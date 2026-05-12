import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { SalesTarget } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 읽기는 활성 사용자 누구나, 쓰기는 admin만 (퇴사자 영향 차단)
function canWrite(role: string): boolean {
  return role === 'admin';
}

// 전체 또는 연도별 조회
router.get('/', (req, res) => {
  const yearStr = req.query.year as string | undefined;
  let list = store.sales_targets;
  if (yearStr) {
    const y = Number(yearStr);
    list = list.filter((t) => t.year === y);
  }
  res.json({ targets: list });
});

// 단건 조회 (year/month)
router.get('/:year/:month', (req, res) => {
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const target = store.sales_targets.find((t) => t.year === year && t.month === month);
  res.json({ target: target || null });
});

// upsert (year/month) — admin only
router.put('/:year/:month', (req, res) => {
  if (!canWrite(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'invalid_year_month' });
  }
  const body = req.body as Partial<SalesTarget>;
  const now = new Date().toISOString();
  let target = store.sales_targets.find((t) => t.year === year && t.month === month);
  if (!target) {
    target = {
      id: nanoid(10),
      year,
      month,
      wedding_event_count_forecast: null,
      mice_event_count_forecast: null,
      total_event_count_forecast: null,
      wedding_revenue_forecast: null,
      mice_revenue_forecast: null,
      total_revenue_forecast: null,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };
    store.sales_targets.push(target);
  }
  if (body.wedding_event_count_forecast !== undefined)
    target.wedding_event_count_forecast = body.wedding_event_count_forecast;
  if (body.mice_event_count_forecast !== undefined)
    target.mice_event_count_forecast = body.mice_event_count_forecast;
  if (body.total_event_count_forecast !== undefined)
    target.total_event_count_forecast = body.total_event_count_forecast;
  if (body.wedding_revenue_forecast !== undefined)
    target.wedding_revenue_forecast = body.wedding_revenue_forecast;
  if (body.mice_revenue_forecast !== undefined)
    target.mice_revenue_forecast = body.mice_revenue_forecast;
  if (body.total_revenue_forecast !== undefined)
    target.total_revenue_forecast = body.total_revenue_forecast;
  target.updated_at = now;
  persistDoc('sales_targets', target.id);
  res.json({ target });
});

// 삭제 — admin only
router.delete('/:year/:month', (req, res) => {
  if (!canWrite(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const year = Number(req.params.year);
  const month = Number(req.params.month);
  const idx = store.sales_targets.findIndex((t) => t.year === year && t.month === month);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const removedId = store.sales_targets[idx].id;
  store.sales_targets.splice(idx, 1);
  persistDelete('sales_targets', removedId);
  res.json({ ok: true });
});

export default router;
