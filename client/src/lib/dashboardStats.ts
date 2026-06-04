// 대시보드용 집계 함수 모음.
// 각 섹션은 순수 함수로 분리해 Firestore 전환 시 일부를 서버 aggregation으로 옮기기 쉽게 한다.

import {
  MICE_INQUIRY_STATUS_OPTIONS,
  WEDDING_PROGRESS_OPTIONS,
  type EventStatus,
  type EventWithFood,
  type MiceCustomer,
  type MiceInquiry,
  type MiceInquiryStatus,
  type SalesTarget,
  type WeddingCustomer,
  type WeddingProgressStatus,
} from '../types';

// ============================================================
// 시간 범위 헬퍼
// ============================================================

export interface DateBound {
  start: number;
  end: number;
}

export function todayBound(): DateBound {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(),
  };
}

// 이번 주 (월요일 시작 기준)
export function thisWeekBound(): DateBound {
  const now = new Date();
  const day = now.getDay(); // 일=0, 월=1, ...
  const diffFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffFromMonday);
  return {
    start: monday.getTime(),
    end: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7).getTime(),
  };
}

export function thisMonthBound(): DateBound {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  };
}

export function thisYearBound(year: number): DateBound {
  return {
    start: new Date(year, 0, 1).getTime(),
    end: new Date(year + 1, 0, 1).getTime(),
  };
}

export function monthBound(year: number, month1to12: number): DateBound {
  return {
    start: new Date(year, month1to12 - 1, 1).getTime(),
    end: new Date(year, month1to12, 1).getTime(),
  };
}

function inRange(iso: string | null | undefined, b: DateBound): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  return t >= b.start && t < b.end;
}

// ============================================================
// 1. MICE 신규 유입
// ============================================================
// 기준: 통화일자 우선, 없으면 inquiry.created_at
// 진행상황별 카운트: INQ, TEN, DEF, LOS, 단순문의

export interface MiceInflowRow {
  customer_id: string;
  inquiry_id: string;
  mice_category: string;
  organization_name: string;
  contact_name: string;
  phone: string;
  email: string;
  call_date: string | null;
  inquiry_event_date_text: string;
  progress_status: MiceInquiryStatus;
  customer_memo: string;
  // 신규유입 판정 시각 (call_date || created_at)
  inflow_at: string;
}

function miceInflowDate(inq: MiceInquiry): string {
  return inq.call_date || inq.created_at;
}

export function flattenMiceInflows(customers: MiceCustomer[]): MiceInflowRow[] {
  const rows: MiceInflowRow[] = [];
  for (const c of customers) {
    for (const inq of c.inquiries) {
      const firstContact = inq.contacts[0];
      rows.push({
        customer_id: c.id,
        inquiry_id: inq.id,
        mice_category: c.mice_category,
        organization_name: c.organization_name,
        contact_name: firstContact?.name || '',
        phone: firstContact?.phone || '',
        email: firstContact?.email || '',
        call_date: inq.call_date,
        inquiry_event_date_text: inq.inquiry_event_date_text,
        progress_status: inq.progress_status,
        customer_memo: c.memo,
        inflow_at: miceInflowDate(inq),
      });
    }
  }
  return rows;
}

export interface MiceStatusCounts {
  INQ: number;
  TEN: number;
  DEF: number;
  LOS: number;
  단순문의: number;
}

function emptyMiceCounts(): MiceStatusCounts {
  return { INQ: 0, TEN: 0, DEF: 0, LOS: 0, 단순문의: 0 };
}

