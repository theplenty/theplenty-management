// 운영 지표 계산 — 단일 소스.
// 두 곳에서 쓴다:
//   1) /api/public/v1/ops/*  — 경영진 에이전트(리바이·아르민)가 물어볼 때
//   2) 알림 자동화(A4)        — 매일 아침 Slack 으로 밀어줄 때
// 같은 판정이 두 군데서 따로 계산되면 반드시 어긋나므로 여기 한 곳에만 둔다.
import { store } from '../store/mockStore.js';
import type { CardCompany, Event } from '../types.js';

// 카드사별 영업일 기준 입금 소요일 (client/src/types.ts 와 동일 기준)
const CARD_DEPOSIT_DAYS: Record<CardCompany, number> = {
  hyundai: 3,
  samsung: 3,
  shinhan: 2,
  kb: 3,
  lotte: 3,
  bc: 2,
  woori: 2,
  hana: 2,
  other: 3,
};

export function addBusinessDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(s: string | null | undefined): string {
  return (s || '').slice(0, 10);
}

/**
 * 휴지통에 들어간(soft-delete) 행사의 id 집합.
 *
 * 행사를 기준으로 도는 규칙들은 각자 `e.deleted_at` 을 보지만,
 * **행사에 딸린 레코드**(협업요청·결제)를 기준으로 도는 규칙은 부모 행사가 지워져도
 * 그대로 남아 있어서 유령 알림이 된다. 실제로 삭제된 행사의 협업요청이
 * 화면(GET /api/collaborations 는 같은 필터를 건다)에는 없는데 알림에만 뜬 사고가 있었다.
 * 그래서 화면과 알림이 같은 기준을 쓰도록 여기 한 곳에 둔다.
 */
function deletedEventIds(): Set<string> {
  return new Set(store.events.filter((e) => e.deleted_at).map((e) => e.id));
}

/** 행사별 매출 합계 — sales_total_amount 우선, 없으면 세부 매출 라인 합 */
export function salesTotalOf(ev: Event): number {
  if (ev.sales_total_amount) return ev.sales_total_amount;
  return store.event_revenue_lines
    .filter((l) => l.event_id === ev.id)
    .reduce((s, l) => s + (l.amount ?? 0), 0);
}

/** 행사별 결제 합계 — 환불은 차감 */
export function paymentTotalOf(eventId: string): number {
  const ps = store.payments.filter((p) => p.event_id === eventId);
  return (
    ps.filter((p) => p.payment_type !== 'refund').reduce((s, p) => s + (p.amount ?? 0), 0) -
    ps.filter((p) => p.payment_type === 'refund').reduce((s, p) => s + (p.amount ?? 0), 0)
  );
}

// ── 1. 정산 미완 (종료된 확정 행사인데 매출≠결제) ──────────────────────────
export interface UnsettledRow {
  event_id: string;
  event_name: string;
  event_type: string;
  start_datetime: string;
  assigned_manager_name: string | null;
  sales_total: number;
  payment_total: number;
  payment_count: number; // 등록된 결제 건수. 0이면 '미수'가 아니라 '결제 미입력'이다.
  diff: number; // +면 미수, -면 과수납
}

export function unsettledEvents(from?: string, to?: string): UnsettledRow[] {
  const t = today();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromStr = from || sixMonthsAgo.toISOString().slice(0, 10);
  const toStr = to || t;

  return store.events
    .filter((e) => {
      if (e.deleted_at) return false;
      if (e.status !== 'DEF') return false;
      const d = dateOnly(e.start_datetime);
      if (d < fromStr || d > toStr) return false;
      // 아직 안 끝난 행사는 잔금이 남는 게 정상이므로 제외
      return dateOnly(e.end_datetime) < t;
    })
    .map((e) => {
      const sales_total = salesTotalOf(e);
      const payment_total = paymentTotalOf(e.id);
      return {
        event_id: e.id,
        event_name: e.event_name,
        event_type: e.event_type,
        start_datetime: e.start_datetime,
        assigned_manager_name: e.assigned_manager_name || null,
        sales_total,
        payment_total,
        payment_count: store.payments.filter((p) => p.event_id === e.id).length,
        diff: sales_total - payment_total,
      };
    })
    // 금액 정보가 아예 없는 행사(매출 미입력·결제 0)는 정산 대상으로 보지 않음
    // → 그건 revenueMissingEvents() 가 따로 잡는다.
    .filter((r) => (r.sales_total > 0 || r.payment_total > 0) && r.diff !== 0)
    .sort((a, b) => b.diff - a.diff);
}

// ── 2. 카드사 입금 지연 ────────────────────────────────────────────────────
export interface OverduePaymentRow {
  event_id: string;
  event_name: string;
  payment_type: string;
  amount: number;
  card_company: CardCompany;
  paid_at: string;
  deposit_deadline: string;
  days_overdue: number;
}

export function overduePayments(): OverduePaymentRow[] {
  const now = Date.now();
  const eventById = new Map(store.events.map((e) => [e.id, e]));
  const deleted = deletedEventIds();
  return store.payments
    // 삭제된 행사의 결제는 추적 대상이 아니다 (협업요청과 같은 이유)
    .filter((p) => !deleted.has(p.event_id))
    .filter((p) => p.method === 'card' && !p.bank_deposit_date && p.paid_at && p.card_company)
    .map((p) => {
      const deadline = addBusinessDays(p.paid_at, CARD_DEPOSIT_DAYS[p.card_company!] ?? 3);
      const ev = eventById.get(p.event_id);
      return {
        event_id: p.event_id,
        event_name: ev?.event_name ?? '(행사 없음)',
        payment_type: p.payment_type,
        amount: p.amount,
        card_company: p.card_company!,
        paid_at: p.paid_at,
        deposit_deadline: deadline.toISOString().slice(0, 10),
        days_overdue: Math.floor((now - deadline.getTime()) / 86400000),
      };
    })
    .filter((r) => r.days_overdue > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue);
}

