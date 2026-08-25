import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const [wed, evs, evc] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
]);
const evMap = new Map(evs.docs.map((d) => [d.id, { id: d.id, ...(d.data() as any) }]));
const evByCust = new Map<string, any[]>();
for (const d of evc.docs) {
  const l = d.data() as any;
  const e = evMap.get(l.event_id);
  if (!e || e.deleted_at || e.event_type !== 'WEDDING') continue;
  const a = evByCust.get(l.customer_id) || []; a.push(e); evByCust.set(l.customer_id, a);
}
const R = { exact: 0, single: 0, none: 0, ambiguous: 0 };
const problems: string[] = [];
for (const d of wed.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  if (!['INQ', 'DEF'].includes(c.progress_status)) continue;
  const evList = evByCust.get(d.id) || [];
  for (const q of c.event_inquiries || []) {
    const qd = (q.wedding_datetime || '').slice(0, 10);
    const sameDay = evList.filter((e) => (e.start_datetime || '').slice(0, 10) === qd);
    if (sameDay.length === 1) R.exact++;
    else if (sameDay.length > 1) { R.ambiguous++; problems.push(`중복 ${c.wedding_event_name} ${qd}`); }
    else if (evList.length === 1) R.single++;
    else { R.none++; if (problems.length < 12) problems.push(`미매칭 ${c.wedding_event_name} 후보=${qd || '(일시없음)'} 행사=${evList.length}건`); }
  }
}
console.log('INQ+DEF 고객의 예식후보 → 행사 매칭 결과');
console.log(' 날짜 정확히 일치 :', R.exact);
console.log(' 날짜는 다르나 연결행사 1개뿐(그걸로 확정 가능):', R.single);
console.log(' 같은 날 행사 2개 이상(모호):', R.ambiguous);
console.log(' 매칭 불가(연결행사 0 또는 다수):', R.none);
console.log('\n샘플:', problems.slice(0, 12));
