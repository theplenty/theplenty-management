// 협업요청서 (Collaboration Request) — 작성(세일즈) → 회신(주방/연회) → 최종결정(세일즈).
// 행사(Event)에 연결. 인앱 알림은 활동로그(change_logs) 폴링으로 처리하므로
// 여기서는 데이터 + 워크플로우 + 감사로그만 책임진다. (모바일 푸시/자동 에스컬레이션 범위 외)

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { logChange } from '../store/changeLog.js';
import type {
  CollaborationReply,
  CollaborationRequest,
  CollabDecision,
  CollabDeviation,
  CollabReplyResult,
  CollabStatus,
  CollabTeam,
  Role,
} from '../types.js';

const router = Router();
router.use(requireActiveRole);

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

const VALID_DEVIATIONS: CollabDeviation[] = [
  '메뉴/식자재',
  '음주류',
  '인력/외주',
  '운영 시간',
  '공간 세팅',
  '기타',
];
const VALID_REPLY_RESULTS: CollabReplyResult[] = ['가능', '조건부 가능', '불가'];
const VALID_DECISIONS: CollabDecision[] = ['진행', '조건부진행', '진행안함'];
const VALID_TEAMS: CollabTeam[] = ['kitchen', 'banquet'];

// ===== 권한 헬퍼 =====
function canCreate(role: Role): boolean {
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}
function canDecide(role: Role): boolean {
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}
function canReplyForTeam(role: Role, team: CollabTeam): boolean {
  if (role === 'admin') return true;
  if (team === 'kitchen') return role === 'kitchen';
  if (team === 'banquet') return role === 'banquet';
  return false;
}
// 조회 가능 범위: admin/sales 는 전체, 주방/연회는 자기 팀이 대상인 건만, 그 외는 없음.
function visibleTo(cr: CollaborationRequest, role: Role): boolean {
  if (role === 'admin' || role === 'sales_mice' || role === 'sales_wedding') return true;
  if (role === 'kitchen') return cr.target_teams.includes('kitchen');
  if (role === 'banquet') return cr.target_teams.includes('banquet');
  return false;
}

