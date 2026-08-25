// 읽기 전용: 웨딩 계약금 설계용 현황 파악
import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const [wed, evs, evc, invs] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
  firestore.collection('invoices').get(),
]);

const wedIds = new Set(wed.docs.filter((d) => !(d.data() as any).deleted_at).map((d) => d.id));
// 고객 → 연결 행사
const evByCust = new Map<string, string[]>();
for (const d of evc.docs) {
  const l = d.data() as any;
  if (!wedIds.has(l.customer_id)) continue;
  const a = evByCust.get(l.customer_id) || []; a.push(l.event_id); evByCust.set(l.customer_id, a);
}
const evMap = new Map(evs.docs.map((d) => [d.id, d.data() as any]));
const invByEv = new Map(invs.docs.map((d) => [(d.data() as any).event_id, d.data() as any]));

// 1) 웨딩 행사에 gateway_fee(가톨릭대관료) 가 쓰이는가?
let wedEv = 0, wedEvGw = 0, wedEvInv = 0, wedEvContract = 0;
for (const [, e] of evMap) {
  if (e.deleted_at || e.event_type !== 'WEDDING') continue;
  wedEv++;
  if (Number(e.gateway_fee) > 0) wedEvGw++;
  if (Number(e.contract_amount) > 0) wedEvContract++;
  if (invByEv.get(e.id ?? '')) wedEvInv++;
}
console.log(`웨딩 행사 ${wedEv}건 · gateway_fee>0 ${wedEvGw}건 · contract_amount>0 ${wedEvContract}건`);

// 2) INQ 고객의 예식후보 개수 / 행사 연결 여부
const byStage: Record<string, { n: number; inqAvg: number[]; linked: number; multiCand: number }> = {};
for (const d of wed.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  const s = c.progress_status || '(없음)';
  const slot = (byStage[s] ||= { n: 0, inqAvg: [], linked: 0, multiCand: 0 });
  slot.n++;
  const cands = (c.event_inquiries || []).length;
  slot.inqAvg.push(cands);
  if (cands > 1) slot.multiCand++;
  if ((evByCust.get(d.id) || []).length) slot.linked++;
}
console.log('\n진행단계별 — 고객수 / 행사연결된 고객 / 예식후보 2개이상 고객 / 평균 후보수');
for (const [k, v] of Object.entries(byStage)) {
  const avg = (v.inqAvg.reduce((a, b) => a + b, 0) / v.n).toFixed(2);
  console.log(` ${k.padEnd(8)} n=${String(v.n).padStart(3)} linked=${String(v.linked).padStart(3)} multi=${String(v.multiCand).padStart(3)} avg후보=${avg}`);
}

// 3) INQ 고객 상세
console.log('\n=== INQ 고객 상세 ===');
for (const d of wed.docs) {
  const c = d.data() as any;
  if (c.deleted_at || c.progress_status !== 'INQ') continue;
  const evIds = evByCust.get(d.id) || [];
  const evInfo = evIds.map((id) => {
    const e = evMap.get(id);
    return e ? `${e.status}/${(e.start_datetime||'').slice(0,10)}/gw=${e.gateway_fee ?? '-'}/contract=${e.contract_amount ?? '-'}` : '?';
  });
  console.log(` ${d.id} ${c.wedding_event_name} · 후보 ${(c.event_inquiries||[]).length}개 · 행사 [${evInfo.join(' | ')}]`);
}

// 4) DEF 고객 중 행사에 금액이 들어있는 사례 (계약금 원본이 어디 있나)
let defWithGw = 0, defWithInv = 0, defTotal = 0;
for (const d of wed.docs) {
  const c = d.data() as any;
  if (c.deleted_at || c.progress_status !== 'DEF') continue;
  defTotal++;
  for (const id of evByCust.get(d.id) || []) {
    const e = evMap.get(id); if (!e) continue;
    if (Number(e.gateway_fee) > 0) { defWithGw++; break; }
  }
  for (const id of evByCust.get(d.id) || []) {
    if (invByEv.get(id)) { defWithInv++; break; }
  }
}
console.log(`\nDEF 웨딩고객 ${defTotal}명 · 연결행사에 gateway_fee>0 ${defWithGw}명 · invoice 존재 ${defWithInv}명`);
