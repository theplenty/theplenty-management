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
const noEv: Record<string, number> = {};
const withEv: Record<string, number> = {};
for (const d of wed.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  const has = (byCust.get(d.id) || []).length > 0;
  const t = has ? withEv : noEv;
  t[c.progress_status] = (t[c.progress_status] || 0) + 1;
}
console.log('행사 연결 없는 고객 단계 분포:', noEv);
console.log('행사 연결 있는 고객 단계 분포:', withEv);
