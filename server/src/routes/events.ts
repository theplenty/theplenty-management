import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete, replaceMatching, deleteMatching } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type {
  Event,
  CustomerType,
  EventStatus,
  FoodItem,
  EventCustomerLink,
  CustomerRole,
  Invoice,
  Cancellation,
} from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 행사 권한 — 세일즈팀(sales_mice/sales_wedding)은 한 팀으로 보고 동등하게 처리.
// 역할 분리는 "고객정보 입력 담당자"를 나누기 위한 것이므로 행사 정보에서는 크로스 체크 가능.
// - admin / banquet / kitchen / sales_*: 모든 행사 읽기 가능
// - admin / sales_*: 모든 행사 쓰기 가능 (등록/수정)
// - banquet / kitchen: 읽기만
function canReadType(role: string, _type: CustomerType): boolean {
  return (
    role === 'admin' ||
    role === 'banquet' ||
    role === 'kitchen' ||
    role === 'sales_mice' ||
    role === 'sales_wedding'
  );
}

function canWriteType(role: string, _type: CustomerType): boolean {
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}

// 한 행사에 연결된 식음 메뉴 항목들을 통째로 교체.
function replaceFoodItems(eventId: string, items: Partial<FoodItem>[] | undefined) {
  if (!items) return;
  const newItems: FoodItem[] = items.map((it) => ({
    id: it.id || nanoid(10),
    event_id: eventId,
    menu_name: it.menu_name as FoodItem['menu_name'],
    gtd: it.gtd ?? null,
    exp: it.exp ?? null,
    time_label: it.time_label || '',
    service_time: it.service_time || '',
    quantity: it.quantity ?? null,
    memo: it.memo || '',
  }));
  replaceMatching('event_food_items', (f) => f.event_id === eventId, newItems);
}

// 행사-고객 연결도 통째로 교체. CONTACT POINT용 담당자 식별자(contact_point_contact_id)도 보존.
function replaceCustomerLinks(eventId: string, links: Partial<EventCustomerLink>[] | undefined) {
  if (!links) return;
  const newItems: EventCustomerLink[] = [];
  for (const it of links) {
    if (!it.customer_id) continue;
    newItems.push({
      id: it.id || nanoid(10),
      event_id: eventId,
      customer_id: it.customer_id,
      customer_role: (it.customer_role as CustomerRole) || '주최사',
      is_contact_point: !!it.is_contact_point,
      contact_point_contact_id: it.contact_point_contact_id || '',
    });
  }
  replaceMatching('event_customers', (l) => l.event_id === eventId, newItems);
}

// INVOICE upsert.
// data가 undefined → 변경 없음 (보존)
// data가 null → 삭제
// data가 객체 → 기존 있으면 부분 업데이트, 없으면 신규 생성
function upsertInvoice(eventId: string, data: Partial<Invoice> | null | undefined) {
  if (data === undefined) return;
  if (data === null) {
    deleteMatching('invoices', (i) => i.event_id === eventId);
    return;
  }
  let row = store.invoices.find((i) => i.event_id === eventId);
  if (!row) {
    row = {
      id: nanoid(10),
      event_id: eventId,
      payment_status: '',
      invoice_type: '',
      invoice_issue_status: '',
      payment_amount: null,
      payment_date: null,
      tax_invoice_issue_date: null,
      depositor_name: '',
    };
    store.invoices.push(row);
  }
  if (data.payment_status !== undefined) row.payment_status = data.payment_status;
  if (data.invoice_type !== undefined) row.invoice_type = data.invoice_type;
  if (data.invoice_issue_status !== undefined) row.invoice_issue_status = data.invoice_issue_status;
  if (data.payment_amount !== undefined) row.payment_amount = data.payment_amount;
  if (data.payment_date !== undefined) row.payment_date = data.payment_date;
  if (data.tax_invoice_issue_date !== undefined) row.tax_invoice_issue_date = data.tax_invoice_issue_date;
  if (data.depositor_name !== undefined) row.depositor_name = data.depositor_name;
  persistDoc('invoices', row.id);
}

// 행사취소(cancellation) upsert. invoice와 동일한 패턴.
function upsertCancellation(eventId: string, data: Partial<Cancellation> | null | undefined) {
  if (data === undefined) return;
  if (data === null) {
    deleteMatching('cancellations', (c) => c.event_id === eventId);
    return;
  }
  let row = store.cancellations.find((c) => c.event_id === eventId);
  if (!row) {
    row = {
      id: nanoid(10),
      event_id: eventId,
      cancel_requested_at: null,
      cancel_reason: '',
      plenty_cancel_fee: null,
      plenty_cancel_fee_paid_at: null,
      catholic_rental_refund_status: '',
    };
    store.cancellations.push(row);
  }
  if (data.cancel_requested_at !== undefined) row.cancel_requested_at = data.cancel_requested_at;
  if (data.cancel_reason !== undefined) row.cancel_reason = data.cancel_reason;
  if (data.plenty_cancel_fee !== undefined) row.plenty_cancel_fee = data.plenty_cancel_fee;
  if (data.plenty_cancel_fee_paid_at !== undefined) row.plenty_cancel_fee_paid_at = data.plenty_cancel_fee_paid_at;
  if (data.catholic_rental_refund_status !== undefined)
    row.catholic_rental_refund_status = data.catholic_rental_refund_status;
  persistDoc('cancellations', row.id);
}

