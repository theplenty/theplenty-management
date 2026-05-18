import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, softDelete, activeRows, isDeleted } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { logChange, computeDiff, getLogsForEntity } from '../store/changeLog.js';
import { normalizeOrgName, levenshtein } from '../lib/textNormalize.js';
import type {
  MiceContact,
  MiceCustomer,
  MiceInquiry,
  WeddingCustomer,
  WeddingEventInquiry,
  CustomerType,
} from '../types.js';

const router = Router();

// 정책:
// - READ: 모든 활성 사용자 (행사-고객 연결을 위해 양 팀에서 양쪽 고객 검색 필요)
// - WRITE: admin 또는 매칭 팀만
function canAccessType(role: string, type: CustomerType): { read: boolean; write: boolean } {
  const isActive =
    role === 'admin' ||
    role === 'sales_mice' ||
    role === 'sales_wedding' ||
    role === 'banquet' ||
    role === 'kitchen';
  const write =
    role === 'admin' ||
    (role === 'sales_mice' && type === 'MICE') ||
    (role === 'sales_wedding' && type === 'WEDDING');
  return { read: isActive, write };
}

router.use(requireActiveRole);

// ===== 고객 통합 프로필 — 한 고객의 모든 연결 행사 + 변경 이력 묶음 =====
// /api/customers/{wedding|mice}/:id/full
// 응답: { customer, linked_events: [...], change_logs: [...] }
//   - linked_events: event_customers 링크로 연결된 행사 + 휴지통 제외 + 시간 desc 정렬
//   - change_logs: 이 고객의 logs + 연결된 행사들의 logs 모두 합쳐 시간 desc

function buildFullProfile(
  type: 'mice' | 'wedding',
  id: string
): { customer: MiceCustomer | WeddingCustomer; linked_events: unknown[]; change_logs: unknown[] } | null {
  const coll = type === 'mice' ? store.mice_customers : store.wedding_customers;
  const item = coll.find((c) => c.id === id);
  if (!item || isDeleted(item)) return null;

  // 1) 연결 행사 — event_customers 링크 → events (휴지통 제외)
  const linkRows = store.event_customers.filter((l) => l.customer_id === id);
  const eventIds = new Set(linkRows.map((l) => l.event_id));
  const linked_events = store.events
    .filter((e) => eventIds.has(e.id) && !e.deleted_at)
    .map((e) => {
      const invoice = store.invoices.find((i) => i.event_id === e.id) || null;
      const cancellation = store.cancellations.find((c) => c.event_id === e.id) || null;
      const review = store.event_reviews.find((r) => r.event_id === e.id) || null;
      const link = linkRows.find((l) => l.event_id === e.id);
      return {
        ...e,
        customer_role: link?.customer_role || null,
        is_contact_point: link?.is_contact_point || false,
        invoice_payment_status: invoice?.payment_status || null,
        cancellation: cancellation ? { reason: cancellation.cancel_reason } : null,
        has_review: !!review,
      };
    })
    .sort((a, b) => (a.start_datetime < b.start_datetime ? 1 : -1));

  // 2) 변경 이력 — 이 고객 logs + 연결 행사들 logs
  const entityType = type === 'mice' ? 'mice_customer' : 'wedding_customer';
  const customerLogs = getLogsForEntity(entityType, id);
  const eventLogs: typeof customerLogs = [];
  for (const ev of linked_events) {
    eventLogs.push(...getLogsForEntity('event', (ev as { id: string }).id));
  }
  const change_logs = [...customerLogs, ...eventLogs].sort((a, b) =>
    a.changed_at < b.changed_at ? 1 : -1
  );

  return { customer: item, linked_events, change_logs };
}

router.get('/mice/:id/full', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'MICE');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const out = buildFullProfile('mice', req.params.id);
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.json(out);
});

router.get('/wedding/:id/full', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const out = buildFullProfile('wedding', req.params.id);
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.json(out);
});

