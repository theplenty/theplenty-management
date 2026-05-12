// Firebase Storage 연결 진단 — 작은 객체를 PUT/GET/DELETE 라운드트립.
import './_loadEnv.js';
const { firebaseStorage } = await import('../src/lib/firebase.js');

const ts = Date.now();
const objectKey = `_health/probe-${ts}.txt`;
const content = Buffer.from(`probe @ ${new Date(ts).toISOString()}\n`);

console.log(`\n[1/4] 버킷 정보 확인`);
const bucket = firebaseStorage.bucket();
console.log(`  bucket: ${bucket.name}`);

console.log(`[2/4] 객체 쓰기: ${objectKey}`);
await bucket.file(objectKey).save(content, { contentType: 'text/plain' });
console.log('[OK] 쓰기 성공');

console.log(`[3/4] 다시 읽기 (라운드트립)`);
const [downloaded] = await bucket.file(objectKey).download();
if (!downloaded.equals(content)) {
  throw new Error('내용 불일치');
}
console.log(`[OK] 읽기 성공 — ${downloaded.byteLength} bytes`);

console.log(`[4/4] 정리 (delete)`);
await bucket.file(objectKey).delete();
console.log('[OK] 삭제 완료');

console.log('\n========================================');
console.log('✅ Phase 5 PASS — Firebase Storage 연결 정상');
console.log('========================================\n');
process.exit(0);
