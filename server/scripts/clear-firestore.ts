// 사고 시 롤백용: Firestore 모든 컬렉션 비움. 실행 전 명시적 확인 요구.
// 사용: cd server && npx tsx scripts/clear-firestore.ts --i-know-what-im-doing

import './_loadEnv.js';

const COLLECTIONS = [
  'users',
  'mice_customers',
  'wedding_customers',
  'events',
  'event_customers',
  'event_food_items',
  'invoices',
  'event_files',
  'cancellations',
  'event_reviews',
  'calendar_shares',
  'sales_targets',
  'change_logs',
  '_health',
];

if (!process.argv.includes('--i-know-what-im-doing')) {
  console.error(
    '⚠️  Firestore 전체 데이터를 삭제합니다. 정말 실행하려면:\n' +
      '   npx tsx scripts/clear-firestore.ts --i-know-what-im-doing'
  );
  process.exit(1);
}

const { firestore } = await import('../src/lib/firebase.js');

async function deleteCollection(name: string, batchSize = 400) {
  const collRef = firestore.collection(name);
  let total = 0;
  while (true) {
    const snap = await collRef.limit(batchSize).get();
    if (snap.empty) break;
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    process.stdout.write(`\r  삭제 중: ${name} ${total}건`);
  }
  process.stdout.write('\n');
  return total;
}

console.log(`프로젝트 ${process.env.FIREBASE_PROJECT_ID} 에서 컬렉션 삭제 시작\n`);
let grand = 0;
for (const c of COLLECTIONS) {
  console.log(`[${c}]`);
  grand += await deleteCollection(c);
}
console.log(`\n✅ 총 ${grand}건 삭제 완료`);
process.exit(0);