// ===== WEDDING 전화번호 중복 추정 (신규 등록 시 inline 경고용) =====
// 신랑/신부 전화번호 정규화(숫자만) — 완전 일치 시 즉시 빨강 경고.
router.get('/wedding/_similar-phone', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const raw = typeof req.query.phone === 'string' ? req.query.phone : '';
  const limit = Math.min(
    20,
    Math.max(1, parseInt(String(req.query.limit || 5), 10) || 5)
  );
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) {
    return res.json({ input: digits, similar: [] });
  }

  // 행사 카운트 인덱스
  const activeEventIds = new Set<string>();
  for (const ev of store.events) if (!ev.deleted_at) activeEventIds.add(ev.id);
  const eventCountByCustomer = new Map<string, number>();
  for (const link of store.event_customers) {
    if (!activeEventIds.has(link.event_id)) continue;
    eventCountByCustomer.set(
      link.customer_id,
      (eventCountByCustomer.get(link.customer_id) || 0) + 1
    );
  }

  interface Match {
    id: string;
    wedding_event_name: string;
    groom_name: string;
    bride_name: string;
    matched_party: 'groom' | 'bride';
    matched_phone: string;
    event_count: number;
  }
  const matches: Match[] = [];
  for (const c of store.wedding_customers) {
    if (c.deleted_at) continue;
    const g = (c.groom_phone || '').replace(/\D/g, '');
    const b = (c.bride_phone || '').replace(/\D/g, '');
    if (g && g.includes(digits)) {
      matches.push({
        id: c.id,
        wedding_event_name: c.wedding_event_name,
        groom_name: c.groom_name,
        bride_name: c.bride_name,
        matched_party: 'groom',
        matched_phone: c.groom_phone,
        event_count: eventCountByCustomer.get(c.id) || 0,
      });
    } else if (b && b.includes(digits)) {
      matches.push({
        id: c.id,
        wedding_event_name: c.wedding_event_name,
        groom_name: c.groom_name,
        bride_name: c.bride_name,
        matched_party: 'bride',
        matched_phone: c.bride_phone,
        event_count: eventCountByCustomer.get(c.id) || 0,
      });
    }
    if (matches.length >= limit) break;
  }
  res.json({ input: digits, similar: matches });
});

// ===== MICE 업체명 중복 추정 (신규 등록 시 inline 경고용) =====
// normalizeOrgName 으로 키 정규화한 뒤:
//   1) 완전 일치 → exact_after_normalize, score 1.0
//   2) 한쪽이 다른쪽의 substring → substring, score 0.9
//   3) Levenshtein ≤ 2 → levenshtein, score = 1 - dist/max(len)
// 점수 내림차순 top N.
router.get('/mice/_similar-org', (req, res) => {
  const raw = typeof req.query.name === 'string' ? req.query.name : '';
  const limit = Math.min(
    20,
    Math.max(1, parseInt(String(req.query.limit || 5), 10) || 5)
  );
  const inputNorm = normalizeOrgName(raw);
  if (!inputNorm || inputNorm.length < 2) {
    return res.json({ input_normalized: inputNorm, similar: [] });
  }

  // 행사 카운트 인덱스
  const activeEventIds = new Set<string>();
  for (const ev of store.events) if (!ev.deleted_at) activeEventIds.add(ev.id);
  const eventCountByCustomer = new Map<string, number>();
  for (const link of store.event_customers) {
    if (!activeEventIds.has(link.event_id)) continue;
    eventCountByCustomer.set(
      link.customer_id,
      (eventCountByCustomer.get(link.customer_id) || 0) + 1
    );
  }

  type MatchType = 'exact_after_normalize' | 'substring' | 'levenshtein';
  interface Candidate {
    id: string;
    organization_name: string;
    normalized: string;
    score: number;
    match_type: MatchType;
    distance?: number;
    event_count: number;
  }
  const candidates: Candidate[] = [];

  for (const c of store.mice_customers) {
    if (c.deleted_at) continue;
    const norm = normalizeOrgName(c.organization_name);
    if (!norm) continue;
    let match: Candidate | null = null;
    if (norm === inputNorm) {
      match = {
        id: c.id,
        organization_name: c.organization_name,
        normalized: norm,
        score: 1.0,
        match_type: 'exact_after_normalize',
        event_count: eventCountByCustomer.get(c.id) || 0,
      };
    } else if (norm.includes(inputNorm) || inputNorm.includes(norm)) {
      const shorter = Math.min(norm.length, inputNorm.length);
      const longer = Math.max(norm.length, inputNorm.length);
      // 길이 차이가 너무 크면 정확도 낮음 — 짧은쪽이 긴쪽의 절반 이상일 때만 유효
      if (shorter * 2 >= longer) {
        match = {
          id: c.id,
          organization_name: c.organization_name,
          normalized: norm,
          score: 0.9 * (shorter / longer),
          match_type: 'substring',
          event_count: eventCountByCustomer.get(c.id) || 0,
        };
      }
    } else {
      const dist = levenshtein(norm, inputNorm);
      const maxLen = Math.max(norm.length, inputNorm.length);
      // 거리 임계: 4자 이하면 1, 그 이상은 2 허용
      const threshold = maxLen <= 4 ? 1 : 2;
      if (dist <= threshold) {
        match = {
          id: c.id,
          organization_name: c.organization_name,
          normalized: norm,
          score: 1 - dist / Math.max(maxLen, 1),
          match_type: 'levenshtein',
          distance: dist,
          event_count: eventCountByCustomer.get(c.id) || 0,
        };
      }
    }
    if (match) candidates.push(match);
  }

  candidates.sort((a, b) => b.score - a.score);
  res.json({ input_normalized: inputNorm, similar: candidates.slice(0, limit) });
});

