// 알림 자동화 (로드맵 A4) — 규칙 판정 → 중복 제거 → Slack 발송.
//
// 설계 원칙
//  1. 판정은 lib/opsMetrics.ts 하나만 쓴다. (에이전트 /ops API 와 같은 숫자를 보장)
//  2. 같은 건을 매일 다시 밀지 않는다. 규칙별 repeat_days 가 지나야 재알림.
//  3. 웹훅 미설정이면 조용히 skip — 발송 실패로 서버가 죽지 않는다.
import { store, persistDoc } from '../store/mockStore.js';
import type { NotificationLog } from '../types.js';
import { sendSlack, slackConfigured, type SlackBlock } from './slack.js';
import {
  overduePayments,
  pendingCollaborations,
  revenueMissingEvents,
  unsettledEvents,
  upcomingEvents,
} from './opsMetrics.js';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → '2026-08-12 (수)' — 화면 표기 규칙과 동일하게 요일을 붙인다. */
function fmtDateW(s: string | null | undefined): string {
  if (!s) return '-';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return m[0];
  return `${m[0]} (${WEEKDAYS_KO[d.getDay()]})`;
}

function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

// Slack section 의 text 는 3,000자 제한 — 넘으면 블록 전체가 거부된다.
// maxItems 로 이미 줄이지만, 행사명이 유난히 긴 경우를 대비한 최후 안전장치.
const SLACK_TEXT_LIMIT = 2900;
function truncateForSlack(s: string): string {
  return s.length <= SLACK_TEXT_LIMIT ? s : `${s.slice(0, SLACK_TEXT_LIMIT)}\n… _(길이 제한으로 생략)_`;
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://plenty-management.web.app').replace(/\/$/, '');
}

function eventLink(eventId: string, label: string, tab?: string): string {
  const q = tab ? `?tab=${tab}` : '';
  return `<${appBaseUrl()}/events/${eventId}${q}|${label}>`;
}

// ── 규칙 정의 ───────────────────────────────────────────────────────────────
export type RuleId =
  | 'collab_pending'
  | 'payment_overdue'
  | 'settlement_unpaid'
  | 'event_d7'
  | 'revenue_missing';

interface RuleDef {
  id: RuleId;
  title: string;
  // 같은 대상에 대해 다시 알리기까지의 간격(일). 0 이면 매 실행마다 알림.
  repeatDays: number;
  // 한 번에 나열할 최대 건수 — 넘치면 "외 N건" 으로 접는다.
  maxItems: number;
}

const RULES: Record<RuleId, RuleDef> = {
  // 기한이 걸린 건이라 매일 리마인드가 맞다.
  collab_pending: { id: 'collab_pending', title: '🤝 협업요청 회신 대기', repeatDays: 1, maxItems: 10 },
  // 돈 문제 — 해결될 때까지 매일.
  payment_overdue: { id: 'payment_overdue', title: '💳 카드사 입금 지연', repeatDays: 1, maxItems: 10 },
  // 미수는 하루 만에 안 바뀌므로 주 1회.
  settlement_unpaid: { id: 'settlement_unpaid', title: '💰 정산 미완 (미수/과수납)', repeatDays: 7, maxItems: 10 },
  // 행사 준비 착수 신호 — 행사당 한 번이면 충분.
  event_d7: { id: 'event_d7', title: '📅 D-7 행사 준비 시작', repeatDays: 30, maxItems: 10 },
  // 입력 누락 — 주 1회 상기.
  revenue_missing: { id: 'revenue_missing', title: '📝 종료 행사 매출 미입력', repeatDays: 7, maxItems: 10 },
};

export interface AlertItem {
  rule: RuleId;
  targetId: string;
  line: string; // Slack mrkdwn 한 줄
}

export interface AlertGroup {
  rule: RuleId;
  title: string;
  items: AlertItem[];
}

