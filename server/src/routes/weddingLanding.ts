// 웨딩 고객 랜딩 — 가예약(INQ) 고객에게 보내는 공개 링크.
//
// 직원용 (인증):
//   GET /api/events/:eventId/landing      — 랜딩 조회 (없으면 null)
//   PUT /api/events/:eventId/landing      — 생성/수정 (토큰은 최초 1회 발급 후 유지)
// 공개 (토큰만):
//   GET  /api/public/landing/:token       — 랜딩 payload (상태머신 적용)
//   POST /api/public/landing/:token/cta   — CTA 클릭 기록 + 직원 통지 메일
//
// 상태머신: 휴지통/LOS → closed · DEF → contracted · 가블록 종료일 경과 → expired
//           · 직원 수동 closed → closed · 그 외(INQ 등) → active
//
// 모드 2종:
//   block   (기본) — 가블록 행사(event_id)에 연결. 위 상태머신 그대로.
//   consult        — 상담만 하고 간 고객(customer_id)에 직접 연결. 행사 없이 발행.
//                    GET/PUT /api/customers/wedding/:customerId/landing
//                    만료 기준은 block_until(열람 기한). 고객이 DEF 행사로 계약되면 contracted.
//                    같은 고객의 가블록(block) 랜딩이 발행되면 자동으로 닫힘.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { sendNotifyMail, smtpConfigured } from '../lib/mailer.js';
import type { WeddingLanding, WeddingPriorityKey, AppSetting } from '../types.js';

const PRIORITY_KEYS: WeddingPriorityKey[] = [
  'space', 'food', 'access', 'flower', 'private', 'parents', 'budget', 'photo',
];

function sanitizePriorities(v: unknown): WeddingPriorityKey[] {
  if (!Array.isArray(v)) return [];
  return v.filter((k): k is WeddingPriorityKey =>
    PRIORITY_KEYS.includes(k as WeddingPriorityKey)
  );
}

// KST 기준 오늘 날짜 (Cloud Functions는 UTC로 돌므로 +9h 보정)
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

type LandingState = 'active' | 'contracted' | 'closed' | 'expired';

function landingState(landing: WeddingLanding): LandingState {
  if (landing.mode === 'consult') {
    const cust = store.wedding_customers.find((c) => c.id === landing.customer_id);
    if (!cust || cust.deleted_at) return 'closed';
    // 이 고객이 DEF(계약완료) 웨딩 행사에 연결되어 있으면 감사 화면
    const contracted = store.event_customers.some((l) => {
      if (l.customer_id !== cust.id) return false;
      const ev = store.events.find((e) => e.id === l.event_id);
      return !!ev && !ev.deleted_at && ev.event_type === 'WEDDING' && ev.status === 'DEF';
    });
    if (contracted) return 'contracted';
    if (landing.closed) return 'closed';
    if (landing.block_until && todayKst() > landing.block_until) return 'expired';
    return 'active';
  }
  const ev = store.events.find((e) => e.id === landing.event_id);
  if (!ev || ev.deleted_at) return 'closed';
  if (ev.status === 'LOS' || ev.status === '상담취소') return 'closed';
  if (ev.status === 'DEF') return 'contracted';
  if (landing.closed) return 'closed';
  if (landing.block_until && todayKst() > landing.block_until) return 'expired';
  return 'active';
}

// ===== 직원용 =====
export const landingStaffRouter = Router();
landingStaffRouter.use(requireActiveRole);

function canManageLanding(role: string): boolean {
  return role === 'admin' || role === 'sales_wedding';
}

landingStaffRouter.get('/:eventId/landing', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const landing = store.wedding_landings.find((l) => l.event_id === ev.id) || null;
  res.json({
    landing,
    state: landing ? landingState(landing) : null,
    smtp_configured: smtpConfigured(),
  });
});

