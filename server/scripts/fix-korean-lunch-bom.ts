// 한식도시락(Korean Lunch Box, MICE) BOM 교정:
//   1) 중복 카테고리 레코드 제거 (8 카테고리 × 2 → 1)
//   2) 불고기소스(배치 수량) 항목에 batch_yield 적용 → 1인 환산
//
// 사용:
//   cd server
//   npx tsx scripts/fix-korean-lunch-bom.ts                 # DRY-RUN (변경 없음)
//   npx tsx scripts/fix-korean-lunch-bom.ts --apply --yield 100
//
// 안전장치: 변경 전 전체 백업(JSON) 저장. --yield 로 불고기소스 배치 수율 지정(기본 100).

import './_loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const yi = args.indexOf('--yield');
const BATCH_YIELD = yi >= 0 ? Number(args[yi + 1]) : 100;

const { firestore } = await import('../src/lib/firebase.js');
const snap = await firestore.collection('menus').get();

interface MenuDoc { id: string; name_ko?: string; category?: string; event_type?: string; details?: Array<Record<string, unknown>>; [k: string]: unknown; }
const klb: MenuDoc[] = [];
snap.forEach((d) => {
  const m = d.data() as MenuDoc;
  if (m.name_ko === 'Korean Lunch Box' && m.event_type === 'MICE') klb.push({ ...m, id: d.id });
});
console.log(`한식도시락(MICE) 레코드: ${klb.length}개`);

// ── 중복 카테고리 제거 (각 카테고리 첫 레코드 유지) ──
const seen = new Set<string>();
const keep: MenuDoc[] = [];
const dropIds: string[] = [];
for (const m of klb) {
  const cat = String(m.category);
  if (seen.has(cat)) { dropIds.push(m.id); continue; }
  seen.add(cat); keep.push(m);
}
console.log(`유지 ${keep.length}개 / 중복삭제 ${dropIds.length}개`);

// ── 불고기소스에 batch_yield 적용 ──
const sauceUpdates: Array<{ id: string; details: Array<Record<string, unknown>> }> = [];
function effCost(d: Record<string, unknown>): number {
  const pc = Number(d.portion_cost) || 0;
  const by = Number(d.batch_yield);
  return pc / (by && by > 0 ? by : 1);
}
let totalAfter = 0;
for (const m of keep) {
  let sub = 0;
  if (String(m.category) === '불고기소스') {
    const newDetails = (m.details || []).map((d) => ({ ...d, batch_yield: BATCH_YIELD }));
    sauceUpdates.push({ id: m.id, details: newDetails });
    sub = newDetails.reduce((s, d) => s + effCost(d), 0);
  } else {
    sub = (m.details || []).reduce((s, d) => s + effCost(d), 0);
  }
  totalAfter += sub;
  console.log(`  · ${m.category}: ${Math.round(sub).toLocaleString()}원`);
}
console.log(`\n  ===> 교정 후 1인 표준원가(단일세트): ${Math.round(totalAfter).toLocaleString()}원 (batch_yield=${BATCH_YIELD})`);

if (!APPLY) {
  console.log('\n[DRY-RUN] 변경 없음. 적용: --apply --yield <인분수>');
  process.exit(0);
}

// ── 백업 ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.resolve(__dirname, `../data/korean-lunch-bom-backup.${ts}.json`);
fs.writeFileSync(backupPath, JSON.stringify(klb, null, 2), 'utf-8');
console.log(`[backup] ${backupPath}`);

// ── 적용 ──
const batch = firestore.batch();
for (const id of dropIds) batch.delete(firestore.collection('menus').doc(id));
for (const u of sauceUpdates) batch.update(firestore.collection('menus').doc(u.id), { details: u.details, updated_at: new Date().toISOString() });
await batch.commit();
console.log(`[완료] 중복 ${dropIds.length}개 삭제 + 불고기소스 batch_yield=${BATCH_YIELD} 적용.`);
process.exit(0);
