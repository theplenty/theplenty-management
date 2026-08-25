/**
 * 웨딩 진행단계 ↔ 행사 상태 불일치 일괄 정리 (W2).
 * 사용: npx tsx scripts/fix-wedding-stage-mismatch.ts [--apply]
 *
 * 사장님 확정(2026-08-25): 행사 상태가 진실이므로 대표 행사에 맞춰 고객 단계를 내린다.
 * 취소(LOS)도 자동 반영 — 홀딩을 놓치면 그 딜은 끝난 것으로 본다.
 * 재상담이 시작되면 화면에서 단계를 되돌리면 되고, 그때는 '수동 지정' 배지가 붙는다.
 *
 * --apply 없이 돌리면 무엇이 바뀔지만 출력한다. 적용 시 원본을 data/ 에 백업한다.
 */
import './_loadEnv.js';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const { firestore } = await import('../src/lib/firebase.js');

const [wed, evs, evc] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
]);

interface Ev {
  id: string;
  event_name?: string;
  status?: string;
  start_datetime?: string;
  event_type?: string;
  deleted_at?: string | null;
}

const EVENT_TO_STAGE: Record<string, string | undefined> = {
  INQ: 'INQ',
  DEF: 'DEF',
  LOS: 'LOS',
  상담취소: '상담취소',
};
const CANCELLED = ['LOS', '상담취소', '미팅취소'];

const evMap = new Map<string, Ev>(evs.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Ev) }]));
const byCust = new Map<string, Ev[]>();
for (const d of evc.docs) {
  const l = d.data() as { customer_id: string; event_id: string };
  const e = evMap.get(l.event_id);
  if (!e || e.deleted_at || e.event_type !== 'WEDDING') continue;
  if (!EVENT_TO_STAGE[e.status || '']) continue;
  const a = byCust.get(l.customer_id) || [];
  a.push(e);
  byCust.set(l.customer_id, a);
}

function representative(custId: string): Ev | null {
  const list = byCust.get(custId) || [];
  if (!list.length) return null;
  const live = list.filter((e) => !CANCELLED.includes(e.status || ''));
  const pool = live.length ? live : list;
  return [...pool].sort((a, b) => ((a.start_datetime || '') < (b.start_datetime || '') ? 1 : -1))[0];
}

interface Fix {
  id: string;
  name: string;
  from: string;
  to: string;
  eventStatus: string;
  eventDate: string;
}
const fixes: Fix[] = [];
const backup: Record<string, unknown>[] = [];

for (const d of wed.docs) {
  const c = d.data() as { progress_status?: string; wedding_event_name?: string; deleted_at?: string | null };
  if (c.deleted_at) continue;
  const ev = representative(d.id);
  if (!ev) continue;
  const want = EVENT_TO_STAGE[ev.status || ''];
  if (!want || want === c.progress_status) continue;
  fixes.push({
    id: d.id,
    name: c.wedding_event_name || '',
    from: c.progress_status || '(없음)',
    to: want,
    eventStatus: ev.status || '',
    eventDate: (ev.start_datetime || '').slice(0, 10),
  });
  backup.push({ id: d.id, progress_status: c.progress_status });
}

const byKind = new Map<string, number>();
for (const f of fixes) byKind.set(`${f.from} → ${f.to}`, (byKind.get(`${f.from} → ${f.to}`) || 0) + 1);

console.log(`불일치 ${fixes.length}건${APPLY ? ' — 적용합니다' : ' (미리보기, 적용하려면 --apply)'}\n`);
console.log('유형별:');
[...byKind.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}건  ${k}`));
console.log('\n상세:');
for (const f of fixes) {
  console.log(`  ${f.eventDate} 행사 ${f.eventStatus.padEnd(5)} · 고객 ${f.from} → ${f.to}  ${f.name}`);
}

if (!APPLY) {
  console.log('\n적용하려면: npx tsx scripts/fix-wedding-stage-mismatch.ts --apply');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const path = `data/wedding-stage-fix-backup-${stamp}.json`;
fs.writeFileSync(path, JSON.stringify(backup, null, 2), 'utf-8');
console.log(`\n원본 백업: ${path}`);

let done = 0;
for (const f of fixes) {
  await firestore.collection('wedding_customers').doc(f.id).update({
    progress_status: f.to,
    stage_manual_at: null,
    stage_manual_by_name: '',
    updated_at: new Date().toISOString(),
  });
  done++;
  if (done % 20 === 0) console.log(`  ...${done}/${fixes.length}`);
}
console.log(`\n완료: ${done}건 반영. 화면에 보이려면 functions 재배포가 필요합니다(hydrate 캐시).`);
