import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { CalendarShare } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 활성 사용자 누구나 (admin/sales/banquet/kitchen) 자신이 만든 share 목록을 보거나 만들 수 있게 함.
// 권한이 더 엄격해야 하면 admin/sales만으로 제한하면 됨.

router.get('/', (_req, res) => {
  res.json({ shares: store.calendar_shares });
});

router.post('/', (req, res) => {
  const body = req.body as Partial<CalendarShare>;
  const year = Number(body.year);
  const month = Number(body.month);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'invalid_year_month' });
  }
  const share: CalendarShare = {
    id: nanoid(10),
    token: nanoid(20), // URL-safe random
    year,
    month,
    label: body.label || `${year}년 ${month}월`,
    created_by: req.user!.id,
    created_at: new Date().toISOString(),
    event_type_filter: (body.event_type_filter || 'ALL') as 'ALL' | 'MICE' | 'WEDDING',
  };
  store.calendar_shares.push(share);
  persistDoc('calendar_shares', share.id);
  res.status(201).json({ share });
});

router.delete('/:id', (req, res) => {
  const idx = store.calendar_shares.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const removedId = store.calendar_shares[idx].id;
  store.calendar_shares.splice(idx, 1);
  persistDelete('calendar_shares', removedId);
  res.json({ ok: true });
});

export default router;
