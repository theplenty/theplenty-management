// 세일즈 중심 대시보드 통계 — 유입 채널(INCALL/OUTCALL) + 전환 추적.
// MICE: 인콜/아웃콜 분리. WEDDING: 상담예약/취소 흐름.
//
// 전환 계산 기준: 현재 progress_status (이력 mining 안 함).
//   - 동일 건의 status 가 INCALL→INQ→DEF 로 변경됐다면 → DEF 전환 1건으로 카운트 (중복 X)
//   - "단순문의" 상태를 "미처리" 로 간주

import { todayKst } from './dateFmt';
import { normalizeMiceStatus, miceStatusGroup } from '../types';
import type {
  MiceCustomer,
  MiceInquiry,
  MiceInquiryStatus,
  WeddingCustomer,
  WeddingProgressStatus,
} from '../types';

// ===== 공통 기간 =====
export interface DateRange {
  fromIso: string; // inclusive
  toIso: string; // exclusive
}

export function todayRange(now = new Date()): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400_000);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export function thisWeekRange(now = new Date()): DateRange {
  const d = new Date(now);
  const day = d.getDay(); // 0=일, 1=월, ...
  const monOffset = (day + 6) % 7; // 월요일 시작
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - monOffset);
  const nextMon = new Date(monday.getTime() + 7 * 86400_000);
  return { fromIso: monday.toISOString(), toIso: nextMon.toISOString() };
}

export function thisMonthRange(now = new Date()): DateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export function customRange(fromYmd: string, toYmd: string): DateRange {
  // YYYY-MM-DD 형식. to 는 inclusive 이지만 toIso 는 다음날 00:00 (exclusive 변환).
  const f = new Date(fromYmd + 'T00:00');
  const tDay = new Date(toYmd + 'T00:00');
  const t = new Date(tDay.getTime() + 86400_000);
  return { fromIso: f.toISOString(), toIso: t.toISOString() };
}

function inRange(iso: string | null | undefined, range: DateRange): boolean {
  if (!iso) return false;
  return iso >= range.fromIso && iso < range.toIso;
}

// ===== MICE 세일즈 통계 =====

// 진행상황이 3분류(문의/DEF/LOS)로 줄면서 '미처리' 를 상태만으로는 가릴 수 없게 됐다.
// 예전 기준(단순문의)을 그대로 두면 문의 전체가 미처리로 잡힌다.
// → **아무 진전이 없는 문의**로 다시 정의한다: 상태가 '문의' 이고 체크 4종이 전부 비어 있는 것.
//    체크가 하나라도 찍혔으면 최소한 견적은 나갔다는 뜻이라 '진행' 으로 센다.
const MICE_DEF_STATUSES = new Set<MiceInquiryStatus>(['DEF']);
const MICE_LOS_STATUSES = new Set<MiceInquiryStatus>(['LOS']);

function hasProgressChecks(inq: MiceInquiry): boolean {
  return !!(inq.quote_sent || inq.contract_sent || inq.contract_replied || inq.deposit_paid);
}
function isUnprocessed(inq: MiceInquiry): boolean {
  return miceStatusGroup(inq.progress_status) === '문의' && !hasProgressChecks(inq);
}

export interface InquiryWithCustomer {
  inquiry: MiceInquiry;
  customer: MiceCustomer;
  inquiryIndex: number; // 0-based, 같은 고객 내 문의 순서
}

// 한 고객 → 모든 (inquiry, customer, index) 평탄화
export function flattenMiceInquiries(customers: MiceCustomer[]): InquiryWithCustomer[] {
  const out: InquiryWithCustomer[] = [];
  for (const c of customers) {
    if (c.deleted_at) continue;
    c.inquiries.forEach((inq, idx) => {
      out.push({ inquiry: inq, customer: c, inquiryIndex: idx });
    });
  }
  return out;
}

export interface MiceChannelMetrics {
  total: number;
  unprocessed: number; // 문의 상태 + 체크 4종 전부 비어 있음 (아무 진전 없음)
  inq: number; // 문의 상태 + 체크 하나 이상 (견적 이상 나감)
  def: number;
  los: number;
  conversionRate: number; // (INQ + DEF + LOS) / total — 미처리 외 비율
}

