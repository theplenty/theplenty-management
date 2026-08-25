import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, softDelete, activeRows, isDeleted } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { logChange, computeDiff, getLogsForEntity } from '../store/changeLog.js';
import { normalizeOrgName, levenshtein } from '../lib/textNormalize.js';
import { shiftDate } from '../lib/kstDate.js';
import { normalizeMiceStatus } from '../types.js';
import {
  linkInquiryToEvent,
  pushDepositsForCustomer,
  unlinkInquiry,
} from '../lib/depositLink.js';
import { weddingLandingSummary } from './weddingLanding.js';
import {
  backfillCandidateFromEvent,
  pushWeddingDeposits,
  resolveCandidateEvent,
  WEDDING_GATEWAY_FEE,
} from '../lib/weddingDepositLink.js';
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
// - READ: admin / 양 세일즈 / banquet / kitchen — h_kitchen 은 고객 DB 접근 불가 (스펙)
// - WRITE: admin / 양 세일즈 — 세일즈 팀끼리 서로의 DB 작성·수정 가능
function canAccessType(role: string, _type: CustomerType): { read: boolean; write: boolean } {
  const read =
    role === 'admin' ||
    role === 'sales_mice' ||
    role === 'sales_wedding' ||
    role === 'banquet' ||
    role === 'kitchen';
  // h_kitchen 은 명시적으로 false — 고객 DB 접근 불가
  const write =
    role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
  return { read, write };
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
    // String() 강제 변환 — 엑셀 임포트로 number 타입 phone 이 섞여 있어도 안전.
    const g = String(c.groom_phone || '').replace(/\D/g, '');
    const b = String(c.bride_phone || '').replace(/\D/g, '');
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

// 내용 없는 빈 문의(placeholder)인지 판단.
// MICE 고객 중 다수가 문의 0건이라, 고객정보 수정 모달이 열릴 때 빈 문의 카드가 자동 추가된다.
// 그 placeholder 가 저장되면 created_at=now 로 잡혀 대시보드 신규유입에 잘못 집계되므로 저장 단계에서 제거한다.
// 담당자/통화일자/문의행사일이 모두 없고 진행상황·채널이 기본값(문의/INCALL)이면 사용자가 실제로 입력하지 않은 빈 카드로 본다.
function isBlankMiceInquiry(inq: MiceInquiry): boolean {
  const hasContact = inq.contacts.length > 0;
  const hasCall = !!inq.call_date;
  const hasDateText = !!(inq.inquiry_event_date_text && inq.inquiry_event_date_text.trim());
  const nonDefaultStatus = inq.progress_status !== '문의';
  const nonDefaultChannel = inq.inquiry_channel !== 'INCALL';
  return !hasContact && !hasCall && !hasDateText && !nonDefaultStatus && !nonDefaultChannel;
}

function normalizeMiceInquiries(
  input: unknown,
  fallbackUserId: string,
  fallbackUserName: string
): MiceInquiry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw) => {
      const o = raw as Partial<MiceInquiry> & {
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
      // 유입 채널 — 없으면 'INCALL' 로 기본값 (기존 데이터 호환)
      const channel: MiceInquiry['inquiry_channel'] =
        o.inquiry_channel === 'OUTCALL' ? 'OUTCALL' : 'INCALL';
      return {
        id: o.id || nanoid(10),
        // 옛 값(단순문의·INQ·TEN)이 들어와도 3분류로 접어서 저장한다
        progress_status: normalizeMiceStatus(o.progress_status),
        inquiry_channel: channel,
        contacts,
        call_date: o.call_date ?? null,
        inquiry_event_date_text: o.inquiry_event_date_text || '',
        created_by_id: createdById,
        created_by_name: createdByName,
        assigned_manager_id: o.assigned_manager_id || createdById,
        assigned_manager_name: o.assigned_manager_name || createdByName,
        created_at: o.created_at || new Date().toISOString(),
        ...callTrackerFields(o),
      };
    })
    .filter((inq) => !isBlankMiceInquiry(inq))
    .map(applyAutoConfirm)
    .sort(byInquiryDate);
}