export function miceInflowSummary(
  customers: MiceCustomer[]
): {
  today: number;
  thisWeek: number;
  thisMonth: number;
  weekCounts: MiceStatusCounts;
  monthCounts: MiceStatusCounts;
  monthDefRate: number | null;
  monthLosRate: number | null;
  monthSimpleRate: number | null;
} {
  const tBound = todayBound();
  const wBound = thisWeekBound();
  const mBound = thisMonthBound();
  let today = 0;
  let thisWeek = 0;
  let thisMonth = 0;
  const weekCounts = emptyMiceCounts();
  const monthCounts = emptyMiceCounts();

  for (const c of customers) {
    for (const inq of c.inquiries) {
      const ts = miceInflowDate(inq);
      if (inRange(ts, tBound)) today++;
      if (inRange(ts, wBound)) {
        thisWeek++;
        weekCounts[inq.progress_status]++;
      }
      if (inRange(ts, mBound)) {
        thisMonth++;
        monthCounts[inq.progress_status]++;
      }
    }
  }
  const totalMonth = thisMonth || 0;
  const rate = (n: number) => (totalMonth > 0 ? Math.round((n / totalMonth) * 1000) / 10 : null);
  return {
    today,
    thisWeek,
    thisMonth,
    weekCounts,
    monthCounts,
    monthDefRate: rate(monthCounts.DEF),
    monthLosRate: rate(monthCounts.LOS),
    monthSimpleRate: rate(monthCounts.단순문의),
  };
}

// 카드 클릭용 — 특정 범위/상태로 필터된 inflow 목록
export function filterMiceInflows(
  customers: MiceCustomer[],
  bound: DateBound,
  status?: MiceInquiryStatus
): MiceInflowRow[] {
  const all = flattenMiceInflows(customers);
  return all
    .filter((r) => inRange(r.inflow_at, bound))
    .filter((r) => !status || r.progress_status === status)
    .sort((a, b) => (a.inflow_at < b.inflow_at ? 1 : -1));
}

// ============================================================
// 2. WEDDING 신규 유입
// ============================================================
// 기준: 신규문의일자 (inquiry_date)
// 진행단계별: INQ, TEN, DEF, LOS (전체 7단계 중 INQ/TEN/DEF/LOS만 집계)

export interface WeddingInflowRow {
  customer_id: string;
  wedding_event_name: string;
  inquiry_date: string | null;
  desired_consultation_date: string | null;
  wedding_datetime: string | null; // first event_inquiry
  progress_status: WeddingProgressStatus;
  groom_name: string;
  groom_phone: string;
  bride_name: string;
  bride_phone: string;
  source: string;
  source_detail: string;
  assigned_manager_name: string;
  estimate_amount: string;
}

function flattenWeddingInflow(c: WeddingCustomer): WeddingInflowRow {
  const first = c.event_inquiries[0];
  return {
    customer_id: c.id,
    wedding_event_name: c.wedding_event_name,
    inquiry_date: c.inquiry_date,
    desired_consultation_date: c.desired_consultation_date,
    wedding_datetime: first?.wedding_datetime ?? null,
    progress_status: c.progress_status,
    groom_name: c.groom_name,
    groom_phone: c.groom_phone,
    bride_name: c.bride_name,
    bride_phone: c.bride_phone,
    source: c.source,
    source_detail: c.source_detail,
    assigned_manager_name: first?.assigned_manager_name || '',
    estimate_amount: first?.estimate_amount || '',
  };
}

export interface WeddingStatusCounts {
  INQ: number;
  TEN: number;
  DEF: number;
  LOS: number;
}

function emptyWeddingCounts(): WeddingStatusCounts {
  return { INQ: 0, TEN: 0, DEF: 0, LOS: 0 };
}

function isCoreStatus(s: WeddingProgressStatus): s is keyof WeddingStatusCounts {
  return s === 'INQ' || s === 'TEN' || s === 'DEF' || s === 'LOS';
}