export function computeMiceChannelMetrics(
  flat: InquiryWithCustomer[],
  channel: 'INCALL' | 'OUTCALL',
  range: DateRange | null,
  managerId: string | null
): MiceChannelMetrics {
  let total = 0;
  let unprocessed = 0;
  let inq = 0;
  let def = 0;
  let los = 0;
  for (const f of flat) {
    if (f.inquiry.inquiry_channel !== channel) continue;
    if (range && !inRange(f.inquiry.created_at, range)) continue;
    if (managerId && f.inquiry.assigned_manager_id !== managerId) continue;
    total += 1;
    const s = f.inquiry.progress_status;
    if (MICE_DEF_STATUSES.has(miceStatusGroup(s))) def += 1;
    else if (MICE_LOS_STATUSES.has(miceStatusGroup(s))) los += 1;
    else if (isUnprocessed(f.inquiry)) unprocessed += 1;
    else inq += 1; // 문의 상태 + 체크 하나 이상 = 진행 중
  }
  const converted = inq + def + los;
  const conversionRate = total > 0 ? (converted / total) * 100 : 0;
  return { total, unprocessed, inq, def, los, conversionRate };
}

// 미처리 인콜 (특정 일수 이상 방치된)
export interface StaleInquiry extends InquiryWithCustomer {
  ageDays: number;
}
export function findStaleIncalls(
  flat: InquiryWithCustomer[],
  minAgeDays: number,
  now = new Date()
): StaleInquiry[] {
  const stale: StaleInquiry[] = [];
  for (const f of flat) {
    if (f.inquiry.inquiry_channel !== 'INCALL') continue;
    if (!isUnprocessed(f.inquiry)) continue;
    const created = new Date(f.inquiry.created_at).getTime();
    if (isNaN(created)) continue;
    const ageDays = Math.floor((now.getTime() - created) / 86400_000);
    if (ageDays >= minAgeDays) stale.push({ ...f, ageDays });
  }
  return stale.sort((a, b) => b.ageDays - a.ageDays);
}

// 최근 아웃콜
export function findRecentOutcalls(
  flat: InquiryWithCustomer[],
  limit = 20
): InquiryWithCustomer[] {
  return flat
    .filter((f) => f.inquiry.inquiry_channel === 'OUTCALL')
    .sort((a, b) => (a.inquiry.created_at < b.inquiry.created_at ? 1 : -1))
    .slice(0, limit);
}

