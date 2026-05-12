// 특정 event_id의 자식 doc들이 Firestore에 있는지 검증.
import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const eid = process.argv[2];
if (!eid) { console.error('usage: <eventId>'); process.exit(2); }

const colls = ['event_food_items', 'event_customers', 'invoices', 'cancellations', 'event_reviews', 'event_files'];
console.log(`event_id = ${eid} 의 자식 doc 검색`);
for (const c of colls) {
  const snap = await firestore.collection(c).where('event_id', '==', eid).get();
  console.log(`  ${c}: ${snap.size}건`);
}
process.exit(0);
