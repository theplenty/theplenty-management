// 행사(events)와 cascade되는 자식 컬렉션을 모두 삭제.
// 고객·사용자·캘린더공유·매출목표 등 행사와 무관한 데이터는 건드리지 않음.
//
// 사용:
//   cd server && npx tsx scripts/clear-events.ts --i-know-what-im-doing
//
// 출력 예:
//   [events] 248건 삭제
//   [event_food_items] 412건 삭제
//   ...
//   ✅ 합계: 행사 관련 N건 삭제

import './_loadEnv.js';

// 삭제 대상 — 모두 event_id 기준으로 행사에 종속된 데이터.
// 'events'를 마지막에 두는 이유: 자식 먼저 지우고 부모를 마지막에 지우는 게 안전.
const EVENT_SCOPED_COLLECTIONS = [
  'event_food_items',
  'event_customers',
  'invoices',
  'event_files',
  'cancellations',
  'event_reviews',
  'events',
];

if (!process.argv.includes('--i-know-what-im-doing')) {
  console.error(
    '⚠️  행사·식음메뉴·업체연결·INVOICE·첨부파일·취소·리뷰를 모두 삭제합니다.\n' +
      '   고객정보·사용자·캘린더공유·매출목표는 보존됩니다.\n\n' +
      '정말 실행하려면:\n' +
      '   npx tsx scripts/clear-events.ts --i-know-what-im-doing\n'
  );
  process.exit(1);
}

const { firestore } = await import('../src/lib/firebase.js');

async function deleteCollection(name: string, batchSize = 400): Promise<number> {
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

console.log(`\n📍 프로젝트: ${process.env.FIREBASE_PROJECT_ID || '(FIREBASE_CONFIG 환경변수 사용)'}`);
console.log(`📍 행사 관련 컬렉션 ${EVENT_SCOPED_COLLECTIONS.length}개 삭제 시작\n`);

let grand = 0;
const breakdown: Array<[string, number]> = [];
for (const c of EVENT_SCOPED_COLLECTIONS) {
  console.log(`[${c}]`);
  const n = await deleteCollection(c);
  breakdown.push([c, n]);
  grand += n;
}

console.log(`\n✅ 합계: 행사 관련 ${grand.toLocaleString('ko-KR')}건 삭제 완료`);
console.log('\n세부:');
for (const [name, count] of breakdown) {
  console.log(`  · ${name.padEnd(22)} ${count.toLocaleString('ko-KR').padStart(6)}건`);
}
console.log('\n⚠️  Cloud Functions가 현재 메모리에 캐싱한 데이터는 다음 배포/cold-start에 다시 hydrate됩니다.');
console.log('    안전하게 새로 시작하려면 firebase deploy를 곧 진행하세요.\n');

process.exit(0);