landingStaffRouter.put('/:eventId/landing', (req, res) => {
  if (!canManageLanding(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev || ev.deleted_at) return res.status(404).json({ error: 'event_not_found' });
  if (ev.event_type !== 'WEDDING') return res.status(400).json({ error: 'wedding_only' });

  const body = req.body as Partial<WeddingLanding>;
  const now = new Date().toISOString();
  let landing = store.wedding_landings.find((l) => l.event_id === ev.id);
  if (!landing) {
    landing = {
      id: nanoid(10),
      event_id: ev.id,
      token: nanoid(24),
      block_until: '',
      priorities: [],
      custom_note: '',
      inquiry_id: '',
      guest_count: null,
      total_amount: '',
      quote_html: '',
      closed: false,
      cta_clicks: [],
      created_by: req.user!.id,
      created_by_name: req.user!.name,
      created_at: now,
      updated_at: now,
    };
    store.wedding_landings.push(landing);
  }
  applyLandingBody(landing, body, now);
  persistDoc('wedding_landings', landing.id);

  // 같은 고객의 상담형(consult) 랜딩 자동 닫기 — 문구가 다른 두 링크가 동시에 살아있지 않도록
  const linkedCustIds = store.event_customers
    .filter((l) => l.event_id === ev.id)
    .map((l) => l.customer_id);
  for (const cl of store.wedding_landings) {
    if (cl.mode === 'consult' && cl.customer_id && linkedCustIds.includes(cl.customer_id) && !cl.closed) {
      cl.closed = true;
      cl.updated_at = now;
      persistDoc('wedding_landings', cl.id);
    }
  }

  res.json({ landing, state: landingState(landing), smtp_configured: smtpConfigured() });
});

// 허용 필드만 갱신 (token/cta_clicks/mode 등은 서버 관리)
function applyLandingBody(landing: WeddingLanding, body: Partial<WeddingLanding>, now: string) {
  if (typeof body.block_until === 'string') landing.block_until = body.block_until.slice(0, 10);
  if (body.priorities !== undefined) landing.priorities = sanitizePriorities(body.priorities);
  if (typeof body.custom_note === 'string') landing.custom_note = body.custom_note.slice(0, 500);
  if (typeof body.inquiry_id === 'string') landing.inquiry_id = body.inquiry_id;
  if (body.guest_count === null || typeof body.guest_count === 'number')
    landing.guest_count = body.guest_count;
  if (typeof body.total_amount === 'string') landing.total_amount = body.total_amount.slice(0, 40);
  if (typeof body.quote_html === 'string') landing.quote_html = body.quote_html;
  if (Array.isArray(body.benefits)) {
    landing.benefits = body.benefits
      .filter((b) => b && typeof b.label === 'string' && typeof b.amount === 'number' && isFinite(b.amount))
      .slice(0, 20)
      .map((b) => ({ label: b.label.slice(0, 80), amount: Math.round(b.amount) }));
  }
  if (typeof body.closed === 'boolean') landing.closed = body.closed;
  landing.updated_at = now;
}

// ===== 직원용 — 상담형(consult): 행사 없이 웨딩 고객에 직접 발행 =====
// mount: /api/customers → GET/PUT /api/customers/wedding/:customerId/landing
export const landingConsultRouter = Router();
landingConsultRouter.use(requireActiveRole);

landingConsultRouter.get('/wedding/:customerId/landing', (req, res) => {
  const cust = store.wedding_customers.find((c) => c.id === req.params.customerId);
  if (!cust || cust.deleted_at) return res.status(404).json({ error: 'customer_not_found' });
  const landing =
    store.wedding_landings.find((l) => l.mode === 'consult' && l.customer_id === cust.id) || null;
  res.json({
    landing,
    state: landing ? landingState(landing) : null,
    smtp_configured: smtpConfigured(),
  });
});

landingConsultRouter.put('/wedding/:customerId/landing', (req, res) => {
  if (!canManageLanding(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const cust = store.wedding_customers.find((c) => c.id === req.params.customerId);
  if (!cust || cust.deleted_at) return res.status(404).json({ error: 'customer_not_found' });

  const body = req.body as Partial<WeddingLanding>;
  const now = new Date().toISOString();
  let landing = store.wedding_landings.find(
    (l) => l.mode === 'consult' && l.customer_id === cust.id
  );
  if (!landing) {
    landing = {
      id: nanoid(10),
      event_id: '',
      mode: 'consult',
      customer_id: cust.id,
      token: nanoid(24),
      block_until: '',
      priorities: [],
      custom_note: '',
      inquiry_id: '',
      guest_count: null,
      total_amount: '',
      quote_html: '',
      closed: false,
      cta_clicks: [],
      created_by: req.user!.id,
      created_by_name: req.user!.name,
      created_at: now,
      updated_at: now,
    };
    store.wedding_landings.push(landing);
  }
  applyLandingBody(landing, body, now);
  persistDoc('wedding_landings', landing.id);
  res.json({ landing, state: landingState(landing), smtp_configured: smtpConfigured() });
});

// ===== 공개 (토큰) =====
export const landingPublicRouter = Router();

// 랜딩 미디어 설정 (settings key). 값 예시는 클라이언트 WeddingLandingPublic 참고.
const MEDIA_SETTING_KEY = 'wedding-landing-media';

// Firestore 모드에서는 이 설정이 외부 스크립트로 직접 갱신될 수 있어,
// 부팅 시 hydrate된 in-memory 캐시를 60초 TTL로 재조회한다.
// (구버전 인스턴스가 삭제된 미디어 URL을 계속 응답하던 문제 방지)
const MEDIA_TTL_MS = 60_000;
let mediaCheckedAt = 0;

async function mediaSetting(): Promise<unknown> {
  const backend = (process.env.STORE_BACKEND || 'json').toLowerCase();
  if (backend === 'firestore' && Date.now() - mediaCheckedAt > MEDIA_TTL_MS) {
    mediaCheckedAt = Date.now(); // 실패해도 TTL 동안 재시도 안 함 (기존 캐시 사용)
    try {
      const { firestore } = await import('../lib/firebase.js');
      const snap = await firestore.doc(`settings/${MEDIA_SETTING_KEY}`).get();
      if (snap.exists) {
        const fresh = snap.data() as AppSetting;
        const i = store.settings.findIndex((s: AppSetting) => s.key === MEDIA_SETTING_KEY);
        if (i >= 0) store.settings[i] = fresh;
        else store.settings.push(fresh);
      }
    } catch (e) {
      console.error('[landing] media 설정 재조회 실패 — 캐시 사용:', (e as Error).message);
    }
  }
  const row = store.settings.find((s: AppSetting) => s.key === MEDIA_SETTING_KEY);
  return row?.value ?? null;
}

// 랜딩 → 연결 고객 해석 (block: 행사의 CONTACT POINT 우선 / consult: customer_id 직접)
function landingCustomer(landing: WeddingLanding) {
  if (landing.mode === 'consult') {
    return store.wedding_customers.find((c) => c.id === landing.customer_id);
  }
  const links = store.event_customers.filter((l) => l.event_id === landing.event_id);
  const cp = links.find((l) => l.is_contact_point) || links[0];
  return cp ? store.wedding_customers.find((c) => c.id === cp.customer_id) : undefined;
}

// 랜딩 → 예식 예정일시 (block: 행사 시작일시 / consult: 견적 출처 예식후보의 희망일시)
function landingDatetime(landing: WeddingLanding): string {
  if (landing.mode === 'consult') {
    const cust = landingCustomer(landing);
    const inq =
      cust?.event_inquiries?.find((q) => q.id === landing.inquiry_id) || cust?.event_inquiries?.[0];
    return inq?.wedding_datetime || '';
  }
  const ev = store.events.find((e) => e.id === landing.event_id);
  return ev?.start_datetime || '';
}

landingPublicRouter.get('/landing/:token', async (req, res) => {
  const landing = store.wedding_landings.find((l) => l.token === req.params.token);
  if (!landing) return res.status(404).json({ error: 'invalid_token' });
  const state = landingState(landing);
  const mode = landing.mode || 'block';

  const cust = landingCustomer(landing);
  const groom = cust?.groom_name || '';
  const bride = cust?.bride_name || '';

  const media = await mediaSetting();
  // 닫힘/만료 상태에서는 최소 정보만 (견적·상세 미노출)
  if (state === 'closed' || state === 'expired') {
    return res.json({ state, mode, groom_name: groom, bride_name: bride, media });
  }
  res.json({
    state,
    mode,
    groom_name: groom,
    bride_name: bride,
    wedding_datetime: landingDatetime(landing),
    block_until: landing.block_until,
    priorities: landing.priorities,
    custom_note: landing.custom_note,
    guest_count: landing.guest_count,
    total_amount: landing.total_amount,
    quote_html: landing.quote_html,
    benefits: landing.benefits || [],
    media,
  });
});

// ===== OG 미리보기 (/l/:token) =====
// SPA는 정적 index.html이라 카톡/문자 링크 미리보기가 항상 "운영관리"로 떠서,
// 랜딩 경로만 함수가 index.html에 신랑신부 이름이 담긴 OG 태그를 주입해 응답한다.
// (hosting rewrite: /l/** → api 함수. 크롤러는 메타만 읽고, 브라우저는 그대로 SPA 구동)
export const landingOgRouter = Router();

const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || 'https://plenty-management.web.app';
const OG_IMAGE =
  'https://storage.googleapis.com/plenty-management.firebasestorage.app/wedding-landing/brand/og_card.jpg';

// XSS 방지 — 고객 이름이 HTML에 들어가므로 이스케이프
function escHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

// 호스팅의 index.html을 가져와 캐시 (5분 TTL, 실패 시 이전 캐시 유지)
let indexCache: { html: string; at: number } | null = null;
async function fetchIndexHtml(): Promise<string | null> {
  if (indexCache && Date.now() - indexCache.at < 5 * 60_000) return indexCache.html;
  try {
    const r = await fetch(`${PUBLIC_ORIGIN}/index.html`);
    if (r.ok) {
      indexCache = { html: await r.text(), at: Date.now() };
      return indexCache.html;
    }
  } catch (e) {
    console.error('[landing-og] index.html fetch 실패:', (e as Error).message);
  }
  return indexCache?.html ?? null; // 실패해도 이전 캐시가 있으면 사용
}

landingOgRouter.get('/l/:token', async (req, res) => {
  const landing = store.wedding_landings.find((l) => l.token === req.params.token);
  const cust = landing ? landingCustomer(landing) : undefined;
  const names =
    cust && (cust.groom_name || cust.bride_name)
      ? [cust.groom_name, cust.bride_name].filter(Boolean).join(' ♥ ')
      : '';
  const title = names
    ? `${escHtml(names)} · PLENTY Private Reservation Page`
    : 'PLENTY Private Reservation Page';
  const desc = '플렌티컨벤션이 두 분만을 위해 준비한 프라이빗 페이지입니다.';
  const url = `${PUBLIC_ORIGIN}/l/${encodeURIComponent(req.params.token)}`;

  const base = await fetchIndexHtml();
  if (!base) {
    // 최초 요청부터 fetch 실패한 극히 드문 경우 — 재시도 유도
    return res
      .status(503)
      .send('<!doctype html><html><head><meta charset="utf-8"></head><body><script>setTimeout(()=>location.reload(),800)</script></body></html>');
  }
  const og =
    `<meta property="og:type" content="website" />` +
    `<meta property="og:title" content="${title}" />` +
    `<meta property="og:description" content="${desc}" />` +
    `<meta property="og:image" content="${OG_IMAGE}" />` +
    `<meta property="og:url" content="${url}" />` +
    `<meta name="twitter:card" content="summary_large_image" />`;
  const html = base
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace('</head>', `${og}</head>`);
  res.set('Cache-Control', 'no-cache').type('html').send(html);
});

landingPublicRouter.post('/landing/:token/cta', async (req, res) => {
  const landing = store.wedding_landings.find((l) => l.token === req.params.token);
  if (!landing) return res.status(404).json({ error: 'invalid_token' });
  const state = landingState(landing);
  if (state === 'closed') return res.status(400).json({ error: 'landing_closed' });

  const action = (req.body as { action?: string }).action;
  if (action !== 'contract' && action !== 'call') {
    return res.status(400).json({ error: 'invalid_action' });
  }
  // 1) 항상 시스템에 먼저 기록 (메일 실패해도 유실 없음)
  landing.cta_clicks.push({ action, at: new Date().toISOString() });
  persistDoc('wedding_landings', landing.id);

  // 2) 직원 통지 메일 (SMTP 설정 시)
  const isConsult = landing.mode === 'consult';
  const ev = isConsult ? undefined : store.events.find((e) => e.id === landing.event_id);
  const cust = landingCustomer(landing);
  const inq = isConsult
    ? cust?.event_inquiries?.find((q) => q.id === landing.inquiry_id) || cust?.event_inquiries?.[0]
    : undefined;
  const names = cust ? `${cust.groom_name || '?'} & ${cust.bride_name || '?'}` : '(고객 미연결)';
  const label = action === 'contract' ? '💍 이 날짜로 계약하고 싶어요' : '📞 담당자와 전화로 상의할게요';
  const when = landingDatetime(landing).replace('T', ' ') || '-';
  const manager = isConsult ? inq?.assigned_manager_name : ev?.assigned_manager_name;
  const mail = await sendNotifyMail({
    subject: `[고객랜딩${isConsult ? '·상담' : ''}] ${names} — ${action === 'contract' ? '계약 의사' : '전화 상담 요청'}`,
    html:
      `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px;line-height:1.7">` +
      `<p><b>${names}</b> 고객님이 ${isConsult ? '상담형 ' : ''}랜딩 페이지에서 버튼을 눌렀습니다.</p>` +
      `<p style="font-size:16px"><b>${label}</b></p>` +
      `<p>예식 예정일시: ${when}<br>${isConsult ? '링크 열람 기한' : '가블록 종료일'}: ${landing.block_until || '-'}<br>` +
      `담당자: ${manager || '-'}</p>` +
      `<p>관리시스템에서 해당 ${isConsult ? '고객(웨딩 상담 DB)' : '행사'}을 열어 확인해주세요.</p></div>`,
  });
  res.json({ ok: true, mail_sent: mail.sent });
});
