// S2 스모크 — 문의↔행사 연결 + 계약금 자동 반영. json 모드 격리 서버(:4100) 대상.
// 실행: STORE_BACKEND=json PORT=4100 npx tsx src/server.ts 를 띄운 뒤 이 스크립트.
const BASE = 'http://localhost:4100';
const ADMIN = '0u1bMDz4xK';
const SALES = 'x8WgqC1LD6'; // sales_mice — 매출 필드 직접 쓰기 불가한 역할

let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name} ${detail}`);
  if (!cond) fails++;
};
const api = async (path: string, opt: { method?: string; body?: unknown; uid?: string } = {}) => {
  const res = await fetch(BASE + path, {
    method: opt.method || 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${opt.uid || ADMIN}` },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

// ── 준비: 행사 2개(대관료 빈 것 / 이미 있는 것) + 고객 1곳(문의 2건) ──
const ev1 = await api('/api/events', {
  method: 'POST',
  body: { event_type: 'MICE', event_name: '_스모크 행사A', status: 'DEF', start_datetime: '2026-09-10T09:00:00', halls: ['Hall A+B'] },
});
const ev2 = await api('/api/events', {
  method: 'POST',
  body: { event_type: 'MICE', event_name: '_스모크 행사B', status: 'DEF', start_datetime: '2026-09-20T09:00:00', gateway_fee: 500000 },
});
await api(`/api/events/${ev2.body.event.id}`, { method: 'PATCH', body: { gateway_fee: 500000 } });
check('행사 2건 생성', !!ev1.body.event?.id && !!ev2.body.event?.id, `${ev1.body.event?.id} / ${ev2.body.event?.id}`);
const e1 = ev1.body.event.id, e2 = ev2.body.event.id;

const cust = await api('/api/customers/mice', {
  method: 'POST',
  body: {
    organization_name: '_스모크 업체',
    inquiries: [
      { progress_status: 'DEF', inquiry_channel: 'INCALL', contacts: [], call_date: '2026-08-01', inquiry_event_date_text: '2026-09-10', quote_sent: true, contract_replied: true, deposit_paid: true, deposit_amount: 300000, deposit_depositor: '홍길동', deposit_date: '2026-08-15', invoice_type: '현금영수증', invoice_issue_status: '발행완료' },
      { progress_status: 'DEF', inquiry_channel: 'INCALL', contacts: [], call_date: '2026-08-05', inquiry_event_date_text: '2026-09-20', deposit_paid: true, deposit_amount: 700000 },
    ],
  },
});
check('고객 생성 (문의 2건)', !!cust.body.customer?.id && cust.body.customer?.inquiries?.length === 2);
const cid = cust.body.customer.id;
const q1 = cust.body.customer.inquiries[0].id;
const q2 = cust.body.customer.inquiries[1].id;

// ── 후보 제안 ──
const cands = await api(`/api/customers/mice/${cid}/inquiries/${q1}/event-candidates`);
check('후보 제안 — 예정일로 인식', cands.body.guessed_date === '2026-09-10', JSON.stringify(cands.body.guessed_date));
check('후보에 행사A 포함', (cands.body.candidates || []).some((c: any) => c.id === e1));

// ── 연결 + 자동 반영 (세일즈 역할로! 매출 필드 직접 쓰기는 불가한 역할) ──
const link1 = await api(`/api/customers/mice/${cid}/inquiries/${q1}/link`, { method: 'POST', body: { event_id: e1 }, uid: SALES });
check('세일즈 역할로 연결 성공', link1.status === 200, JSON.stringify(link1.body.error || ''));
check('대관료 자동 반영됨', (link1.body.pushed || []).some((p: any) => p.filled.includes('가톨릭대관료')), JSON.stringify(link1.body.pushed));
const full1 = await api(`/api/events/${e1}`);
check('행사 gateway_fee = 300,000', Number(full1.body.event?.gateway_fee) === 300000, String(full1.body.event?.gateway_fee));
check('입금상태 입금완료', full1.body.invoice?.payment_status === '입금완료');
check('입금액 300,000', Number(full1.body.invoice?.payment_amount) === 300000);
check('고객↔행사 링크 자동 생성', (full1.body.customer_links || []).some((l: any) => l.customer_id === cid));
check('입금자명 미러', full1.body.invoice?.depositor_name === '홍길동', full1.body.invoice?.depositor_name);
check('입금일자 미러', full1.body.invoice?.payment_date === '2026-08-15', full1.body.invoice?.payment_date);
check('계산서 발행 미러', full1.body.invoice?.invoice_type === '현금영수증' && full1.body.invoice?.invoice_issue_status === '발행완료');

