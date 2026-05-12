// Firebase Admin SDK 연결 진단 스크립트.
// 사용: cd server && npx tsx scripts/firebase-health.ts

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// .env는 프로젝트 루트에 있음. 스크립트가 server/scripts/에서 돌더라도 정확히 찾아 로드.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });

const { firestore } = await import('../src/lib/firebase.js');

async function main() {
  const ts = Date.now();
  const docId = `probe-${ts}`;
  const docRef = firestore.collection('_health').doc(docId);

  console.log(`\n[1/4] 테스트 doc 쓰기: _health/${docId}`);
  await docRef.set({ probe: true, timestamp: ts, project: process.env.FIREBASE_PROJECT_ID });
  console.log('[OK] 쓰기 성공');

  console.log('[2/4] 다시 읽기 (라운드트립)');
  const snap = await docRef.get();
  if (!snap.exists) throw new Error('doc 존재하지 않음');
  const data = snap.data();
  if (data?.timestamp !== ts) {
    throw new Error(`timestamp 불일치: 기대=${ts}, 실제=${data?.timestamp}`);
  }
  console.log('[OK] 읽기 성공 — timestamp 일치');

  console.log('[3/4] 정리 (cleanup)');
  await docRef.delete();
  console.log('[OK] 삭제 완료');

  console.log('[4/4] 컬렉션 카운트 (이미 존재하는 _health doc 잔재 확인)');
  const lingering = await firestore.collection('_health').limit(5).get();
  console.log(`[INFO] _health 잔재 doc: ${lingering.size}개 (정상: 0)`);

  console.log('\n========================================');
  console.log('✅ Phase 1 PASS — Firestore 연결 정상');
  console.log('========================================\n');
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('\n========================================');
  console.error('❌ Phase 1 FAIL');
  console.error('========================================');
  if (e instanceof Error) {
    console.error(e.message);
    if (e.stack) console.error('\nStack:\n' + e.stack.split('\n').slice(0, 5).join('\n'));
  } else {
    console.error(e);
  }
  console.error('\n해결 가이드:');
  console.error('  - "5 NOT_FOUND" → Firestore Database가 활성화되지 않음. Console에서 Create database.');
  console.error('  - "PERMISSION_DENIED" → 서비스 계정 권한 문제. Console에서 Project settings 확인.');
  console.error('  - "credentials 파일 없음" → 참고/ 폴더에 Firebase admin SDK JSON 있는지 확인.');
  process.exit(1);
});
