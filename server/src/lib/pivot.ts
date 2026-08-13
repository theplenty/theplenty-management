// 사용자 정의 피벗 통계 (로드맵 A8) — 집계 엔진 단일 소스.
//
// 설계 의도:
//   "원하는 주제를 직접 골라 끄는 통계" 가 요구사항이라, 화면마다 집계를 하드코딩하지 않고
//   **축(dimension) 과 측정값(measure) 을 데이터로 선언**해두고 조합만 바꾼다.
//   축을 하나 늘리려면 아래 표에 한 줄 추가하면 화면·API·엑셀에 동시에 반영된다.
//
//   다년 추이(3년 비교)는 별도 기능이 아니라 "열축 = 연도" 인 피벗의 특수 케이스다.
//
// 주의 (과거에 실제로 사고가 났던 지점):
//   - 행사 상태(EventStatus)에는 TEN 이 없다. TEN 은 MICE 문의상태·웨딩 진행단계에만 있다.
//   - 휴지통(soft delete) 레코드는 전부 제외한다. 화면과 숫자가 어긋나면 신뢰를 잃는다.
//   - 홀(halls)은 배열이라 한 행사가 여러 칸에 잡힌다 → 합계가 총 행사 수보다 커진다. 경고를 띄운다.
import { store } from '../store/mockStore.js';
import { normalizeMiceStatus } from '../types.js';
import type { Event, MiceCustomer, WeddingCustomer, QuoteVersion } from '../types.js';

// ── 공용 ───────────────────────────────────────────────────────────────────
const NONE = '(미지정)';

/**
 * 축 라벨 정리.
 * 실데이터에 담당자 필드로 상담 메모 전체(수백 자)가 들어간 레코드가 있었다.
 * 그대로 두면 표가 한 줄에 무너지므로 잘라서 보여준다. 값 자체는 지우지 않는다.
 */
