import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const [wed, evs, evc] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
]);
const evMap = new Map(evs.docs.map((d) => [d.id, { id: d.id, ...(d.data() as any) }]));
const byCust = new Map<string, any[]>();
for (const d of evc.docs) {
  const l = d.data() as any;
  const e = evMap.get(l.event_id);
  if (!e || e.deleted_at || e.event_type !== 'WEDDING') continue;
  const a = byCust.get(l.customer_id) || []; a.push(e); byCust.set(l.customer_id, a);
}
// 웨딩 고객 단계와 대응되는 행사 상태만 비교 (미팅/미팅취소/시식은 딜 단계가 아님)
const MAP: Record<string, string> = { INQ: 'INQ', DEF: 'DEF', LOS: 'LOS', 상담취소: '상담취소' };
let compared = 0, mismatch = 0, noEvent = 0, multi = 0;
const kinds = new Map<string, number>();
const samples: string[] = [];
for (const d of wed.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  const list = (byCust.get(d.id) || []).filter((e) => MAP[e.status]);
  if (!list.length) { noEvent++; continue; }
  if (list.length > 1) multi++;
  // 대표 행사 = 취소 아닌 것 우선, 그중 가장 최근 예식일
  const live = list.filter((e) => e.status !== 'LOS' && e.status !== '상담취소');
  const rep = (live.length ? live : list).sort((a, b) => (a.start_datetime < b.start_datetime ? 1 : -1))[0];
  compared++;
  const want = MAP[rep.status];
  if (want !== c.progress_status) {
    mismatch++;
    const k = `고객 ${c.progress_status} vs 행사 ${rep.status}`;
    kinds.set(k, (kinds.get(k) || 0) + 1);
    if (samples.length < 25) samples.push(`${(rep.start_datetime||'').slice(0,10)} ${k} — ${c.wedding_event_name}`);
  }
}
console.log(`행사 연결된 웨딩고객 ${compared}명 중 단계 불일치 ${mismatch}명 (${Math.round(mismatch/compared*100)}%)`);
console.log(`행사 없는 고객 ${noEvent}명 · 행사 2건 이상 연결 ${multi}명`);
console.log('\n유형별:');
[...kinds.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${v}건  ${k}`));
console.log('\n샘플:');
samples.forEach((x)=>console.log('  '+x));
