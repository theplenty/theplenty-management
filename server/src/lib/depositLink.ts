/**
 * 문의↔행사 연결 + 계약금(= 가톨릭대 대관료) 자동 반영. (S2)
 *
 * 연결과 계약금은 별개다 (2026-08-26 확정):
 *  - **연결은 여러 문의가 가능** — 한 행사에 주최사·대행사 등 컨택포인트가 여럿이라
 *    각자의 문의가 같은 행사를 물 수 있다 (예: 종근당 웹세미나 ← 종근당 + 인터엠디).
 *  - **계약금 원본은 행사당 문의 하나** — 행사의 source_inquiry_id 가 그 자리다.
 *    처음 연결한 문의가 원본이 되고, 나머지는 '참조 연결'(매출 반영 없음)이다.
 *    참조 문의에 계약금을 적어도 밀리지 않고 skipped 로 이유를 알려준다.
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

/** 계약금 반영이 건너뛰어진 문의 — 왜 안 밀렸는지 화면에 알려주기 위한 것 */
export interface PushSkipped {
  inquiryId: string;
  eventId: string;
  /** 계약금 원본을 쥔 업체·문의 */
  owner_org: string;
  owner_inquiry_no: number;
}

/** 행사의 계약금 원본 문의를 찾는다 (source_inquiry_id 기준) */
function depositOwnerOf(eventId: string): { customer: MiceCustomer; inq: MiceInquiry; no: number } | null {
  const ev = store.events.find((e) => e.id === eventId);
  if (!ev?.source_inquiry_id || !ev.source_customer_id) return null;
  const c = store.mice_customers.find((x) => x.id === ev.source_customer_id);
  const idx = (c?.inquiries || []).findIndex((q) => q.id === ev.source_inquiry_id);
  if (!c || idx < 0) return null;
  return { customer: c, inq: c.inquiries[idx], no: idx + 1 };
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
export function pushDepositsForCustomer(customer: MiceCustomer): { results: PushResult[]; skipped: PushSkipped[] } {
  const results: PushResult[] = [];
  const skipped: PushSkipped[] = [];
  for (const inq of customer.inquiries || []) {
    if (!isPushReady(inq)) continue;

    const ev = store.events.find((e) => e.id === inq.linked_event_id);
    if (!ev) continue;

    // 참조 연결(계약금 원본이 다른 문의)이면 매출로 밀지 않는다 — 한 행사에 두 계약금 금지
    if (ev.source_inquiry_id && ev.source_inquiry_id !== inq.id) {
      const owner = depositOwnerOf(ev.id);
      skipped.push({
        inquiryId: inq.id,
        eventId: ev.id,
        owner_org: owner?.customer.organization_name || '(다른 업체)',
        owner_inquiry_no: owner?.no || 0,
      });
      continue;
    }
    // 원본이 비어 있으면(옛 데이터) 이 문의가 원본이 된다
    if (!ev.source_inquiry_id) {
      ev.source_inquiry_id = inq.id;
      ev.source_customer_id = customer.id;
    }

    const fp = pushFingerprint(inq);
    if (inq.revenue_pushed_at && (inq as { revenue_pushed_fp?: string }).revenue_pushed_fp === fp) continue;

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
  // 세금계산서 발행일자는 2026-08-25 폐기 — 가톨릭에서 발행해 우리가 확인할 수 없는 값이라
  // 입력칸을 없앴고 미러도 하지 않는다. (남아있는 옛 데이터는 건드리지 않는다)
    setIf('발행상태', inv.invoice_issue_status, inq.invoice_issue_status, (v) => { inv.invoice_issue_status = v as Invoice['invoice_issue_status']; });

    inq.revenue_pushed_at = new Date().toISOString();
    inq.revenue_pushed_amount = amount;
    (inq as { revenue_pushed_fp?: string }).revenue_pushed_fp = fp;

    if (filled.length) {
      persistDoc('events', ev.id);
      persistDoc('invoices', inv.id);
    }
    results.push({ inquiryId: inq.id, eventId: ev.id, amount, filled, kept });
  }
  return { results, skipped };
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
):
  | { ok: true; pulled: string[]; role: 'primary' | 'secondary'; owner_org?: string; owner_inquiry_no?: number }
  | { ok: false; error: string } {
  const ev = store.events.find((e) => e.id === eventId);
  if (!ev) return { ok: false, error: '행사를 찾을 수 없습니다.' };
  if (ev.event_type !== 'MICE') return { ok: false, error: 'MICE 행사만 연결할 수 있습니다.' };

  // 같은 업체의 다른 문의가 이미 물고 있으면 막는다 — 한 업체의 한 딜은 문의 하나로 관리한다.
  // (다른 업체의 문의는 허용 — 주최사·대행사가 같은 행사에 각자 연결되는 게 실무다)
  for (const q of customer.inquiries || []) {
    if (q.linked_event_id === eventId && q.id !== inq.id) {
      return { ok: false, error: '이 업체의 다른 문의가 이미 이 행사에 연결되어 있습니다.' };
    }
  }

  // 계약금 원본(source_inquiry_id)은 행사당 하나 — 비어 있으면 이 문의가 원본이 되고,
  // 이미 다른 문의가 쥐고 있으면 이 연결은 '참조'다 (매출 반영 없음, 역채움 없음).
  const owner = depositOwnerOf(eventId);
  const isPrimary = !owner || owner.inq.id === inq.id;

  inq.linked_event_id = eventId;
  inq.linked_at = new Date().toISOString();
  inq.linked_by_name = userName;

  let pulled: string[] = [];
  if (isPrimary) {
    ev.source_customer_id = customer.id;
    ev.source_inquiry_id = inq.id;
    pulled = backfillInquiryFromEvent(inq, eventId);
  }

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
  return isPrimary
    ? { ok: true, pulled, role: 'primary' }
    : {
        ok: true,
        pulled,
        role: 'secondary',
        owner_org: owner!.customer.organization_name,
        owner_inquiry_no: owner!.no,
      };
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
