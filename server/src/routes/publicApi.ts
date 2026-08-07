// 외부 클라이언트용 공개 API.
// 인증: X-API-Key 헤더 (또는 Authorization: Bearer).
// scope 별로 응답 필터링/마스킹.

import { Router } from 'express';
import { store } from '../store/mockStore.js';
import { requireApiKey } from '../middleware/apiKey.js';
import type { Event } from '../types.js';
// 운영 지표 계산은 lib/opsMetrics 한 곳에만 둔다 — 알림 자동화(A4)와 같은 판정을 쓰기 위함.
import {
  overduePayments,
  pendingCollaborations,
  revenueMissingEvents,
  unsettledEvents,
  upcomingEvents,
} from '../lib/opsMetrics.js';
import { todayKst, monthsFromTodayKst } from '../lib/kstDate.js';

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

// 계산 로직은 ../lib/opsMetrics.ts 로 이동 (알림 자동화와 공유).

// GET /api/public/v1/ops/settlement-status?from&to
// 종료된 DEF 행사 중 정산 미완(매출합계 ≠ 결제합계)인 건. 기본 기간: 최근 6개월.
router.get('/ops/settlement-status', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : undefined;
  const rows = unsettledEvents(from, to);
  res.json({
    range: { from: from || monthsFromTodayKst(-6), to: to || todayKst() },
    count: rows.length,
    unsettled: rows,
  });
});

// GET /api/public/v1/ops/payments-overdue
// 카드 결제 중 입금 예정일(영업일 기준)을 넘겼는데 카드사 입금이 확인 안 된 건.
router.get('/ops/payments-overdue', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const rows = overduePayments();
  res.json({ as_of: todayKst(), count: rows.length, overdue: rows });
});

// GET /api/public/v1/ops/collaborations-pending
// 회신 대기 중(팀 회신 미완) 또는 회신은 끝났는데 세일즈 최종 결정이 없는 협업 요청.
router.get('/ops/collaborations-pending', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const rows = pendingCollaborations();
  res.json({ as_of: new Date().toISOString(), count: rows.length, pending: rows });
});

// GET /api/public/v1/ops/upcoming-events?days=7
// 곧 열리는 확정 행사 — 준비 착수 여부 점검용. (알림 자동화와 같은 기준)
router.get('/ops/upcoming-events', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const days = Number(req.query.days) > 0 ? Math.min(Number(req.query.days), 60) : 7;
  const rows = upcomingEvents(days);
  res.json({ as_of: todayKst(), within_days: days, count: rows.length, upcoming: rows });
});

// GET /api/public/v1/ops/revenue-missing?days=90
// 이미 끝난 확정 행사인데 매출도 결제도 입력이 없는 건 — 정산 대조의 사각지대.
router.get('/ops/revenue-missing', (req, res) => {
  if (!requireAllScope(req, res)) return;
  const days = Number(req.query.days) > 0 ? Math.min(Number(req.query.days), 730) : 90;
  const rows = revenueMissingEvents(days);
  res.json({ as_of: todayKst(), since_days: days, count: rows.length, missing: rows });
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
