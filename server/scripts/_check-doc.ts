import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');

const [, , collection, docId] = process.argv;
if (!collection || !docId) {
  console.error('usage: npx tsx scripts/_check-doc.ts <collection> <docId>');
  process.exit(2);
}

const snap = await firestore.collection(collection).doc(docId).get();
if (!snap.exists) {
  console.log(`[NOT_FOUND] ${collection}/${docId}`);
  process.exit(1);
}
const d = snap.data();
console.log(`[OK] ${collection}/${docId} 존재`);
console.log(JSON.stringify(d, null, 2).split('\n').slice(0, 30).join('\n'));
process.exit(0);
