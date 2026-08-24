// 콜 트래커 공용 조각 — MICE 고객정보 화면이 쓰는 판정들.
//
// 별도 사이트로 굴리던 문의 트래커를 흡수하면서 들어왔다.
// 화면을 따로 만들지 않고 고객정보 안에 접어 넣었기 때문에, 판정은 여기 한 곳에 둔다.
import { todayKst } from './dateFmt';
import { normalizeMiceStatus } from '../types';
import type { MiceCustomer, MiceInquiry, MiceInquiryStatus } from '../types';

/**
 * 상태 탭. '문의' 탭은 상태가 아니라 **팔로업 여부**로 거른다 —
 * 콜백 예정일이 살아 있는 건만. 문의로 그친 건(콜백 완료 ✓ 또는 날짜 없음)은
 * 전체 탭에서만 보인다. "문의 탭 = 지금 굴리고 있는 일감 목록" 이 되게 하려는 것.
 */
export const CALL_TABS: { key: string; label: string; tip: string; match: (q?: MiceInquiry) => boolean }[] = [
  { key: 'all', label: '전체', tip: '모든 고객', match: () => true },
  {
    key: 'inq',
    label: '문의',
    tip: '팔로업 중인 건만 — 콜백 예정일이 살아 있는 문의. 끝난 건은 콜백 ✓ 로 닫으면 여기서 빠집니다.',
    match: (q) =>
      !!q && normalizeMiceStatus(q.progress_status) === '문의' && needsCall(callbackView(q).state),
  },
  {
    key: 'deposit',
    label: '입금확인중',
    tip: '계약서 날인 완료 · 계약금 입금 확인 대기',
    match: (q) => !!q && normalizeMiceStatus(q.progress_status) === '입금확인중',
  },
  { key: 'def', label: '확정', tip: '확정(DEF)', match: (q) => !!q && normalizeMiceStatus(q.progress_status) === 'DEF' },
  { key: 'los', label: '취소', tip: '취소(LOS)', match: (q) => !!q && normalizeMiceStatus(q.progress_status) === 'LOS' },
];

export const CALL_CHECKS: { key: keyof MiceInquiry; label: string }[] = [
  { key: 'quote_sent', label: '견적서' },
  { key: 'contract_sent', label: '계약서' },
  { key: 'contract_replied', label: '회신됨' },
  { key: 'deposit_paid', label: '계약금' },
];

/**
 * 고객정보 표에 대표로 세울 문의 한 건 = **편집 창의 마지막 문의 (#N)**.
 *
 * 표는 고객당 한 줄이고, 지난 문의들은 행을 눌러 편집 창에서 이력으로 본다.
 * 기준을 '통화일이 가장 늦은 건' 으로 잰 적이 있는데, 확정 건의 통화일이 취소 건보다
 * 늦은 고객에서 **화면의 마지막 칸(취소)과 탭 분류(확정)가 서로 어긋났다**.
 * 사용자가 "가장 최근 문의" 라고 읽는 건 편집 창의 마지막 칸이므로 그걸 기준으로 한다 —
 * 날짜로 추정하지 않아야 배지·탭·체크가 전부 같은 문의를 가리킨다.
 */
export function trackedInquiryOf(c: MiceCustomer): MiceInquiry | undefined {
  const list = c.inquiries || [];
  return list.length ? list[list.length - 1] : undefined;
}

/**
 * 콜백 기준일 = callback_due 한 칸.
 * 옛 '재통화 예정일'(callback_at)이 아직 남아 있는 문서가 있어 그쪽을 먼저 본다 —
 * 저장이 한 번 일어나면 callback_due 로 흡수되고 비워진다.
 */
export function callbackDateOf(q?: MiceInquiry): string {
  if (!q) return '';
  return q.callback_at || q.callback_due || '';
}

/** 남은 일수. 음수면 지났다. 날짜가 없으면 null. */
export function daysLeft(due?: string | null): number | null {
  if (!due) return null;
  const t = new Date(`${todayKst()}T00:00:00`).getTime();
  const d = new Date(`${due}T00:00:00`).getTime();
  if (isNaN(d)) return null;
  return Math.round((d - t) / 86400000);
}

/** 아직 굴러가는 건인지 — 확정·취소는 콜백 대상이 아니다 */
export function isOpenStatus(s?: MiceInquiryStatus): boolean {
  return s !== 'DEF' && s !== 'LOS';
}

