/**
 * 문의↔행사 연결 + 계약금(= 가톨릭대 대관료) 자동 반영. (S2)
 *
 * 플렌티는 **계약금 = 가톨릭대 대관료** 구조다. 세일즈는 고객정보(문의)에서 계약금을 관리하고,
 * 확정되는 순간 그 값이 연결된 행사의 매출탭으로 흘러간다.
 *
 * 원칙:
 *  - **문의 → 행사 단방향**. 행사에서 사람이 고친 값을 문의로 되돌리지 않는다(루프·경합 방지).
 *  - **비어 있을 때만 채운다**. 이미 값이 있으면 덮지 않고 그대로 둔다 — 연회팀이 조정한 값을
 *    시스템이 조용히 되돌리는 사고를 막는다. 다름은 화면에서 배지로 알린다.
 *  - `gateway_fee` 는 admin 전용 매출 필드지만, 이 반영은 **시스템 동작**이라 역할 게이트를 타지 않는다.
 *    세일즈가 매출 권한 없이도 결과가 채워지는 것이 이 기능의 값.
 */
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import type { Invoice, MiceCustomer, MiceInquiry } from '../types.js';

/** 반영 대상인지 — 링크·확정·계약금 체크·금액이 모두 갖춰졌을 때만 */
export function isPushReady(inq: MiceInquiry): boolean {
  return (
    !!inq.linked_event_id &&
    inq.progress_status === 'DEF' &&
    !!inq.deposit_paid &&
    Number(inq.deposit_amount) > 0
  );
}

function invoiceOf(eventId: string): Invoice {
  let row = store.invoices.find((i) => i.event_id === eventId);
  if (!row) {
    row = {
      id: nanoid(10),
      event_id: eventId,
      payment_status: '',
      invoice_type: '',
      invoice_issue_status: '',
      payment_amount: null,
      payment_date: null,
      tax_invoice_issue_date: null,
      depositor_name: '',
    };
    store.invoices.push(row);
  }
  return row;
}

export interface PushResult {
  inquiryId: string;
  eventId: string;
  amount: number;
  /** 실제로 채운 항목 — 비어 있던 칸만 */
  filled: string[];
  /** 이미 다른 값이 있어 건드리지 않은 항목 */
  kept: string[];
}

/**
 * 고객의 문의들을 훑어 조건을 만족하는 건의 계약금을 행사 매출로 반영한다.
 * 문의 객체(스탬프)는 제자리에서 갱신하고, 반영 결과를 돌려준다(변경 로그용).
 */
export function pushDepositsForCustomer(customer: MiceCustomer): PushResult[] {
  const results: PushResult[] = [];
  for (const inq of customer.inquiries || []) {
    if (!isPushReady(inq)) continue;
    const amount = Number(inq.deposit_amount);
    // 같은 금액을 이미 반영했으면 다시 쓰지 않는다 (저장마다 로그가 쌓이는 것 방지)
    if (inq.revenue_pushed_at && inq.revenue_pushed_amount === amount) continue;

    const ev = store.events.find((e) => e.id === inq.linked_event_id);
    if (!ev) continue;

    const filled: string[] = [];
    const kept: string[] = [];

    // 대관료 — 비어 있을 때만
    if (ev.gateway_fee == null || Number(ev.gateway_fee) === 0) {
      ev.gateway_fee = amount;
      filled.push('가톨릭대관료');
    } else if (Number(ev.gateway_fee) !== amount) {
      kept.push(`가톨릭대관료(기존 ${Number(ev.gateway_fee).toLocaleString()})`);
    }

    // 입금 블록 — 비어 있는 칸만. 입금자명은 자동으로 알 수 없어 사람 몫으로 둔다.
    const inv = invoiceOf(ev.id);
    if (!inv.payment_status) {
      inv.payment_status = '입금완료';
      filled.push('입금상태');
    } else if (inv.payment_status !== '입금완료') {
      kept.push(`입금상태(${inv.payment_status})`);
    }
    if (inv.payment_amount == null || Number(inv.payment_amount) === 0) {
      inv.payment_amount = amount;
      filled.push('입금액');
    } else if (Number(inv.payment_amount) !== amount) {
      kept.push(`입금액(기존 ${Number(inv.payment_amount).toLocaleString()})`);
    }
    const paidDate = (inq.deposit_paid_at || '').slice(0, 10);
    if (!inv.payment_date && paidDate) {
      inv.payment_date = paidDate;
      filled.push('입금일자');
    }

    inq.revenue_pushed_at = new Date().toISOString();
    inq.revenue_pushed_amount = amount;

    if (filled.length) {
      persistDoc('events', ev.id);
      persistDoc('invoices', inv.id);
    }
    results.push({ inquiryId: inq.id, eventId: ev.id, amount, filled, kept });
  }
  return results;
}

/**
 * 문의 ↔ 행사 연결. 행사 쪽 역참조와 고객↔행사 링크(EventCustomerLink)까지 한 번에 맞춘다.
 * 고객링크를 함께 만드는 이유: MICE 행사 620건 중 고객 연결이 176건뿐이었고(28%),
 * 이 동선이 그 커버리지를 자연히 메운다.
 */
export function linkInquiryToEvent(
  customer: MiceCustomer,
  inq: MiceInquiry,
  eventId: string,
  userName: string,
): { ok: true } | { ok: false; error: string } {
  const ev = store.events.find((e) => e.id === eventId);
  if (!ev) return { ok: false, error: '행사를 찾을 수 없습니다.' };
  if (ev.event_type !== 'MICE') return { ok: false, error: 'MICE 행사만 연결할 수 있습니다.' };

  // 다른 문의가 이미 이 행사를 물고 있으면 막는다 — 한 행사에 두 계약금이 흘러들면 매출이 꼬인다.
  for (const c of store.mice_customers) {
    for (const q of c.inquiries || []) {
      if (q.linked_event_id === eventId && q.id !== inq.id) {
        return { ok: false, error: `이미 다른 문의(${c.organization_name})에 연결된 행사입니다.` };
      }
    }
  }

  inq.linked_event_id = eventId;
  inq.linked_at = new Date().toISOString();
  inq.linked_by_name = userName;
  ev.source_customer_id = customer.id;
  ev.source_inquiry_id = inq.id;

  // 고객↔행사 링크 자동 생성 (없을 때만)
  const exists = store.event_customers.some(
    (l) => l.event_id === eventId && l.customer_id === customer.id,
  );
  if (!exists) {
    store.event_customers.push({
      id: nanoid(10),
      event_id: eventId,
      customer_id: customer.id,
      customer_role: '주최사',
      is_contact_point: true,
      contact_point_contact_id: inq.contacts?.[0]?.id || '',
    });
    persistDoc('event_customers', store.event_customers[store.event_customers.length - 1].id);
  }
  persistDoc('events', ev.id);
  return { ok: true };
}

/** 연결 해제 — 이미 반영된 매출 값은 건드리지 않는다(회계 기록을 임의로 비우지 않는다). */
export function unlinkInquiry(inq: MiceInquiry): void {
  const ev = inq.linked_event_id
    ? store.events.find((e) => e.id === inq.linked_event_id)
    : undefined;
  if (ev && ev.source_inquiry_id === inq.id) {
    ev.source_inquiry_id = null;
    ev.source_customer_id = null;
    persistDoc('events', ev.id);
  }
  inq.linked_event_id = null;
  inq.linked_at = null;
  inq.revenue_pushed_at = null;
  inq.revenue_pushed_amount = null;
}
