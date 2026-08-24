// 사용홀 복합 문자열 정리 — "Hall A+B,Leaf Room,Ivy Room" → 개별 홀 분해 + 중복 제거
// 백업: scripts/../data/halls-fix-before.json (id, event_name, halls)
import './_loadEnv.js';
import fs from 'fs';
const { firestore } = await import('../src/lib/firebase.js');

const APPLY = process.argv.includes('--apply');
const snap = await firestore.collection('events').get();
const targets: { id: string; name: string; before: string[]; after: string[] }[] = [];
for (const d of snap.docs) {
  const e = d.data();
  if (!Array.isArray(e.halls)) continue;
  const halls = e.halls.map(String);
  const after = [...new Set(halls.flatMap((h) => h.split(',')).map((s) => s.trim()).filter(Boolean))];
  if (JSON.stringify(after) !== JSON.stringify(halls)) {
    targets.push({ id: d.id, name: e.event_name || '', before: halls, after });
  }
}
console.log(`대상 ${targets.length}건 / 전체 ${snap.size}건`);
targets.slice(0, 5).forEach((t) => console.log(`  ${t.name.slice(0, 20)}: ${JSON.stringify(t.before)} → ${JSON.stringify(t.after)}`));
if (!APPLY) { console.log('(dry-run — --apply 로 실행)'); process.exit(0); }

fs.writeFileSync('data/halls-fix-before.json', JSON.stringify(targets, null, 1));
let n = 0;
for (const t of targets) {
  await firestore.collection('events').doc(t.id).update({ halls: t.after });
  n++;
}
console.log(`수정 완료 ${n}건 (백업: data/halls-fix-before.json)`);
process.exit(0);
