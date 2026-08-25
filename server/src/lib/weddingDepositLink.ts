/**
 * 웨딩 계약금(= 가톨릭대 대관료, 154만원 정액) 미러 + 입금 확인 시 DEF 자동 전환. (W1)
 *
 * MICE 와 같은 원칙이되, 웨딩의 구조 차이를 반영한다:
 *  - MICE 는 진행상황이 **문의 단위**, 웨딩은 **고객 단위**다. 계약금은 어느 날짜로 잡았나이므로
 *    예식 후보(event_inquiry) 에 붙이고, 진행단계는 고객에 둔다.
 *  - MICE 는 문의↔행사 매칭이 큰 일이었지만, 웨딩은 이미 event_customers 로 연결돼 있다
 *    (INQ 4/4 · DEF 151/154). 그래서 후보 날짜로 자동 매칭하고, 안 맞을 때만 사람이 고른다.
 *
 * 원칙 (MICE 와 동일):
 *  - 고객정보(예식 후보)가 원본, 행사 매출탭은 읽기 전용 거울. 값이 있으면 덮어쓴다.
 *  - **빈 값은 밀지 않는다** — 아직 안 적은 칸 때문에 행사의 옛 기록이 지워지면 안 된다.
 *  - 연결되는 순간 1회 역채움 — 행사에 이미 있던 대관료·입금 기록을 후보의 빈 칸으로 끌어온다.
 *  - 입금 확인(deposit_paid)이 켜지면 **고객 진행단계 → DEF, 연결 행사 상태 → DEF**.
 *    (행사가 DEF 여야 고객 랜딩이 계약완료 감사 화면으로 바뀌고 캘린더도 확정으로 보인다)
 */
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import type { Event, Invoice, WeddingCustomer, WeddingEventInquiry } from '../types.js';

/** 웨딩 가톨릭대 대관료 정액 — 운영 34건이 전부 이 값이라 입력 기본값으로 제안한다. */
export const WEDDING_GATEWAY_FEE = 1_540_000;

/** 이 고객에 연결된 웨딩 행사들 (휴지통 제외) */
function linkedEventsOf(customerId: string): Event[] {
  const ids = new Set(
    store.event_customers.filter((l) => l.customer_id === customerId).map((l) => l.event_id)
  );
  return store.events.filter((e) => ids.has(e.id) && !e.deleted_at && e.event_type === 'WEDDING');
}

/**
 * 후보 → 미러 대상 행사 찾기.
 * ① 이미 지정된 linked_event_id ② 후보 날짜와 같은 날 행사 ③ 연결 행사가 하나뿐이면 그것.
 * 셋 다 아니면 null (화면에서 사람이 고른다). 운영 기준 165개 중 156개가 이걸로 해결된다.
 */
