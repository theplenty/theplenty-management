import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  store,
  persistDoc,
  persistDelete,
  replaceMatching,
  deleteMatching,
  softDelete,
  activeRows,
  isDeleted,
} from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { logChange, computeDiff, getLogsForEntity } from '../store/changeLog.js';
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

// WEDDING 행사일 때, 연결된 WEDDING 고객의 첫 예식후보 담당지배인을 가져온다.
// 없거나 MICE 행사면 [null, null].
function deriveWeddingManager(eventId: string): { id: string; name: string } | null {
  const links = store.event_customers.filter((l) => l.event_id === eventId);
  for (const l of links) {
    const c = store.wedding_customers.find((w) => w.id === l.customer_id);
    if (!c) continue;
    const inq = c.event_inquiries[0];
    if (inq && (inq.assigned_manager_id || inq.assigned_manager_name)) {
      return { id: inq.assigned_manager_id || '', name: inq.assigned_manager_name || '' };
    }
  }
  return null;
}

const EVENT_FIELD_LABELS: Record<string, string> = {
  event_type: '구분',
  status: '상태',
  usage_type: '이용시간',
  halls: '사용홀',
  start_datetime: '시작일시',
  end_datetime: '종료일시',
  event_name: '행사명',
  seats: '좌석수',
  food_gtd_contract: '식음 GTD(계약)',
  food_exp_contract: '식음 EXP(계약)',
  food_gtd_final: '식음 GTD(확정)',
  food_exp_final: '식음 EXP(확정)',
  memo: '메모',
  // assigned_manager_id 는 PATCH 핸들러에서 diff 대상에서 제외 → _name 변경만 '담당자'로 노출
  assigned_manager_name: '담당자',
};

const router = Router();
router.use(requireActiveRole);

// 행사 권한 — 세일즈팀(sales_mice/sales_wedding)은 한 팀으로 보고 동등하게 처리.
// 역할 분리는 "고객정보 입력 담당자"를 나누기 위한 것이므로 행사 정보에서는 크로스 체크 가능.
// - admin / banquet / kitchen / sales_*: 모든 행사 읽기 가능
// - admin / sales_*: 모든 행사 쓰기 가능 (등록/수정)
// - banquet / kitchen: 읽기만
function canReadType(role: string, _type: CustomerType): boolean {
  // 모든 활성 사용자 — h_kitchen 도 행사 조회 가능 (스펙: 뷰어. 고객 DB만 제한)
  return (
    role === 'admin' ||
    role === 'banquet' ||
    role === 'kitchen' ||
    role === 'h_kitchen' ||
    role === 'sales_mice' ||
    role === 'sales_wedding'
  );
}

function canWriteType(role: string, _type: CustomerType): boolean {
  // 작성/수정은 admin + sales 만. banquet/kitchen/h_kitchen 은 뷰어.
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}