// ===== 고객별 행사 개최 횟수 =====
// /admin/trash 의 휴지통 행사는 제외. 취소 계열(LOS / 상담취소 / 미팅취소)도 "개최 실적"에서 제외.
// 응답: { counts: { [customer_id]: { total, held } } }
//   - total: 휴지통 외 모든 연결 (취소 포함) — 연결 수 자체
//   - held: 실제 개최된 행사 (DEF 또는 그 외 진행/완료 상태에서 취소 계열 제외)
router.get('/_event-counts', (_req, res) => {
  // 1) 휴지통·취소 계열 행사 id 제외 set
  const cancelled = new Set(['LOS', '상담취소', '미팅취소']);
  const activeEventIds = new Set<string>();
  const heldEventIds = new Set<string>();
  for (const e of store.events) {
    if (e.deleted_at) continue;
    activeEventIds.add(e.id);
    if (!cancelled.has(e.status)) heldEventIds.add(e.id);
  }
  // 2) event_customers 링크를 돌면서 customer_id별 카운트 집계
  const counts: Record<string, { total: number; held: number }> = {};
  for (const link of store.event_customers) {
    if (!activeEventIds.has(link.event_id)) continue;
    const slot = (counts[link.customer_id] ||= { total: 0, held: 0 });
    slot.total += 1;
    if (heldEventIds.has(link.event_id)) slot.held += 1;
  }
  res.json({ counts });
});

// ===== MICE =====

const MICE_FIELD_LABELS: Record<string, string> = {
  mice_category: '구분',
  organization_name: '업체명',
  official_phone: '공식연락처',
  official_email: '공식이메일',
  official_website: '공식홈페이지',
  inquiries: '문의건수',
  memo: '메모',
};

function normalizeContacts(input: unknown): MiceContact[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const o = raw as Partial<MiceContact>;
      return {
        id: o.id || nanoid(10),
        name: o.name || '',
        email: o.email || '',
        phone: o.phone || '',
      };
    })
    // 모두 빈 담당자는 제외
    .filter((c) => c.name || c.email || c.phone);
}

function normalizeMiceInquiries(
  input: unknown,
  fallbackUserId: string,
  fallbackUserName: string
): MiceInquiry[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw) => {
    const o = raw as Partial<MiceInquiry> & {
      lost_reason?: string;
      contact_name?: string;
      email?: string;
      phone?: string;
    };
    // 신규 스키마(contacts[]) 우선. 없으면 옛 단일 필드를 한 명의 담당자로 변환.
    let contacts = normalizeContacts(o.contacts);
    if (contacts.length === 0 && (o.contact_name || o.email || o.phone)) {
      contacts = [
        {
          id: nanoid(10),
          name: o.contact_name || '',
          email: o.email || '',
          phone: o.phone || '',
        },
      ];
    }
    // 작성자: 한 번 정해지면 유지. 담당자: 미지정이면 작성자에서 fallback (옛 데이터 호환).
    const createdById = o.created_by_id || fallbackUserId;
    const createdByName = o.created_by_name || fallbackUserName;
    return {
      id: o.id || nanoid(10),
      progress_status: (o.progress_status as MiceInquiry['progress_status']) || 'INQ',
      contacts,
      call_date: o.call_date ?? null,
      inquiry_event_date_text: o.inquiry_event_date_text || '',
      event_memo: o.event_memo || o.lost_reason || '',
      created_by_id: createdById,
      created_by_name: createdByName,
      assigned_manager_id: o.assigned_manager_id || createdById,
      assigned_manager_name: o.assigned_manager_name || createdByName,
      created_at: o.created_at || new Date().toISOString(),
    };
  });
}

