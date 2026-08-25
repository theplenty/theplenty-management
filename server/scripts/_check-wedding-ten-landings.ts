// 운영 점검(읽기 전용): 웨딩 진행단계 TEN 잔존 여부 + wedding_landings 현황
// 사용: npx tsx scripts/_check-wedding-ten-landings.ts
import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');

const [wedDocs, landDocs] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('wedding_landings').get(),
]);

const stages: Record<string, number> = {};
const tenNames: string[] = [];
for (const d of wedDocs.docs) {
  const c = d.data() as { progress_status?: string; wedding_event_name?: string; deleted_at?: string };
  if (c.deleted_at) continue;
  const s = c.progress_status || '(없음)';
  stages[s] = (stages[s] || 0) + 1;
  if (s === 'TEN') tenNames.push(`${d.id} ${c.wedding_event_name || ''}`);
}
console.log('wedding_customers(활성):', wedDocs.size, stages);
if (tenNames.length) console.log('TEN 잔존:', tenNames);

console.log('wedding_landings:', landDocs.size);
for (const d of landDocs.docs) {
  const l = d.data() as { mode?: string; event_id?: string; customer_id?: string; block_until?: string; closed?: boolean };
  console.log(' -', l.mode || 'block', l.customer_id || l.event_id, 'until', l.block_until || '(없음)', 'closed', !!l.closed);
}