// ── 규칙별 항목 생성 ────────────────────────────────────────────────────────
export function collectAlerts(): AlertGroup[] {
  const groups: AlertGroup[] = [];

  // 1) 협업요청 회신 대기 — 기한 지난 것만 (아직 여유 있으면 소음)
  const collabs = pendingCollaborations().filter((c) => c.hours_overdue > 0);
  if (collabs.length) {
    groups.push({
      rule: 'collab_pending',
      title: RULES.collab_pending.title,
      items: collabs.map((c) => ({
        rule: 'collab_pending' as const,
        targetId: c.id,
        line:
          `• *${c.customer_event_name}* — ${c.stage} · ${c.hours_overdue}시간 초과\n` +
          `   행사일 ${fmtDateW(c.event_date)} · 미회신 ${c.missing_teams.join('/') || '없음'} · 작성 ${c.created_by_name}`,
      })),
    });
  }

  // 2) 카드사 입금 지연
  const pays = overduePayments();
  if (pays.length) {
    groups.push({
      rule: 'payment_overdue',
      title: RULES.payment_overdue.title,
      items: pays.map((p) => ({
        rule: 'payment_overdue' as const,
        targetId: `${p.event_id}:${p.paid_at}:${p.amount}`,
        line:
          `• ${eventLink(p.event_id, p.event_name, 'revenue')} — ${won(p.amount)} (${p.card_company})\n` +
          `   결제 ${fmtDateW(p.paid_at)} · 입금예정 ${fmtDateW(p.deposit_deadline)} · *${p.days_overdue}일 지연*`,
      })),
    });
  }

  // 3) 정산 미완 — 결제가 '한 건이라도 등록된' 행사만.
  //    결제 내역이 아예 없는 행사는 미수가 아니라 '결제 미입력'이므로 여기서 알리면
  //    (결제 DB가 비어 있는 동안) 전 행사가 매일 미수로 뜨는 소음이 된다.
  const unsettled = unsettledEvents().filter((u) => u.payment_count > 0);
  if (unsettled.length) {
    groups.push({
      rule: 'settlement_unpaid',
      title: RULES.settlement_unpaid.title,
      items: unsettled.map((u) => ({
        rule: 'settlement_unpaid' as const,
        targetId: u.event_id,
        line:
          `• ${eventLink(u.event_id, u.event_name, 'revenue')} — ${fmtDateW(u.start_datetime)}\n` +
          `   매출 ${won(u.sales_total)} / 결제 ${won(u.payment_total)} · ` +
          (u.diff > 0 ? `*미수 ${won(u.diff)}*` : `*과수납 ${won(-u.diff)}*`),
      })),
    });
  }

  // 4) D-7 행사 — 정확히 7일 뒤인 것만 (매일 7일치를 다 보내면 소음)
  const upcoming = upcomingEvents(7).filter((e) => e.days_until === 7);
  if (upcoming.length) {
    groups.push({
      rule: 'event_d7',
      title: RULES.event_d7.title,
      items: upcoming.map((e) => ({
        rule: 'event_d7' as const,
        targetId: e.event_id,
        line:
          `• ${eventLink(e.event_id, e.event_name)} — ${fmtDateW(e.start_datetime)} · ${e.halls.join('/') || '홀 미지정'}\n` +
          `   ${e.seats != null ? `${e.seats}석 · ` : ''}식음 ${e.food_item_count}건 · ` +
          `협업요청 ${e.has_collaboration ? '있음' : '*없음*'} · 담당 ${e.assigned_manager_name || '-'}`,
      })),
    });
  }

  // 5) 매출 미입력
  const missing = revenueMissingEvents();
  if (missing.length) {
    groups.push({
      rule: 'revenue_missing',
      title: RULES.revenue_missing.title,
      items: missing.map((m) => ({
        rule: 'revenue_missing' as const,
        targetId: m.event_id,
        line:
          `• ${eventLink(m.event_id, m.event_name, 'revenue')} — ${fmtDateW(m.start_datetime)} (${m.days_since}일 경과)` +
          (m.contract_amount ? ` · 계약 ${won(m.contract_amount)}` : ''),
      })),
    });
  }

  return groups;
}

// ── 중복 제거 ───────────────────────────────────────────────────────────────
function dedupKey(rule: RuleId, targetId: string): string {
  return `${rule}:${targetId}`;
}

function recentlySent(rule: RuleId, targetId: string): boolean {
  const repeatDays = RULES[rule].repeatDays;
  if (repeatDays <= 0) return false;
  const log = store.notification_logs.find((l) => l.dedup_key === dedupKey(rule, targetId));
  if (!log) return false;
  const ageDays = (Date.now() - new Date(log.sent_at).getTime()) / 86400000;
  return ageDays < repeatDays;
}