router.get('/mice', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'MICE');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  res.json({ customers: activeRows(store.mice_customers) });
});

router.get('/mice/:id', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'MICE');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const item = store.mice_customers.find((c) => c.id === req.params.id);
  if (!item || isDeleted(item)) return res.status(404).json({ error: 'not_found' });
  res.json({ customer: item });
});

router.get('/mice/:id/logs', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'MICE');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const logs = getLogsForEntity('mice_customer', req.params.id);
  res.json({ logs });
});

router.post('/mice', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const now = new Date().toISOString();
  const body = req.body as Partial<MiceCustomer>;
  const item: MiceCustomer = {
    id: nanoid(10),
    customer_type: 'MICE',
    mice_category: body.mice_category || '기업',
    organization_name: body.organization_name || '',
    official_phone: body.official_phone || '',
    official_email: body.official_email || '',
    official_website: body.official_website || '',
    inquiries: normalizeMiceInquiries(body.inquiries, req.user!.id, req.user!.name),
    memo: body.memo || '',
    created_at: now,
    updated_at: now,
    last_modified_by_id: req.user!.id,
    last_modified_by_name: req.user!.name,
    last_modified_at: now,
  };
  store.mice_customers.push(item);
  persistDoc('mice_customers', item.id);
  logChange({
    entity_type: 'mice_customer',
    entity_id: item.id,
    action: 'create',
    summary: `[${item.organization_name}] 신규 등록 (문의 ${item.inquiries.length}건)`,
    user: req.user!,
  });
  res.status(201).json({ customer: item });
});

router.patch('/mice/:id', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const item = store.mice_customers.find((c) => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const body = req.body as Partial<MiceCustomer>;

  // 변경 전 스냅샷 (요약용)
  const before = { ...item } as Record<string, unknown>;

  if (body.mice_category !== undefined) item.mice_category = body.mice_category;
  if (body.organization_name !== undefined) item.organization_name = body.organization_name;
  if (body.official_phone !== undefined) item.official_phone = body.official_phone;
  if (body.official_email !== undefined) item.official_email = body.official_email;
  if (body.official_website !== undefined) item.official_website = body.official_website;
  if (body.memo !== undefined) item.memo = body.memo;
  if (body.inquiries !== undefined) {
    item.inquiries = normalizeMiceInquiries(body.inquiries, req.user!.id, req.user!.name);
  }
  const now = new Date().toISOString();
  item.updated_at = now;
  item.last_modified_by_id = req.user!.id;
  item.last_modified_by_name = req.user!.name;
  item.last_modified_at = now;

  persistDoc('mice_customers', item.id);
  const diff = computeDiff(before, item as unknown as Record<string, unknown>, MICE_FIELD_LABELS);
  logChange({
    entity_type: 'mice_customer',
    entity_id: item.id,
    action: 'update',
    summary: diff.summary,
    changes: diff.changes,
    user: req.user!,
  });
  res.json({ customer: item });
});

router.delete('/mice/:id', (req, res) => {
  // 휴지통 안전망이 있으므로 활성 사용자 전체에게 삭제 권한 (admin/sales/banquet/kitchen).
  // 잘못 삭제해도 /admin/trash 에서 복구 가능.
  const item = store.mice_customers.find((c) => c.id === req.params.id);
  if (!item || isDeleted(item)) return res.status(404).json({ error: 'not_found' });
  softDelete('mice_customers', item.id, { id: req.user!.id, name: req.user!.name });
  logChange({
    entity_type: 'mice_customer',
    entity_id: item.id,
    action: 'delete',
    summary: `[${item.organization_name}] 휴지통으로 이동`,
    user: req.user!,
  });
  res.json({ ok: true, trashed: true });
});

// ===== WEDDING =====

const WEDDING_FIELD_LABELS: Record<string, string> = {
  wedding_event_name: '행사명',
  progress_status: '진행단계',
  inquiry_date: '신규문의일자',
  desired_consultation_date: '희망상담일자',
  source: '유입경로',
  source_detail: '유입세부경로',
  desired_budget: '희망예산',
  competing_venues: '비교웨딩홀',
  groom_name: '신랑이름',
  bride_name: '신부이름',
  event_inquiries: '예식후보',
  memo: '메모',
};