// ===== 유틸 =====
function str(v: unknown, max: number): string {
  return String(v ?? '').slice(0, max);
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sumAddedCost(cr: CollaborationRequest): number {
  return cr.replies.reduce((acc, r) => acc + (r.added_cost || 0), 0);
}

function recomputeStatus(cr: CollaborationRequest): CollabStatus {
  if (cr.decision) return cr.decision;
  const allReplied = cr.target_teams.every((t) => {
    const r = cr.replies.find((x) => x.team === t);
    return !!(r && r.result);
  });
  return allReplied ? '회신완료' : '회신대기';
}

function touch(cr: CollaborationRequest) {
  cr.status = recomputeStatus(cr);
  cr.updated_at = new Date().toISOString();
}

// ===== 목록 (대시보드/통계용) =====
router.get('/', (req, res) => {
  const role = req.user!.role;
  const eventId = typeof req.query.event_id === 'string' ? req.query.event_id : null;
  const deletedEventIds = new Set(store.events.filter((e) => e.deleted_at).map((e) => e.id));
  const list = store.collaboration_requests
    .filter((cr) => visibleTo(cr, role))
    .filter((cr) => !deletedEventIds.has(cr.event_id))
    .filter((cr) => (eventId ? cr.event_id === eventId : true))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  res.json({ requests: list });
});

// ===== 단건 조회 =====
router.get('/:id', (req, res) => {
  const cr = store.collaboration_requests.find((c) => c.id === req.params.id);
  if (!cr) return res.status(404).json({ error: 'not_found' });
  if (!visibleTo(cr, req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  res.json({ request: cr });
});

// ===== 작성 (화면 1, 세일즈) =====
router.post('/', (req, res) => {
  if (!canCreate(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body as Record<string, unknown>;

  const ev = store.events.find((e) => e.id === b.event_id);
  if (!ev) return res.status(400).json({ error: 'event_not_found' });

  const target_teams = Array.isArray(b.target_teams)
    ? (b.target_teams as unknown[]).filter((t): t is CollabTeam => VALID_TEAMS.includes(t as CollabTeam))
    : [];
  if (target_teams.length === 0) return res.status(400).json({ error: 'target_teams_required' });

  const customer_event_name = str(b.customer_event_name, 200).trim();
  const customer_request = str(b.customer_request, 100).trim();
  if (!customer_event_name) return res.status(400).json({ error: 'customer_event_name_required' });
  if (!customer_request) return res.status(400).json({ error: 'customer_request_required' });

  const deviations = Array.isArray(b.deviations)
    ? (b.deviations as unknown[]).filter((d): d is CollabDeviation =>
        VALID_DEVIATIONS.includes(d as CollabDeviation)
      )
    : [];

  const now = new Date();
  const cr: CollaborationRequest = {
    id: nanoid(10),
    event_id: ev.id,
    created_by_id: req.user!.id,
    created_by_name: req.user!.name,
    created_by_role: req.user!.role,
    created_at: now.toISOString(),
    customer_event_name,
    event_date: b.event_date ? str(b.event_date, 30) : null,
    customer_request,
    deviations,
    deviation_other: str(b.deviation_other, 100),
    expected_revenue: num(b.expected_revenue),
    expected_revenue_memo: str(b.expected_revenue_memo, 200),
    target_teams,
    sales_comment: str(b.sales_comment, 200),
    replies: [],
    decision: null,
    decided_margin: null,
    decision_comment: '',
    decided_by_id: null,
    decided_by_name: null,
    decided_at: null,
    status: '회신대기',
    reply_due_at: new Date(now.getTime() + REPLY_WINDOW_MS).toISOString(),
    updated_at: now.toISOString(),
  };
  store.collaboration_requests.push(cr);
  persistDoc('collaboration_requests', cr.id);

  logChange({
    entity_type: 'collaboration_request',
    entity_id: cr.id,
    action: 'create',
    summary: `협업요청서 작성 — ${cr.customer_event_name} (대상: ${cr.target_teams
      .map((t) => (t === 'kitchen' ? '주방' : '연회'))
      .join('+')})`,
    user: req.user!,
  });

  res.status(201).json({ request: cr });
});

// ===== 회신 (화면 2, 주방/연회) =====
router.patch('/:id/reply', (req, res) => {
  const cr = store.collaboration_requests.find((c) => c.id === req.params.id);
  if (!cr) return res.status(404).json({ error: 'not_found' });

  const b = req.body as Record<string, unknown>;
  const team = b.team as CollabTeam;
  if (!VALID_TEAMS.includes(team)) return res.status(400).json({ error: 'invalid_team' });
  if (!cr.target_teams.includes(team)) return res.status(400).json({ error: 'team_not_targeted' });
  if (!canReplyForTeam(req.user!.role, team)) return res.status(403).json({ error: 'forbidden' });

  const result = b.result as CollabReplyResult;
  if (!VALID_REPLY_RESULTS.includes(result)) return res.status(400).json({ error: 'invalid_result' });

  const reason = str(b.condition_or_reject_reason, 200).trim();
  if ((result === '조건부 가능' || result === '불가') && !reason) {
    return res.status(400).json({ error: 'reason_required' });
  }

  const reply: CollaborationReply = {
    team,
    result,
    added_cost: num(b.added_cost),
    added_cost_memo: str(b.added_cost_memo, 200),
    condition_or_reject_reason: reason,
    alternative: str(b.alternative, 200),
    replied_by_id: req.user!.id,
    replied_by_name: req.user!.name,
    replied_at: new Date().toISOString(),
  };

  const idx = cr.replies.findIndex((r) => r.team === team);
  if (idx === -1) cr.replies.push(reply);
  else cr.replies[idx] = reply;

  touch(cr);
  persistDoc('collaboration_requests', cr.id);

  logChange({
    entity_type: 'collaboration_request',
    entity_id: cr.id,
    action: 'update',
    summary: `협업회신 (${team === 'kitchen' ? '주방' : '연회'}) — ${cr.customer_event_name}: ${result}`,
    user: req.user!,
  });

  res.json({ request: cr });
});

// ===== 최종 결정 (화면 3, 세일즈) =====
router.patch('/:id/decision', (req, res) => {
  if (!canDecide(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const cr = store.collaboration_requests.find((c) => c.id === req.params.id);
  if (!cr) return res.status(404).json({ error: 'not_found' });

  const b = req.body as Record<string, unknown>;
  const decision = b.decision as CollabDecision;
  if (!VALID_DECISIONS.includes(decision)) return res.status(400).json({ error: 'invalid_decision' });

  // 마진: 클라이언트가 수정값을 보내면 사용, 없으면 자동계산(예상매출 - 추가COST 합)
  const provided = num(b.decided_margin);
  const autoMargin =
    cr.expected_revenue != null ? cr.expected_revenue - sumAddedCost(cr) : null;

  cr.decision = decision;
  cr.decided_margin = provided != null ? provided : autoMargin;
  cr.decision_comment = str(b.decision_comment, 200);
  cr.decided_by_id = req.user!.id;
  cr.decided_by_name = req.user!.name;
  cr.decided_at = new Date().toISOString();
  touch(cr);
  persistDoc('collaboration_requests', cr.id);

  logChange({
    entity_type: 'collaboration_request',
    entity_id: cr.id,
    action: 'update',
    summary: `협업 최종결정 — ${cr.customer_event_name}: ${decision}`,
    user: req.user!,
  });

  res.json({ request: cr });
});

// ===== 삭제 (대표/admin 전용) =====
router.delete('/:id', (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const idx = store.collaboration_requests.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const removed = store.collaboration_requests[idx];
  store.collaboration_requests.splice(idx, 1);
  persistDelete('collaboration_requests', removed.id);

  logChange({
    entity_type: 'collaboration_request',
    entity_id: removed.id,
    action: 'delete',
    summary: `협업요청서 삭제 — ${removed.customer_event_name}`,
    user: req.user!,
  });

  res.json({ ok: true });
});

export default router;
