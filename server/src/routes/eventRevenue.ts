import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole, requireRoles } from '../middleware/auth.js';
import { DEFAULT_TENANT_ID } from '../types.js';

const router = Router({ mergeParams: true });
const ADMIN_ROLES = ['admin'] as const;

// GET /api/revenue/all-lines — 전 행사의 세부 매출 라인을 한 번에 조회.
// 엑셀 내보내기가 행을 하나씩 펼치지 않아도 세부항목을 채울 수 있게 하기 위함
// (행별 조회만 있으면 펼쳐본 행사만 값이 실려 나가 왕복 시 데이터가 유실된다).
router.get('/all-lines', requireActiveRole, (_req, res) => {
  const deleted = new Set(store.events.filter((e) => e.deleted_at).map((e) => e.id));
  const lines = store.event_revenue_lines.filter((l) => !deleted.has(l.event_id));
  res.json({ revenue_lines: lines });
});

// GET /api/events/:eventId/revenue — 행사 매출 전체 조회
router.get('/:eventId/revenue', requireActiveRole, (req, res) => {
  const event = store.events.find(e => e.id === req.params.eventId && !e.deleted_at);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const lines = store.event_revenue_lines.filter(l => l.event_id === req.params.eventId);
  res.json({ event, revenue_lines: lines, revenue_items: store.revenue_items });
});

// PUT /api/events/:eventId/revenue — 행사 매출 라인 일괄 저장 (admin)
router.put('/:eventId/revenue', requireRoles(...ADMIN_ROLES), (req, res) => {
  const event = store.events.find(e => e.id === req.params.eventId && !e.deleted_at);
  if (!event) return res.status(404).json({ error: 'not_found' });

  const {
    contract_amount, sales_total_amount, discount_rate, discount_reason,
    contract_date, gateway_fee, lines,
  } = req.body as {
    contract_amount?: number | null;
    sales_total_amount?: number | null;
    discount_rate?: number | null;
    discount_reason?: string;
    contract_date?: string | null;
    gateway_fee?: number | null;
    lines?: Array<{ revenue_item_id: string; amount: number | null; note?: string }>;
  };

  // 이벤트 메타 업데이트
  const raw = event as unknown as Record<string, unknown>;
  if (contract_amount !== undefined) raw.contract_amount = contract_amount;
  if (sales_total_amount !== undefined) raw.sales_total_amount = sales_total_amount;
  if (discount_rate !== undefined) raw.discount_rate = discount_rate;
  if (discount_reason !== undefined) raw.discount_reason = discount_reason;
  if (contract_date !== undefined) raw.contract_date = contract_date;
  if (gateway_fee !== undefined) raw.gateway_fee = gateway_fee;
  event.updated_at = new Date().toISOString();
  persistDoc('events', event.id);

  // 라인 업데이트 (해당 event 기존 라인 제거 후 재삽입)
  if (Array.isArray(lines)) {
    const otherLines = store.event_revenue_lines.filter(l => l.event_id !== event.id);
    const now = new Date().toISOString();
    const newLines = lines
      .filter(l => l.revenue_item_id)
      .map(l => ({
        id: nanoid(10),
        tenant_id: DEFAULT_TENANT_ID,
        event_id: event.id,
        revenue_item_id: l.revenue_item_id,
        amount: l.amount ?? null,
        note: l.note?.trim() ?? '',
        created_at: now,
        updated_at: now,
      }));
    store.event_revenue_lines = [...otherLines, ...newLines];
    for (const line of newLines) persistDoc('event_revenue_lines', line.id);
  }

  const resultLines = store.event_revenue_lines.filter(l => l.event_id === event.id);
  res.json({ event, revenue_lines: resultLines });
});

// POST /api/revenue/import — 엑셀 일괄 import (admin)
// 클라이언트가 파싱한 rows 배열을 받아서 upsert
// body: { rows: Array<{ event_id, contract_amount, sales_total_amount, discount_rate, discount_reason, contract_date, gateway_fee, items: {[code]: amount}, note }> }
router.post('/import', requireRoles(...ADMIN_ROLES), (req, res) => {
  const { rows } = req.body as {
    rows?: Array<{
      event_id: string;
      contract_amount?: number | null;
      sales_total_amount?: number | null;
      discount_rate?: number | null;
      discount_reason?: string;
      contract_date?: string | null;
      gateway_fee?: number | null;
      items?: Record<string, number | null>;
      note?: string;
    }>;
  };
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows_required' });

  const itemsByCode = Object.fromEntries(store.revenue_items.map(i => [i.code, i]));
  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const event = store.events.find(e => e.id === row.event_id && !e.deleted_at);
    if (!event) { errors.push(`event_id not found: ${row.event_id}`); continue; }

    const raw = event as unknown as Record<string, unknown>;
    if (row.contract_amount !== undefined) raw.contract_amount = row.contract_amount;
    if (row.sales_total_amount !== undefined) raw.sales_total_amount = row.sales_total_amount;
    if (row.discount_rate !== undefined) raw.discount_rate = row.discount_rate;
    if (row.discount_reason !== undefined) raw.discount_reason = row.discount_reason;
    if (row.contract_date !== undefined) raw.contract_date = row.contract_date;
    if (row.gateway_fee !== undefined) raw.gateway_fee = row.gateway_fee;
    event.updated_at = new Date().toISOString();
    persistDoc('events', event.id);

    if (row.items && typeof row.items === 'object') {
      const otherLines = store.event_revenue_lines.filter(l => l.event_id !== event.id);
      const now = new Date().toISOString();
      const newLines = Object.entries(row.items)
        .filter(([code]) => itemsByCode[code])
        .map(([code, amount]) => ({
          id: nanoid(10),
          tenant_id: DEFAULT_TENANT_ID,
          event_id: event.id,
          revenue_item_id: itemsByCode[code].id,
          amount: amount ?? null,
          note: row.note?.trim() ?? '',
          created_at: now,
          updated_at: now,
        }));
      store.event_revenue_lines = [...otherLines, ...newLines];
      for (const line of newLines) persistDoc('event_revenue_lines', line.id);
    }
    updated++;
  }

  res.json({ updated, errors });
});

export default router;
