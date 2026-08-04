// 협업요청서 공용 로직 — API 래퍼 + 상태색/라벨 + 카운트다운 + 마진 계산.
// 행사 모달 탭, 대시보드, 통계, 헤더 알림 배지가 공유.

import { api } from './api';
import type {
  CollabDecision,
  CollabReplyResult,
  CollabStatus,
  CollabTeam,
  CollaborationReply,
  CollaborationRequest,
} from '../types';

// ===== 표시용 값 =====
// 협업요청서는 작성 시점의 행사명/행사일을 복사 보관하므로, 그 뒤 행사가 개명·일정변경되면
// 캘린더와 다른 값이 보인다. 서버가 함께 내려주는 현재 행사값(live_*)을 우선 표시한다.
export function collabEventName(cr: CollaborationRequest): string {
  return cr.live_event_name || cr.customer_event_name;
}
export function collabEventDate(cr: CollaborationRequest): string | null {
  return cr.live_event_date || cr.event_date;
}

// ===== API =====
export async function listCollaborations(eventId?: string): Promise<CollaborationRequest[]> {
  const q = eventId ? `?event_id=${encodeURIComponent(eventId)}` : '';
  const res = await api.get<{ requests: CollaborationRequest[] }>(`/api/collaborations${q}`);
  return res.requests;
}

export interface CreateCollabBody {
  event_id: string;
  customer_event_name: string;
  event_date: string | null;
  customer_request: string;
  deviations: string[];
  deviation_other: string;
  expected_revenue: number | null;
  expected_revenue_memo: string;
  target_teams: CollabTeam[];
  sales_comment: string;
}
export async function createCollaboration(body: CreateCollabBody): Promise<CollaborationRequest> {
  const res = await api.post<{ request: CollaborationRequest }>('/api/collaborations', body);
  return res.request;
}

export interface ReplyCollabBody {
  team: CollabTeam;
  result: CollabReplyResult;
  added_cost: number | null;
  added_cost_memo: string;
  condition_or_reject_reason: string;
  alternative: string;
}
export async function replyCollaboration(
  id: string,
  body: ReplyCollabBody
): Promise<CollaborationRequest> {
  const res = await api.patch<{ request: CollaborationRequest }>(
    `/api/collaborations/${id}/reply`,
    body
  );
  return res.request;
}

export interface DecideCollabBody {
  decision: CollabDecision;
  decided_margin: number | null;
  decision_comment: string;
}
export async function decideCollaboration(
  id: string,
  body: DecideCollabBody
): Promise<CollaborationRequest> {
  const res = await api.patch<{ request: CollaborationRequest }>(
    `/api/collaborations/${id}/decision`,
    body
  );
  return res.request;
}

export async function deleteCollaboration(id: string): Promise<void> {
  await api.delete(`/api/collaborations/${id}`);
}

// ===== 상태 색/라벨 =====
const STATUS_STYLE: Record<CollabStatus, string> = {
  회신대기: 'bg-amber-100 text-amber-800 border-amber-200',
  회신완료: 'bg-blue-100 text-blue-800 border-blue-200',
  진행: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  조건부진행: 'bg-violet-100 text-violet-800 border-violet-200',
  진행안함: 'bg-gray-200 text-gray-700 border-gray-300',
};
export function statusBadgeClass(s: CollabStatus): string {
  return STATUS_STYLE[s] || STATUS_STYLE['회신대기'];
}

const RESULT_STYLE: Record<CollabReplyResult, string> = {
  가능: 'bg-emerald-100 text-emerald-800',
  '조건부 가능': 'bg-amber-100 text-amber-800',
  불가: 'bg-red-100 text-red-800',
};
export function resultBadgeClass(r: CollabReplyResult): string {
  return RESULT_STYLE[r] || 'bg-gray-100 text-gray-700';
}

// ===== 마진 계산 =====
export function sumAddedCost(cr: CollaborationRequest): number {
  return cr.replies.reduce((acc, r) => acc + (r.added_cost || 0), 0);
}
export function autoMargin(cr: CollaborationRequest): number | null {
  if (cr.expected_revenue == null) return null;
  return cr.expected_revenue - sumAddedCost(cr);
}
export function marginPct(revenue: number | null, margin: number | null): number | null {
  if (revenue == null || margin == null || revenue === 0) return null;
  return (margin / revenue) * 100;
}

// ===== 카운트다운 =====
export interface Countdown {
  expired: boolean;
  ms: number; // 남은 ms (음수면 초과)
  label: string; // "6시간 23분" 또는 "초과 2시간"
  urgent: boolean; // 6시간 이내 → 빨강 강조
}
export function countdown(dueIso: string, now = Date.now()): Countdown {
  const due = new Date(dueIso).getTime();
  const ms = due - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const core = h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  if (ms <= 0) {
    return { expired: true, ms, label: `초과 ${core}`, urgent: true };
  }
  return { expired: false, ms, label: core, urgent: ms <= 6 * 3_600_000 };
}

// 회신 대기 중인지 (카운트다운 표시 대상)
export function isAwaitingReply(cr: CollaborationRequest): boolean {
  return cr.status === '회신대기';
}

// 특정 팀의 회신 찾기
export function replyOf(cr: CollaborationRequest, team: CollabTeam): CollaborationReply | undefined {
  return cr.replies.find((r) => r.team === team);
}

// ===== 인앱 알림: 내가 처리해야 할 건 계산 =====
// 세일즈/admin: 내가 만든 요청이 '회신완료'(결정 대기) 인 것 + (admin은 전체 회신완료)
// 주방/연회: 내 팀이 대상인데 아직 우리 팀이 회신 안 한 '회신대기' 건
export interface CollabAttention {
  total: number;
  needMyReply: CollaborationRequest[]; // 주방/연회: 내 팀 회신 필요
  needDecision: CollaborationRequest[]; // 세일즈: 결정 필요
}
export function computeAttention(
  requests: CollaborationRequest[],
  role: string | undefined,
  userId: string | undefined
): CollabAttention {
  const needMyReply: CollaborationRequest[] = [];
  const needDecision: CollaborationRequest[] = [];
  const myTeam: CollabTeam | null =
    role === 'kitchen' ? 'kitchen' : role === 'banquet' ? 'banquet' : null;

  for (const cr of requests) {
    if (myTeam) {
      if (cr.target_teams.includes(myTeam) && cr.status === '회신대기') {
        const mine = replyOf(cr, myTeam);
        if (!mine || !mine.result) needMyReply.push(cr);
      }
    }
    if (role === 'admin' || role === 'sales_mice' || role === 'sales_wedding') {
      if (cr.status === '회신완료') {
        // 세일즈는 본인이 만든 것 우선, admin 은 전체
        if (role === 'admin' || cr.created_by_id === userId) needDecision.push(cr);
      }
    }
  }
  return { total: needMyReply.length + needDecision.length, needMyReply, needDecision };
}
