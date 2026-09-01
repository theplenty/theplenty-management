/**
 * event_customers 중 `id` 필드가 비어 있는 레코드를 복구한다.
 *
 *   npx tsx scripts/fix-missing-link-ids.ts            # 미리보기 (기본)
 *   npx tsx scripts/fix-missing-link-ids.ts --apply    # 실제 수정
 *
 * 왜 생겼나 (2026-09-01 확인):
 *   scripts/apply-inquiry-event-links.ts 가 `.add({...})` 로 레코드를 만들면서
 *   문서 안의 `id` 필드를 안 넣었다. Firestore 문서 id 는 자동 생성됐지만
 *   앱의 store 는 문서 id 가 아니라 **필드 `id`** 를 쓴다.
 *
 * 증상: 행사 수정 화면에서 저장을 누르면 요청이 서버로 가기도 전에
 *   `TypeError: Cannot read properties of undefined (reading 'startsWith')` 로 죽고
 *   "저장 실패" 만 뜬다. 해당 행사만 저장이 안 되고 다른 행사는 멀쩡하다.
 *
 * 복구 방식: `id` = 문서 id. 다른 정상 레코드들도 두 값이 같으므로 규칙이 일관된다.
 *
 * ⚠ 실행 후 functions 재배포가 필요하다. store 는 인스턴스당 1회만 hydrate 하므로
 *   Firestore 를 직접 고쳐도 이미 떠 있는 인스턴스는 옛 메모리를 계속 쓴다.
 */
import './_loadEnv.js';

const APPLY = process.argv.includes('--apply');
const { firestore } = await import('../src/lib/firebase.js');

const snap = await firestore.collection('event_customers').get();
const broken = snap.docs.filter((d) => {
  const v = d.data() as { id?: unknown };
  return v.id === undefined || v.id === null || v.id === '';
});

console.log(`\nevent_customers 전체 ${snap.size}건 · id 없는 레코드 ${broken.length}건\n`);
if (!broken.length) {
  console.log('고칠 것이 없습니다.');
  process.exit(0);
}

// 어느 행사가 영향받는지 같이 보여준다 — 사용자가 "그 행사"를 알아볼 수 있어야 한다
const evs = await firestore.collection('events').get();
const evName = new Map(evs.docs.map((d) => [d.id, (d.data() as { event_name?: string }).event_name || '']));

for (const d of broken) {
  const v = d.data() as { event_id?: string; customer_id?: string };
  console.log(
    `  ${d.id}  →  id="${d.id}"   [행사] ${evName.get(String(v.event_id)) || '(삭제됨?)'} (${v.event_id})`,
  );
}

if (!APPLY) {
  console.log(`\n총 ${broken.length}건이 수정 대상입니다. 실제로 고치려면 --apply 를 붙이세요.`);
  process.exit(0);
}

let n = 0;
for (const d of broken) {
  await d.ref.update({ id: d.id });
  n++;
}
console.log(`\n수정 완료: ${n}건`);

// 검증 — 정말 없어졌는지 다시 센다
const after = await firestore.collection('event_customers').get();
const still = after.docs.filter((d) => {
  const v = d.data() as { id?: unknown };
  return v.id === undefined || v.id === null || v.id === '';
});
console.log(`잔여 ${still.length}건 / 전체 ${after.size}건`);
console.log('\n⚠ functions 재배포를 해야 화면에 반영됩니다.');
