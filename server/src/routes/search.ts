// 전역 검색 — WEDDING/MICE 고객 + 행사를 한 번에 검색.
// 사용자 권한에 따라 가시 영역 필터.
// 휴지통(soft delete)에 들어간 항목은 모두 제외.

import { Router } from 'express';
import { store } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import {
  normalizePhone,
  parseQuery,
  softIncludes,
} from '../lib/textNormalize.js';
import type { MiceCustomer, WeddingCustomer, Event } from '../types.js';

const router = Router();
router.use(requireActiveRole);

interface SearchResultItem {
  id: string;
  label: string;
  subtitle: string;
  event_count?: number;
  matched: string[]; // 어느 필드에서 매칭되었는지
}

interface SearchResponse {
  query: string;
  took_ms: number;
  wedding: SearchResultItem[];
  mice: SearchResultItem[];
  events: SearchResultItem[];
  total: number;
}

const DEFAULT_LIMIT_PER_GROUP = 8;
const MAX_LIMIT_PER_GROUP = 20;

// 결과 라벨 빌더
function describeWedding(c: WeddingCustomer): { label: string; subtitle: string } {
  const groomBride = [c.groom_name, c.bride_name].filter(Boolean).join(' ♥ ');
  const label = c.wedding_event_name || groomBride || '(이름 없음)';
  const phone = c.groom_phone || c.bride_phone || '';
  const phoneShort = phone ? phone.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1-$2-$3') : '';
  const subtitle = [phoneShort, c.progress_status].filter(Boolean).join(' · ');
  return { label, subtitle };
}

function describeMice(c: MiceCustomer): { label: string; subtitle: string } {
  const firstContact = c.inquiries[0]?.contacts[0];
  const phone = c.official_phone || firstContact?.phone || '';
  const subtitle = [c.mice_category, phone].filter(Boolean).join(' · ');
  return { label: c.organization_name || '(업체명 없음)', subtitle };
}

function describeEvent(ev: Event): { label: string; subtitle: string } {
  const dt = (ev.start_datetime || '').replace('T', ' ').slice(0, 16);
  const halls = (ev.halls || []).join(' / ');
  const subtitle = [dt, ev.status, halls].filter(Boolean).join(' · ');
  return { label: ev.event_name || '(이름 없음)', subtitle };
}

// 한 고객/이벤트가 검색어와 매칭되는지 + 어느 필드에서 매칭됐는지 반환
// 한 WEDDING 고객의 모든 텍스트 필드를 join 후 digits-only 추출.
// WeddingCustomers 페이지의 fuzzyMatchEntry 와 동일한 범위로 통일.
function buildWeddingDigits(c: WeddingCustomer): string {
  const parts = [
    c.wedding_event_name,
    c.groom_phone,
    c.bride_phone,
    c.groom_email,
    c.bride_email,
    c.desired_budget,
    c.competing_venues,
    c.memo,
    c.first_inform_comment,
    c.inquiry_date,
    c.desired_consultation_date,
  ];
  for (const i of c.event_inquiries || []) {
    parts.push(i.wedding_datetime, i.estimate_amount, i.estimate_detail, i.visit_consultation_comment);
  }
  return parts.filter(Boolean).join(' ').replace(/\D/g, '');
}

function matchWedding(c: WeddingCustomer, q: ReturnType<typeof parseQuery>): string[] | null {
  if (c.deleted_at) return null;
  const matched: string[] = [];
  if (softIncludes(c.wedding_event_name, q.text)) matched.push('wedding_event_name');
  if (softIncludes(c.groom_name, q.text)) matched.push('groom_name');
  if (softIncludes(c.bride_name, q.text)) matched.push('bride_name');
  if (q.phoneNumeric) {
    const groomDigits = normalizePhone(c.groom_phone);
    const brideDigits = normalizePhone(c.bride_phone);
    if (groomDigits.includes(q.phoneNumeric)) matched.push('groom_phone');
    if (brideDigits.includes(q.phoneNumeric)) matched.push('bride_phone');
    // 전화로 매칭 안 됐을 때 — 다른 필드(견적금액·메모·견적세부 등)의 digit 도 확인
    if (!matched.some((m) => m === 'groom_phone' || m === 'bride_phone')) {
      if (buildWeddingDigits(c).includes(q.phoneNumeric)) matched.push('digits');
    }
  }
  if (q.emailLocal) {
    if ((c.groom_email || '').toLowerCase().includes(q.emailLocal)) matched.push('groom_email');
    if ((c.bride_email || '').toLowerCase().includes(q.emailLocal)) matched.push('bride_email');
  }
  return matched.length ? matched : null;
}

function buildMiceDigits(c: MiceCustomer): string {
  const parts: Array<string | null | undefined> = [
    c.organization_name,
    c.official_phone,
    c.official_email,
    c.official_website,
    c.memo,
  ];
  for (const inq of c.inquiries || []) {
    parts.push(inq.inquiry_event_date_text, inq.event_memo, inq.call_date);
    for (const ct of inq.contacts || []) {
      parts.push(ct.name, ct.phone, ct.email);
    }
  }
  return parts.filter(Boolean).join(' ').replace(/\D/g, '');
}

