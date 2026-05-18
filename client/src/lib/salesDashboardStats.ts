// 세일즈 중심 대시보드 통계 — 유입 채널(INCALL/OUTCALL) + 전환 추적.
// MICE: 인콜/아웃콜 분리. WEDDING: 상담예약/취소 흐름.
//
// 전환 계산 기준: 현재 progress_status (이력 mining 안 함).
//   - 동일 건의 status 가 INCALL→INQ→DEF 로 변경됐다면 → DEF 전환 1건으로 카운트 (중복 X)
//   - "단순문의" 상태를 "미처리" 로 간주

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

// 미처리 인콜 기준 status — 단순문의로 남아있는 건. (INQ/TEN/DEF/LOS 는 전환된 것으로 간주)
const MICE_UNPROCESSED_STATUSES = new Set<MiceInquiryStatus>(['단순문의']);
// 전환된 final 상태들
const MICE_INQ_STATUSES = new Set<MiceInquiryStatus>(['INQ', 'TEN']);
const MICE_DEF_STATUSES = new Set<MiceInquiryStatus>(['DEF']);
const MICE_LOS_STATUSES = new Set<MiceInquiryStatus>(['LOS']);

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
  unprocessed: number; // 단순문의 상태로 남아있음
  inq: number;
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
    if (MICE_UNPROCESSED_STATUSES.has(s)) unprocessed += 1;
    else if (MICE_INQ_STATUSES.has(s)) inq += 1;
    else if (MICE_DEF_STATUSES.has(s)) def += 1;
    else if (MICE_LOS_STATUSES.has(s)) los += 1;
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
    if (!MICE_UNPROCESSED_STATUSES.has(f.inquiry.progress_status)) continue;
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
    if (!MICE_UNPROCESSED_STATUSES.has(f.inquiry.progress_status)) entry.converted += 1;
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
  consultConversionRate: number; // (상담 + 후속전환) / 인콜
  defRate: number; // DEF / 인콜
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
  return {
    totalInflow,
    consultBooked,
    consultCancelled,
    inq,
    def,
    los,
    newOnly,
    consultConversionRate,
    defRate,
  };
}

// 상담 예정 / 상담 취소 / 장기 미전환 리스트
export function findScheduledConsultations(
  customers: WeddingCustomer[],
  now = new Date()
): WeddingCustomer[] {
  const today = now.toISOString().slice(0, 10);
  return customers
    .filter((c) => !c.deleted_at)
    .filter((c) => c.progress_status === '상담' || (c.desired_consultation_date && c.desired_consultation_date >= today))
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
      if (statusGroup === 'unprocessed') return MICE_UNPROCESSED_STATUSES.has(s);
      if (statusGroup === 'inq') return MICE_INQ_STATUSES.has(s);
      if (statusGroup === 'def') return MICE_DEF_STATUSES.has(s);
      if (statusGroup === 'los') return MICE_LOS_STATUSES.has(s);
      if (statusGroup === 'converted') {
        return (
          MICE_INQ_STATUSES.has(s) || MICE_DEF_STATUSES.has(s) || MICE_LOS_STATUSES.has(s)
        );
      }
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
export function findStaleWedding(
  customers: WeddingCustomer[],
  minAgeDays: number,
  now = new Date()
): Array<{ customer: WeddingCustomer; ageDays: number }> {
  const out: Array<{ customer: WeddingCustomer; ageDays: number }> = [];
  for (const c of customers) {
    if (c.deleted_at) continue;
    if (c.progress_status !== '신규문의' && c.progress_status !== '상담') continue;
    const baseIso = c.inquiry_date || c.created_at;
    const created = new Date(baseIso).getTime();
    if (isNaN(created)) continue;
    const ageDays = Math.floor((now.getTime() - created) / 86400_000);
    if (ageDays >= minAgeDays) out.push({ customer: c, ageDays });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}