router.get('/', (req, res) => {
  const role = req.user!.role;
  const list = store.events.filter((e) => canReadType(role, e.event_type));
  // 캘린더 표시 + 대시보드 통계용으로 식음 메뉴 + invoice를 함께 반환
  const enriched = list.map((e) => {
    const food_items = store.event_food_items.filter((f) => f.event_id === e.id);
    const invoice = store.invoices.find((i) => i.event_id === e.id) || null;
    return { ...e, food_items, invoice };
  });
  res.json({ events: enriched });
});

router.get('/:id', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  if (!canReadType(req.user!.role, ev.event_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const food_items = store.event_food_items.filter((f) => f.event_id === ev.id);
  const customer_links = store.event_customers.filter((l) => l.event_id === ev.id);
  const invoice = store.invoices.find((i) => i.event_id === ev.id) || null;
  const cancellation = store.cancellations.find((c) => c.event_id === ev.id) || null;
  const review = store.event_reviews.find((r) => r.event_id === ev.id) || null;
  const files = store.event_files.filter((f) => f.event_id === ev.id);
  res.json({ event: ev, food_items, customer_links, invoice, cancellation, review, files });
});

type EventBody = Partial<Event> & {
  food_items?: Partial<FoodItem>[];
  customer_links?: Partial<EventCustomerLink>[];
  invoice?: Partial<Invoice> | null;
  cancellation?: Partial<Cancellation> | null;
};

router.post('/', (req, res) => {
  const body = req.body as EventBody;
  const event_type = (body.event_type === 'WEDDING' ? 'WEDDING' : 'MICE') as CustomerType;
  if (!canWriteType(req.user!.role, event_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const now = new Date().toISOString();
  // 작성자/작성일자: 일괄등록 시 body로 직접 지정 가능. 미지정이면 현재 로그인 사용자/현재시각.
  const overrideCreatedAt =
    typeof body.created_at === 'string' && body.created_at.trim() ? body.created_at : null;
  const overrideCreatedByName =
    typeof body.created_by_name === 'string' && body.created_by_name.trim()
      ? body.created_by_name.trim()
      : null;
  const ev: Event = {
    id: nanoid(10),
    event_type,
    created_by: req.user!.id,
    created_by_name: overrideCreatedByName || req.user!.name,
    status: (body.status as EventStatus) || 'INQ',
    usage_type: body.usage_type ?? null,
    halls: body.halls || [],
    start_datetime: body.start_datetime || now,
    end_datetime: body.end_datetime || now,
    event_name: body.event_name || '',
    seats: body.seats ?? null,
    food_gtd_contract: body.food_gtd_contract ?? null,
    food_exp_contract: body.food_exp_contract ?? null,
    food_gtd_final: body.food_gtd_final ?? null,
    food_exp_final: body.food_exp_final ?? null,
    created_at: overrideCreatedAt || now,
    updated_at: now,
  };
  store.events.push(ev);
  persistDoc('events', ev.id);
  replaceFoodItems(ev.id, body.food_items);
  replaceCustomerLinks(ev.id, body.customer_links);
  upsertInvoice(ev.id, body.invoice);
  upsertCancellation(ev.id, body.cancellation);
  const food_items = store.event_food_items.filter((f) => f.event_id === ev.id);
  const customer_links = store.event_customers.filter((l) => l.event_id === ev.id);
  const invoice = store.invoices.find((i) => i.event_id === ev.id) || null;
  const cancellation = store.cancellations.find((c) => c.event_id === ev.id) || null;
  res.status(201).json({ event: ev, food_items, customer_links, invoice, cancellation });
});

router.patch('/:id', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  if (!canWriteType(req.user!.role, ev.event_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const body = req.body as EventBody;
  Object.assign(ev, body, {
    id: ev.id,
    event_type: ev.event_type,
    created_by: ev.created_by,
    created_by_name: ev.created_by_name,
    created_at: ev.created_at,
    updated_at: new Date().toISOString(),
  });
  if (body.food_items !== undefined) replaceFoodItems(ev.id, body.food_items);
  if (body.customer_links !== undefined) replaceCustomerLinks(ev.id, body.customer_links);
  if (body.invoice !== undefined) upsertInvoice(ev.id, body.invoice);
  if (body.cancellation !== undefined) upsertCancellation(ev.id, body.cancellation);
  // 상태가 LOS가 아닌데 cancellation이 남아있으면 정리
  if (ev.status !== 'LOS') upsertCancellation(ev.id, null);
  persistDoc('events', ev.id);
  const food_items = store.event_food_items.filter((f) => f.event_id === ev.id);
  const customer_links = store.event_customers.filter((l) => l.event_id === ev.id);
  const invoice = store.invoices.find((i) => i.event_id === ev.id) || null;
  const cancellation = store.cancellations.find((c) => c.event_id === ev.id) || null;
  res.json({ event: ev, food_items, customer_links, invoice, cancellation });
});

router.delete('/:id', (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const idx = store.events.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const eid = store.events[idx].id;
  store.events.splice(idx, 1);
  persistDelete('events', eid);
  // cascade — 자식 컬렉션은 deleteMatching이 in-memory + Firestore 둘 다 정리
  deleteMatching('event_food_items', (f) => f.event_id === eid);
  deleteMatching('event_customers', (l) => l.event_id === eid);
  deleteMatching('invoices', (i) => i.event_id === eid);
  deleteMatching('event_files', (f) => f.event_id === eid);
  deleteMatching('cancellations', (c) => c.event_id === eid);
  deleteMatching('event_reviews', (r) => r.event_id === eid);
  res.json({ ok: true });
});

export default router;