// 한 행사에 연결된 식음 메뉴 항목들을 통째로 교체.
function replaceFoodItems(eventId: string, items: Partial<FoodItem>[] | undefined) {
  if (!items) return;
  const newItems: FoodItem[] = items.map((it) => ({
    id: it.id || nanoid(10),
    event_id: eventId,
    menu_name: it.menu_name as FoodItem['menu_name'],
    gtd_contract: it.gtd_contract ?? null,
    exp_contract: it.exp_contract ?? null,
    gtd_final: it.gtd_final ?? null,
    exp_final: it.exp_final ?? null,
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
  const list = activeRows(store.events).filter((e) => canReadType(role, e.event_type));
  // 캘린더 표시 + 대시보드 통계용으로 식음 메뉴 + invoice를 함께 반환
  const enriched = list.map((e) => {
    const food_items = store.event_food_items.filter((f) => f.event_id === e.id);
    const invoice = store.invoices.find((i) => i.event_id === e.id) || null;
    return { ...e, food_items, invoice };
  });
  res.json({ events: enriched });
});

// 일괄 upsert (엑셀 import) — 관리자 또는 sales.
// 매칭: id → event_name + start_datetime + event_type 복합키.
// food_items는 Excel에 있는 경우만 교체.
router.post('/_bulk-upsert', (req, res) => {
  const role = req.user!.role;
  // 권한: 한 행이라도 자기가 쓸 수 없는 타입이면 에러로 처리. 일단 sales/admin만 진입.
  if (role !== 'admin' && role !== 'sales_mice' && role !== 'sales_wedding') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const body = req.body as {
    rows: Array<Partial<Event> & { food_items?: Partial<FoodItem>[] }>;
    dryRun?: boolean;
  };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = !!body.dryRun;
  let added = 0;
  let updated = 0;
  const errors: Array<{ row?: number; key?: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const eventName = (r.event_name || '').trim();
    if (!eventName) {
      errors.push({ row: i + 1, reason: '행사명이 비어있습니다' });
      continue;
    }
    const evType: CustomerType = r.event_type === 'WEDDING' ? 'WEDDING' : 'MICE';
    if (!canWriteType(role, evType)) {
      errors.push({ row: i + 1, key: eventName, reason: `${evType} 행사 쓰기 권한 없음` });
      continue;
    }

    // 휴지통 row는 매칭 대상에서 제외 — 새 row로 인입.
    let existing: Event | undefined;
    if (r.id) existing = store.events.find((e) => e.id === r.id && !e.deleted_at);
    if (!existing) {
      // 복합키: event_name + start_datetime + event_type
      existing = store.events.find(
        (e) =>
          !e.deleted_at &&
          e.event_type === evType &&
          e.event_name.trim() === eventName &&
          e.start_datetime === r.start_datetime
      );
    }

    if (existing) {
      if (dryRun) {
        updated++;
        continue;
      }
      // 스칼라 필드 갱신
      if (r.status !== undefined) existing.status = r.status as EventStatus;
      if (r.usage_type !== undefined) existing.usage_type = r.usage_type;
      if (r.halls !== undefined) existing.halls = [...new Set(r.halls)];
      if (r.start_datetime !== undefined) existing.start_datetime = r.start_datetime;
      if (r.end_datetime !== undefined) existing.end_datetime = r.end_datetime;
      if (r.event_name !== undefined) existing.event_name = r.event_name;
      if (r.seats !== undefined) existing.seats = r.seats;
      if (r.food_gtd_contract !== undefined) existing.food_gtd_contract = r.food_gtd_contract;
      if (r.food_exp_contract !== undefined) existing.food_exp_contract = r.food_exp_contract;
      if (r.food_gtd_final !== undefined) existing.food_gtd_final = r.food_gtd_final;
      if (r.food_exp_final !== undefined) existing.food_exp_final = r.food_exp_final;
      if (r.memo !== undefined) existing.memo = r.memo || '';
      if (r.assigned_manager_id !== undefined) existing.assigned_manager_id = r.assigned_manager_id || '';
      if (r.assigned_manager_name !== undefined) existing.assigned_manager_name = r.assigned_manager_name || '';
      existing.updated_at = now;
      persistDoc('events', existing.id);
      // food_items은 Excel에 있는 경우만 교체
      if (Array.isArray(r.food_items) && r.food_items.length > 0) {
        replaceFoodItems(existing.id, r.food_items);
      }
      updated++;
    } else {
      if (dryRun) {
        added++;
        continue;
      }
      const newEv: Event = {
        id: nanoid(10),
        event_type: evType,
        created_by: req.user!.id,
        created_by_name:
          (typeof r.created_by_name === 'string' && r.created_by_name.trim()) ||
          req.user!.name,
        status: (r.status as EventStatus) || 'INQ',
        usage_type: r.usage_type ?? null,
        halls: [...new Set(r.halls || [])],
        start_datetime: r.start_datetime || now,
        end_datetime: r.end_datetime || now,
        event_name: eventName,
        seats: r.seats ?? null,
        food_gtd_contract: r.food_gtd_contract ?? null,
        food_exp_contract: r.food_exp_contract ?? null,
        food_gtd_final: r.food_gtd_final ?? null,
        food_exp_final: r.food_exp_final ?? null,
        memo: r.memo || '',
        assigned_manager_id: r.assigned_manager_id || '',
        assigned_manager_name: r.assigned_manager_name || '',
        created_at:
          (typeof r.created_at === 'string' && r.created_at.trim()) || now,
        updated_at: now,
      };
      store.events.push(newEv);
      persistDoc('events', newEv.id);
      if (Array.isArray(r.food_items) && r.food_items.length > 0) {
        replaceFoodItems(newEv.id, r.food_items);
      }
      added++;
    }
  }
  res.json({
    ok: added + updated,
    failed: errors.length,
    added,
    updated,
    errors,
    dryRun,
  });
});

// 일괄 삭제 — 관리자 전용. 행사와 자식 컬렉션(식음/업체연결/INVOICE/첨부/취소/리뷰) 모두 정리.
// 고객/사용자/캘린더공유/매출목표는 건드리지 않음.
// 주의: 라우트 순서상 '/:id' 보다 먼저 정의해야 'id=_clear-all'로 잡히지 않음.
router.post('/_clear-all', (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const before = store.events.length;
  // 부모 행사 먼저 제거 (in-memory + Firestore)
  const eventIds = store.events.map((e) => e.id);
  store.events.length = 0;
  for (const id of eventIds) persistDelete('events', id);
  // 자식 컬렉션 모두 비우기
  deleteMatching('event_food_items', () => true);
  deleteMatching('event_customers', () => true);
  deleteMatching('invoices', () => true);
  deleteMatching('event_files', () => true);
  deleteMatching('cancellations', () => true);
  deleteMatching('event_reviews', () => true);
  console.log(`[events] 일괄 삭제 — 행사 ${before}건 + 자식 컬렉션 정리`);
  res.json({ ok: true, deleted: before });
});

router.get('/:id/logs', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.id);
  if (!ev || isDeleted(ev)) return res.status(404).json({ error: 'not_found' });
  if (!canReadType(req.user!.role, ev.event_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const logs = getLogsForEntity('event', req.params.id);
  res.json({ logs });
});

router.get('/:id', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.id);
  if (!ev || isDeleted(ev)) return res.status(404).json({ error: 'not_found' });
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
    halls: [...new Set(body.halls || [])],
    start_datetime: body.start_datetime || now,
    end_datetime: body.end_datetime || now,
    event_name: body.event_name || '',
    seats: body.seats ?? null,
    food_gtd_contract: body.food_gtd_contract ?? null,
    food_exp_contract: body.food_exp_contract ?? null,
    food_gtd_final: body.food_gtd_final ?? null,
    food_exp_final: body.food_exp_final ?? null,
    memo: body.memo || '',
    assigned_manager_id: body.assigned_manager_id || '',
    assigned_manager_name: body.assigned_manager_name || '',
    created_at: overrideCreatedAt || now,
    updated_at: now,
  };
  store.events.push(ev);
  persistDoc('events', ev.id);
  replaceFoodItems(ev.id, body.food_items);
  replaceCustomerLinks(ev.id, body.customer_links);
  upsertInvoice(ev.id, body.invoice);
  upsertCancellation(ev.id, body.cancellation);
  // WEDDING 행사면 연결된 고객의 담당지배인으로 덮어쓰기
  if (ev.event_type === 'WEDDING') {
    const mgr = deriveWeddingManager(ev.id);
    if (mgr) {
      ev.assigned_manager_id = mgr.id;
      ev.assigned_manager_name = mgr.name;
      persistDoc('events', ev.id);
    }
  }
  const food_items = store.event_food_items.filter((f) => f.event_id === ev.id);
  const customer_links = store.event_customers.filter((l) => l.event_id === ev.id);
  const invoice = store.invoices.find((i) => i.event_id === ev.id) || null;
  const cancellation = store.cancellations.find((c) => c.event_id === ev.id) || null;
  logChange({
    entity_type: 'event',
    entity_id: ev.id,
    action: 'create',
    summary: `[${ev.event_name || '(이름 없음)'}] 신규 등록`,
    user: req.user!,
  });
  res.status(201).json({ event: ev, food_items, customer_links, invoice, cancellation });
});