function normalizeWeddingInquiries(input: unknown, fallbackUserId: string, fallbackUserName: string): WeddingEventInquiry[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw) => {
    const o = raw as Partial<WeddingEventInquiry>;
    return {
      id: o.id || nanoid(10),
      wedding_datetime: o.wedding_datetime ?? null,
      guaranteed_guest_count: o.guaranteed_guest_count ?? null,
      estimate_amount: o.estimate_amount || '',
      estimate_detail: o.estimate_detail || '',
      visit_consultation_comment: o.visit_consultation_comment || '',
      assigned_manager_id: o.assigned_manager_id || fallbackUserId,
      assigned_manager_name: o.assigned_manager_name || fallbackUserName,
      created_at: o.created_at || new Date().toISOString(),
    };
  });
}

router.get('/wedding', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  res.json({ customers: activeRows(store.wedding_customers) });
});

router.get('/wedding/:id', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const item = store.wedding_customers.find((c) => c.id === req.params.id);
  if (!item || isDeleted(item)) return res.status(404).json({ error: 'not_found' });
  res.json({ customer: item });
});

router.get('/wedding/:id/logs', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const logs = getLogsForEntity('wedding_customer', req.params.id);
  res.json({ logs });
});

router.post('/wedding', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'WEDDING');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const now = new Date().toISOString();
  const body = req.body as Partial<WeddingCustomer>;
  const item: WeddingCustomer = {
    id: nanoid(10),
    customer_type: 'WEDDING',
    wedding_event_name: body.wedding_event_name || '',
    progress_status: body.progress_status || '신규문의',
    inquiry_date: body.inquiry_date ?? null,
    desired_consultation_date: body.desired_consultation_date ?? null,
    first_inform_comment: body.first_inform_comment || '',
    groom_name: body.groom_name || '',
    groom_phone: body.groom_phone || '',
    groom_email: body.groom_email || '',
    bride_name: body.bride_name || '',
    bride_phone: body.bride_phone || '',
    bride_email: body.bride_email || '',
    competing_venues: body.competing_venues || '',
    desired_budget: body.desired_budget || '',
    source: (body.source as WeddingCustomer['source']) || '',
    source_detail: (body.source_detail as WeddingCustomer['source_detail']) || '',
    event_inquiries: normalizeWeddingInquiries(body.event_inquiries, req.user!.id, req.user!.name),
    memo: body.memo || '',
    created_at: now,
    updated_at: now,
    last_modified_by_id: req.user!.id,
    last_modified_by_name: req.user!.name,
    last_modified_at: now,
  };
  store.wedding_customers.push(item);
  persistDoc('wedding_customers', item.id);
  logChange({
    entity_type: 'wedding_customer',
    entity_id: item.id,
    action: 'create',
    summary: `[${item.wedding_event_name}] 신규 등록 (예식 후보 ${item.event_inquiries.length}건)`,
    user: req.user!,
  });
  res.status(201).json({ customer: item });
});

router.patch('/wedding/:id', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'WEDDING');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const item = store.wedding_customers.find((c) => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const body = req.body as Partial<WeddingCustomer>;
  const before = { ...item } as Record<string, unknown>;

  const SCALAR_KEYS: (keyof WeddingCustomer)[] = [
    'wedding_event_name',
    'progress_status',
    'inquiry_date',
    'desired_consultation_date',
    'first_inform_comment',
    'groom_name',
    'groom_phone',
    'groom_email',
    'bride_name',
    'bride_phone',
    'bride_email',
    'competing_venues',
    'desired_budget',
    'source',
    'source_detail',
    'memo',
  ];
  for (const k of SCALAR_KEYS) {
    if (body[k] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item as any)[k] = body[k];
    }
  }
  if (body.event_inquiries !== undefined) {
    item.event_inquiries = normalizeWeddingInquiries(body.event_inquiries, req.user!.id, req.user!.name);
  }
  const now = new Date().toISOString();
  item.updated_at = now;
  item.last_modified_by_id = req.user!.id;
  item.last_modified_by_name = req.user!.name;
  item.last_modified_at = now;

  persistDoc('wedding_customers', item.id);
  const diff = computeDiff(before, item as unknown as Record<string, unknown>, WEDDING_FIELD_LABELS);
  logChange({
    entity_type: 'wedding_customer',
    entity_id: item.id,
    action: 'update',
    summary: diff.summary,
    changes: diff.changes,
    user: req.user!,
  });
  res.json({ customer: item });
});