// 담당자별 전환율
export interface ManagerConversion {
  id: string;
  name: string;
  total: number;
  converted: number;
  rate: number;
}
export function computeManagerConversionRates(
  flat: InquiryWithCustomer[],
  channel: 'INCALL' | 'OUTCALL' | null
): ManagerConversion[] {
  const byManager = new Map<string, { id: string; name: string; total: number; converted: number }>();
  for (const f of flat) {
    if (channel && f.inquiry.inquiry_channel !== channel) continue;
    const id = f.inquiry.assigned_manager_id || '__none';
    const name = f.inquiry.assigned_manager_name || '미지정';
    const entry = byManager.get(id) || { id, name, total: 0, converted: 0 };
    entry.total += 1;
    if (!isUnprocessed(f.inquiry)) entry.converted += 1;
    byManager.set(id, entry);
  }
  return Array.from(byManager.values())
    .map((m) => ({ ...m, rate: m.total > 0 ? (m.converted / m.total) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}

// ===== WEDDING 세일즈 통계 =====

// 진행단계 분류
const WEDDING_INFLOW_STATUSES = new Set<WeddingProgressStatus>(['신규문의']); // 인콜 직후
const WEDDING_CONSULT_STATUSES = new Set<WeddingProgressStatus>(['상담']);
const WEDDING_CONSULT_CANCELLED = new Set<WeddingProgressStatus>(['상담취소']);
const WEDDING_INQ_STATUSES = new Set<WeddingProgressStatus>(['INQ', 'TEN']);
const WEDDING_DEF_STATUSES = new Set<WeddingProgressStatus>(['DEF']);
const WEDDING_LOS_STATUSES = new Set<WeddingProgressStatus>(['LOS']);

export interface WeddingMetrics {
  totalInflow: number; // 모든 status (현재 status 무관하게 신규 들어온 수)
  consultBooked: number; // 상담 예약 (진행단계 = 상담 + 그 이후 INQ/DEF/LOS)
  consultCancelled: number;
  inq: number;
  def: number;
  los: number;
  newOnly: number; // 신규문의 상태로 남아 있음 (방치)
  advancedPastConsult: number; // 상담 이상 도달 (상담 + INQ + DEF + LOS) — DEF 전환율 분모
  consultConversionRate: number; // (상담 + 후속전환) / 인콜
  defRate: number; // DEF / 인콜 (전체 깔때기 기준)
  consultToDefRate: number; // DEF / 상담 이상 도달 (상담 단계 도달 후 확정 비율)
}

export function computeWeddingMetrics(
  customers: WeddingCustomer[],
  range: DateRange | null,
  managerId: string | null
): WeddingMetrics {
  let totalInflow = 0;
  let consultBooked = 0;
  let consultCancelled = 0;
  let inq = 0;
  let def = 0;
  let los = 0;
  let newOnly = 0;
  for (const c of customers) {
    if (c.deleted_at) continue;
    // 매니저 필터 — 첫 event_inquiry 의 담당자 기준
    if (managerId) {
      const mgr = c.event_inquiries[0]?.assigned_manager_id;
      if (mgr !== managerId) continue;
    }
    // 기간 필터 — inquiry_date 또는 created_at
    const inflowIso = c.inquiry_date || c.created_at;
    if (range && !inRange(inflowIso, range)) continue;
    totalInflow += 1;
    const s = c.progress_status;
    if (WEDDING_INFLOW_STATUSES.has(s)) newOnly += 1;
    if (WEDDING_CONSULT_STATUSES.has(s)) consultBooked += 1;
    if (WEDDING_CONSULT_CANCELLED.has(s)) consultCancelled += 1;
    if (WEDDING_INQ_STATUSES.has(s)) inq += 1;
    if (WEDDING_DEF_STATUSES.has(s)) def += 1;
    if (WEDDING_LOS_STATUSES.has(s)) los += 1;
  }
  // 상담 전환율 = (상담 + 후속 전환단계: INQ/DEF/LOS) / 전체 인콜
  // 즉 '상담취소'와 '신규문의 방치' 제외
  const advancedPastConsult = consultBooked + inq + def + los;
  const consultConversionRate = totalInflow > 0 ? (advancedPastConsult / totalInflow) * 100 : 0;
  const defRate = totalInflow > 0 ? (def / totalInflow) * 100 : 0;
  // 상담→DEF 전환율 = 상담 단계 이상 도달한 건 중 DEF로 확정된 비율
  const consultToDefRate = advancedPastConsult > 0 ? (def / advancedPastConsult) * 100 : 0;
  return {
    totalInflow,
    consultBooked,
    consultCancelled,
    inq,
    def,
    los,
    newOnly,
    advancedPastConsult,
    consultConversionRate,
    defRate,
    consultToDefRate,
  };
}

// 상담 예정 / 상담 취소 / 장기 미전환 리스트
// range 전달 시 신규문의일자(inquiry_date, fallback created_at) 기준으로 필터.
export function findScheduledConsultations(
  customers: WeddingCustomer[],
  range: DateRange | null = null,
  now = new Date()
): WeddingCustomer[] {
  // UTC 기준이면 오전 9시 이전에 '오늘'이 하루 밀린다 — KST 기준으로 구한다.
  const today = todayKst(now);
  return customers
    .filter((c) => !c.deleted_at)
    .filter((c) => c.progress_status === '상담' || (c.desired_consultation_date && c.desired_consultation_date >= today))
    .filter((c) => !range || inRange(c.inquiry_date || c.created_at, range))
    .sort((a, b) => {
      const ad = a.desired_consultation_date || '';
      const bd = b.desired_consultation_date || '';
      return ad < bd ? -1 : 1;
    });
}

export function findCancelledConsultations(customers: WeddingCustomer[]): WeddingCustomer[] {
  return customers
    .filter((c) => !c.deleted_at && c.progress_status === '상담취소')
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

// ===== 드릴다운 (KPI 카드 클릭) 헬퍼 =====
// 카드 클릭 시 실제로 어떤 건들이 카운트됐는지 리스트로 보여주기 위한 필터.

export type MiceStatusGroup =
  | 'all'
  | 'unprocessed' // 단순문의
  | 'inq' // INQ + TEN
  | 'def'
  | 'los'
  | 'converted'; // INQ + DEF + LOS (=전환)

export function filterMiceForDrill(
  flat: InquiryWithCustomer[],
  channel: 'INCALL' | 'OUTCALL' | null,
  statusGroup: MiceStatusGroup,
  range: DateRange | null,
  managerId: string | null
): InquiryWithCustomer[] {
  return flat
    .filter((f) => {
      if (channel && f.inquiry.inquiry_channel !== channel) return false;
      if (range && !inRange(f.inquiry.created_at, range)) return false;
      if (managerId && f.inquiry.assigned_manager_id !== managerId) return false;
      const s = f.inquiry.progress_status;
      if (statusGroup === 'all') return true;
      if (statusGroup === 'unprocessed') return isUnprocessed(f.inquiry);
      // '진행' = 문의 상태이지만 체크가 하나라도 찍힌 것
      if (statusGroup === 'inq') return miceStatusGroup(s) === '문의' && hasProgressChecks(f.inquiry);
      if (statusGroup === 'def') return MICE_DEF_STATUSES.has(miceStatusGroup(s));
      if (statusGroup === 'los') return MICE_LOS_STATUSES.has(miceStatusGroup(s));
      if (statusGroup === 'converted') return !isUnprocessed(f.inquiry);
      return true;
    })
    .sort((a, b) => (a.inquiry.created_at < b.inquiry.created_at ? 1 : -1));
}

export type WeddingStatusGroup =
  | 'all'
  | 'newOnly' // 신규문의 방치
  | 'consult' // 상담 예약
  | 'consultCancelled'
  | 'inq'
  | 'def'
  | 'los'
  | 'advancedPastConsult'; // 상담 + INQ + DEF + LOS (= 상담 전환)

export function filterWeddingForDrill(
  customers: WeddingCustomer[],
  statusGroup: WeddingStatusGroup,
  range: DateRange | null,
  managerId: string | null
): WeddingCustomer[] {
  return customers
    .filter((c) => {
      if (c.deleted_at) return false;
      if (managerId) {
        const mgr = c.event_inquiries[0]?.assigned_manager_id;
        if (mgr !== managerId) return false;
      }
      const inflowIso = c.inquiry_date || c.created_at;
      if (range && !inRange(inflowIso, range)) return false;
      const s = c.progress_status;
      if (statusGroup === 'all') return true;
      if (statusGroup === 'newOnly') return WEDDING_INFLOW_STATUSES.has(s);
      if (statusGroup === 'consult') return WEDDING_CONSULT_STATUSES.has(s);
      if (statusGroup === 'consultCancelled') return WEDDING_CONSULT_CANCELLED.has(s);
      if (statusGroup === 'inq') return WEDDING_INQ_STATUSES.has(s);
      if (statusGroup === 'def') return WEDDING_DEF_STATUSES.has(s);
      if (statusGroup === 'los') return WEDDING_LOS_STATUSES.has(s);
      if (statusGroup === 'advancedPastConsult') {
        return (
          WEDDING_CONSULT_STATUSES.has(s) ||
          WEDDING_INQ_STATUSES.has(s) ||
          WEDDING_DEF_STATUSES.has(s) ||
          WEDDING_LOS_STATUSES.has(s)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const ad = a.inquiry_date || a.created_at;
      const bd = b.inquiry_date || b.created_at;
      return ad < bd ? 1 : -1;
    });
}

// 장기 미전환 = 신규문의 또는 상담 상태로 N일 이상 방치
// range 전달 시 신규문의일자(inquiry_date, fallback created_at) 기준으로 필터.
export function findStaleWedding(
  customers: WeddingCustomer[],
  minAgeDays: number,
  range: DateRange | null = null,
  now = new Date()
): Array<{ customer: WeddingCustomer; ageDays: number }> {
  const out: Array<{ customer: WeddingCustomer; ageDays: number }> = [];
  for (const c of customers) {
    if (c.deleted_at) continue;
    if (c.progress_status !== '신규문의' && c.progress_status !== '상담') continue;
    const baseIso = c.inquiry_date || c.created_at;
    if (range && !inRange(baseIso, range)) continue;
    const created = new Date(baseIso).getTime();
    if (isNaN(created)) continue;
    const ageDays = Math.floor((now.getTime() - created) / 86400_000);
    if (ageDays >= minAgeDays) out.push({ customer: c, ageDays });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

// ===== MICE 월별 세일즈 표 (문의 → 견적 → 계약) =====
//
// 사장님이 손으로 만들던 월별 표의 재현. 귀속 기준은 **접수월(코호트)** —
// "6월에 들어온 문의가 이후 어디까지 갔나" 를 센다.
// 체크(견적서 등)에는 켠 시각이 없어서 "6월에 견적을 몇 건 보냈나(활동월)" 는
// 과거 데이터로는 계산이 불가능하다. 이제부터는 체크 시각을 서버가 기록하므로
// 데이터가 쌓이면 활동월 기준도 만들 수 있다.
// 아웃콜은 행에서 제외(껍데기 정리 후 체계적 기록이 없음) — 인콜 채널만 센다.
export interface MiceMonthlyRow {
  month: number; // 1~12
  received: number; // 문의 접수 (인콜)
  quoted: number; // 그중 견적서 발송 체크
  contracted: number; // 그중 확정(DEF)
  notContracted: number; // 견적 발송 후 미계약 = 견적 발송 && 확정 아님 (취소·진행 중 포함)
  holding: number; // 견적+계약서 발송했는데 아직 '문의' 상태 (결론 안 남)
}

export function computeMiceMonthlyTable(customers: MiceCustomer[], year: number): MiceMonthlyRow[] {
  const rows: MiceMonthlyRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, received: 0, quoted: 0, contracted: 0, notContracted: 0, holding: 0,
  }));
  for (const c of customers) {
    if (c.deleted_at) continue;
    for (const q of c.inquiries || []) {
      if (q.inquiry_channel === 'OUTCALL') continue;
      // 귀속월 = 통화일 우선, 없으면 등록일
      const base = (q.call_date || q.created_at || '').slice(0, 10);
      if (!base.startsWith(String(year))) continue;
      const m = parseInt(base.slice(5, 7), 10);
      if (!m || m < 1 || m > 12) continue;
      const row = rows[m - 1];
      row.received += 1;
      const isDef = normalizeMiceStatus(q.progress_status) === 'DEF';
      if (q.quote_sent) {
        row.quoted += 1;
        if (isDef) row.contracted += 1;
        else row.notContracted += 1;
        if (q.contract_sent && miceStatusGroup(q.progress_status) === '문의') row.holding += 1;
      } else if (isDef) {
        // 견적 체크 없이 확정된 건 — 계약 수에는 넣되 견적 기반 비율에는 안 들어간다
        row.contracted += 1;
      }
    }
  }
  return rows;
}

// ===== WEDDING 월별 세일즈 표 (인콜 → 상담 → 계약) =====
// MICE 표와 같은 코호트 방식. 귀속월 = 신규문의일(inquiry_date), 없으면 등록일.
// 웨딩은 진행단계가 상태값에 다 있어서(상담·INQ·TEN·DEF·LOS) 체크 없이 상태로 센다.
// '상담 도달' 에 LOS 포함 — 상담까지 갔다가 잃은 건도 상담은 한 것이다(통계 퍼널과 동일 규칙).
// 상담 전에 이탈한 건은 신규문의·상담취소 상태로 남으므로 상담 수에 안 잡힌다.
export interface WeddingMonthlyRow {
  month: number; // 1~12
  received: number; // 신규 인콜 (전 상태)
  consulted: number; // 상담 도달 (상담·INQ·TEN·DEF·LOS)
  contracted: number; // 계약 = DEF
  notContracted: number; // 상담 후 미계약 = 상담 도달 − 계약 (진행 중·잃음 포함)
}

const WEDDING_CONSULT_REACHED = new Set<WeddingProgressStatus>(['상담', 'INQ', 'TEN', 'DEF', 'LOS']);

export function computeWeddingMonthlyTable(customers: WeddingCustomer[], year: number): WeddingMonthlyRow[] {
  const rows: WeddingMonthlyRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, received: 0, consulted: 0, contracted: 0, notContracted: 0,
  }));
  for (const c of customers) {
    if (c.deleted_at) continue;
    const base = (c.inquiry_date || c.created_at || '').slice(0, 10);
    if (!base.startsWith(String(year))) continue;
    const m = parseInt(base.slice(5, 7), 10);
    if (!m || m < 1 || m > 12) continue;
    const row = rows[m - 1];
    row.received += 1;
    if (WEDDING_CONSULT_REACHED.has(c.progress_status)) {
      row.consulted += 1;
      if (c.progress_status === 'DEF') row.contracted += 1;
      else row.notContracted += 1;
    }
  }
  return rows;
}
