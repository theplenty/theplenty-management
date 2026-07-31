// 외부 클라이언트용 공개 API.
// 인증: X-API-Key 헤더 (또는 Authorization: Bearer).
// scope 별로 응답 필터링/마스킹.

import { Router } from 'express';
import { store } from '../store/mockStore.js';
import { requireApiKey } from '../middleware/apiKey.js';
import type { CardCompany, Event } from '../types.js';

const router = Router();
router.use(requireApiKey);

// 한 행사를 scope 별로 외부 노출 가능한 형태로 변환.
function shapeEventForScope(ev: Event, scope: string) {
  // 공통 — 어느 scope 든 항상 포함
  const base = {
    id: ev.id,
    event_type: ev.event_type,
    status: ev.status,
    start_datetime: ev.start_datetime,
    end_datetime: ev.end_datetime,
  };
  if (scope === 'summary') {
    // 디테일 가림 — 행사명·고객·메모·담당자·식음 정보 노출 안 함
    return {
      ...base,
      // 홀 정보는 일정 가시성을 위해 살려둠 (수용 가능 여부 외부에서 판단 용)
      halls: ev.halls,
    };
  }
  return {
    ...base,
    event_name: ev.event_name,
    halls: ev.halls,
    usage_type: ev.usage_type,
    seats: ev.seats,
    assigned_manager_name: ev.assigned_manager_name || null,
  };
}