router.delete('/wedding/:id', (req, res) => {
  // 휴지통 안전망 있으므로 활성 사용자 전체에게 삭제 권한.
  const item = store.wedding_customers.find((c) => c.id === req.params.id);
  if (!item || isDeleted(item)) return res.status(404).json({ error: 'not_found' });
  softDelete('wedding_customers', item.id, { id: req.user!.id, name: req.user!.name });
  logChange({
    entity_type: 'wedding_customer',
    entity_id: item.id,
    action: 'delete',
    summary: `[${item.wedding_event_name}] 휴지통으로 이동`,
    user: req.user!,
  });
  res.json({ ok: true, trashed: true });
});

// ===== 일괄 upsert (엑셀 import) =====
// 정책:
//   1) 매칭 키 — id가 있으면 id로, 없으면 정규화 이름(소문자·trim)으로
//   2) 매칭되면 update / 안 되면 insert (중복 생성 방지)
//   3) inquiries / event_inquiries — Excel에 있는 경우만 교체, 없으면 보존 (partial import 안전)
//   4) dryRun=true — 변경 없이 카운트만 반환 (미리보기용)

interface BulkBody<T> {
  rows: Partial<T>[];
  dryRun?: boolean;
}

router.post('/mice/_bulk-upsert', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const body = req.body as BulkBody<MiceCustomer>;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = !!body.dryRun;
  let added = 0;
  let updated = 0;
  const errors: Array<{ row?: number; key?: string; reason: string }> = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const orgName = (r.organization_name || '').trim();
    if (!orgName) {
      errors.push({ row: i + 1, reason: '업체명이 비어있습니다' });
      continue;
    }
    // 1차: id로 매칭. 2차: 정규화된 organization_name으로. 휴지통 row는 매칭 대상에서 제외.
    let existing: MiceCustomer | undefined;
    if (r.id) existing = store.mice_customers.find((c) => c.id === r.id && !c.deleted_at);
    if (!existing) {
      const norm = orgName.toLowerCase();
      existing = store.mice_customers.find(
        (c) => !c.deleted_at && c.organization_name.trim().toLowerCase() === norm
      );
    }

    if (existing) {
      if (dryRun) {
        updated++;
        continue;
      }
      const before = { ...existing } as Record<string, unknown>;
      if (r.mice_category !== undefined) existing.mice_category = r.mice_category;
      if (r.organization_name !== undefined) existing.organization_name = r.organization_name;
      if (r.official_phone !== undefined) existing.official_phone = r.official_phone;
      if (r.official_email !== undefined) existing.official_email = r.official_email;
      if (r.official_website !== undefined) existing.official_website = r.official_website;
      if (r.memo !== undefined) existing.memo = r.memo;
      // Excel에 inquiries 정보가 있으면 교체. 빈 배열이면 기존 보존.
      if (Array.isArray(r.inquiries) && r.inquiries.length > 0) {
        existing.inquiries = normalizeMiceInquiries(
          r.inquiries,
          req.user!.id,
          req.user!.name
        );
      }
      existing.updated_at = now;
      existing.last_modified_by_id = req.user!.id;
      existing.last_modified_by_name = req.user!.name;
      existing.last_modified_at = now;
      persistDoc('mice_customers', existing.id);
      const diff = computeDiff(
        before,
        existing as unknown as Record<string, unknown>,
        MICE_FIELD_LABELS
      );
      logChange({
        entity_type: 'mice_customer',
        entity_id: existing.id,
        action: 'update',
        summary: `[엑셀 업데이트] ${diff.summary}`,
        changes: diff.changes,
        user: req.user!,
      });
      updated++;
    } else {
      if (dryRun) {
        added++;
        continue;
      }
      const newItem: MiceCustomer = {
        id: nanoid(10),
        customer_type: 'MICE',
        mice_category: r.mice_category || '기업',
        organization_name: orgName,
        official_phone: r.official_phone || '',
        official_email: r.official_email || '',
        official_website: r.official_website || '',
        inquiries: normalizeMiceInquiries(r.inquiries, req.user!.id, req.user!.name),
        memo: r.memo || '',
        created_at: now,
        updated_at: now,
        last_modified_by_id: req.user!.id,
        last_modified_by_name: req.user!.name,
        last_modified_at: now,
      };
      store.mice_customers.push(newItem);
      persistDoc('mice_customers', newItem.id);
      logChange({
        entity_type: 'mice_customer',
        entity_id: newItem.id,
        action: 'create',
        summary: `[엑셀 신규] ${newItem.organization_name}`,
        user: req.user!,
      });
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

router.post('/wedding/_bulk-upsert', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'WEDDING');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const body = req.body as BulkBody<WeddingCustomer>;
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = !!body.dryRun;
  let added = 0;
  let updated = 0;
  const errors: Array<{ row?: number; key?: string; reason: string }> = [];
  const now = new Date().toISOString();

  const SCALAR_KEYS: (keyof WeddingCustomer)[] = [
    'wedding_event_name',
    'progress_status',
    'inquiry_date',
    'desired_consultation_date',
    'first_inform_comment',
    'groom_name',
    'groom_phone',
    'groom_email',
    'bride_name',
    'bride_phone',
    'bride_email',
    'competing_venues',
    'desired_budget',
    'source',
    'source_detail',
    'memo',
  ];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = (r.wedding_event_name || '').trim();
    if (!name) {
      errors.push({ row: i + 1, reason: '행사명이 비어있습니다' });
      continue;
    }
    // 휴지통 row는 매칭 대상에서 제외.
    let existing: WeddingCustomer | undefined;
    if (r.id) existing = store.wedding_customers.find((c) => c.id === r.id && !c.deleted_at);
    if (!existing) {
      const norm = name.toLowerCase();
      existing = store.wedding_customers.find(
        (c) => !c.deleted_at && c.wedding_event_name.trim().toLowerCase() === norm
      );
    }

    if (existing) {
      if (dryRun) {
        updated++;
        continue;
      }
      const before = { ...existing } as Record<string, unknown>;
      for (const k of SCALAR_KEYS) {
        if (r[k] !== undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (existing as any)[k] = r[k];
        }
      }
      if (Array.isArray(r.event_inquiries) && r.event_inquiries.length > 0) {
        existing.event_inquiries = normalizeWeddingInquiries(
          r.event_inquiries,
          req.user!.id,
          req.user!.name
        );
      }
      existing.updated_at = now;
      existing.last_modified_by_id = req.user!.id;
      existing.last_modified_by_name = req.user!.name;
      existing.last_modified_at = now;
      persistDoc('wedding_customers', existing.id);
      const diff = computeDiff(
        before,
        existing as unknown as Record<string, unknown>,
        WEDDING_FIELD_LABELS
      );
      logChange({
        entity_type: 'wedding_customer',
        entity_id: existing.id,
        action: 'update',
        summary: `[엑셀 업데이트] ${diff.summary}`,
        changes: diff.changes,
        user: req.user!,
      });
      updated++;
    } else {
      if (dryRun) {
        added++;
        continue;
      }
      const newItem: WeddingCustomer = {
        id: nanoid(10),
        customer_type: 'WEDDING',
        wedding_event_name: name,
        progress_status: r.progress_status || '신규문의',
        inquiry_date: r.inquiry_date ?? null,
        desired_consultation_date: r.desired_consultation_date ?? null,
        first_inform_comment: r.first_inform_comment || '',
        groom_name: r.groom_name || '',
        groom_phone: r.groom_phone || '',
        groom_email: r.groom_email || '',
        bride_name: r.bride_name || '',
        bride_phone: r.bride_phone || '',
        bride_email: r.bride_email || '',
        competing_venues: r.competing_venues || '',
        desired_budget: r.desired_budget || '',
        source: (r.source as WeddingCustomer['source']) || '',
        source_detail: (r.source_detail as WeddingCustomer['source_detail']) || '',
        event_inquiries: normalizeWeddingInquiries(
          r.event_inquiries,
          req.user!.id,
          req.user!.name
        ),
        memo: r.memo || '',
        created_at: now,
        updated_at: now,
        last_modified_by_id: req.user!.id,
        last_modified_by_name: req.user!.name,
        last_modified_at: now,
      };
      store.wedding_customers.push(newItem);
      persistDoc('wedding_customers', newItem.id);
      logChange({
        entity_type: 'wedding_customer',
        entity_id: newItem.id,
        action: 'create',
        summary: `[엑셀 신규] ${newItem.wedding_event_name}`,
        user: req.user!,
      });
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

export default router;