// 출처 조회
const src = await api(`/api/events/${e1}/deposit-source`);
check('출처 문의 조회', src.body.source?.customerId === cid && src.body.source?.inquiryNo === 1, JSON.stringify(src.body.source));

// ── 이미 대관료가 있는 행사 → 덮지 않음 ──
const link2 = await api(`/api/customers/mice/${cid}/inquiries/${q2}/link`, { method: 'POST', body: { event_id: e2 } });
const m2 = (link2.body.pushed || []).find((p: any) => p.inquiryId === q2);
check('문의가 행사 대관료를 덮어씀(미러)', !!m2 && m2.filled.includes('가톨릭대관료'), JSON.stringify(m2));
const full2 = await api(`/api/events/${e2}`);
check('행사B 대관료 700,000 (문의 값 승리)', Number(full2.body.event?.gateway_fee) === 700000, String(full2.body.event?.gateway_fee));

// ── 한 행사에 두 문의 연결 차단 ──
const dup = await api(`/api/customers/mice/${cid}/inquiries/${q2}/link`, { method: 'POST', body: { event_id: e1 } });
check('이미 연결된 행사 재연결 차단', dup.status === 400, JSON.stringify(dup.body.error));

// ── 고객 저장(PATCH)이 링크를 지우지 않는지 — 화이트리스트 보존 확인 ──
const cur = await api(`/api/customers/mice/${cid}`);
const patched = await api(`/api/customers/mice/${cid}`, { method: 'PATCH', body: { inquiries: cur.body.customer.inquiries, memo: '저장 테스트' } });
const keptLink = patched.body.customer.inquiries.find((q: any) => q.id === q1);
check('저장 후에도 링크 유지', keptLink?.linked_event_id === e1, String(keptLink?.linked_event_id));
check('저장 후에도 계약금 금액 유지', Number(keptLink?.deposit_amount) === 300000);
check('반영 스탬프 유지', !!keptLink?.revenue_pushed_at);

// ── 금액을 올리면 다시 반영되는가 (행사 대관료는 이미 채워져 있으니 kept 로 남아야) ──
const bumped = cur.body.customer.inquiries.map((q: any) => (q.id === q1 ? { ...q, deposit_amount: 350000 } : q));
const rePatch = await api(`/api/customers/mice/${cid}`, { method: 'PATCH', body: { inquiries: bumped } });
const rePushed = (rePatch.body.pushed || []).find((p: any) => p.inquiryId === q1);
check('금액 변경 시 행사도 갱신(미러)', !!rePushed && rePushed.filled.includes('가톨릭대관료'), JSON.stringify(rePushed));
const reFull = await api(`/api/events/${e1}`);
check('행사A 대관료 350,000 갱신', Number(reFull.body.event?.gateway_fee) === 350000, String(reFull.body.event?.gateway_fee));

// ── 문의에서 행사 생성 + 즉시 연결 ──
const cust2 = await api('/api/customers/mice', {
  method: 'POST',
  body: { organization_name: '_스모크 신규', inquiries: [{ progress_status: 'DEF', inquiry_channel: 'INCALL', contacts: [], call_date: '2026-08-10', inquiry_event_date_text: '10월 15일', deposit_paid: true, deposit_amount: 250000 }] },
});
const cid2 = cust2.body.customer.id, q3 = cust2.body.customer.inquiries[0].id;
const created = await api(`/api/customers/mice/${cid2}/inquiries/${q3}/create-event`, { method: 'POST', body: {}, uid: SALES });
check('문의에서 행사 생성', !!created.body.event?.id, JSON.stringify(created.body.error || ''));
const e3 = created.body.event?.id;
check('생성 행사 예정일 = 텍스트에서 인식(10월 15일)', (created.body.event?.start_datetime || '').startsWith('2026-10-15'), created.body.event?.start_datetime);
const full3 = await api(`/api/events/${e3}`);
check('생성 즉시 대관료 반영', Number(full3.body.event?.gateway_fee) === 250000, String(full3.body.event?.gateway_fee));