export function weddingInflowSummary(customers: WeddingCustomer[]): {
  today: number;
  thisWeek: number;
  thisMonth: number;
  weekCounts: WeddingStatusCounts;
  monthCounts: WeddingStatusCounts;
  monthDefRate: number | null;
  monthLosRate: number | null;
} {
  const tBound = todayBound();
  const wBound = thisWeekBound();
  const mBound = thisMonthBound();
  let today = 0;
  let thisWeek = 0;
  let thisMonth = 0;
  const weekCounts = emptyWeddingCounts();
  const monthCounts = emptyWeddingCounts();

  for (const c of customers) {
    const ts = c.inquiry_date;
    if (inRange(ts, tBound)) today++;
    if (inRange(ts, wBound)) {
      thisWeek++;
      if (isCoreStatus(c.progress_status)) weekCounts[c.progress_status]++;
    }
    if (inRange(ts, mBound)) {
      thisMonth++;
      if (isCoreStatus(c.progress_status)) monthCounts[c.progress_status]++;
    }
  }
  const totalMonth = thisMonth || 0;
  const rate = (n: number) => (totalMonth > 0 ? Math.round((n / totalMonth) * 1000) / 10 : null);
  return {
    today,
    thisWeek,
    thisMonth,
    weekCounts,
    monthCounts,
    monthDefRate: rate(monthCounts.DEF),
    monthLosRate: rate(monthCounts.LOS),
  };
}

export function filterWeddingInflows(
  customers: WeddingCustomer[],
  bound: DateBound,
  status?: WeddingProgressStatus
): WeddingInflowRow[] {
  return customers
    .filter((c) => inRange(c.inquiry_date, bound))
    .filter((c) => !status || c.progress_status === status)
    .sort((a, b) => ((a.inquiry_date || '') < (b.inquiry_date || '') ? 1 : -1))
    .map(flattenWeddingInflow);
}

// ============================================================
// 3. WEDDING 유입경로 현황
// ============================================================
// 연도(신규문의일자) × 유입경로 × DEF 전환율

export interface SourceBreakdownRow {
  source: string; // 유입경로 또는 (전체)
  total: number;
  def_count: number;
  los_count: number;
  def_rate: number | null; // %
  los_rate: number | null; // %
}