/**
 * 콜백 한 건의 현재 상태.
 *
 * 날짜만 보고 '지났다' 고 하면 안 된다. 마지막 통화까지 끝내고 확정으로 넘어간 건들이
 * 옛날 기한을 그대로 달고 있어서, 전화해야 할 것처럼 빨갛게 보이는 문제가 있었다.
 *  - closed : 확정(DEF)·취소(LOS) 로 끝난 건 — 날짜가 지났어도 전화할 일 없음
 *  - done   : 진행 중이지만 사람이 "더 이상 콜백 안 함" 으로 닫은 건
 * 이 둘을 먼저 걸러낸 다음에야 D-day 를 따진다.
 */
export type CallbackState = 'none' | 'closed' | 'done' | 'overdue' | 'today' | 'soon' | 'later';

export interface CallbackView {
  state: CallbackState;
  /** 기준 날짜 (없으면 '') */
  due: string;
  /** 남은 일수. 음수면 지났다. */
  days: number | null;
  label: string;
  cls: string;
}

const NO_CALLBACK: CallbackView = { state: 'none', due: '', days: null, label: '–', cls: 'text-gray-300' };

export function callbackView(q?: MiceInquiry): CallbackView {
  if (!q) return NO_CALLBACK;
  const due = callbackDateOf(q);
  if (q.callback_done_at) {
    return { state: 'done', due, days: daysLeft(due), label: '완료', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
  }
  if (!due) return NO_CALLBACK;
  if (!isOpenStatus(q.progress_status)) {
    // 확정/취소로 끝난 건 — 남은 날짜는 의미가 없으니 회색으로 눕힌다
    return {
      state: 'closed',
      due,
      days: daysLeft(due),
      label: q.progress_status === 'DEF' ? '확정됨' : '종료',
      cls: 'bg-gray-100 text-gray-400',
    };
  }
  const n = daysLeft(due);
  if (n === null) return NO_CALLBACK;
  if (n < 0) return { state: 'overdue', due, days: n, label: `${-n}일 지남`, cls: 'bg-red-100 text-red-800' };
  if (n === 0) return { state: 'today', due, days: n, label: '오늘', cls: 'bg-red-600 text-white' };
  if (n <= 2) return { state: 'soon', due, days: n, label: `D-${n}`, cls: 'bg-amber-100 text-amber-800' };
  return { state: 'later', due, days: n, label: `D-${n}`, cls: 'bg-gray-100 text-gray-600' };
}

/** 아직 전화해야 하는 건인지 */
export function needsCall(state: CallbackState): boolean {
  return state === 'overdue' || state === 'today' || state === 'soon' || state === 'later';
}

/** 콜백 기한이 지난 고객 수 (배너용) */
export function overdueCount(customers: MiceCustomer[]): number {
  let n = 0;
  for (const c of customers) {
    if (callbackView(trackedInquiryOf(c)).state === 'overdue') n++;
  }
  return n;
}

// ── 홈 대시보드용 ────────────────────────────────────────────────────────
export interface CallbackRow {
  customer: MiceCustomer;
  inquiry: MiceInquiry;
  view: CallbackView;
}

/** 이 문의의 담당자 id — 담당 미지정인 옛 데이터는 작성자로 fallback */
export function inquiryOwnerId(q: MiceInquiry): string {
  return q.assigned_manager_id || q.created_by_id || '';
}

/**
 * 전화해야 할 콜백 목록 — 급한 것부터.
 * 고객당 한 건이 아니라 문의 건별로 뽑는다(한 업체에 여러 건이 굴러갈 수 있다).
 * managerId 를 주면 그 사람 담당만.
 */
export function pendingCallbacks(
  customers: MiceCustomer[],
  opts: { managerId?: string; withinDays?: number } = {}
): CallbackRow[] {
  const rows: CallbackRow[] = [];
  for (const c of customers) {
    if (c.deleted_at) continue;
    for (const q of c.inquiries || []) {
      const view = callbackView(q);
      if (!needsCall(view.state)) continue;
      if (opts.withinDays !== undefined && (view.days ?? 0) > opts.withinDays) continue;
      if (opts.managerId && inquiryOwnerId(q) !== opts.managerId) continue;
      rows.push({ customer: c, inquiry: q, view });
    }
  }
  return rows.sort((a, b) => a.view.due.localeCompare(b.view.due));
}