export function resolveCandidateEvent(
  customer: WeddingCustomer,
  inq: WeddingEventInquiry
): Event | null {
  const evs = linkedEventsOf(customer.id);
  if (inq.linked_event_id) {
    const pinned = evs.find((e) => e.id === inq.linked_event_id);
    if (pinned) return pinned;
  }
  const day = (inq.wedding_datetime || '').slice(0, 10);
  if (day) {
    const sameDay = evs.filter((e) => (e.start_datetime || '').slice(0, 10) === day);
    if (sameDay.length === 1) return sameDay[0];
    if (sameDay.length > 1) return null; // 같은 날 여러 건 — 모호하므로 사람이 고른다
  }
  return evs.length === 1 ? evs[0] : null;
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

/** 이번에 밀어낼 값들의 지문 — 같으면 재반영(로그 포함)을 건너뛴다 */
function fingerprint(inq: WeddingEventInquiry): string {
  return JSON.stringify([
    Number(inq.deposit_amount) || 0,
    inq.deposit_depositor || '',
    inq.deposit_date || (inq.deposit_paid_at || '').slice(0, 10) || '',
    inq.invoice_type || '',
    inq.invoice_issue_status || '',
  ]);
}

export interface WeddingPushResult {
  inquiryId: string;
  eventId: string;
  eventName: string;
  amount: number;
  /** 실제로 값이 바뀐 항목 */
  filled: string[];
  /** 후보가 비어 있어 행사 기존 값을 남겨둔 항목 */
  kept: string[];
  /** 이번에 DEF 로 올라간 것 — 화면 안내·변경이력용 */
  promoted: { customer: boolean; event: boolean };
}

/**
 * 고객의 예식 후보들을 훑어 계약금·입금 상세를 행사로 미러링하고,
 * 입금이 확인된 건은 고객·행사를 DEF 로 승격한다.
 */
export function pushWeddingDeposits(customer: WeddingCustomer): WeddingPushResult[] {
  const results: WeddingPushResult[] = [];
  // 후보가 여러 개인데 연결 행사가 하나뿐이면 전부 같은 행사로 해석된다(운영에 실제 사례 있음).
  // 그 상태로 두 후보에 계약금을 넣으면 한 행사에 두 계약금이 흘러들어 매출이 꼬이므로,
  // 한 번의 저장에서 행사 하나당 한 후보만 반영한다.
  const usedEvents = new Set<string>();
  for (const inq of customer.event_inquiries || []) {
    if (!inq.deposit_paid || !(Number(inq.deposit_amount) > 0)) continue;
    const ev = resolveCandidateEvent(customer, inq);
    if (!ev) continue;
    if (usedEvents.has(ev.id)) continue;
    usedEvents.add(ev.id);

    // 대상 행사를 후보에 고정 — 이후 날짜를 손봐도 같은 행사를 계속 본다
    if (inq.linked_event_id !== ev.id) inq.linked_event_id = ev.id;

    const promoted = { customer: false, event: false };
    // 입금이 확인됐다 = 계약이 성사됐다. 고객·행사를 확정으로 올린다.
    if (customer.progress_status !== 'DEF') {
      customer.progress_status = 'DEF';
      promoted.customer = true;
    }
    if (ev.status !== 'DEF') {
      ev.status = 'DEF';
      promoted.event = true;
    }

    const fp = fingerprint(inq);
    if (inq.revenue_pushed_at && inq.revenue_pushed_fp === fp && !promoted.customer && !promoted.event) {
      continue;
    }

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

    setIf('가톨릭대관료', ev.gateway_fee ?? null, amount, (v) => {
      ev.gateway_fee = v;
    });

    const inv = invoiceOf(ev.id);
    setIf('입금상태', inv.payment_status, '입금완료', (v) => {
      inv.payment_status = v as Invoice['payment_status'];
    });
    setIf('입금액', inv.payment_amount ?? null, amount, (v) => {
      inv.payment_amount = v;
    });
    setIf('입금자명', inv.depositor_name, inq.deposit_depositor, (v) => {
      inv.depositor_name = v;
    });
    setIf(
      '입금일자',
      inv.payment_date ?? null,
      inq.deposit_date || (inq.deposit_paid_at || '').slice(0, 10) || null,
      (v) => {
        inv.payment_date = v;
      }
    );
    setIf('계산서발행', inv.invoice_type, inq.invoice_type, (v) => {
      inv.invoice_type = v as Invoice['invoice_type'];
    });
  // 세금계산서 발행일자는 2026-08-25 폐기 — 가톨릭에서 발행해 우리가 확인할 수 없는 값이라
  // 입력칸을 없앴고 미러도 하지 않는다. (남아있는 옛 데이터는 건드리지 않는다)
    setIf('발행상태', inv.invoice_issue_status, inq.invoice_issue_status, (v) => {
      inv.invoice_issue_status = v as Invoice['invoice_issue_status'];
    });

    inq.revenue_pushed_at = new Date().toISOString();
    inq.revenue_pushed_amount = amount;
    inq.revenue_pushed_fp = fp;

    if (filled.length || promoted.event) persistDoc('events', ev.id);
    if (filled.length) persistDoc('invoices', inv.id);
    results.push({
      inquiryId: inq.id,
      eventId: ev.id,
      eventName: ev.event_name || '',
      amount,
      filled,
      kept,
      promoted,
    });
  }
  return results;
}

/**
 * 연결 시 1회 역채움: 행사에 이미 적혀 있던 대관료·입금 기록을 후보의 **빈 칸에만** 끌어온다.
 * 운영 웨딩 행사 34건이 이미 대관료 154만원을 들고 있어, 이 다리가 있어야
 * 기존 DEF 고객도 고객정보에서 계약금이 보인다.
 */
export function backfillCandidateFromEvent(inq: WeddingEventInquiry, eventId: string): string[] {
  const ev = store.events.find((e) => e.id === eventId);
  if (!ev) return [];
  const inv = store.invoices.find((i) => i.event_id === eventId);
  const pulled: string[] = [];
  const pull = <T>(
    label: string,
    cur: T | undefined | null,
    from: T | undefined | null,
    apply: (v: T) => void
  ) => {
    const curEmpty = cur === undefined || cur === null || String(cur) === '' || cur === 0;
    const has = from !== undefined && from !== null && String(from) !== '' && from !== 0;
    if (curEmpty && has) {
      apply(from as T);
      pulled.push(label);
    }
  };
  pull('계약금', inq.deposit_amount, ev.gateway_fee ?? inv?.payment_amount, (v) => {
    inq.deposit_amount = Number(v);
  });
  pull('입금자명', inq.deposit_depositor, inv?.depositor_name, (v) => {
    inq.deposit_depositor = String(v);
  });
  pull('입금일자', inq.deposit_date, inv?.payment_date, (v) => {
    inq.deposit_date = String(v);
  });
  pull('계산서발행', inq.invoice_type, inv?.invoice_type, (v) => {
    inq.invoice_type = String(v);
  });
  pull('발행상태', inq.invoice_issue_status, inv?.invoice_issue_status, (v) => {
    inq.invoice_issue_status = String(v);
  });
  // 입금완료 기록이 있는데 후보 체크가 꺼져 있으면 켠다 (사실이 이미 발생했으므로)
  if (!inq.deposit_paid && inv?.payment_status === '입금완료') {
    inq.deposit_paid = true;
    inq.deposit_paid_at = inq.deposit_paid_at || inv.payment_date || new Date().toISOString();
    pulled.push('입금확인');
  }
  return pulled;
}
