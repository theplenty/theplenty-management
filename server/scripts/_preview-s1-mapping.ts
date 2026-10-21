// 읽기 전용 — S1 메뉴 코드 매핑 미리보기 + 식수 미입력 행사 + (키가 있으면) 월 P&L 시험 계산.
// 운영 Firestore 를 읽어 메모리에만 올린다. 아무것도 쓰지 않는다.
// 사용: cd server && npx tsx scripts/_preview-s1-mapping.ts [YYYY-MM]
//   P&L 까지 보려면 스모크와 같이 셸 환경변수 STORAGE_READ_KEY 를 잠깐 넣고 실행한다(파일에 적지 않음).
import './_loadEnv.js';

const month = process.argv[2] || '2026-09';
const { firestore } = await import('../src/lib/firebase.js');
const { store } = await import('../src/store/mockStore.js');
const { menuCodePreview, missingMealCountEvents, computeConventionPnl } = await import('../src/lib/s1Pnl.js');
const { getStorageMenuCost, getStorageCogs, storageKeyConfigured } = await import('../src/lib/storageCost.js');

const load = async (c: string) => (await firestore.collection(c).get()).docs.map((d) => d.data());
const s = store as unknown as Record<string, unknown[]>;
for (const c of ['events', 'event_food_items', 'event_reviews', 'event_revenue_lines', 'revenue_items']) {
  s[c].length = 0;
  s[c].push(...(await load(c)));
}

const p = menuCodePreview();
console.log(`행사 메뉴 라인 ${p.total} — 매핑 ${p.mapped} · 코드 없음 ${p.no_code} · 식사없음 ${p.no_meal} · 모르는 메뉴 ${p.unknown}`);
console.log(`식수 기준 메뉴가 2개 이상인 행사(라인별 인원 입력 필요): ${p.multi_meal_events}`);
for (const r of p.rows) console.log(`  ${String(r.lines).padStart(4)}  ${r.event_type.padEnd(7)} ${r.menu_name.padEnd(18)} → ${r.code ?? '-'} (${r.status})`);

const miss = missingMealCountEvents();
console.log(`\n2026 이후 종료 · 식수 미입력 DEF 행사: ${miss.length}건`);
const byMonth = new Map<string, number>();
for (const m of miss) byMonth.set(m.start_datetime.slice(0, 7), (byMonth.get(m.start_datetime.slice(0, 7)) || 0) + 1);
console.log('  월별:', [...byMonth.entries()].sort().map(([k, n]) => `${k}:${n}`).join('  '));

if (storageKeyConfigured()) {
  const [mc, cg] = await Promise.all([getStorageMenuCost(month), getStorageCogs(month)]);
  const pnl = computeConventionPnl(month, mc.ok ? mc.data : null, cg.ok ? cg.data : null);
  const w = (n: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('ko-KR'));
  const pc = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
  console.log(`\n${month} 컨벤션 P&L (행사 ${pnl.event_count}) · 원가 ${mc.ok ? 200 : mc.status} · cogs ${cg.ok ? 200 : cg.status}`);
  for (const d of pnl.depts)
    console.log(`  ${d.dept}  식음매출 ${w(d.food_revenue)} · 이론원가 ${w(d.theoretical_cost)} (${pc(d.theoretical_cost_pct)}) · 실제원가 ${w(d.actual_cost)} (${pc(d.cost_pct)}) · 로스 ${w(d.loss)}`);
  console.log(`  합계  식음 ${w(pnl.total.food_revenue)} · 비식음 ${w(pnl.total.nonfood_revenue)} · COST% ${pc(pnl.total.cost_pct)} · 이론 ${pc(pnl.total.theoretical_cost_pct)}`);
  const i = pnl.issues;
  console.log(`  확인: 매출라인 없음 ${i.no_revenue_lines.length} · 식수 미입력 ${i.missing_meal_count.length} · 세트 2개 이상 ${i.multi_meal_needs_split.length} · 수량 없음 ${i.missing_quantity.length} · 코드 없는 라인 ${i.no_code_lines} · 스냅샷에 없는 코드 ${i.code_not_in_snapshot.join(',') || '-'} · 원가 일부 미확인 ${i.incomplete_menus.join(',') || '-'}`);
} else {
  console.log('\n(키 없음 — P&L 시험 계산은 건너뜀)');
}
process.exitCode = 0;
