/**
 * 문의↔행사 연결 + 계약금(= 가톨릭대 대관료) 자동 반영. (S2)
 *
 * 플렌티는 **계약금 = 가톨릭대 대관료** 구조다. 입금 상세(입금자명·입금일자·계산서)까지
 * 전부 **고객정보의 문의가 원본**이고, 행사 매출탭의 가톨릭대관료 블록은 읽기 전용 거울이다.
 * (2026-08-22 사장님 확정 — 처음엔 "비어 있을 때만 채움"이었으나, 매출탭 입력을 막으면서
 *  문의 값이 항상 이긴다로 바뀌었다.)
 *
 * 원칙:
 *  - **문의 → 행사 단방향 미러**. 문의에 값이 있으면 행사를 덮어쓴다.
 *  - **빈 값은 밀지 않는다** — 문의에 아직 안 적은 칸 때문에 행사의 옛 기록이 지워지면 안 된다.
 *  - **연결하는 순간 한 번만 역채움** — 행사에 이미 있던 입금 기록을 문의의 빈 칸으로 끌어온다.
 *    (소급 연결 때 옛 데이터가 문의로 올라와, 이후 수정을 문의에서 하게 하는 다리)
 *  - `gateway_fee` 는 admin 전용 매출 필드지만 이 반영은 시스템 동작이라 역할 게이트를 안 탄다.
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

/** 이번에 밀어낼 값들의 지문 — 같으면 재반영(로그 포함)을 건너뛴다 */
function pushFingerprint(inq: MiceInquiry): string {
  return JSON.stringify([
    Number(inq.deposit_amount) || 0,
    inq.deposit_depositor || '',
    inq.deposit_date || (inq.deposit_paid_at || '').slice(0, 10) || '',
    inq.invoice_type || '',
    inq.invoice_issue_status || '',
    inq.tax_invoice_issue_date || '',
  ]);
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
  /** 실제로 값이 바뀐 항목 */
  filled: string[];
  /** 문의가 비어 있어 행사 기존 값을 남겨둔 항목 */
  kept: string[];
}

/**
 * 고객의 문의들을 훑어 조건을 만족하는 건의 계약금·입금 상세를 행사 매출로 미러링한다.
 */
export function pushDepositsForCustomer(customer: MiceCustomer): PushResult[] {
  const results: PushResult[] = [];
  for (const inq of customer.inquiries || []) {
    if (!isPushReady(inq)) continue;
    const fp = pushFingerprint(inq);
    if (inq.revenue_pushed_at && (inq as { revenue_pushed_fp?: string }).revenue_pushed_fp === fp) continue;

    const ev = store.events.find((e) => e.id === inq.linked_event_id);
    if (!ev) continue;

    const amount = Number(inq.deposit_amount);
    const filled: string[] = [];
    const kept: string[] = [];
    const setIf = <T>(label: string, cur: T, next: T | undefined | null, apply: (v: T) => void) => {
      const has = next !== undefined && next !== null && String(next) !== '';
      if (!has) {
        if (cur !== undefined && cur !== null && String(cur) !== '') kept.push(label);
        return;
      }
      if (cur !== next) {
        apply(next as T);
        filled.push(label);
      }
    };

    setIf('가톨릭대관료', ev.gateway_fee ?? null, amount, (v) => { ev.gateway_fee = v; });

    const inv = invoiceOf(ev.id);
    setIf('입금상태', inv.payment_status, '입금완료', (v) => { inv.payment_status = v as Invoice['payment_status']; });
    setIf('입금액', inv.payment_amount ?? null, amount, (v) => { inv.payment_amount = v; });
    setIf('입금자명', inv.depositor_name, inq.deposit_depositor, (v) => { inv.depositor_name = v; });
    setIf('입금일자', inv.payment_date ?? null, inq.deposit_date || (inq.deposit_paid_at || '').slice(0, 10) || null, (v) => { inv.payment_date = v; });
    setIf('계산서발행', inv.invoice_type, inq.invoice_type, (v) => { inv.invoice_type = v as Invoice['invoice_type']; });
    setIf('발행상태', inv.invoice_issue_status, inq.invoice_issue_status, (v) => { inv.invoice_issue_status = v as Invoice['invoice_issue_status']; });
    setIf('세금계산서발행일', inv.tax_invoice_issue_date ?? null, inq.tax_invoice_issue_date, (v) => { inv.tax_invoice_issue_date = v; });

    inq.revenue_pushed_at = new Date().toISOString();
    inq.revenue_pushed_amount = amount;
    (inq as { revenue_pushed_fp?: string }).revenue_pushed_fp = fp;

    if (filled.length) {
      persistDoc('events', ev.id);
      persistDoc('invoices', inv.id);
    }
    results.push({ inquiryId: inq.id, eventId: ev.id, amount, filled, kept });
  }
  return results;
}

/**
 * 연결 시 1회 역채움: 행사에 이미 적혀 있던 입금 기록을 문의의 **빈 칸에만** 끌어온다.
 * 이후의 진실은 문의 쪽이므로, 옛 데이터가 문의로 올라와야 수정을 문의에서 할 수 있다.
 */
function backfillInquiryFromEvent(inq: MiceInquiry, eventId: string): string[] {
  const ev = store.events.find((e) => e.id === eventId);
  if (!ev) return [];
  const inv = store.invoices.find((i) => i.event_id === eventId);
  const pulled: string[] = [];
  const pull = <T>(label: string, cur: T | undefined | null, from: T | undefined | null, apply: (v: T) => void) => {
    const curEmpty = cur === undefined || cur === null || String(cur) === '' || cur === 0;
    const has = from !== undefined && from !== null && String(from) !== '' && from !== 0;
    if (curEmpty && has) {
      apply(from as T);
      pulled.push(label);
    }
  };
  pull('계약금', inq.deposit_amount, ev.gateway_fee ?? inv?.payment_amount, (v) => { inq.deposit_amount = Number(v); });
  pull('입금자명', inq.deposit_depositor, inv?.depositor_name, (v) => { inq.deposit_depositor = String(v); });
  pull('입금일자', inq.deposit_date, inv?.payment_date, (v) => { inq.deposit_date = String(v); });
  pull('계산서발행', inq.invoice_type, inv?.invoice_type, (v) => { inq.invoice_type = String(v); });
  pull('발행상태', inq.invoice_issue_status, inv?.invoice_issue_status, (v) => { inq.invoice_issue_status = String(v); });
  pull('세금계산서발행일', inq.tax_invoice_issue_date, inv?.tax_invoice_issue_date, (v) => { inq.tax_invoice_issue_date = String(v); });
  // 입금완료 기록이 있는데 문의 계약금 체크가 꺼져 있으면 켠다 (사실이 이미 발생했으므로)
  if (!inq.deposit_paid && inv?.payment_status === '입금완료') {
    inq.deposit_paid = true;
    inq.deposit_paid_at = inq.deposit_paid_at || inv.payment_date || new Date().toISOString();
    pulled.push('계약금체크');
  }
  return pulled;
}

/**
 * 문의 ↔ 행사 연결. 행사 쪽 역참조·고객↔행사 링크·역채움까지 한 번에.
 */
export function linkInquiryToEvent(
  customer: MiceCustomer,
  inq: MiceInquiry,
  eventId: string,
  userName: string,
): { ok: true; pulled: string[] } | { ok: false; error: string } {
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

  const pulled = backfillInquiryFromEvent(inq, eventId);

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
  return { ok: true, pulled };
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
  delete (inq as { revenue_pushed_fp?: string }).revenue_pushed_fp;
}
