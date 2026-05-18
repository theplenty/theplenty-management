// 전역 활동 로그 — admin 전용.
// 모든 entity 의 change_log 를 시간 desc 로 묶어서 반환. 폴링용 since 커서 지원.
//
// 필터:
//   - entity_type: 'event' | 'mice_customer' | 'wedding_customer' (생략 시 전체)
//   - user_id: 특정 사용자 활동만
//   - since: ISO timestamp — 이 시각 이후의 로그만 (실시간 폴링용 — 변경분만 가져오기)
//   - until: ISO timestamp — 이 시각 이전 (날짜 범위 조회용)
//   - limit: 1~500, 기본 100

import { Router } from 'express';
import { store } from '../store/mockStore.js';
import { requireRoles } from '../middleware/auth.js';
import type { ChangeLog, ChangeLogEntityType } from '../types.js';

const router = Router();
router.use(requireRoles('admin'));

interface EnrichedLog extends ChangeLog {
  entity_name: string | null; // 엔티티의 표시용 이름 (행사명·업체명 등)
  entity_deleted: boolean; // 휴지통 또는 영구 삭제 여부
}

function enrichLog(l: ChangeLog): EnrichedLog {
  let name: string | null = null;
  let deleted = false;
  if (l.entity_type === 'event') {
    const ev = store.events.find((e) => e.id === l.entity_id);
    if (ev) {
      name = ev.event_name || null;
      deleted = !!ev.deleted_at;
    } else {
      deleted = true; // 영구 삭제됨
    }
  } else if (l.entity_type === 'mice_customer') {
    const c = store.mice_customers.find((x) => x.id === l.entity_id);
    if (c) {
      name = c.organization_name || null;
      deleted = !!c.deleted_at;
    } else {
      deleted = true;
    }
  } else if (l.entity_type === 'wedding_customer') {
    const c = store.wedding_customers.find((x) => x.id === l.entity_id);
    if (c) {
      name = c.wedding_event_name || null;
      deleted = !!c.deleted_at;
    } else {
      deleted = true;
    }
  }
  return { ...l, entity_name: name, entity_deleted: deleted };
}

router.get('/', (req, res) => {
  const entityTypeParam = typeof req.query.entity_type === 'string' ? req.query.entity_type : '';
  const userIdParam = typeof req.query.user_id === 'string' ? req.query.user_id : '';
  const sinceParam = typeof req.query.since === 'string' ? req.query.since : '';
  const untilParam = typeof req.query.until === 'string' ? req.query.until : '';
  const limit = Math.min(
    500,
    Math.max(1, parseInt(String(req.query.limit || 100), 10) || 100)
  );

  const validEntity: ChangeLogEntityType[] = ['event', 'mice_customer', 'wedding_customer'];
  const entityType =
    entityTypeParam && validEntity.includes(entityTypeParam as ChangeLogEntityType)
      ? (entityTypeParam as ChangeLogEntityType)
      : null;

  let logs = store.change_logs.slice();
  if (entityType) logs = logs.filter((l) => l.entity_type === entityType);
  if (userIdParam) logs = logs.filter((l) => l.changed_by_id === userIdParam);
  if (sinceParam) logs = logs.filter((l) => l.changed_at > sinceParam);
  if (untilParam) logs = logs.filter((l) => l.changed_at < untilParam);

  // 시간 desc 정렬 + limit
  logs.sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
  const sliced = logs.slice(0, limit);

  // 엔티티 이름·삭제 상태 enrich
  const enriched = sliced.map(enrichLog);

  // 사용자 통계 — 활동 많은 순으로 사이드 정보
  const userCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const l of logs) {
    const entry = userCounts.get(l.changed_by_id) || {
      id: l.changed_by_id,
      name: l.changed_by_name,
      count: 0,
    };
    entry.count += 1;
    userCounts.set(l.changed_by_id, entry);
  }
  const userStats = Array.from(userCounts.values()).sort((a, b) => b.count - a.count);

  res.json({
    logs: enriched,
    total_filtered: logs.length,
    total_in_store: store.change_logs.length,
    returned: enriched.length,
    user_stats: userStats,
    server_time: new Date().toISOString(),
  });
});

export default router;