const LABEL_MAX = 40;
function label(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return NONE;
  return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX)}…` : s;
}

function dateOnly(s: string | null | undefined): string {
  return (s || '').slice(0, 10);
}

function yearOf(s: string | null | undefined): string {
  const d = dateOnly(s);
  return d ? d.slice(0, 4) : NONE;
}

function monthOf(s: string | null | undefined): string {
  const d = dateOnly(s);
  return d ? `${Number(d.slice(5, 7))}월` : NONE;
}

function ymOf(s: string | null | undefined): string {
  const d = dateOnly(s);
  return d ? d.slice(0, 7) : NONE;
}

function quarterOf(s: string | null | undefined): string {
  const d = dateOnly(s);
  if (!d) return NONE;
  return `${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}분기`;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function weekdayOf(s: string | null | undefined): string {
  const d = dateOnly(s);
  if (!d) return NONE;
  return `${WEEKDAY[new Date(d).getDay()]}요일`;
}

function bucketOf(n: number | null | undefined, edges: number[], unit: string): string {
  if (n === null || n === undefined) return NONE;
  for (let i = 0; i < edges.length; i++) {
    if (n < edges[i]) return i === 0 ? `~${edges[0]}${unit}` : `${edges[i - 1]}~${edges[i]}${unit}`;
  }
  return `${edges[edges.length - 1]}${unit}~`;
}

// ── 축·측정값 선언 ─────────────────────────────────────────────────────────
export interface FieldDef<T> {
  key: string;
  label: string;
  group: string;
  /** 문자열이면 한 칸, 배열이면 여러 칸에 중복 집계 (홀처럼 다중값인 필드) */
  value: (row: T) => string | string[];
  multi?: boolean;
  /** 라벨 정렬용 가중치. 없으면 사전순. */
  order?: (label: string) => number;
}

export interface MeasureDef<T> {
  key: string;
  label: string;
  unit: 'count' | 'money' | 'number' | 'percent';
  /** count 는 value 불필요 */
  value?: (row: T) => number | null;
  agg: 'count' | 'sum' | 'avg';
  /** percent 전용 — 분자 조건 */
  numerator?: (row: T) => boolean;
}

// ── 데이터셋 1: 행사 ───────────────────────────────────────────────────────
function salesTotalOf(ev: Event): number {
  if (ev.sales_total_amount) return ev.sales_total_amount;
  return store.event_revenue_lines
    .filter((l) => l.event_id === ev.id)
    .reduce((s, l) => s + (l.amount ?? 0), 0);
}

/** 'Hall A+B,Leaf Room' 처럼 콤마로 묶여 저장된 값을 개별 홀로 분해 */
function splitHalls(halls: string[]): string[] {
  const out = (halls || [])
    .flatMap((h) => String(h).split(','))
    .map((h) => h.trim())
    .filter(Boolean);
  return out.length ? [...new Set(out)] : [NONE];
}

const MONTH_ORDER = (l: string) => (l === NONE ? 999 : Number(l.replace('월', '')));
const WEEKDAY_ORDER = (l: string) => {
  const i = WEEKDAY.indexOf(l.replace('요일', ''));
  return i < 0 ? 999 : i;
};

const EVENT_FIELDS: FieldDef<Event>[] = [
  { key: 'year', label: '연도', group: '기간', value: (e) => yearOf(e.start_datetime) },
  { key: 'quarter', label: '분기', group: '기간', value: (e) => quarterOf(e.start_datetime) },
  { key: 'month', label: '월', group: '기간', value: (e) => monthOf(e.start_datetime), order: MONTH_ORDER },
  { key: 'ym', label: '연-월', group: '기간', value: (e) => ymOf(e.start_datetime) },
  { key: 'weekday', label: '요일', group: '기간', value: (e) => weekdayOf(e.start_datetime), order: WEEKDAY_ORDER },
  { key: 'event_type', label: '구분 (MICE/웨딩)', group: '행사', value: (e) => e.event_type },
  { key: 'status', label: '상태', group: '행사', value: (e) => e.status },
  { key: 'usage_type', label: '이용형태', group: '행사', value: (e) => e.usage_type || NONE },
  // 다중값 — 한 행사가 여러 홀을 쓰면 각 홀에 중복 계상된다.
  // 배열 원소 안에 콤마로 묶인 값("Hall A+B,Leaf Room")이 섞여 있어 한 번 더 쪼갠다.
  // (쪼개지 않으면 'Hall A+B,Leaf Room,Ivy Room' 같은 조합이 하나의 홀처럼 잡힌다)
  { key: 'hall', label: '홀', group: '행사', value: (e) => splitHalls(e.halls as string[]), multi: true },
  { key: 'manager', label: '담당자', group: '사람', value: (e) => label(e.assigned_manager_name) },
  { key: 'creator', label: '작성자', group: '사람', value: (e) => label(e.created_by_name) },
  { key: 'seats_bucket', label: '좌석 규모', group: '규모', value: (e) => bucketOf(e.seats, [50, 100, 200, 300, 500], '석') },
  {
    key: 'discount',
    label: '할인 여부',
    group: '금액',
    value: (e) => (e.discount_rate && e.discount_rate > 0 ? '할인 있음' : '할인 없음'),
  },
];

const EVENT_MEASURES: MeasureDef<Event>[] = [
  { key: 'count', label: '행사 건수', unit: 'count', agg: 'count' },
  { key: 'sales_total', label: '실매출 합계', unit: 'money', agg: 'sum', value: (e) => salesTotalOf(e) },
  { key: 'contract_amount', label: '계약금액 합계', unit: 'money', agg: 'sum', value: (e) => e.contract_amount ?? 0 },
  { key: 'sales_avg', label: '건당 평균 매출', unit: 'money', agg: 'avg', value: (e) => salesTotalOf(e) },
  {
    key: 'discount_amount',
    label: '할인액 합계',
    unit: 'money',
    agg: 'sum',
    value: (e) => Math.max(0, (e.contract_amount ?? 0) - salesTotalOf(e)),
  },
  { key: 'gateway_fee', label: '대관료 합계', unit: 'money', agg: 'sum', value: (e) => e.gateway_fee ?? 0 },
  { key: 'seats', label: '좌석 합계', unit: 'number', agg: 'sum', value: (e) => e.seats ?? 0 },
  { key: 'seats_avg', label: '평균 좌석', unit: 'number', agg: 'avg', value: (e) => e.seats ?? 0 },
  { key: 'food_gtd', label: '식음 GTD 합계', unit: 'number', agg: 'sum', value: (e) => e.food_gtd_final ?? e.food_gtd_contract ?? 0 },
];

// ── 데이터셋 2: MICE 문의 ──────────────────────────────────────────────────
// 고객 1건이 문의 여러 건을 가지므로 문의 단위로 펼친다.
export interface MiceInquiryRow {
  customer_id: string;
  organization_name: string;
  mice_category: string;
  status: string;
  channel: string;
  manager: string;
  creator: string;
  call_date: string | null;
  created_at: string;
  /** 체크 4종 중 하나라도 찍혔는지 — 상태가 3분류로 줄면서 '어디까지 갔나'는 이쪽이 답한다 */
  progressed: boolean;
}

function miceRows(): MiceInquiryRow[] {
  const out: MiceInquiryRow[] = [];
  for (const c of store.mice_customers as MiceCustomer[]) {
    if (c.deleted_at) continue;
    for (const q of c.inquiries || []) {
      out.push({
        customer_id: c.id,
        organization_name: c.organization_name,
        mice_category: c.mice_category || NONE,
        status: normalizeMiceStatus(q.progress_status),
        channel: q.inquiry_channel || NONE,
        manager: q.assigned_manager_name || q.created_by_name || NONE,
        creator: q.created_by_name || NONE,
        call_date: q.call_date,
        created_at: q.created_at,
        progressed: !!(q.quote_sent || q.contract_sent || q.contract_replied || q.deposit_paid),
      });
    }
  }
  return out;
}

/** 문의 기준일 — 통화일이 있으면 그것, 없으면 등록일 */
const miceDate = (r: MiceInquiryRow) => r.call_date || r.created_at;

const MICE_FIELDS: FieldDef<MiceInquiryRow>[] = [
  { key: 'year', label: '연도', group: '기간', value: (r) => yearOf(miceDate(r)) },
  { key: 'quarter', label: '분기', group: '기간', value: (r) => quarterOf(miceDate(r)) },
  { key: 'month', label: '월', group: '기간', value: (r) => monthOf(miceDate(r)), order: MONTH_ORDER },
  { key: 'ym', label: '연-월', group: '기간', value: (r) => ymOf(miceDate(r)) },
  { key: 'channel', label: '유입 채널 (인콜/아웃콜)', group: '영업', value: (r) => r.channel },
  { key: 'status', label: '진행 상태', group: '영업', value: (r) => r.status },
  {
    key: 'progressed',
    label: '진행 여부 (견적 이상)',
    group: '영업',
    value: (r) => (r.progressed ? '진행' : '문의만'),
  },
  { key: 'category', label: '고객 분류', group: '고객', value: (r) => r.mice_category },
  { key: 'manager', label: '담당자', group: '사람', value: (r) => label(r.manager) },
  { key: 'creator', label: '작성자', group: '사람', value: (r) => label(r.creator) },
];

const MICE_MEASURES: MeasureDef<MiceInquiryRow>[] = [
  { key: 'count', label: '문의 건수', unit: 'count', agg: 'count' },
  { key: 'def_count', label: '계약(DEF) 건수', unit: 'count', agg: 'sum', value: (r) => (r.status === 'DEF' ? 1 : 0) },
  { key: 'conversion', label: '계약 전환율', unit: 'percent', agg: 'avg', numerator: (r) => r.status === 'DEF' },
  { key: 'lost_rate', label: '실패(LOS) 비율', unit: 'percent', agg: 'avg', numerator: (r) => r.status === 'LOS' },
];

// ── 데이터셋 3: 웨딩 문의 ──────────────────────────────────────────────────
export interface WeddingRow {
  customer_id: string;
  status: string;
  source: string;
  source_detail: string;
  search_keyword: string;
  manager: string;
  inquiry_date: string | null;
  created_at: string;
  guest_count: number | null;
}

function weddingRows(): WeddingRow[] {
  const out: WeddingRow[] = [];
  for (const c of store.wedding_customers as WeddingCustomer[]) {
    if (c.deleted_at) continue;
    const first = (c.event_inquiries || [])[0];
    out.push({
      customer_id: c.id,
      status: c.progress_status,
      source: c.source || NONE,
      source_detail: c.source_detail || NONE,
      search_keyword: c.search_keyword || NONE,
      manager: first?.assigned_manager_name || NONE,
      inquiry_date: c.inquiry_date,
      created_at: c.created_at,
      guest_count: first?.guaranteed_guest_count ?? null,
    });
  }
  return out;
}

const weddingDate = (r: WeddingRow) => r.inquiry_date || r.created_at;

const WEDDING_FIELDS: FieldDef<WeddingRow>[] = [
  { key: 'year', label: '연도', group: '기간', value: (r) => yearOf(weddingDate(r)) },
  { key: 'quarter', label: '분기', group: '기간', value: (r) => quarterOf(weddingDate(r)) },
  { key: 'month', label: '월', group: '기간', value: (r) => monthOf(weddingDate(r)), order: MONTH_ORDER },
  { key: 'ym', label: '연-월', group: '기간', value: (r) => ymOf(weddingDate(r)) },
  { key: 'status', label: '진행 단계', group: '영업', value: (r) => r.status },
  { key: 'source', label: '유입 경로', group: '마케팅', value: (r) => label(r.source) },
  { key: 'source_detail', label: '유입 상세', group: '마케팅', value: (r) => label(r.source_detail) },
  { key: 'search_keyword', label: '검색 키워드', group: '마케팅', value: (r) => label(r.search_keyword) },
  { key: 'manager', label: '담당지배인', group: '사람', value: (r) => label(r.manager) },
  { key: 'guest_bucket', label: '보증인원 규모', group: '규모', value: (r) => bucketOf(r.guest_count, [50, 100, 150, 200], '명') },
];

const WEDDING_MEASURES: MeasureDef<WeddingRow>[] = [
  { key: 'count', label: '문의 건수', unit: 'count', agg: 'count' },
  { key: 'def_count', label: '계약(DEF) 건수', unit: 'count', agg: 'sum', value: (r) => (r.status === 'DEF' ? 1 : 0) },
  { key: 'conversion', label: '계약 전환율', unit: 'percent', agg: 'avg', numerator: (r) => r.status === 'DEF' },
  { key: 'guest_avg', label: '평균 보증인원', unit: 'number', agg: 'avg', value: (r) => r.guest_count ?? 0 },
];

// ── 데이터셋 4: 견적 (B2) ──────────────────────────────────────────────────
// 예전에는 계산기 입력이 통짜 JSON 이라 "할인 10% 이상 준 견적" 같은 걸 셀 수 없었다.
// 1급 엔티티로 올리면서 축으로 바로 쓸 수 있게 됐다.
function quoteRows() {
  return store.quote_versions.filter((q) => !!q.inquiry_id);
}

const QUOTE_FIELDS: FieldDef<QuoteVersion>[] = [
  { key: 'year', label: '연도 (예식일)', group: '기간', value: (q) => yearOf(q.wedding_date) },
  { key: 'month', label: '월 (예식일)', group: '기간', value: (q) => monthOf(q.wedding_date), order: MONTH_ORDER },
  { key: 'weekday', label: '요일 (예식일)', group: '기간', value: (q) => weekdayOf(q.wedding_date), order: WEEKDAY_ORDER },
  { key: 'issued_year', label: '연도 (견적 발행)', group: '기간', value: (q) => yearOf(q.created_at) },
  { key: 'slot', label: '예식 시간대', group: '조건', value: (q) => label(q.slot) },
  { key: 'course', label: '코스', group: '조건', value: (q) => label(q.course) },
  { key: 'customer_type', label: '고객 유형', group: '조건', value: (q) => label(q.customer_type) },
  { key: 'discount', label: '식대 할인율', group: '조건', value: (q) => (q.meal_discount_rate ? `${q.meal_discount_rate}%` : '할인 없음'), order: (l) => (l === '할인 없음' ? -1 : parseFloat(l)) },
  { key: 'guest_bucket', label: '보증인원 규모', group: '규모', value: (q) => bucketOf(q.guests, [150, 200, 250, 300], '명') },
  { key: 'flower_give', label: '제공 플라워 등급', group: '조건', value: (q) => label(q.flower_give) },
  { key: 'flower_upgrade', label: '플라워 업그레이드', group: '조건', value: (q) => (q.flower_upgrade ? '적용' : '미적용') },
  { key: 'noodle', label: '웨딩국수', group: '조건', value: (q) => (q.noodle ? '포함' : '미포함') },
  { key: 'author', label: '작성자', group: '사람', value: (q) => label(q.created_by_name) },
  { key: 'version', label: '견적 회차', group: '이력', value: (q) => `${q.version}차` , order: (l) => parseInt(l) },
];

const QUOTE_MEASURES: MeasureDef<QuoteVersion>[] = [
  { key: 'count', label: '견적 건수', unit: 'count', agg: 'count' },
  { key: 'amount_sum', label: '견적금액 합계', unit: 'money', agg: 'sum', value: (q) => q.total_amount },
  { key: 'amount_avg', label: '건당 평균 견적금액', unit: 'money', agg: 'avg', value: (q) => q.total_amount },
  { key: 'per_guest', label: '1인당 견적금액', unit: 'money', agg: 'avg', value: (q) => (q.guests ? q.total_amount / q.guests : 0) },
  { key: 'guests_avg', label: '평균 보증인원', unit: 'number', agg: 'avg', value: (q) => q.guests },
  { key: 'discount_avg', label: '평균 식대 할인율', unit: 'number', agg: 'avg', value: (q) => q.meal_discount_rate },
  { key: 'benefit_sum', label: '총 혜택 합계', unit: 'money', agg: 'sum', value: (q) => q.total_benefit },
];

// ── 데이터셋 레지스트리 ────────────────────────────────────────────────────
export type DatasetId = 'events' | 'mice' | 'wedding' | 'quotes';

interface Dataset<T> {
  id: DatasetId;
  label: string;
  hint: string;
  rows: () => T[];
  /** 기간 필터가 기준으로 삼는 날짜 */
  dateOf: (row: T) => string | null;
  fields: FieldDef<T>[];
  measures: MeasureDef<T>[];
}

const DATASETS: { [K in DatasetId]: Dataset<never> } = {
  events: {
    id: 'events',
    label: '행사',
    hint: '캘린더에 등록된 행사 기준. 휴지통 제외.',
    rows: () => (store.events as Event[]).filter((e) => !e.deleted_at),
    dateOf: (e: Event) => e.start_datetime,
    fields: EVENT_FIELDS,
    measures: EVENT_MEASURES,
  } as unknown as Dataset<never>,
  mice: {
    id: 'mice',
    label: 'MICE 문의',
    hint: '기업/학회 문의 건 기준 (고객 1곳에 문의 여러 건).',
    rows: miceRows,
    dateOf: miceDate,
    fields: MICE_FIELDS,
    measures: MICE_MEASURES,
  } as unknown as Dataset<never>,
  wedding: {
    id: 'wedding',
    label: '웨딩 문의',
    hint: '웨딩 고객 기준 (고객 1건 = 문의 1건).',
    rows: weddingRows,
    dateOf: weddingDate,
    fields: WEDDING_FIELDS,
    measures: WEDDING_MEASURES,
  } as unknown as Dataset<never>,
  quotes: {
    id: 'quotes',
    label: '웨딩 견적',
    hint: '발행한 견적 버전 기준. 같은 고객에 여러 번 냈으면 각각 한 건.',
    rows: quoteRows,
    // 기간 필터는 '언제 발행했는지' 기준. 예식일 기준으로 보고 싶으면 축에서 고르면 된다.
    dateOf: (q: QuoteVersion) => q.created_at,
    fields: QUOTE_FIELDS,
    measures: QUOTE_MEASURES,
  } as unknown as Dataset<never>,
};

export function datasetMeta() {
  return (Object.keys(DATASETS) as DatasetId[]).map((id) => {
    const d = DATASETS[id] as unknown as Dataset<unknown>;
    return {
      id,
      label: d.label,
      hint: d.hint,
      fields: d.fields.map((f) => ({ key: f.key, label: f.label, group: f.group, multi: !!f.multi })),
      measures: d.measures.map((m) => ({ key: m.key, label: m.label, unit: m.unit })),
    };
  });
}

// ── 피벗 계산 ──────────────────────────────────────────────────────────────
export interface PivotRequest {
  dataset: DatasetId;
  row_field: string;
  col_field?: string | null;
  measure: string;
  date_from?: string | null;
  date_to?: string | null;
  /** 축 key → 허용 라벨 목록. 비어 있으면 전체. */
  filters?: Record<string, string[]>;
  /** 상위 N개 행만 (나머지는 '기타'로 합산). 0/미지정이면 전체 */
  top_rows?: number;
}

export interface PivotResult {
  dataset: DatasetId;
  row_field: string;
  col_field: string | null;
  measure: string;
  measure_label: string;
  unit: string;
  row_labels: string[];
  col_labels: string[];
  /** cells[rowIndex][colIndex] */
  cells: (number | null)[][];
  row_totals: (number | null)[];
  col_totals: (number | null)[];
  grand_total: number | null;
  source_count: number;
  warnings: string[];
}

interface Bucket {
  sum: number;
  count: number;
  hits: number; // percent 측정의 분자
}

function emptyBucket(): Bucket {
  return { sum: 0, count: 0, hits: 0 };
}

function finalize(b: Bucket | undefined, m: MeasureDef<unknown>): number | null {
  if (!b || b.count === 0) return null;
  if (m.unit === 'percent') return b.count === 0 ? null : (b.hits / b.count) * 100;
  if (m.agg === 'count') return b.count;
  if (m.agg === 'avg') return b.sum / b.count;
  return b.sum;
}

function sortLabels(labels: string[], f: FieldDef<unknown>): string[] {
  return labels.sort((a, b) => {
    if (a === NONE) return 1;
    if (b === NONE) return -1;
    if (f.order) return f.order(a) - f.order(b);
    return a.localeCompare(b, 'ko');
  });
}

export function runPivot(req: PivotRequest): PivotResult {
  const ds = DATASETS[req.dataset] as unknown as Dataset<unknown>;
  if (!ds) throw new Error(`unknown_dataset:${req.dataset}`);

  const rowField = ds.fields.find((f) => f.key === req.row_field);
  if (!rowField) throw new Error(`unknown_row_field:${req.row_field}`);
  const colField = req.col_field ? ds.fields.find((f) => f.key === req.col_field) : null;
  if (req.col_field && !colField) throw new Error(`unknown_col_field:${req.col_field}`);
  const measure = ds.measures.find((m) => m.key === req.measure);
  if (!measure) throw new Error(`unknown_measure:${req.measure}`);

  const warnings: string[] = [];
  let rows = ds.rows();

  // 기간 필터
  if (req.date_from || req.date_to) {
    rows = rows.filter((r) => {
      const d = dateOnly(ds.dateOf(r));
      if (!d) return false;
      if (req.date_from && d < req.date_from) return false;
      if (req.date_to && d > req.date_to) return false;
      return true;
    });
  }

  // 축 값 기준 필터
  for (const [key, allowed] of Object.entries(req.filters || {})) {
    if (!allowed?.length) continue;
    const f = ds.fields.find((x) => x.key === key);
    if (!f) continue;
    const set = new Set(allowed);
    rows = rows.filter((r) => {
      const v = f.value(r);
      return Array.isArray(v) ? v.some((x) => set.has(x)) : set.has(v);
    });
  }

  const asArray = (v: string | string[]) => (Array.isArray(v) ? v : [v]);
  if (rowField.multi || colField?.multi) {
    warnings.push(
      `'${(rowField.multi ? rowField : colField!).label}' 은(는) 한 건이 여러 값을 가질 수 있어 합계가 실제 건수보다 클 수 있습니다.`
    );
  }

  const grid = new Map<string, Map<string, Bucket>>();
  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  const ALL = '__all__';

  for (const r of rows) {
    const rls = asArray(rowField.value(r));
    const cls = colField ? asArray(colField.value(r)) : [ALL];
    const val = measure.value ? measure.value(r) : 1;
    const hit = measure.numerator ? (measure.numerator(r) ? 1 : 0) : 0;
    for (const rl of rls) {
      rowSet.add(rl);
      let byCol = grid.get(rl);
      if (!byCol) grid.set(rl, (byCol = new Map()));
      for (const cl of cls) {
        if (cl !== ALL) colSet.add(cl);
        let b = byCol.get(cl);
        if (!b) byCol.set(cl, (b = emptyBucket()));
        b.count += 1;
        b.sum += val ?? 0;
        b.hits += hit;
      }
    }
  }

  let row_labels = sortLabels([...rowSet], rowField);
  const col_labels = colField ? sortLabels([...colSet], colField) : [];

  // 상위 N개만 보기 — 축 값이 수백 개인 경우(검색 키워드 등) 표가 무너지는 걸 막는다.
  if (req.top_rows && row_labels.length > req.top_rows) {
    const scored = row_labels
      .map((rl) => {
        const byCol = grid.get(rl)!;
        let n = 0;
        for (const b of byCol.values()) n += b.count;
        return { rl, n };
      })
      .sort((a, b) => b.n - a.n);
    const keep = new Set(scored.slice(0, req.top_rows).map((s) => s.rl));
    warnings.push(`행이 ${row_labels.length}개라 상위 ${req.top_rows}개만 표시합니다.`);
    row_labels = row_labels.filter((rl) => keep.has(rl));
  }

  const colKeys = colField ? col_labels : [ALL];
  const cells: (number | null)[][] = row_labels.map((rl) => {
    const byCol = grid.get(rl);
    return colKeys.map((ck) => finalize(byCol?.get(ck), measure as MeasureDef<unknown>));
  });

  // 합계는 셀 값을 더하는 게 아니라 원본에서 다시 집계한다.
  // (평균·비율을 더하면 틀린 숫자가 나오기 때문)
  const rowAgg = new Map<string, Bucket>();
  const colAgg = new Map<string, Bucket>();
  const grand = emptyBucket();
  for (const rl of row_labels) {
    const byCol = grid.get(rl);
    if (!byCol) continue;
    const rb = emptyBucket();
    for (const [ck, b] of byCol) {
      if (colField && !col_labels.includes(ck)) continue;
      rb.sum += b.sum; rb.count += b.count; rb.hits += b.hits;
      const cb = colAgg.get(ck) || emptyBucket();
      cb.sum += b.sum; cb.count += b.count; cb.hits += b.hits;
      colAgg.set(ck, cb);
      grand.sum += b.sum; grand.count += b.count; grand.hits += b.hits;
    }
    rowAgg.set(rl, rb);
  }

  return {
    dataset: req.dataset,
    row_field: rowField.key,
    col_field: colField?.key ?? null,
    measure: measure.key,
    measure_label: measure.label,
    unit: measure.unit,
    row_labels,
    col_labels,
    cells,
    row_totals: row_labels.map((rl) => finalize(rowAgg.get(rl), measure as MeasureDef<unknown>)),
    col_totals: colKeys.map((ck) => finalize(colAgg.get(ck), measure as MeasureDef<unknown>)),
    grand_total: finalize(grand, measure as MeasureDef<unknown>),
    source_count: rows.length,
    warnings,
  };
}

// ── 전환 퍼널 ──────────────────────────────────────────────────────────────
// 피벗으로는 "단계별 잔존" 을 표현하기 어려워 별도로 둔다.
// MICE 와 웨딩은 단계 정의가 다르므로(웨딩에만 상담 단계가 있다) 분리한다.
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  /** 첫 단계 대비 % */
  rate_from_start: number;
  /** 직전 단계 대비 % */
  rate_from_prev: number;
}

export interface FunnelResult {
  type: 'MICE' | 'WEDDING';
  channel: string | null;
  total: number;
  stages: FunnelStage[];
}

// 문의 상태는 '현재 상태' 스냅샷이므로, 뒤 단계에 도달한 건은 앞 단계도 통과한 것으로 센다.
// 진행상황이 3분류(문의/DEF/LOS)로 줄어 중간 단계를 상태로 표현할 수 없다.
// 어디까지 갔는지는 체크 4종이 들고 있으므로 가운데 단계는 runFunnel 에서 체크로 판정한다.
const MICE_FUNNEL: { key: string; label: string; reached: string[]; needsProgress?: boolean }[] = [
  { key: 'inquiry', label: '문의 접수', reached: ['문의', '단순문의', 'INQ', 'TEN', 'DEF', 'LOS'] },
  { key: 'progress', label: '진행 (견적 이상)', reached: ['문의', '단순문의', 'INQ', 'TEN', 'DEF'], needsProgress: true },
  { key: 'def', label: '계약 확정 (DEF)', reached: ['DEF'] },
];

const WEDDING_FUNNEL: { key: string; label: string; reached: string[] }[] = [
  { key: 'inquiry', label: '신규 문의', reached: ['신규문의', '상담', '상담취소', 'INQ', 'TEN', 'DEF', 'LOS'] },
  { key: 'consult', label: '상담 진행', reached: ['상담', 'INQ', 'TEN', 'DEF', 'LOS'] },
  { key: 'inq', label: '가예약 (INQ)', reached: ['INQ', 'TEN', 'DEF'] },
  { key: 'ten', label: '가계약 (TEN)', reached: ['TEN', 'DEF'] },
  { key: 'def', label: '계약 확정 (DEF)', reached: ['DEF'] },
];

export function runFunnel(opts: {
  type: 'MICE' | 'WEDDING';
  from?: string | null;
  to?: string | null;
  channel?: string | null;
}): FunnelResult {
  const inRange = (d: string | null) => {
    const s = dateOnly(d);
    if (!s) return false;
    if (opts.from && s < opts.from) return false;
    if (opts.to && s > opts.to) return false;
    return true;
  };

  // 상태만으로는 중간 단계를 못 세므로 (status, progressed) 쌍으로 다룬다.
  let marks: { status: string; progressed: boolean }[];
  let spec: typeof MICE_FUNNEL;
  if (opts.type === 'MICE') {
    let rows = miceRows().filter((r) => inRange(miceDate(r)));
    if (opts.channel) rows = rows.filter((r) => r.channel === opts.channel);
    marks = rows.map((r) => ({ status: r.status, progressed: r.progressed }));
    spec = MICE_FUNNEL;
  } else {
    const rows = weddingRows().filter((r) => inRange(weddingDate(r)));
    // 웨딩은 진행단계가 아직 상태값으로 표현된다 — 체크 개념이 없어 항상 true 로 둔다.
    marks = rows.map((r) => ({ status: r.status, progressed: true }));
    spec = WEDDING_FUNNEL;
  }

  const total = marks.length;
  let prev = 0;
  const stages: FunnelStage[] = spec.map((s, i) => {
    const set = new Set(s.reached);
    const count = marks.filter(
      (m) => set.has(m.status) && (!s.needsProgress || m.progressed || m.status === 'DEF')
    ).length;
    const stage: FunnelStage = {
      key: s.key,
      label: s.label,
      count,
      rate_from_start: total ? (count / total) * 100 : 0,
      rate_from_prev: i === 0 ? 100 : prev ? (count / prev) * 100 : 0,
    };
    prev = count;
    return stage;
  });

  return { type: opts.type, channel: opts.channel ?? null, total, stages };
}