// ── 연결 해제 — 매출 값은 유지 ──
const unl = await api(`/api/customers/mice/${cid2}/inquiries/${q3}/link`, { method: 'DELETE' });
check('연결 해제', unl.status === 200 && !unl.body.customer.inquiries[0].linked_event_id);
const full3b = await api(`/api/events/${e3}`);
check('해제 후에도 대관료 유지(회계 기록 보존)', Number(full3b.body.event?.gateway_fee) === 250000);
const src3 = await api(`/api/events/${e3}/deposit-source`);
check('해제 후 출처 표시 사라짐', src3.body.source === null);

// ── 역채움: 행사에 입금 기록이 있으면 연결 시 문의의 빈 칸으로 끌어온다 ──
const evB = await api('/api/events', { method: 'POST', body: { event_type: 'MICE', event_name: '_스모크 역채움', status: 'DEF', start_datetime: '2026-12-01T09:00:00' } });
await api(`/api/events/${evB.body.event.id}`, { method: 'PATCH', body: { gateway_fee: 1100000 } });
await api(`/api/events/${evB.body.event.id}`, { method: 'PATCH', body: { invoice: { payment_status: '입금완료', depositor_name: '윤혜주', payment_amount: 1100000, payment_date: '2025-12-03', invoice_type: '현금영수증', invoice_issue_status: '발행완료' } } });
const custB = await api('/api/customers/mice', {
  method: 'POST',
  body: { organization_name: '_스모크 역채움업체', inquiries: [{ progress_status: 'DEF', inquiry_channel: 'INCALL', contacts: [], call_date: '2026-08-12' }] },
});
const cidB = custB.body.customer.id, qB = custB.body.customer.inquiries[0].id;
const linkB = await api(`/api/customers/mice/${cidB}/inquiries/${qB}/link`, { method: 'POST', body: { event_id: evB.body.event.id } });
check('역채움 항목 보고', (linkB.body.pulled || []).includes('계약금') && (linkB.body.pulled || []).includes('입금자명'), JSON.stringify(linkB.body.pulled));
const qAfter = linkB.body.customer.inquiries[0];
check('문의에 계약금 1,100,000 채워짐', Number(qAfter.deposit_amount) === 1100000, String(qAfter.deposit_amount));
check('문의에 입금자명·일자·계산서 채워짐', qAfter.deposit_depositor === '윤혜주' && qAfter.deposit_date === '2025-12-03' && qAfter.invoice_type === '현금영수증');
check('입금완료 기록 → 계약금 체크 자동 ON', qAfter.deposit_paid === true);

// ── 미반영 조건: 계약금 체크 없으면 안 흘러감 ──
const cust3 = await api('/api/customers/mice', {
  method: 'POST',
  body: { organization_name: '_스모크 미체크', inquiries: [{ progress_status: 'DEF', inquiry_channel: 'INCALL', contacts: [], call_date: '2026-08-11', deposit_amount: 900000, deposit_paid: false }] },
});
const cid3 = cust3.body.customer.id, q4 = cust3.body.customer.inquiries[0].id;
const ev4 = await api('/api/events', { method: 'POST', body: { event_type: 'MICE', event_name: '_스모크 행사C', status: 'DEF', start_datetime: '2026-11-01T09:00:00' } });
await api(`/api/customers/mice/${cid3}/inquiries/${q4}/link`, { method: 'POST', body: { event_id: ev4.body.event.id } });
const full4 = await api(`/api/events/${ev4.body.event.id}`);
check('계약금 미체크 → 반영 안 됨', full4.body.event?.gateway_fee == null || Number(full4.body.event.gateway_fee) === 0, String(full4.body.event?.gateway_fee));

// ── 정리 ──
for (const id of [cid, cid2, cid3, cidB]) await api(`/api/customers/mice/${id}`, { method: 'DELETE' });
for (const id of [e1, e2, e3, ev4.body.event.id, evB.body.event.id]) await api(`/api/events/${id}`, { method: 'DELETE' });
console.log(fails ? `\n❌ 실패 ${fails}건` : '\n✅ 전체 통과');
process.exit(fails ? 1 : 0);