// ── 3. 협업요청 대기 ───────────────────────────────────────────────────────
export interface PendingCollabRow {
  id: string;
  customer_event_name: string;
  event_date: string | null;
  created_by_name: string;
  created_at: string;
  target_teams: string[];
  missing_teams: string[];
  stage: string;
  reply_due_at: string;
  hours_overdue: number;
  expected_revenue: number | null;
}

export function pendingCollaborations(): PendingCollabRow[] {
  const now = Date.now();
  const deleted = deletedEventIds();
  return store.collaboration_requests
    // 부모 행사가 휴지통에 있으면 협업요청도 없는 것으로 본다 (목록 화면과 동일 기준)
    .filter((c) => !deleted.has(c.event_id))
    .filter((c) => c.status === '회신대기' || (c.status === '회신완료' && !c.decision))
    .map((c) => {
      const missing_teams = c.target_teams.filter(
        (t) => !c.replies.some((r) => r.team === t && r.result)
      );
      return {
        id: c.id,
        customer_event_name: c.customer_event_name,
        event_date: c.event_date,
        created_by_name: c.created_by_name,
        created_at: c.created_at,
        target_teams: c.target_teams as string[],
        missing_teams: missing_teams as string[],
        stage: c.status === '회신대기' ? '팀 회신 대기' : '세일즈 결정 대기',
        reply_due_at: c.reply_due_at,
        hours_overdue: Math.max(0, Math.floor((now - new Date(c.reply_due_at).getTime()) / 3600000)),
        expected_revenue: c.expected_revenue,
      };
    })
    .sort((a, b) => b.hours_overdue - a.hours_overdue);
}

// ── 4. 다가오는 확정 행사 (D-N) — 신규 (A4) ────────────────────────────────
// "D-7 이 되면 준비 시작" 을 사람이 달력 보고 챙기지 않아도 되게 한다.
export interface UpcomingEventRow {
  event_id: string;
  event_name: string;
  event_type: string;
  start_datetime: string;
  halls: string[];
  seats: number | null;
  assigned_manager_name: string | null;
  days_until: number;
  has_collaboration: boolean;
  food_item_count: number;
}

export function upcomingEvents(withinDays = 7): UpcomingEventRow[] {
  const t = today();
  const limit = new Date();
  limit.setDate(limit.getDate() + withinDays);
  const limitStr = limit.toISOString().slice(0, 10);
  const todayMs = new Date(t).getTime();

  return store.events
    .filter((e) => {
      if (e.deleted_at) return false;
      if (e.status !== 'DEF') return false;
      const d = dateOnly(e.start_datetime);
      return d >= t && d <= limitStr;
    })
    .map((e) => ({
      event_id: e.id,
      event_name: e.event_name,
      event_type: e.event_type,
      start_datetime: e.start_datetime,
      halls: e.halls as string[],
      seats: e.seats,
      assigned_manager_name: e.assigned_manager_name || null,
      days_until: Math.round((new Date(dateOnly(e.start_datetime)).getTime() - todayMs) / 86400000),
      has_collaboration: store.collaboration_requests.some((c) => c.event_id === e.id),
      food_item_count: store.event_food_items.filter((f) => f.event_id === e.id).length,
    }))
    .sort((a, b) => a.days_until - b.days_until);
}

// ── 5. 매출 미입력 — 신규 (A4) ─────────────────────────────────────────────
// 이미 끝난 확정 행사인데 실매출도 세부 매출항목도 비어 있는 건.
// 정산 대조(unsettledEvents)에서는 의도적으로 제외되는 구멍이라 따로 잡는다.
export interface RevenueMissingRow {
  event_id: string;
  event_name: string;
  event_type: string;
  start_datetime: string;
  assigned_manager_name: string | null;
  contract_amount: number | null;
  days_since: number;
}

export function revenueMissingEvents(sinceDays = 90): RevenueMissingRow[] {
  const t = today();
  const todayMs = new Date(t).getTime();
  const from = new Date();
  from.setDate(from.getDate() - sinceDays);
  const fromStr = from.toISOString().slice(0, 10);

  return store.events
    .filter((e) => {
      if (e.deleted_at) return false;
      if (e.status !== 'DEF') return false;
      const d = dateOnly(e.start_datetime);
      if (d < fromStr) return false;
      if (dateOnly(e.end_datetime) >= t) return false; // 아직 안 끝남
      return salesTotalOf(e) === 0 && paymentTotalOf(e.id) === 0;
    })
    .map((e) => ({
      event_id: e.id,
      event_name: e.event_name,
      event_type: e.event_type,
      start_datetime: e.start_datetime,
      assigned_manager_name: e.assigned_manager_name || null,
      contract_amount: e.contract_amount ?? null,
      days_since: Math.round((todayMs - new Date(dateOnly(e.start_datetime)).getTime()) / 86400000),
    }))
    .sort((a, b) => b.days_since - a.days_since);
}
