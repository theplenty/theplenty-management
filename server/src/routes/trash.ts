// 휴지통 (soft delete) 관리 — admin 전용.
// 대상: wedding_customers, mice_customers, events.
// 각 라우트는 :type 으로 구분 — 'wedding' | 'mice' | 'event'.

import { Router } from 'express';
import {
  store,
  restoreSoft,
  purgeHard,
  type SoftDeleteCollection,
} from '../store/mockStore.js';
import { requireRoles } from '../middleware/auth.js';
import { logChange } from '../store/changeLog.js';

const router = Router();
router.use(requireRoles('admin'));

type TrashType = 'wedding' | 'mice' | 'event';

const TYPE_TO_COLL: Record<TrashType, SoftDeleteCollection> = {
  wedding: 'wedding_customers',
  mice: 'mice_customers',
  event: 'events',
};

const TYPE_TO_ENTITY: Record<TrashType, 'wedding_customer' | 'mice_customer' | 'event'> = {
  wedding: 'wedding_customer',
  mice: 'mice_customer',
  event: 'event',
};

function isValidType(s: string): s is TrashType {
  return s === 'wedding' || s === 'mice' || s === 'event';
}

interface TrashItem {
  type: TrashType;
  id: string;
  label: string;
  detail: string;
  deleted_at: string;
  deleted_by_id: string | null;
  deleted_by_name: string | null;
}

function labelOf(type: TrashType, row: unknown): { label: string; detail: string } {
  if (type === 'wedding') {
    const r = row as { wedding_event_name?: string; groom_name?: string; bride_name?: string; progress_status?: string };
    return {
      label: r.wedding_event_name || '(이름 없음)',
      detail: `${r.groom_name || ''} ♥ ${r.bride_name || ''} · ${r.progress_status || ''}`.trim(),
    };
  }
  if (type === 'mice') {
    const r = row as { organization_name?: string; mice_category?: string; inquiries?: unknown[] };
    return {
      label: r.organization_name || '(업체명 없음)',
      detail: `${r.mice_category || ''} · 문의 ${Array.isArray(r.inquiries) ? r.inquiries.length : 0}건`.trim(),
    };
  }
  // event
  const r = row as { event_name?: string; event_type?: string; status?: string; start_datetime?: string };
  return {
    label: r.event_name || '(이름 없음)',
    detail: `${r.event_type || ''} · ${r.status || ''} · ${r.start_datetime || ''}`.trim(),
  };
}

// GET /api/admin/trash — 휴지통 모든 항목 목록
router.get('/', (_req, res) => {
  const items: TrashItem[] = [];
  const types: TrashType[] = ['wedding', 'mice', 'event'];
  for (const t of types) {
    const coll = TYPE_TO_COLL[t];
    const rows = store[coll] as Array<{
      id: string;
      deleted_at?: string | null;
      deleted_by_id?: string | null;
      deleted_by_name?: string | null;
    }>;
    for (const r of rows) {
      if (!r.deleted_at) continue;
      const { label, detail } = labelOf(t, r);
      items.push({
        type: t,
        id: r.id,
        label,
        detail,
        deleted_at: r.deleted_at,
        deleted_by_id: r.deleted_by_id || null,
        deleted_by_name: r.deleted_by_name || null,
      });
    }
  }
  // 최근 삭제 순으로 정렬
  items.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  res.json({ items, count: items.length });
});

// POST /api/admin/trash/:type/:id/restore — 단건 복구
router.post('/:type/:id/restore', (req, res) => {
  const { type, id } = req.params;
  if (!isValidType(type)) return res.status(400).json({ error: 'invalid_type' });
  const coll = TYPE_TO_COLL[type];
  const rows = store[coll] as Array<{ id: string; deleted_at?: string | null }>;
  const item = rows.find((r) => r.id === id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  if (!item.deleted_at) return res.status(400).json({ error: 'not_in_trash' });
  const ok = restoreSoft(coll, id);
  if (!ok) return res.status(500).json({ error: 'restore_failed' });
  logChange({
    entity_type: TYPE_TO_ENTITY[type],
    entity_id: id,
    action: 'update',
    summary: `[휴지통] 복구됨`,
    user: req.user!,
  });
  res.json({ ok: true, restored: true });
});

// DELETE /api/admin/trash/:type/:id — 단건 영구 삭제
router.delete('/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (!isValidType(type)) return res.status(400).json({ error: 'invalid_type' });
  const coll = TYPE_TO_COLL[type];
  const rows = store[coll] as Array<{ id: string; deleted_at?: string | null }>;
  const item = rows.find((r) => r.id === id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  if (!item.deleted_at) return res.status(400).json({ error: 'not_in_trash' });
  const ok = purgeHard(coll, id);
  if (!ok) return res.status(500).json({ error: 'purge_failed' });
  logChange({
    entity_type: TYPE_TO_ENTITY[type],
    entity_id: id,
    action: 'delete',
    summary: `[휴지통] 영구 삭제됨`,
    user: req.user!,
  });
  res.json({ ok: true, purged: true });
});

// DELETE /api/admin/trash — 휴지통 전체 비우기 (모든 type 영구 삭제)
router.delete('/', (req, res) => {
  let purged = 0;
  const types: TrashType[] = ['wedding', 'mice', 'event'];
  for (const t of types) {
    const coll = TYPE_TO_COLL[t];
    const rows = store[coll] as Array<{ id: string; deleted_at?: string | null }>;
    const ids = rows.filter((r) => r.deleted_at).map((r) => r.id);
    for (const id of ids) {
      const ok = purgeHard(coll, id);
      if (ok) {
        purged++;
        logChange({
          entity_type: TYPE_TO_ENTITY[t],
          entity_id: id,
          action: 'delete',
          summary: `[휴지통 비우기] 영구 삭제됨`,
          user: req.user!,
        });
      }
    }
  }
  res.json({ ok: true, purged });
});

export default router;