export function weddingSourceBreakdown(
  customers: WeddingCustomer[],
  year: number,
  detail = false
): SourceBreakdownRow[] {
  const bound = thisYearBound(year);
  const map = new Map<string, { total: number; def: number; los: number }>();
  for (const c of customers) {
    if (!inRange(c.inquiry_date, bound)) continue;
    const key = (detail ? c.source_detail : c.source) || '미분류';
    const e = map.get(key) || { total: 0, def: 0, los: 0 };
    e.total++;
    if (c.progress_status === 'DEF') e.def++;
    if (c.progress_status === 'LOS') e.los++;
    map.set(key, e);
  }
  const rows: SourceBreakdownRow[] = [];
  for (const [source, e] of map.entries()) {
    rows.push({
      source,
      total: e.total,
      def_count: e.def,
      los_count: e.los,
      def_rate: e.total > 0 ? Math.round((e.def / e.total) * 1000) / 10 : null,
      los_rate: e.total > 0 ? Math.round((e.los / e.total) * 1000) / 10 : null,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

// 검색어별 유입 현황 — 연도(신규문의일자) 기준. 띄어쓰기·대소문자 변형은 한 항목으로 통합.
export function weddingKeywordBreakdown(
  customers: WeddingCustomer[],
  year: number
): SourceBreakdownRow[] {
  const bound = thisYearBound(year);
  const map = new Map<string, { display: string; total: number; def: number; los: number }>();
  for (const c of customers) {
    if (!inRange(c.inquiry_date, bound)) continue;
    const raw = (c.search_keyword || '').trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    const key = raw.toLowerCase();
    const e = map.get(key) || { display: raw, total: 0, def: 0, los: 0 };
    e.total++;
    if (c.progress_status === 'DEF') e.def++;
    if (c.progress_status === 'LOS') e.los++;
    map.set(key, e);
  }
  const rows: SourceBreakdownRow[] = [];
  for (const e of map.values()) {
    rows.push({
      source: e.display,
      total: e.total,
      def_count: e.def,
      los_count: e.los,
      def_rate: e.total > 0 ? Math.round((e.def / e.total) * 1000) / 10 : null,
      los_rate: e.total > 0 ? Math.round((e.los / e.total) * 1000) / 10 : null,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

export function weddingYearlyTotals(customers: WeddingCustomer[]): Array<{ year: number; total: number }> {
  const map = new Map<number, number>();
  for (const c of customers) {
    if (!c.inquiry_date) continue;
    const t = new Date(c.inquiry_date).getTime();
    if (isNaN(t)) continue;
    const y = new Date(t).getFullYear();
    map.set(y, (map.get(y) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, total]) => ({ year, total }));
}

// ============================================================
// 4. WEDDING 상담 현황
// ============================================================
// 기준: 희망상담일자

export interface ConsultationMonthly {
  month: number; // 1-12
  consultation_count: number;
  def_count: number;
  conversion_rate: number | null;
}

export function weddingConsultationByMonth(
  customers: WeddingCustomer[],
  year: number
): ConsultationMonthly[] {
  const arr: ConsultationMonthly[] = [];
  for (let m = 1; m <= 12; m++) {
    const b = monthBound(year, m);
    let cons = 0;
    let def = 0;
    for (const c of customers) {
      if (!inRange(c.desired_consultation_date, b)) continue;
      cons++;
      if (c.progress_status === 'DEF') def++;
    }
    arr.push({
      month: m,
      consultation_count: cons,
      def_count: def,
      conversion_rate: cons > 0 ? Math.round((def / cons) * 1000) / 10 : null,
    });
  }
  return arr;
}

export function weddingConsultationByYear(
  customers: WeddingCustomer[]
): Array<{ year: number; consultation_count: number; def_count: number; conversion_rate: number | null }> {
  const map = new Map<number, { c: number; d: number }>();
  for (const c of customers) {
    if (!c.desired_consultation_date) continue;
    const t = new Date(c.desired_consultation_date).getTime();
    if (isNaN(t)) continue;
    const y = new Date(t).getFullYear();
    const e = map.get(y) || { c: 0, d: 0 };
    e.c++;
    if (c.progress_status === 'DEF') e.d++;
    map.set(y, e);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, e]) => ({
      year,
      consultation_count: e.c,
      def_count: e.d,
      conversion_rate: e.c > 0 ? Math.round((e.d / e.c) * 1000) / 10 : null,
    }));
}

// ============================================================
// 5. SALES 통합 목표 매출 달성 현황
// ============================================================

export interface ReviewLite {
  event_id: string;
  final_revenue: number | null;
}

// 한 행: 월별 6개 행사건수 + 6개 매출 + 달성률 컬럼
export interface TargetRow {
  month: number; // 1-12 (분기/Total 행은 0~13으로 별도)
  // 행사건수
  wedding_actual: number;
  wedding_forecast: number | null;
  mice_actual: number;
  mice_forecast: number | null;
  total_actual: number; // = wedding_actual + mice_actual
  total_forecast: number | null;
  // 매출액
  wedding_revenue_actual: number;
  wedding_revenue_forecast: number | null;
  mice_revenue_actual: number;
  mice_revenue_forecast: number | null;
  total_revenue_actual: number;
  total_revenue_forecast: number | null;
  total_revenue_achievement: number | null; // %
}

function rateOrNull(actual: number, forecast: number | null): number | null {
  if (forecast == null || forecast === 0) return null;
  return Math.round((actual / forecast) * 1000) / 10;
}

export function buildTargetTable(
  events: EventWithFood[],
  reviews: ReviewLite[],
  targets: SalesTarget[],
  year: number
): { months: TargetRow[]; quarters: TargetRow[]; total: TargetRow } {
  // event_reviews에서 final_revenue 합산하기 위해 event_id로 join
  const reviewByEventId = new Map<string, number>();
  for (const r of reviews) {
    if (r.final_revenue && r.final_revenue > 0) {
      reviewByEventId.set(r.event_id, r.final_revenue);
    }
  }
  // 행사 종료일 기준 월별 분류
  const monthsRaw: Array<{
    wedding: number;
    mice: number;
    weddingRev: number;
    miceRev: number;
  }> = Array.from({ length: 12 }, () => ({ wedding: 0, mice: 0, weddingRev: 0, miceRev: 0 }));
  for (const e of events) {
    if (e.status !== 'DEF') continue;
    const t = new Date(e.end_datetime).getTime();
    if (isNaN(t)) continue;
    const d = new Date(t);
    if (d.getFullYear() !== year) continue;
    const m = d.getMonth(); // 0-11
    if (e.event_type === 'WEDDING') monthsRaw[m].wedding++;
    else monthsRaw[m].mice++;
    const rev = reviewByEventId.get(e.id) || 0;
    if (e.event_type === 'WEDDING') monthsRaw[m].weddingRev += rev;
    else monthsRaw[m].miceRev += rev;
  }

  const targetByMonth = new Map<number, SalesTarget>();
  for (const t of targets) {
    if (t.year === year) targetByMonth.set(t.month, t);
  }

  const months: TargetRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const raw = monthsRaw[m - 1];
    const t = targetByMonth.get(m);
    const total_actual = raw.wedding + raw.mice;
    const total_revenue_actual = raw.weddingRev + raw.miceRev;
    const total_revenue_forecast = t?.total_revenue_forecast ?? null;
    months.push({
      month: m,
      wedding_actual: raw.wedding,
      wedding_forecast: t?.wedding_event_count_forecast ?? null,
      mice_actual: raw.mice,
      mice_forecast: t?.mice_event_count_forecast ?? null,
      total_actual,
      total_forecast: t?.total_event_count_forecast ?? null,
      wedding_revenue_actual: raw.weddingRev,
      wedding_revenue_forecast: t?.wedding_revenue_forecast ?? null,
      mice_revenue_actual: raw.miceRev,
      mice_revenue_forecast: t?.mice_revenue_forecast ?? null,
      total_revenue_actual,
      total_revenue_forecast,
      total_revenue_achievement: rateOrNull(total_revenue_actual, total_revenue_forecast),
    });
  }

  function aggregate(rows: TargetRow[], monthLabel: number): TargetRow {
    const sum = rows.reduce(
      (acc, r) => {
        acc.wedding_actual += r.wedding_actual;
        acc.mice_actual += r.mice_actual;
        acc.total_actual += r.total_actual;
        acc.wedding_revenue_actual += r.wedding_revenue_actual;
        acc.mice_revenue_actual += r.mice_revenue_actual;
        acc.total_revenue_actual += r.total_revenue_actual;
        // forecast는 null을 누락으로 취급. 합계 중 하나라도 숫자 있으면 합산.
        const sumNum = (a: number | null, b: number | null) => {
          if (a == null && b == null) return null;
          return (a || 0) + (b || 0);
        };
        acc.wedding_forecast = sumNum(acc.wedding_forecast, r.wedding_forecast);
        acc.mice_forecast = sumNum(acc.mice_forecast, r.mice_forecast);
        acc.total_forecast = sumNum(acc.total_forecast, r.total_forecast);
        acc.wedding_revenue_forecast = sumNum(
          acc.wedding_revenue_forecast,
          r.wedding_revenue_forecast
        );
        acc.mice_revenue_forecast = sumNum(acc.mice_revenue_forecast, r.mice_revenue_forecast);
        acc.total_revenue_forecast = sumNum(acc.total_revenue_forecast, r.total_revenue_forecast);
        return acc;
      },
      {
        month: monthLabel,
        wedding_actual: 0,
        wedding_forecast: null as number | null,
        mice_actual: 0,
        mice_forecast: null as number | null,
        total_actual: 0,
        total_forecast: null as number | null,
        wedding_revenue_actual: 0,
        wedding_revenue_forecast: null as number | null,
        mice_revenue_actual: 0,
        mice_revenue_forecast: null as number | null,
        total_revenue_actual: 0,
        total_revenue_forecast: null as number | null,
        total_revenue_achievement: null as number | null,
      }
    );
    sum.total_revenue_achievement = rateOrNull(sum.total_revenue_actual, sum.total_revenue_forecast);
    return sum;
  }

  const quarters = [
    aggregate(months.slice(0, 3), 101), // 1Q (월 라벨 101)
    aggregate(months.slice(3, 6), 102),
    aggregate(months.slice(6, 9), 103),
    aggregate(months.slice(9, 12), 104),
  ];
  const total = aggregate(months, 999);

  return { months, quarters, total };
}
