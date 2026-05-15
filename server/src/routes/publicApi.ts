// 외부 클라이언트용 공개 API.
// 인증: X-API-Key 헤더 (또는 Authorization: Bearer).
// scope 별로 응답 필터링/마스킹.

import { Router } from 'express';
import { store } from '../store/mockStore.js';
import { requireApiKey } from '../middleware/apiKey.js';
import type { Event } from '../types.js';

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
