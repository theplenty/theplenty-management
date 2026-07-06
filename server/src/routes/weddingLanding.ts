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
  // 허용 필드만 갱신 (token/cta_clicks 등은 서버 관리)
  if (typeof body.block_until === 'string') landing.block_until = body.block_until.slice(0, 10);
  if (body.priorities !== undefined) landing.priorities = sanitizePriorities(body.priorities);
  if (typeof body.custom_note === 'string') landing.custom_note = body.custom_note.slice(0, 500);
  if (typeof body.inquiry_id === 'string') landing.inquiry_id = body.inquiry_id;
  if (body.guest_count === null || typeof body.guest_count === 'number')
    landing.guest_count = body.guest_count;
  if (typeof body.total_amount === 'string') landing.total_amount = body.total_amount.slice(0, 40);
  if (typeof body.quote_html === 'string') landing.quote_html = body.quote_html;
  if (typeof body.closed === 'boolean') landing.closed = body.closed;
  landing.updated_at = now;
  persistDoc('wedding_landings', landing.id);
  res.json({ landing, state: landingState(landing), smtp_configured: smtpConfigured() });
});

// ===== 공개 (토큰) =====
export const landingPublicRouter = Router();

// 랜딩 미디어 설정 (settings key). 값 예시는 클라이언트 WeddingLandingPublic 참고.
const MEDIA_SETTING_KEY = 'wedding-landing-media';

function mediaSetting(): unknown {
  const row = store.settings.find((s: AppSetting) => s.key === MEDIA_SETTING_KEY);
  return row?.value ?? null;
}

landingPublicRouter.get('/landing/:token', (req, res) => {
  const landing = store.wedding_landings.find((l) => l.token === req.params.token);
  if (!landing) return res.status(404).json({ error: 'invalid_token' });
  const state = landingState(landing);
  const ev = store.events.find((e) => e.id === landing.event_id);

  // 신랑/신부 이름 — 연결된 웨딩 고객(CONTACT POINT 우선)에서 해석
  let groom = '';
  let bride = '';
  if (ev) {
    const links = store.event_customers.filter((l) => l.event_id === ev.id);
    const cp = links.find((l) => l.is_contact_point) || links[0];
    const cust = cp ? store.wedding_customers.find((c) => c.id === cp.customer_id) : undefined;
    if (cust) {
      groom = cust.groom_name || '';
      bride = cust.bride_name || '';
    }
  }

  // 닫힘/만료 상태에서는 최소 정보만 (견적·상세 미노출)
  if (state === 'closed' || state === 'expired') {
    return res.json({ state, groom_name: groom, bride_name: bride, media: mediaSetting() });
  }
  res.json({
    state,
    groom_name: groom,
    bride_name: bride,
    wedding_datetime: ev?.start_datetime || '',
    block_until: landing.block_until,
    priorities: landing.priorities,
    custom_note: landing.custom_note,
    guest_count: landing.guest_count,
    total_amount: landing.total_amount,
    quote_html: landing.quote_html,
    media: mediaSetting(),
  });
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
  const ev = store.events.find((e) => e.id === landing.event_id);
  const links = ev ? store.event_customers.filter((l) => l.event_id === ev.id) : [];
  const cp = links.find((l) => l.is_contact_point) || links[0];
  const cust = cp ? store.wedding_customers.find((c) => c.id === cp.customer_id) : undefined;
  const names = cust ? `${cust.groom_name || '?'} & ${cust.bride_name || '?'}` : '(고객 미연결)';
  const label = action === 'contract' ? '💍 이 날짜로 계약하고 싶어요' : '📞 담당자와 전화로 상의할게요';
  const when = ev?.start_datetime?.replace('T', ' ') || '-';
  const mail = await sendNotifyMail({
    subject: `[고객랜딩] ${names} — ${action === 'contract' ? '계약 의사' : '전화 상담 요청'}`,
    html:
      `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px;line-height:1.7">` +
      `<p><b>${names}</b> 고객님이 랜딩 페이지에서 버튼을 눌렀습니다.</p>` +
      `<p style="font-size:16px"><b>${label}</b></p>` +
      `<p>예식 예정일시: ${when}<br>가블록 종료일: ${landing.block_until || '-'}<br>` +
      `담당자: ${ev?.assigned_manager_name || '-'}</p>` +
      `<p>관리시스템에서 해당 행사를 열어 확인해주세요.</p></div>`,
  });
  res.json({ ok: true, mail_sent: mail.sent });
});
