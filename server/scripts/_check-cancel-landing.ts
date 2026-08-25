// 읽기 전용 점검: 진행단계별 × 랜딩 발행 여부 교차표
import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');

const [wedDocs, landDocs, evCustDocs, evDocs] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('wedding_landings').get(),
  firestore.collection('event_customers').get(),
  firestore.collection('events').get(),
]);

const evOwner = new Map<string, string[]>();
for (const d of evCustDocs.docs) {
  const l = d.data() as { event_id?: string; customer_id?: string };
  if (!l.event_id || !l.customer_id) continue;
  const arr = evOwner.get(l.event_id) || [];
  arr.push(l.customer_id);
  evOwner.set(l.event_id, arr);
}
const wedIds = new Set(wedDocs.docs.map((d) => d.id));

const hasLanding = new Set<string>();
for (const d of landDocs.docs) {
  const l = d.data() as { mode?: string; customer_id?: string; event_id?: string };
  if (l.mode === 'consult') {
    if (l.customer_id) hasLanding.add(l.customer_id);
  } else if (l.event_id) {
    for (const cid of evOwner.get(l.event_id) || []) if (wedIds.has(cid)) hasLanding.add(cid);
  }
}

const cross: Record<string, { total: number; withLanding: number }> = {};
for (const d of wedDocs.docs) {
  const c = d.data() as { progress_status?: string; deleted_at?: string };
  if (c.deleted_at) continue;
  const s = c.progress_status || '(없음)';
  const slot = (cross[s] ||= { total: 0, withLanding: 0 });
  slot.total++;
  if (hasLanding.has(d.id)) slot.withLanding++;
}
console.log('랜딩 보유 고객 수:', hasLanding.size, '/ 랜딩 문서', landDocs.size, '/ 행사', evDocs.size);
console.table(cross);