/**
 * 문의 정렬 — 통화일자(없으면 등록일) 오름차순. **가장 최근 통화가 항상 마지막 칸(#N)**.
 *
 * 문의 순서는 그 자체가 통화 이력이고, 마지막 칸이 목록의 대표 문의가 된다.
 * 날짜가 순서와 어긋난 채 저장되면 이력이 거짓말을 하므로 저장 시점에 항상 맞춘다.
 * 같은 날짜끼리는 입력한 순서를 유지한다(stable sort).
 */
function byInquiryDate(a: MiceInquiry, b: MiceInquiry): number {
  const ka = (a.call_date || a.created_at || '').slice(0, 10);
  const kb = (b.call_date || b.created_at || '').slice(0, 10);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// ── 콜 트래커 필드 (문의 트래커 흡수) ──────────────────────────────────────
// 콜백 기한은 등록일 +7일이 기본. 트래커에서 쓰던 규칙 그대로다.
function defaultCallbackDue(createdAt: string): string {
  const base = (createdAt || new Date().toISOString()).slice(0, 10);
  return shiftDate(base, 7);
}

function callTrackerFields(o: Partial<MiceInquiry>): Partial<MiceInquiry> {
  const createdAt = o.created_at || new Date().toISOString();
  // 기한 자동 부여는 **새로 만들어지는 문의에만** 적용한다.
  // 기존 문의(id 가 이미 있는 건)에까지 걸면, 오래된 고객을 한 번 수정하는 순간
  // 몇 백 일 지난 콜백이 무더기로 생겨 트래커가 못 쓰게 된다.
  const isNew = !o.id;
  // 콜백 날짜는 callback_due 한 칸으로 합쳤다.
  // 옛 '재통화 예정일'(callback_at)이 채워져 있으면 그쪽이 더 구체적인 약속이었으므로 그 값을 살려 흡수한다.
  const hasIncoming = o.callback_due !== undefined || o.callback_at !== undefined;
  const incoming = o.callback_at || o.callback_due || null;
  return {
    callback_due: hasIncoming ? incoming : isNew ? defaultCallbackDue(createdAt) : null,
    callback_at: null,
    quote_sent: !!o.quote_sent,
    contract_sent: !!o.contract_sent,
    contract_replied: !!o.contract_replied,
    deposit_paid: !!o.deposit_paid,
    confirmed_at: o.confirmed_at ?? null,
    callback_done_at: o.callback_done_at ?? null,
    note: o.note ?? '',
    // S2 — 계약금(=가톨릭대관료)과 행사 링크. 화이트리스트 방식이라 여기서 이어받지 않으면 저장 때 사라진다.
    deposit_amount: o.deposit_amount ?? null,
    deposit_depositor: o.deposit_depositor ?? '',
    deposit_date: o.deposit_date ?? null,
    invoice_type: o.invoice_type ?? '',
    invoice_issue_status: o.invoice_issue_status ?? '',
    tax_invoice_issue_date: o.tax_invoice_issue_date ?? null,
    linked_event_id: o.linked_event_id ?? null,
    linked_at: o.linked_at ?? null,
    linked_by_name: o.linked_by_name ?? '',
    revenue_pushed_at: o.revenue_pushed_at ?? null,
    revenue_pushed_amount: o.revenue_pushed_amount ?? null,
    revenue_pushed_fp: o.revenue_pushed_fp ?? null,
  };
}

/**
 * 자동 확정 — 견적서 발송 · 계약서 회신 · 계약금 납부 셋이 모두 체크되면 DEF 로 올린다.
 *
 * 트래커에서 팀이 쓰던 규칙 그대로다. 사람이 상태를 따로 바꿔주지 않아도 되는 게 요점.
 * 계약서 '발송'은 조건에 넣지 않는다 — 회신이 왔다면 발송은 당연히 된 것이고,
 * 발송 체크를 깜빡한 탓에 확정이 안 되는 일이 실제로 있었다.
 * 한 번 확정된 뒤 체크가 풀려도 상태를 되돌리지 않는다(확정 취소는 사람이 판단할 일).
 */
// 체크를 '켠 시각' 기록 — 켜지는 순간만 찍고, 이미 켜져 있던 건 이전 시각을 보존한다.
// 클라이언트는 이 필드를 모른 채 보내므로 **반드시 저장소의 이전 레코드에서 이어받는다**.
// 스탬프 도입 전부터 켜져 있던 체크는 null(시각 미상) 그대로 둔다 — 지어내지 않는다.
const CHECK_STAMP_KEYS = [
  ['quote_sent', 'quote_sent_at'],
  ['contract_sent', 'contract_sent_at'],
  ['contract_replied', 'contract_replied_at'],
  ['deposit_paid', 'deposit_paid_at'],
] as const;

function stampCheckTimes(next: MiceInquiry[], prev: MiceInquiry[]): MiceInquiry[] {
  const prevById = new Map(prev.map((q) => [q.id, q]));
  const now = new Date().toISOString();
  return next.map((q) => {
    const p = prevById.get(q.id) as (MiceInquiry & Record<string, unknown>) | undefined;
    const out = { ...q } as MiceInquiry & Record<string, unknown>;
    for (const [flag, at] of CHECK_STAMP_KEYS) {
      if (!q[flag]) out[at] = null; // 껐으면 시각도 지운다
      else if (p?.[flag]) out[at] = (p[at] as string | null) ?? null; // 원래 켜져 있던 것 — 보존
      else out[at] = now; // 이번에 켜진 것
    }
    return out as MiceInquiry;
  });
}

function applyAutoConfirm(inq: MiceInquiry): MiceInquiry {
  const done = inq.quote_sent && inq.contract_replied && inq.deposit_paid;
  if (done && inq.progress_status !== 'DEF') {
    return { ...inq, progress_status: 'DEF', confirmed_at: inq.confirmed_at || new Date().toISOString() };
  }
  if (done && !inq.confirmed_at) return { ...inq, confirmed_at: new Date().toISOString() };
  return inq;
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
    inquiries: stampCheckTimes(
      normalizeMiceInquiries(body.inquiries, req.user!.id, req.user!.name),
      []
    ),
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
    item.inquiries = stampCheckTimes(
      normalizeMiceInquiries(body.inquiries, req.user!.id, req.user!.name),
      item.inquiries || []
    );
  }
  // 계약금(=가톨릭대관료) 자동 반영 — 확정·계약금체크·금액·행사링크가 갖춰진 문의만
  const pushed = pushDepositsForCustomer(item);
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
  // 자동 반영은 행사 쪽 이력에도 남긴다 — 연회팀이 "누가 이 금액을 넣었나" 를 추적할 수 있게
  for (const r of pushed) {
    if (!r.filled.length) continue;
    logChange({
      entity_type: 'event',
      entity_id: r.eventId,
      action: 'update',
      summary: `문의 계약금 자동 반영: ${r.filled.join(', ')} (${r.amount.toLocaleString()}원)`
        + (r.kept.length ? ` · 기존값 유지: ${r.kept.join(', ')}` : ''),
      changes: [],
      user: req.user!,
    });
  }
  res.json({ customer: item, pushed });
});

