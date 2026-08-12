// 콜 트래커 공용 조각 — MICE 고객정보 화면이 쓰는 판정들.
//
// 별도 사이트로 굴리던 문의 트래커를 흡수하면서 들어왔다.
// 화면을 따로 만들지 않고 고객정보 안에 접어 넣었기 때문에, 판정은 여기 한 곳에 둔다.
import { todayKst } from './dateFmt';
import type { MiceCustomer, MiceInquiry, MiceInquiryStatus } from '../types';

/** 탭 ↔ 진행상황. 트래커의 '문의' 는 우리 INQ 가 아니라 '단순문의' 다 — 글자만 보고 옮기면 안 된다. */
export const CALL_TABS: { key: string; label: string; status: MiceInquiryStatus | null }[] = [
  { key: 'all', label: '전체', status: null },
  { key: 'inq', label: '문의', status: '단순문의' },
  { key: 'hold', label: '보류 콜 예정', status: 'INQ' },
  { key: 'def', label: '확정', status: 'DEF' },
  { key: 'los', label: '취소', status: 'LOS' },
];

export const CALL_CHECKS: { key: keyof MiceInquiry; label: string }[] = [
  { key: 'quote_sent', label: '견적서' },
  { key: 'contract_sent', label: '계약서' },
  { key: 'contract_replied', label: '회신됨' },
  { key: 'deposit_paid', label: '계약금' },
];

/**
 * 이 고객에서 '지금 굴리고 있는' 문의 한 건.
 * 고객정보 표는 고객당 한 줄이라, 콜백·체크를 어느 문의 기준으로 보여줄지 정해야 한다.
 * 콜백 날짜가 잡힌 문의를 우선하고(그게 트래커로 관리 중인 건), 없으면 가장 최근 문의.
 */
export function trackedInquiryOf(c: MiceCustomer): MiceInquiry | undefined {
  const list = c.inquiries || [];
  if (!list.length) return undefined;
  const tracked = list.filter((q) => q.callback_due || q.callback_at);
  if (tracked.length) {
    return [...tracked].sort((a, b) =>
      (a.callback_at || a.callback_due || '').localeCompare(b.callback_at || b.callback_due || '')
    )[0];
  }
  return list[list.length - 1];
}

/** 콜백 기준일 — 보류면 재통화 예정일, 아니면 기한 */
export function callbackDateOf(q?: MiceInquiry): string {
  if (!q) return '';
  return (q.progress_status === 'INQ' ? q.callback_at || q.callback_due : q.callback_due) || '';
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
  return s === '단순문의' || s === 'INQ';
}

/** 콜백 기한이 지난 고객 수 (배너용) */
export function overdueCount(customers: MiceCustomer[]): number {
  let n = 0;
  for (const c of customers) {
    const q = trackedInquiryOf(c);
    if (!q || !isOpenStatus(q.progress_status)) continue;
    const d = daysLeft(callbackDateOf(q));
    if (d !== null && d < 0) n++;
  }
  return n;
}