router.patch('/:id', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  if (!canWriteType(req.user!.role, ev.event_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const body = req.body as EventBody;
  // diff 용으로 스칼라 필드만 스냅샷 (body 의 자식 컬렉션은 ev 에 없으므로 비교 노이즈 회피)
  const before: Record<string, unknown> = { ...ev };
  Object.assign(ev, body, {
    id: ev.id,
    event_type: ev.event_type,
    created_by: ev.created_by,
    created_by_name: ev.created_by_name,
    created_at: ev.created_at,
    updated_at: new Date().toISOString(),
  });
  // assigned_manager_id 가 함께 바뀌면 _name 변경은 라벨 중복이라 무시 (서버 측 후처리)
  if (body.food_items !== undefined) replaceFoodItems(ev.id, body.food_items);
  if (body.customer_links !== undefined) replaceCustomerLinks(ev.id, body.customer_links);
  if (body.invoice !== undefined) upsertInvoice(ev.id, body.invoice);
  if (body.cancellation !== undefined) upsertCancellation(ev.id, body.cancellation);
  // 상태가 LOS가 아닌데 cancellation이 남아있으면 정리
  if (ev.status !== 'LOS') upsertCancellation(ev.id, null);
  // WEDDING 행사면 연결된 고객의 담당지배인으로 덮어쓰기 (클라이언트가 보낸 값보다 우선)
  if (ev.event_type === 'WEDDING') {
    const mgr = deriveWeddingManager(ev.id);
    if (mgr) {
      ev.assigned_manager_id = mgr.id;
      ev.assigned_manager_name = mgr.name;
    }
  }
  persistDoc('events', ev.id);
  const food_items = store.event_food_items.filter((f) => f.event_id === ev.id);
  const customer_links = store.event_customers.filter((l) => l.event_id === ev.id);
  const invoice = store.invoices.find((i) => i.event_id === ev.id) || null;
  const cancellation = store.cancellations.find((c) => c.event_id === ev.id) || null;
  // 담당자 id 는 사용자에게 의미 없으므로 diff 대상에서 제외 — _name 변경만 '담당자'로 노출
  const beforeForDiff = { ...before };
  delete beforeForDiff.assigned_manager_id;
  const afterForDiff = { ...(ev as unknown as Record<string, unknown>) };
  delete afterForDiff.assigned_manager_id;
  const diff = computeDiff(beforeForDiff, afterForDiff, EVENT_FIELD_LABELS);
  if (diff.changes.length > 0) {
    logChange({
      entity_type: 'event',
      entity_id: ev.id,
      action: 'update',
      summary: diff.summary,
      changes: diff.changes,
      user: req.user!,
    });
  }
  res.json({ event: ev, food_items, customer_links, invoice, cancellation });
});

// 행사 삭제 — 휴지통으로 이동 (soft delete).
// 자식(food_items/links/invoice/files/cancellation/review)은 그대로 유지.
// 부모가 deleted_at 갖는 한 list/detail에서 안 보임. 영구삭제 시에만 자식 cascade.
// 새 권한 정책: 작성·수정·삭제 가능자(admin + sales)만 행사 삭제 가능. 뷰어 제외.
router.delete('/:id', (req, res) => {
  if (!canWriteType(req.user!.role, 'MICE')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const ev = store.events.find((e) => e.id === req.params.id);
  if (!ev || isDeleted(ev)) return res.status(404).json({ error: 'not_found' });
  softDelete('events', ev.id, { id: req.user!.id, name: req.user!.name });
  logChange({
    entity_type: 'event',
    entity_id: ev.id,
    action: 'delete',
    summary: `[${ev.event_name || '(이름 없음)'}] 휴지통으로 이동`,
    user: req.user!,
  });
  res.json({ ok: true, trashed: true });
});

export default router;
