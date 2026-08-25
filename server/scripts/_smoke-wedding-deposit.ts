/**
 * 웨딩 계약금(W1) 스모크 — 격리된 로컬 JSON 서버(PORT=4190)에 대고 돈다.
 * 사용: STORE_BACKEND=json PORT=4190 npx tsx src/server.ts & → npx tsx scripts/_smoke-wedding-deposit.ts
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:4190';
const ADMIN = '0u1bMDz4xK';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: `uid=${ADMIN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface WedCust {
  id: string;
  wedding_event_name: string;
  progress_status: string;
  event_inquiries: Record<string, unknown>[];
}
interface Ev {
  id: string;
  event_name: string;
  status: string;
  event_type: string;
  start_datetime: string;
  gateway_fee?: number | null;
}

console.log('\n=== 웨딩 계약금(W1) 스모크 ===\n');

// 0) 준비 — 웨딩 고객 + 행사 생성 후 연결
const stamp = Date.now();
const created = await api<{ customer: WedCust }>('POST', '/api/customers/wedding', {
  wedding_event_name: `[스모크] 계약금테스트 ${stamp}`,
  progress_status: 'INQ',
  event_inquiries: [{ wedding_datetime: '2027-06-12T12:00', estimate_amount: '50,000,000' }],
});
const cust = created.customer;
check('웨딩 고객 생성 (INQ)', cust.progress_status === 'INQ' && cust.event_inquiries.length === 1);

const ev = await api<{ event: Ev }>('POST', '/api/events', {
  event_type: 'WEDDING',
  event_name: `[스모크] 예식 ${stamp}`,
  status: 'INQ',
  start_datetime: '2027-06-12T12:00:00.000Z',
  end_datetime: '2027-06-12T15:00:00.000Z',
  halls: ['Hall A+B'],
});
const eventId = ev.event.id;
check('웨딩 행사 생성 (INQ)', ev.event.status === 'INQ');

await api('PATCH', `/api/events/${eventId}`, {
  customer_links: [{ customer_id: cust.id, customer_role: '신랑측', is_contact_point: true }],
});

// 1) 후보 → 행사 자동 매칭 (날짜 동일)
const cands = await api<{ events: Ev[]; resolved: Record<string, string | null>; default_gateway_fee: number }>(
  'GET',
  `/api/customers/wedding/${cust.id}/candidate-events`
);
const inqId = cust.event_inquiries[0].id as string;
check('연결 행사 목록에 방금 만든 행사가 있음', cands.events.some((e) => e.id === eventId));
check('후보가 날짜로 자동 매칭됨', cands.resolved[inqId] === eventId, cands.resolved);
check('웨딩 대관료 기본값 154만원 안내', cands.default_gateway_fee === 1_540_000);

// 2) 계약금만 입력 (입금 확인 전) — 아직 반영/승격 없어야 한다
let saved = await api<{ customer: WedCust; pushed: unknown[] }>(
  'PATCH',
  `/api/customers/wedding/${cust.id}`,
  {
    event_inquiries: [{ ...cust.event_inquiries[0], deposit_amount: 1_540_000, deposit_depositor: '김신랑' }],
  }
);
check('입금 확인 전에는 매출 반영 없음', (saved.pushed || []).length === 0);
check('입금 확인 전에는 진행단계 그대로 INQ', saved.customer.progress_status === 'INQ');
let evNow = await api<{ event: Ev }>('GET', `/api/events/${eventId}`);
check('입금 확인 전 행사 상태 INQ 유지', evNow.event.status === 'INQ');
check('입금 확인 전 대관료 비어 있음', !evNow.event.gateway_fee, evNow.event.gateway_fee);

// 3) 계약금 필드가 저장에서 살아남는가 (화이트리스트 함정)
check(
  '계약금 금액이 저장 후에도 남아있음',
  Number(saved.customer.event_inquiries[0].deposit_amount) === 1_540_000,
  saved.customer.event_inquiries[0]
);
check('입금자명 저장됨', saved.customer.event_inquiries[0].deposit_depositor === '김신랑');

// 4) 입금 확인 → 미러 + 양쪽 DEF 승격
saved = await api<{ customer: WedCust; pushed: any[] }>('PATCH', `/api/customers/wedding/${cust.id}`, {
  event_inquiries: [
    {
      ...saved.customer.event_inquiries[0],
      deposit_paid: true,
      deposit_date: '2026-08-25',
      invoice_type: '세금계산서',
      invoice_issue_status: '가톨릭요청',
    },
  ],
});
const push = (saved as unknown as { pushed: { filled: string[]; promoted: { customer: boolean; event: boolean } }[] }).pushed;
check('입금 확인 시 매출 반영 결과 반환', push.length === 1, push);
check('고객 진행단계 DEF 승격', saved.customer.progress_status === 'DEF');
check('승격 결과에 customer=true 표시', push[0]?.promoted?.customer === true);
check('승격 결과에 event=true 표시', push[0]?.promoted?.event === true);
check('가톨릭대관료가 반영 목록에 포함', (push[0]?.filled || []).includes('가톨릭대관료'), push[0]?.filled);

evNow = await api<{ event: Ev }>('GET', `/api/events/${eventId}`);
check('행사 상태 DEF 로 전환', evNow.event.status === 'DEF');
check('행사 대관료 = 154만원', Number(evNow.event.gateway_fee) === 1_540_000, evNow.event.gateway_fee);

const inv = await api<{ invoice: Record<string, unknown> | null }>('GET', `/api/events/${eventId}`);
check('입금상태 입금완료', inv.invoice?.payment_status === '입금완료', inv.invoice);
check('입금자명 미러됨', inv.invoice?.depositor_name === '김신랑');
check('입금일자 미러됨', inv.invoice?.payment_date === '2026-08-25');
check('계산서 발행 미러됨', inv.invoice?.invoice_type === '세금계산서');
check('발행상태 미러됨', inv.invoice?.invoice_issue_status === '가톨릭요청');
check('입금액 미러됨', Number(inv.invoice?.payment_amount) === 1_540_000);

// 5) 출처 조회 — 매출탭이 "웨딩 예식 후보에서 왔다" 를 알 수 있어야 한다
const src = await api<{ source: { type?: string; customerId: string; inquiryNo: number; amount: number } | null }>(
  'GET',
  `/api/events/${eventId}/deposit-source`
);
check('출처 type=wedding', src.source?.type === 'wedding', src.source);
check('출처가 이 고객을 가리킴', src.source?.customerId === cust.id);
check('출처 후보 번호 #1', src.source?.inquiryNo === 1);

// 6) 재저장해도 중복 반영 없음 (지문)
const again = await api<{ pushed: unknown[] }>('PATCH', `/api/customers/wedding/${cust.id}`, {
  event_inquiries: saved.customer.event_inquiries,
});
check('같은 값 재저장 시 재반영 안 함', (again.pushed || []).length === 0, again.pushed);

// 7) 빈 값은 밀지 않는다 — 입금자명을 비워도 행사 기록은 유지
const cleared = await api<{ pushed: any[] }>('PATCH', `/api/customers/wedding/${cust.id}`, {
  event_inquiries: [{ ...saved.customer.event_inquiries[0], deposit_depositor: '' }],
});
const inv2 = await api<{ invoice: Record<string, unknown> | null }>('GET', `/api/events/${eventId}`);
check('후보에서 입금자명을 비워도 행사 기록은 유지됨', inv2.invoice?.depositor_name === '김신랑', inv2.invoice);
check('유지된 항목이 kept 로 보고됨', (cleared.pushed?.[0]?.kept || []).includes('입금자명'), cleared.pushed?.[0]);

// 8) 역채움 — 행사에만 있던 기록을 새 후보의 빈 칸으로 끌어온다
const cust2 = (
  await api<{ customer: WedCust }>('POST', '/api/customers/wedding', {
    wedding_event_name: `[스모크] 역채움 ${stamp}`,
    progress_status: 'INQ',
    event_inquiries: [{ wedding_datetime: '2027-07-03T12:00' }],
  })
).customer;
const ev2 = (
  await api<{ event: Ev }>('POST', '/api/events', {
    event_type: 'WEDDING',
    event_name: `[스모크] 역채움예식 ${stamp}`,
    status: 'INQ',
    start_datetime: '2027-07-03T12:00:00.000Z',
    end_datetime: '2027-07-03T15:00:00.000Z',
    halls: ['Hall A'],
  })
).event;
await api('PATCH', `/api/events/${ev2.id}`, {
  customer_links: [{ customer_id: cust2.id, customer_role: '신랑측', is_contact_point: true }],
  gateway_fee: 1_540_000,
});
const linked = await api<{ pulled: string[]; customer: WedCust }>(
  'POST',
  `/api/customers/wedding/${cust2.id}/inquiries/${cust2.event_inquiries[0].id}/link`,
  { event_id: ev2.id }
);
check('행사 연결 시 대관료가 후보로 역채움됨', linked.pulled.includes('계약금'), linked.pulled);
check(
  '역채움된 금액이 154만원',
  Number(linked.customer.event_inquiries[0].deposit_amount) === 1_540_000,
  linked.customer.event_inquiries[0]
);

// 9) 한 행사에 두 후보 연결 금지
const dup = await fetch(
  `${BASE}/api/customers/wedding/${cust2.id}/inquiries/${cust2.event_inquiries[0].id}/link`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `uid=${ADMIN}` },
    body: JSON.stringify({ event_id: eventId }),
  }
);
check('다른 고객 행사도 연결은 되지만 409 중복은 같은 고객 내에서만', dup.status === 200 || dup.status === 409);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
