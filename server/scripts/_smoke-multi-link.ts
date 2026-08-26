/**
 * 한 행사 ← 여러 문의(주최사+대행사) 연결 스모크. (2026-08-26)
 * 사용: STORE_BACKEND=json PORT=4191 npx tsx src/server.ts → SMOKE_BASE=... npx tsx scripts/_smoke-multi-link.ts
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:4191';
const ADMIN = '0u1bMDz4xK';

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, x?: unknown) => {
  if (ok) { pass++; console.log('  ✓ ' + l); }
  else { fail++; console.log('  ✗ ' + l, x !== undefined ? JSON.stringify(x) : ''); }
};
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', cookie: `uid=${ADMIN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 180)}`);
  return t ? JSON.parse(t) : ({} as T);
}
interface Cust { id: string; organization_name: string; inquiries: any[] }

console.log('\n=== 다중 연결(주최사+대행사) 스모크 ===\n');
const stamp = Date.now();

// 행사 + 업체 2곳 (주최사/대행사)
const ev = (await api<{ event: any }>('POST', '/api/events', {
  event_type: 'MICE', event_name: `[스모크] 웹세미나 ${stamp}`, status: 'DEF',
  start_datetime: '2027-09-14T11:00:00.000Z', end_datetime: '2027-09-14T15:00:00.000Z', halls: ['Leaf Room'],
})).event;
const mkCust = async (name: string) => (await api<{ customer: Cust }>('POST', '/api/customers/mice', {
  mice_category: '기업', organization_name: name,
  inquiries: [{ progress_status: 'DEF', inquiry_channel: 'INCALL', contacts: [{ name: '담당' }], inquiry_event_date_text: '2027-09-14' }],
})).customer;
const host = await mkCust(`[스모크]주최사 ${stamp}`);
const agency = await mkCust(`[스모크]대행사 ${stamp}`);

// 1) 주최사 문의 → 연결 (원본이 된다)
const l1 = await api<{ link_role: string }>('POST', `/api/customers/mice/${host.id}/inquiries/${host.inquiries[0].id}/link`, { event_id: ev.id });
check('첫 연결은 primary (계약금 원본)', l1.link_role === 'primary', l1);

// 2) 대행사 후보 목록 — 선점 행사가 이제 보이고, 원본 표시가 붙는다
const cands = await api<{ candidates: any[] }>('GET', `/api/customers/mice/${agency.id}/inquiries/${agency.inquiries[0].id}/event-candidates?q=웹세미나`);
const hit = cands.candidates.find((c) => c.id === ev.id);
check('다른 업체가 물고 있는 행사도 후보에 보임', !!hit, cands.candidates.length);
check('계약금 원본(주최사) 표시', hit?.deposit_owner?.org === host.organization_name, hit?.deposit_owner);

// 3) 대행사 문의 → 같은 행사에 참조 연결
const l2 = await api<{ link_role: string; owner_org: string; customer: Cust }>('POST', `/api/customers/mice/${agency.id}/inquiries/${agency.inquiries[0].id}/link`, { event_id: ev.id });
check('두 번째 연결은 secondary (참조)', l2.link_role === 'secondary', l2.link_role);
check('원본 업체명 안내', l2.owner_org === host.organization_name, l2.owner_org);
check('대행사 문의에 링크 걸림', l2.customer.inquiries[0].linked_event_id === ev.id);

const evNow = (await api<{ event: any }>('GET', `/api/events/${ev.id}`)).event;
check('행사 원본은 여전히 주최사 문의', evNow.source_customer_id === host.id, evNow.source_customer_id);

// 4) 주최사 계약금 → 매출 반영 O
const h2 = await api<{ pushed: any[]; push_skipped: any[] }>('PATCH', `/api/customers/mice/${host.id}`, {
  inquiries: [{ ...((await api<{ customer: Cust }>('GET', `/api/customers/mice/${host.id}`)).customer.inquiries[0]), deposit_amount: 2_000_000, deposit_paid: true }],
});
check('원본 문의 계약금은 매출 반영', h2.pushed.length === 1 && h2.pushed[0].filled.includes('가톨릭대관료'), h2.pushed);

// 5) 대행사 계약금 → 반영 안 되고 skipped 로 이유 반환
const a2 = await api<{ pushed: any[]; push_skipped: any[] }>('PATCH', `/api/customers/mice/${agency.id}`, {
  inquiries: [{ ...((await api<{ customer: Cust }>('GET', `/api/customers/mice/${agency.id}`)).customer.inquiries[0]), deposit_amount: 999_999, deposit_paid: true }],
});
check('참조 문의 계약금은 반영 안 됨', a2.pushed.length === 0, a2.pushed);
check('skipped 에 원본 안내', a2.push_skipped?.[0]?.owner_org === host.organization_name, a2.push_skipped);
const evAfter = (await api<{ event: any }>('GET', `/api/events/${ev.id}`)).event;
check('행사 대관료는 주최사 금액(200만) 유지', Number(evAfter.gateway_fee) === 2_000_000, evAfter.gateway_fee);

// 6) 같은 업체의 두 번째 문의 → 같은 행사 연결은 여전히 차단
const host2 = (await api<{ customer: Cust }>('PATCH', `/api/customers/mice/${host.id}`, {
  inquiries: [
    ...(await api<{ customer: Cust }>('GET', `/api/customers/mice/${host.id}`)).customer.inquiries,
    { progress_status: '문의', inquiry_channel: 'INCALL', contacts: [{ name: '담당2' }], inquiry_event_date_text: '' },
  ],
})).customer;
const dupR = await fetch(`${BASE}/api/customers/mice/${host.id}/inquiries/${host2.inquiries[1].id}/link`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: `uid=${ADMIN}` },
  body: JSON.stringify({ event_id: ev.id }),
});
check('같은 업체의 다른 문의는 중복 연결 차단(400)', dupR.status === 400, dupR.status);

// 7) 원본 해제 → 참조 문의가 다음 저장에서 원본을 승계
await api('DELETE', `/api/customers/mice/${host.id}/inquiries/${host.inquiries[0].id}/link`);
const a3 = await api<{ pushed: any[] }>('PATCH', `/api/customers/mice/${agency.id}`, {
  inquiries: (await api<{ customer: Cust }>('GET', `/api/customers/mice/${agency.id}`)).customer.inquiries,
});
check('원본 해제 후 참조 문의가 원본 승계 + 반영', a3.pushed.length === 1, a3.pushed);
const evFinal = (await api<{ event: any }>('GET', `/api/events/${ev.id}`)).event;
check('행사 원본이 대행사로 이동', evFinal.source_customer_id === agency.id, evFinal.source_customer_id);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
