// 결제 매핑 API
// 권한: admin → 전체 CRUD / 그 외 활성 사용자 → GET only

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { Payment, PaymentType, PaymentMethod, CardCompany } from '../types.js';

const router = Router();
router.use(requireActiveRole);

function canWrite(role: string) {
  return role === 'admin';
}

function sanitizePayment(body: Record<string, unknown>): Partial<Payment> {
  const TYPES: PaymentType[] = ['deposit', 'balance', 'contract', 'additional', 'refund'];
  const METHODS: PaymentMethod[] = ['card', 'transfer', 'cash', 'other'];
  const CARDS: CardCompany[] = ['hyundai', 'samsung', 'shinhan', 'kb', 'lotte', 'bc', 'woori', 'hana', 'other'];

  const out: Partial<Payment> = {};
  if (body.event_id) out.event_id = String(body.event_id);
  if (body.payment_type && TYPES.includes(body.payment_type as PaymentType))
    out.payment_type = body.payment_type as PaymentType;
  if (typeof body.amount === 'number') out.amount = body.amount;
  if (body.paid_at) out.paid_at = String(body.paid_at);
  if (body.method && METHODS.includes(body.method as PaymentMethod))
    out.method = body.method as PaymentMethod;
  if (body.card_company && CARDS.includes(body.card_company as CardCompany))
    out.card_company = body.card_company as CardCompany;
  else if (body.card_company === null || body.card_company === '')
    out.card_company = undefined;
  if (body.approval_no !== undefined) out.approval_no = body.approval_no ? String(body.approval_no) : undefined;
  if (body.business_name !== undefined) out.business_name = body.business_name ? String(body.business_name) : undefined;
  if (body.bank_deposit_date !== undefined)
    out.bank_deposit_date = body.bank_deposit_date ? String(body.bank_deposit_date) : undefined;
  if (typeof body.bank_deposit_amount === 'number')
    out.bank_deposit_amount = body.bank_deposit_amount;
  else if (body.bank_deposit_amount === null || body.bank_deposit_amount === '')
    out.bank_deposit_amount = undefined;
  if (body.note !== undefined) out.note = body.note ? String(body.note) : undefined;
  return out;
}

// GET /api/payments?event_id=xxx&month=2026-06
router.get('/', (req, res) => {
  let list = [...store.payments];
  if (req.query.event_id) {
    list = list.filter((p) => p.event_id === req.query.event_id);
  }
  if (req.query.month) {
    const m = String(req.query.month); // "2026-06"
    list = list.filter((p) => p.paid_at?.startsWith(m));
  }
  res.json({ payments: list });
});

// GET /api/payments/alerts — 카드 미입금 알람
router.get('/alerts', (_req, res) => {
  const DEPOSIT_DAYS: Record<CardCompany, number> = {
    hyundai: 3, samsung: 3, shinhan: 2, kb: 3,
    lotte: 3, bc: 2, woori: 2, hana: 2, other: 3,
  };

  function addBusinessDays(dateStr: string, days: number): Date {
    const d = new Date(dateStr);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++; // 주말 제외
    }
    return d;
  }

  const now = new Date();
  const alerts = store.payments
    .filter((p) => {
      if (p.method !== 'card') return false;
      if (p.bank_deposit_date) return false; // 이미 입금됨
      if (!p.paid_at || !p.card_company) return false;
      const deadline = addBusinessDays(p.paid_at, DEPOSIT_DAYS[p.card_company] ?? 3);
      return now > deadline; // 기한 초과
    })
    .map((p) => {
      const ev = store.events.find((e) => e.id === p.event_id);
      return { ...p, event_name: ev?.event_name ?? '' };
    });

  res.json({ alerts });
});

// GET /api/payments/:id
router.get('/:id', (req, res) => {
  const p = store.payments.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({ payment: p });
});

// POST /api/payments
router.post('/', (req, res) => {
  if (!canWrite(req.user!.role))
    return res.status(403).json({ error: 'forbidden' });

  const now = new Date().toISOString();
  const partial = sanitizePayment(req.body as Record<string, unknown>);
  if (!partial.event_id || !partial.payment_type || !partial.method || typeof partial.amount !== 'number') {
    return res.status(400).json({ error: 'missing_required_fields' });
  }

  const ev = store.events.find((e) => e.id === partial.event_id);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });

  const record: Payment = {
    id: nanoid(10),
    event_id: partial.event_id!,
    payment_type: partial.payment_type!,
    amount: partial.amount!,
    paid_at: partial.paid_at ?? now.slice(0, 10),
    method: partial.method!,
    ...(partial.card_company ? { card_company: partial.card_company } : {}),
    ...(partial.approval_no ? { approval_no: partial.approval_no } : {}),
    ...(partial.business_name ? { business_name: partial.business_name } : {}),
    ...(partial.bank_deposit_date ? { bank_deposit_date: partial.bank_deposit_date } : {}),
    ...(typeof partial.bank_deposit_amount === 'number' ? { bank_deposit_amount: partial.bank_deposit_amount } : {}),
    ...(partial.note ? { note: partial.note } : {}),
    created_at: now,
    updated_at: now,
  };
  store.payments.push(record);
  persistDoc('payments', record.id);
  res.status(201).json({ payment: record });
});

// PATCH /api/payments/:id
router.patch('/:id', (req, res) => {
  if (!canWrite(req.user!.role))
    return res.status(403).json({ error: 'forbidden' });

  const idx = store.payments.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });

  const partial = sanitizePayment(req.body as Record<string, unknown>);

  // reconciled_at 처리
  if (req.body.reconciled_at !== undefined) {
    partial.reconciled_at = req.body.reconciled_at ? String(req.body.reconciled_at) : undefined;
    partial.reconciled_by = req.body.reconciled_at ? req.user!.id : undefined;
  }

  const updated: Payment = {
    ...store.payments[idx],
    ...partial,
    updated_at: new Date().toISOString(),
  };
  store.payments[idx] = updated;
  persistDoc('payments', updated.id);
  res.json({ payment: updated });
});

// DELETE /api/payments/:id
router.delete('/:id', (req, res) => {
  if (!canWrite(req.user!.role))
    return res.status(403).json({ error: 'forbidden' });

  const idx = store.payments.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });

  const removed = store.payments[idx];
  store.payments.splice(idx, 1);
  persistDelete('payments', removed.id);
  res.json({ ok: true });
});

export default router;