function matchMice(c: MiceCustomer, q: ReturnType<typeof parseQuery>): string[] | null {
  if (c.deleted_at) return null;
  const matched: string[] = [];
  if (softIncludes(c.organization_name, q.text)) matched.push('organization_name');
  if (q.phoneNumeric) {
    if (normalizePhone(c.official_phone).includes(q.phoneNumeric)) matched.push('official_phone');
  }
  if (q.emailLocal) {
    if ((c.official_email || '').toLowerCase().includes(q.emailLocal)) matched.push('official_email');
  }
  // 문의별 담당자 매칭
  for (const inq of c.inquiries) {
    for (const ct of inq.contacts) {
      if (softIncludes(ct.name, q.text)) {
        matched.push('contact_name');
        break;
      }
      if (q.phoneNumeric && normalizePhone(ct.phone).includes(q.phoneNumeric)) {
        matched.push('contact_phone');
        break;
      }
      if (q.emailLocal && (ct.email || '').toLowerCase().includes(q.emailLocal)) {
        matched.push('contact_email');
        break;
      }
    }
  }
  // 전화/연락처 모두 안 맞았으면 — 다른 텍스트 필드의 digits 확인 (메모·견적·금액 등)
  if (q.phoneNumeric && !matched.some((m) => m.includes('phone'))) {
    if (buildMiceDigits(c).includes(q.phoneNumeric)) matched.push('digits');
  }
  return matched.length ? matched : null;
}

function matchEvent(ev: Event, q: ReturnType<typeof parseQuery>): string[] | null {
  if (ev.deleted_at) return null;
  const matched: string[] = [];
  if (softIncludes(ev.event_name, q.text)) matched.push('event_name');
  if (softIncludes(ev.assigned_manager_name, q.text)) matched.push('assigned_manager_name');
  if (softIncludes(ev.memo, q.text)) matched.push('memo');
  for (const h of ev.halls || []) {
    if (softIncludes(h, q.text)) {
      matched.push('halls');
      break;
    }
  }
  return matched.length ? matched : null;
}

router.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = Math.min(
    MAX_LIMIT_PER_GROUP,
    Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT_PER_GROUP), 10) || DEFAULT_LIMIT_PER_GROUP)
  );
  const role = req.user!.role;
  const parsed = parseQuery(q);
  const t0 = Date.now();

  const out: SearchResponse = {
    query: q,
    took_ms: 0,
    wedding: [],
    mice: [],
    events: [],
    total: 0,
  };

  if (!parsed.text) {
    out.took_ms = Date.now() - t0;
    return res.json(out);
  }

  // 권한 (양 세일즈 상호 고객 DB 접근 허용):
  //   - admin/banquet/kitchen: 모든 영역 검색 가능
  //   - 양 sales: MICE + WEDDING + events 모두 검색 가능
  //   - h_kitchen: 행사만 (고객 DB 접근 불가)
  const canSeeWedding =
    role === 'admin' ||
    role === 'banquet' ||
    role === 'kitchen' ||
    role === 'sales_wedding' ||
    role === 'sales_mice';
  const canSeeMice =
    role === 'admin' ||
    role === 'banquet' ||
    role === 'kitchen' ||
    role === 'sales_mice' ||
    role === 'sales_wedding';
  const canSeeEvents = true; // 활성 사용자 모두 행사 검색 가능 (h_kitchen 포함)

  // 행사별 고객 카운트 (event_count) 빠르게 가져오기 위한 인덱스
  const eventCountByCustomer = new Map<string, number>();
  const activeEventIds = new Set<string>();
  for (const ev of store.events) {
    if (!ev.deleted_at) activeEventIds.add(ev.id);
  }
  for (const link of store.event_customers) {
    if (!activeEventIds.has(link.event_id)) continue;
    eventCountByCustomer.set(
      link.customer_id,
      (eventCountByCustomer.get(link.customer_id) || 0) + 1
    );
  }

  // WEDDING
  if (canSeeWedding) {
    for (const c of store.wedding_customers) {
      const matched = matchWedding(c, parsed);
      if (!matched) continue;
      const { label, subtitle } = describeWedding(c);
      out.wedding.push({
        id: c.id,
        label,
        subtitle,
        event_count: eventCountByCustomer.get(c.id) || 0,
        matched,
      });
      if (out.wedding.length >= limit) break;
    }
  }

  // MICE
  if (canSeeMice) {
    for (const c of store.mice_customers) {
      const matched = matchMice(c, parsed);
      if (!matched) continue;
      const { label, subtitle } = describeMice(c);
      out.mice.push({
        id: c.id,
        label,
        subtitle,
        event_count: eventCountByCustomer.get(c.id) || 0,
        matched,
      });
      if (out.mice.length >= limit) break;
    }
  }

  // EVENTS
  if (canSeeEvents) {
    for (const ev of store.events) {
      const matched = matchEvent(ev, parsed);
      if (!matched) continue;
      const { label, subtitle } = describeEvent(ev);
      out.events.push({ id: ev.id, label, subtitle, matched });
      if (out.events.length >= limit) break;
    }
  }

  out.total = out.wedding.length + out.mice.length + out.events.length;
  out.took_ms = Date.now() - t0;
  // 디버그 — 검색 쿼리 분석과 매칭 결과 카운트 로그
  console.log(
    '[search] role=' + role,
    'q=' + JSON.stringify(q),
    'parsed=' + JSON.stringify({
      text: parsed.text,
      phoneNumeric: parsed.phoneNumeric,
      emailLocal: parsed.emailLocal,
    }),
    'matches=W:' + out.wedding.length + ' M:' + out.mice.length + ' E:' + out.events.length,
    'took=' + out.took_ms + 'ms'
  );
  res.json(out);
});

export default router;