// GET /api/public/v1/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
// scope 별 필터:
//   all     — 모든 행사
//   summary — 모든 행사 (디테일 가려진 응답)
//   wedding — WEDDING 만
//   mice    — MICE 만
// 취소 계열(LOS / 상담취소 / 미팅취소) 은 응답에서 제외.
router.get('/calendar/events', (req, res) => {
  const key = req.apiKey!;
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';

  // 기본 — 향후 1년
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const defaultTo = new Date(today.getFullYear() + 1, today.getMonth(), 0)
    .toISOString()
    .slice(0, 10);
  const fromStr = from || defaultFrom;
  const toStr = to || defaultTo;

  const cancelledStatuses = new Set(['LOS', '상담취소', '미팅취소']);
  let list = store.events.filter((e) => {
    // 휴지통의 행사는 외부 API 응답에서 제외.
    if (e.deleted_at) return false;
    if (cancelledStatuses.has(e.status)) return false;
    const d = (e.start_datetime || '').slice(0, 10);
    if (d < fromStr) return false;
    if (d > toStr) return false;
    return true;
  });

  if (key.scope === 'wedding') list = list.filter((e) => e.event_type === 'WEDDING');
  else if (key.scope === 'mice') list = list.filter((e) => e.event_type === 'MICE');

  const events = list
    .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1))
    .map((e) => shapeEventForScope(e, key.scope));

  res.json({
    scope: key.scope,
    range: { from: fromStr, to: toStr },
    count: events.length,
    events,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /ops/* — 경영진 에이전트(COO 등) 전용 운영 지표.
// 집계·파생 데이터만 노출 (고객 개인정보 없음). scope=all 키만 접근 가능.
// ═══════════════════════════════════════════════════════════════════════════

function requireAllScope(req: import('express').Request, res: import('express').Response): boolean {
  if (req.apiKey!.scope !== 'all') {
    res.status(403).json({ error: 'ops 지표는 scope=all 키만 조회할 수 있습니다.' });
    return false;
  }
  return true;
}

// 카드사별 영업일 기준 입금 소요일 (client/src/types.ts 와 동일 기준)
const CARD_DEPOSIT_DAYS: Record<CardCompany, number> = {
  hyundai: 3, samsung: 3, shinhan: 2, kb: 3,
  lotte: 3, bc: 2, woori: 2, hana: 2, other: 3,
};

function addBusinessDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

// 행사별 매출 합계 — sales_total_amount 우선, 없으면 세부 매출 라인 합
function salesTotalOf(ev: Event): number {
  if (ev.sales_total_amount) return ev.sales_total_amount;
  return store.event_revenue_lines
    .filter((l) => l.event_id === ev.id)
    .reduce((s, l) => s + (l.amount ?? 0), 0);
}

// 행사별 결제 합계 — 환불은 차감
function paymentTotalOf(eventId: string): number {
  const ps = store.payments.filter((p) => p.event_id === eventId);
  return (
    ps.filter((p) => p.payment_type !== 'refund').reduce((s, p) => s + (p.amount ?? 0), 0) -
    ps.filter((p) => p.payment_type === 'refund').reduce((s, p) => s + (p.amount ?? 0), 0)
  );
}

// GET /api/public/v1/ops/settlement-status?from&to
// 종료된 DEF 행사 중 정산 미완(매출합계 ≠ 결제합계)인 건. 기본 기간: 최근 6개월.
router.get('/ops/settlement-status', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const today = new Date().toISOString().slice(0, 10);
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromStr = typeof req.query.from === 'string' && req.query.from ? req.query.from : sixMonthsAgo.toISOString().slice(0, 10);
  const toStr = typeof req.query.to === 'string' && req.query.to ? req.query.to : today;

  const rows = store.events
    .filter((e) => {
      if (e.deleted_at) return false;
      if (e.status !== 'DEF') return false;
      const d = (e.start_datetime || '').slice(0, 10);
      if (d < fromStr || d > toStr) return false;
      // 아직 안 끝난 행사는 잔금이 남는 게 정상이므로 제외
      return (e.end_datetime || '').slice(0, 10) < today;
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
        diff: sales_total - payment_total, // +면 미수, -면 과수납
      };
    })
    // 금액 정보가 아예 없는 행사(매출 미입력·결제 0)는 정산 대상으로 보지 않음
    .filter((r) => (r.sales_total > 0 || r.payment_total > 0) && r.diff !== 0)
    .sort((a, b) => b.diff - a.diff);

  res.json({ range: { from: fromStr, to: toStr }, count: rows.length, unsettled: rows });
});

// GET /api/public/v1/ops/payments-overdue
// 카드 결제 중 입금 예정일(영업일 기준)을 넘겼는데 카드사 입금이 확인 안 된 건.
router.get('/ops/payments-overdue', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const now = new Date();
  const eventById = new Map(store.events.map((e) => [e.id, e]));
  const rows = store.payments
    .filter((p) => p.method === 'card' && !p.bank_deposit_date && p.paid_at && p.card_company)
    .map((p) => {
      const deadline = addBusinessDays(p.paid_at, CARD_DEPOSIT_DAYS[p.card_company!] ?? 3);
      const ev = eventById.get(p.event_id);
      return {
        event_id: p.event_id,
        event_name: ev?.event_name ?? '(행사 없음)',
        payment_type: p.payment_type,
        amount: p.amount,
        card_company: p.card_company,
        paid_at: p.paid_at,
        deposit_deadline: deadline.toISOString().slice(0, 10),
        days_overdue: Math.floor((now.getTime() - deadline.getTime()) / 86400000),
      };
    })
    .filter((r) => r.days_overdue > 0)
    .sort((a, b) => b.days_overdue - a.days_overdue);

  res.json({ as_of: now.toISOString().slice(0, 10), count: rows.length, overdue: rows });
});

// GET /api/public/v1/ops/collaborations-pending
// 회신 대기 중(팀 회신 미완) 또는 회신은 끝났는데 세일즈 최종 결정이 없는 협업 요청.
router.get('/ops/collaborations-pending', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const now = new Date();
  const rows = store.collaboration_requests
    .filter((c) => c.status === '회신대기' || (c.status === '회신완료' && !c.decision))
    .map((c) => {
      const missing_teams = c.target_teams.filter(
        (t) => !c.replies.some((r) => r.team === t && r.result)
      );
      const dueMs = new Date(c.reply_due_at).getTime();
      return {
        id: c.id,
        customer_event_name: c.customer_event_name,
        event_date: c.event_date,
        created_by_name: c.created_by_name,
        created_at: c.created_at,
        target_teams: c.target_teams,
        missing_teams,
        stage: c.status === '회신대기' ? '팀 회신 대기' : '세일즈 결정 대기',
        reply_due_at: c.reply_due_at,
        hours_overdue: Math.max(0, Math.floor((now.getTime() - dueMs) / 3600000)),
        expected_revenue: c.expected_revenue,
      };
    })
    .sort((a, b) => b.hours_overdue - a.hours_overdue);

  res.json({ as_of: now.toISOString(), count: rows.length, pending: rows });
});

// 클라이언트가 자기 키의 권한을 확인할 수 있는 introspection
router.get('/me', (req, res) => {
  const k = req.apiKey!;
  res.json({
    label: k.label,
    scope: k.scope,
    active: k.active,
    created_at: k.created_at,
  });
});

export default router;