// ── 문의 ↔ 행사 연결 (S2) ──────────────────────────────────────────────
// 연결·해제·후보제안·행사생성. 링크 쓰기를 이 네 곳으로 모아 양쪽 필드 동기화를 보장한다.

function findInquiry(customerId: string, inquiryId: string) {
  const customer = store.mice_customers.find((c) => c.id === customerId);
  if (!customer || isDeleted(customer)) return null;
  const inq = (customer.inquiries || []).find((q) => q.id === inquiryId);
  if (!inq) return null;
  return { customer, inq };
}

/** 문의의 '행사 예정일' 자유 텍스트에서 날짜를 건져낸다 (YYYY-MM-DD / M월 D일 / M/D). */
function guessInquiryDate(inq: MiceInquiry): string | null {
  const t = inq.inquiry_event_date_text || '';
  const iso = /(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  // "2027 2월 13일" 처럼 연도가 앞에 붙는 표기가 실제로 많다 — 이걸 놓치면 1년 차이 후보를 1등으로 올린다
  const koY = /(20\d{2})\s*년?\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(t);
  if (koY) return `${koY[1]}-${koY[2].padStart(2, '0')}-${koY[3].padStart(2, '0')}`;
  const ko = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(t);
  const year = (inq.call_date || inq.created_at || '').slice(0, 4) || String(new Date().getFullYear());
  if (ko) return `${year}-${ko[1].padStart(2, '0')}-${ko[2].padStart(2, '0')}`;
  const md = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t);
  if (md) return `${year}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
  return null;
}

// GET 후보 제안 — ① 이 고객에 연결된 행사 ② 예정일 근접 ③ 업체명이 행사명에 포함
router.get('/mice/:id/inquiries/:inqId/event-candidates', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'MICE');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const found = findInquiry(req.params.id, req.params.inqId);
  if (!found) return res.status(404).json({ error: 'not_found' });
  const { customer, inq } = found;

  const linkedIds = new Set(
    store.event_customers.filter((l) => l.customer_id === customer.id).map((l) => l.event_id),
  );
  const takenByOther = new Set<string>();
  for (const c of store.mice_customers)
    for (const q of c.inquiries || [])
      if (q.linked_event_id && q.id !== inq.id) takenByOther.add(q.linked_event_id);

  const target = guessInquiryDate(inq);
  const orgKey = (customer.organization_name || '').replace(/\s+/g, '');
  // 검색어(q) — 후보 추천에 안 걸리는 행사를 직접 찾을 때. 행사명 조각 또는 날짜(2026-12 / 12/20 / 20261220).
  const q = String(req.query.q || '').trim();
  const qKey = q.replace(/\s+/g, '');
  const qDate = (() => {
    const iso = /^(20\d{2})[-./]?(\d{1,2})?[-./]?(\d{1,2})?$/.exec(qKey);
    if (iso) {
      return [iso[1], iso[2] && iso[2].padStart(2, '0'), iso[3] && iso[3].padStart(2, '0')].filter(Boolean).join('-');
    }
    const md = /^(\d{1,2})[-./](\d{1,2})$/.exec(qKey);
    if (md) return `-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`; // 연도 무관 월일 매칭
    return '';
  })();
  const rows = store.events
    .filter((e) => e.event_type === 'MICE' && !isDeleted(e) && !takenByOther.has(e.id))
    .map((e) => {
      const day = (e.start_datetime || '').slice(0, 10);
      const gap = target && day ? Math.abs((new Date(day).getTime() - new Date(target).getTime()) / 86400000) : null;
      const nameHit = orgKey.length >= 2 && (e.event_name || '').replace(/\s+/g, '').includes(orgKey);
      const reasons: string[] = [];
      if (linkedIds.has(e.id)) reasons.push('이 고객에 연결된 행사');
      if (gap != null && gap <= 14) reasons.push(gap === 0 ? '예정일 일치' : `예정일 ±${Math.round(gap)}일`);
      if (nameHit) reasons.push('행사명에 업체명 포함');
      // 점수: 고객링크 > 이름일치 > 날짜근접
      const score = (linkedIds.has(e.id) ? 100 : 0) + (nameHit ? 50 : 0) + (gap != null ? Math.max(0, 30 - gap) : 0);
      return {
        id: e.id, event_name: e.event_name, status: e.status,
        start_datetime: e.start_datetime, halls: e.halls,
        gateway_fee: e.gateway_fee ?? null,
        already_linked: e.source_inquiry_id === inq.id,
        reasons, score,
      };
    })
    .filter((r) => {
      if (r.already_linked) return true;
      if (!q) return r.score > 0;
      // 검색 중에는 추천 점수와 무관하게 '검색어에 맞는 행사' 를 보여준다
      const nameHit = (r.event_name || '').replace(/\s+/g, '').includes(qKey);
      const dayHit = !!qDate && (qDate.startsWith('-')
        ? (r.start_datetime || '').slice(0, 10).endsWith(qDate)
        : (r.start_datetime || '').startsWith(qDate));
      return nameHit || dayHit;
    })
    .map((r) => (q && !r.reasons.length ? { ...r, reasons: ['검색 결과'] } : r))
    .sort((a, b) => b.score - a.score || (b.start_datetime || '').localeCompare(a.start_datetime || ''))
    .slice(0, q ? 50 : 20);
  res.json({ candidates: rows, guessed_date: target, searched: !!q });
});

// POST 연결
router.post('/mice/:id/inquiries/:inqId/link', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const found = findInquiry(req.params.id, req.params.inqId);
  if (!found) return res.status(404).json({ error: 'not_found' });
  const eventId = String((req.body as { event_id?: string }).event_id || '');
  if (!eventId) return res.status(400).json({ error: 'event_id 필요' });
  const r = linkInquiryToEvent(found.customer, found.inq, eventId, req.user!.name);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const pushed = pushDepositsForCustomer(found.customer);
  persistDoc('mice_customers', found.customer.id);
  logChange({
    entity_type: 'mice_customer', entity_id: found.customer.id, action: 'update',
    summary: `문의를 행사에 연결${r.pulled.length ? ` (행사 기록 ${r.pulled.join('·')} 을 문의로 가져옴)` : ''}${pushed.some((x) => x.filled.length) ? ' + 매출 반영' : ''}`,
    changes: [], user: req.user!,
  });
  res.json({ customer: found.customer, pushed, pulled: r.pulled });
});

// DELETE 연결 해제
router.delete('/mice/:id/inquiries/:inqId/link', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const found = findInquiry(req.params.id, req.params.inqId);
  if (!found) return res.status(404).json({ error: 'not_found' });
  unlinkInquiry(found.inq);
  persistDoc('mice_customers', found.customer.id);
  logChange({
    entity_type: 'mice_customer', entity_id: found.customer.id, action: 'update',
    summary: '문의–행사 연결 해제 (반영된 매출 값은 유지)', changes: [], user: req.user!,
  });
  res.json({ customer: found.customer });
});

// POST 문의에서 행사 생성 + 즉시 연결 — 확정인데 캘린더에 행사가 없을 때
router.post('/mice/:id/inquiries/:inqId/create-event', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const found = findInquiry(req.params.id, req.params.inqId);
  if (!found) return res.status(404).json({ error: 'not_found' });
  const { customer, inq } = found;
  const body = (req.body || {}) as { start_datetime?: string; end_datetime?: string; event_name?: string };
  const now = new Date().toISOString();
  const day = body.start_datetime || (guessInquiryDate(inq) ? `${guessInquiryDate(inq)}T09:00:00` : now);
  const ev = {
    id: nanoid(10),
    event_type: 'MICE' as const,
    created_by: req.user!.id,
    created_by_name: req.user!.name,
    status: 'DEF' as const,
    usage_type: null,
    halls: [],
    start_datetime: day,
    end_datetime: body.end_datetime || day,
    event_name: body.event_name || customer.organization_name || '',
    seats: null,
    food_gtd_contract: null,
    food_exp_contract: null,
    food_gtd_final: null,
    food_exp_final: null,
    memo: `문의에서 생성 (담당 ${inq.assigned_manager_name || inq.created_by_name})`,
    assigned_manager_id: inq.assigned_manager_id || '',
    assigned_manager_name: inq.assigned_manager_name || '',
    created_at: now,
    updated_at: now,
  };
  store.events.push(ev);
  persistDoc('events', ev.id);
  const r = linkInquiryToEvent(customer, inq, ev.id, req.user!.name);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const pushed = pushDepositsForCustomer(customer);
  persistDoc('mice_customers', customer.id);
  logChange({
    entity_type: 'event', entity_id: ev.id, action: 'create',
    summary: `MICE 문의에서 행사 생성 (${customer.organization_name})`, changes: [], user: req.user!,
  });
  res.json({ event: ev, customer, pushed });
});

router.delete('/mice/:id', (req, res) => {
  // 새 권한 정책: MICE write 권한자(admin + sales_mice)만 삭제 가능. 뷰어 제외.
  const { write } = canAccessType(req.user!.role, 'MICE');
  if (!write) return res.status(403).json({ error: 'forbidden' });
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
  search_keyword: '검색어',
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
      // 계약금(= 가톨릭대관료) 블록 — 화이트리스트에서 빠지면 저장할 때마다 조용히 지워진다
      linked_event_id: o.linked_event_id ?? null,
      deposit_amount: o.deposit_amount ?? null,
      deposit_paid: !!o.deposit_paid,
      deposit_paid_at: o.deposit_paid_at ?? null,
      deposit_depositor: o.deposit_depositor || '',
      deposit_date: o.deposit_date ?? null,
      invoice_type: o.invoice_type || '',
      invoice_issue_status: o.invoice_issue_status || '',
      tax_invoice_issue_date: o.tax_invoice_issue_date ?? null,
      revenue_pushed_at: o.revenue_pushed_at ?? null,
      revenue_pushed_amount: o.revenue_pushed_amount ?? null,
      ...(o.revenue_pushed_fp !== undefined ? { revenue_pushed_fp: o.revenue_pushed_fp } : {}),
      // 마진계산기 입력 보존 (재오픈 복원용)
      ...(o.calc_payload !== undefined ? { calc_payload: o.calc_payload } : {}),
    };
  });
}

router.get('/wedding', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  // landings: 고객 id → 대표 랜딩 요약 — 목록의 랜딩 필터·D-day 표시용
  res.json({ customers: activeRows(store.wedding_customers), landings: weddingLandingSummary() });
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
    search_keyword: body.search_keyword || '',
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
    'search_keyword',
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
    // 입금 확인 스탬프 — 체크가 켜지는 순간의 시각을 서버가 찍는다 (클라이언트 시계를 믿지 않는다)
    const beforeInqs = new Map(
      ((before.event_inquiries as WeddingEventInquiry[]) || []).map((q) => [q.id, q])
    );
    for (const q of item.event_inquiries) {
      const prev = beforeInqs.get(q.id);
      if (q.deposit_paid && !prev?.deposit_paid) q.deposit_paid_at = new Date().toISOString();
      if (!q.deposit_paid) q.deposit_paid_at = null;
    }
  }
  // 계약금 미러 + 입금 확인 시 고객·행사 DEF 승격 (W1)
  const pushed = pushWeddingDeposits(item);
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
  // 자동 반영·승격은 행사 쪽 이력에도 남긴다 — 연회팀이 "누가 이걸 바꿨나" 를 추적할 수 있게
  for (const r of pushed) {
    const bits: string[] = [];
    if (r.filled.length) bits.push(`계약금 자동 반영: ${r.filled.join(', ')} (${r.amount.toLocaleString()}원)`);
    if (r.promoted.event) bits.push('입금 확인으로 상태 DEF 전환');
    if (r.kept.length) bits.push(`기존값 유지: ${r.kept.join(', ')}`);
    if (!bits.length) continue;
    logChange({
      entity_type: 'event',
      entity_id: r.eventId,
      action: 'update',
      summary: `웨딩 고객정보 — ${bits.join(' · ')}`,
      changes: [],
      user: req.user!,
    });
  }
  res.json({ customer: item, pushed });
});

// ── 예식 후보 ↔ 행사 (W1) ─────────────────────────────────────────────
// 웨딩은 이미 event_customers 로 고객↔행사가 연결돼 있어, 후보 날짜로 자동 매칭한다.
// 이 API 는 자동 매칭이 안 되는 소수(운영 165개 중 9개)를 화면에서 직접 고르게 하는 용도다.
router.get('/wedding/:id/candidate-events', (req, res) => {
  const { read } = canAccessType(req.user!.role, 'WEDDING');
  if (!read) return res.status(403).json({ error: 'forbidden' });
  const cust = store.wedding_customers.find((c) => c.id === req.params.id);
  if (!cust || isDeleted(cust)) return res.status(404).json({ error: 'not_found' });

  const ids = new Set(
    store.event_customers.filter((l) => l.customer_id === cust.id).map((l) => l.event_id)
  );
  const events = store.events
    .filter((e) => ids.has(e.id) && !e.deleted_at && e.event_type === 'WEDDING')
    .map((e) => ({
      id: e.id,
      event_name: e.event_name,
      status: e.status,
      start_datetime: e.start_datetime,
      halls: e.halls || [],
      gateway_fee: e.gateway_fee ?? null,
    }))
    .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1));

  // 후보별 자동 매칭 결과도 같이 — 화면이 "이 후보는 어느 행사에 붙는지" 를 바로 보여준다
  const resolved: Record<string, string | null> = {};
  for (const q of cust.event_inquiries || []) {
    resolved[q.id] = resolveCandidateEvent(cust, q)?.id ?? null;
  }
  res.json({ events, resolved, default_gateway_fee: WEDDING_GATEWAY_FEE });
});

// 후보에 행사를 직접 지정 — 지정 즉시 행사의 기존 대관료·입금 기록을 후보 빈 칸으로 역채움
router.post('/wedding/:id/inquiries/:inqId/link', (req, res) => {
  const { write } = canAccessType(req.user!.role, 'WEDDING');
  if (!write) return res.status(403).json({ error: 'forbidden' });
  const cust = store.wedding_customers.find((c) => c.id === req.params.id);
  if (!cust || isDeleted(cust)) return res.status(404).json({ error: 'not_found' });
  const inq = (cust.event_inquiries || []).find((q) => q.id === req.params.inqId);
  if (!inq) return res.status(404).json({ error: 'inquiry_not_found' });

  const eventId = (req.body as { event_id?: string }).event_id || '';
  if (!eventId) {
    // 해제 — 자동 매칭으로 되돌린다 (이미 반영된 매출 값은 건드리지 않는다)
    inq.linked_event_id = null;
    persistDoc('wedding_customers', cust.id);
    return res.json({ customer: cust, pulled: [] });
  }
  const ev = store.events.find((e) => e.id === eventId);
  if (!ev || ev.deleted_at) return res.status(404).json({ error: 'event_not_found' });
  if (ev.event_type !== 'WEDDING') return res.status(400).json({ error: 'wedding_only' });
  // 한 행사에 두 후보의 계약금이 흘러들면 매출이 꼬인다
  for (const q of cust.event_inquiries || []) {
    if (q.id !== inq.id && q.linked_event_id === eventId) {
      return res.status(409).json({ error: '이미 다른 예식 후보에 연결된 행사입니다.' });
    }
  }

  inq.linked_event_id = eventId;
  const pulled = backfillCandidateFromEvent(inq, eventId);
  persistDoc('wedding_customers', cust.id);
  res.json({ customer: cust, pulled });
});

router.delete('/wedding/:id', (req, res) => {
  // 새 권한 정책: WEDDING write 권한자(admin + sales_wedding)만 삭제 가능. 뷰어 제외.
  const { write } = canAccessType(req.user!.role, 'WEDDING');
  if (!write) return res.status(403).json({ error: 'forbidden' });
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
        existing.inquiries = stampCheckTimes(
          normalizeMiceInquiries(r.inquiries, req.user!.id, req.user!.name),
          existing.inquiries || []
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
        inquiries: stampCheckTimes(
          normalizeMiceInquiries(r.inquiries, req.user!.id, req.user!.name),
          []
        ),
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
    'search_keyword',
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
        search_keyword: r.search_keyword || '',
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