function recordSent(rule: RuleId, targetId: string) {
  const key = dedupKey(rule, targetId);
  const now = new Date().toISOString();
  const existing = store.notification_logs.find((l) => l.dedup_key === key);
  if (existing) {
    existing.sent_at = now;
    persistDoc('notification_logs', existing.id);
    return;
  }
  const row: NotificationLog = {
    id: key,
    dedup_key: key,
    rule,
    target_id: targetId,
    channel: 'slack',
    sent_at: now,
  };
  store.notification_logs.push(row);
  persistDoc('notification_logs', row.id);
}

/** 오래된 발송 이력 정리 — 무한 증가 방지 (90일 초과분 제거) */
function pruneLogs() {
  const cutoff = Date.now() - 90 * 86400000;
  for (let i = store.notification_logs.length - 1; i >= 0; i--) {
    if (new Date(store.notification_logs[i].sent_at).getTime() < cutoff) {
      store.notification_logs.splice(i, 1);
    }
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────────
export interface RunResult {
  as_of: string;
  slack_configured: boolean;
  sent: boolean;
  skipped_reason?: string;
  groups: Array<{ rule: RuleId; title: string; total: number; new: number }>;
  total_new: number;
  text?: string; // dryRun 일 때 미리보기
}

/**
 * @param dryRun true 면 발송하지 않고 내용만 반환 (발송 이력도 남기지 않음)
 * @param force  true 면 중복 제거를 무시하고 전부 포함 (테스트용)
 */
export async function runAlerts(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<RunResult> {
  const { dryRun = false, force = false } = opts;
  const asOf = new Date().toISOString();
  const groups = collectAlerts();

  // 중복 제거 — force 면 전부 통과
  const filtered = groups
    .map((g) => ({
      ...g,
      fresh: force ? g.items : g.items.filter((it) => !recentlySent(it.rule, it.targetId)),
    }))
    .filter((g) => g.fresh.length > 0);

  const summary = filtered.map((g) => ({
    rule: g.rule,
    title: g.title,
    total: g.items.length,
    new: g.fresh.length,
  }));
  const totalNew = filtered.reduce((s, g) => s + g.fresh.length, 0);

  if (totalNew === 0) {
    return {
      as_of: asOf,
      slack_configured: slackConfigured(),
      sent: false,
      skipped_reason: '새로 알릴 건이 없습니다.',
      groups: summary,
      total_new: 0,
    };
  }

  // Slack 메시지 조립 — 규칙별 섹션 하나
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `플렌티 운영 알림 — ${fmtDateW(asOf.slice(0, 10))}`, emoji: true },
    },
  ];
  const textLines: string[] = [];

  for (const g of filtered) {
    const cap = RULES[g.rule].maxItems;
    const shown = g.fresh.slice(0, cap);
    const rest = g.fresh.length - shown.length;
    const body = shown.map((it) => it.line).join('\n') + (rest > 0 ? `\n• _외 ${rest}건_` : '');
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncateForSlack(`*${g.title}* (${g.fresh.length}건)\n${body}`) },
    });
    textLines.push(`${g.title} ${g.fresh.length}건`);
  }

  const text = `플렌티 운영 알림 — ${textLines.join(' · ')}`;

  if (dryRun) {
    return {
      as_of: asOf,
      slack_configured: slackConfigured(),
      sent: false,
      skipped_reason: '미리보기(dryRun) — 발송하지 않았습니다.',
      groups: summary,
      total_new: totalNew,
      text: filtered
        .map((g) => `${g.title} (${g.fresh.length}건)\n${g.fresh.map((i) => i.line).join('\n')}`)
        .join('\n\n'),
    };
  }

  const result = await sendSlack(text, blocks);
  if (!result.ok) {
    return {
      as_of: asOf,
      slack_configured: slackConfigured(),
      sent: false,
      skipped_reason: result.skipped ? 'Slack 웹훅이 설정되지 않았습니다.' : `발송 실패: ${result.error}`,
      groups: summary,
      total_new: totalNew,
    };
  }

  // 발송에 성공한 건만 이력에 남긴다 — 실패 시 다음 실행에서 다시 시도되도록.
  for (const g of filtered) for (const it of g.fresh) recordSent(it.rule, it.targetId);
  pruneLogs();

  return {
    as_of: asOf,
    slack_configured: true,
    sent: true,
    groups: summary,
    total_new: totalNew,
  };
}
