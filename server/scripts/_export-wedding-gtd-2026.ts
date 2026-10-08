// 읽기 전용 — 2026년 WEDDING 행사의 GTD/EXP(기본정보) + 행사리뷰 식사 인원을 엑셀로 뽑는다.
// 사용: npx tsx scripts/_export-wedding-gtd-2026.ts  → server/_out/ 에 저장 (git 제외)
import './_loadEnv.js';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// exceljs 는 client 쪽에만 설치돼 있다 — server 에 의존성을 늘리지 않고 빌려 쓴다
const ExcelJS = createRequire(path.resolve(process.cwd(), '../client/package.json'))('exceljs');

const YEAR = '2026';
const { firestore } = await import('../src/lib/firebase.js');
const [evSnap, foodSnap, revSnap] = await Promise.all([
  firestore.collection('events').get(),
  firestore.collection('event_food_items').get(),
  firestore.collection('event_reviews').get(),
]);

const foodsByEvent = new Map<string, any[]>();
for (const d of foodSnap.docs) {
  const f = d.data() as any;
  if (!foodsByEvent.has(f.event_id)) foodsByEvent.set(f.event_id, []);
  foodsByEvent.get(f.event_id)!.push(f);
}
const reviewByEvent = new Map<string, any>();
for (const d of revSnap.docs) {
  const r = d.data() as any;
  reviewByEvent.set(r.event_id, r);
}

// 화면(캘린더·행사 기본정보)과 같은 규칙: 메뉴 행 합계, 없으면 옛 행사 단위 값
type F = 'gtd_contract' | 'gtd_final' | 'exp_contract' | 'exp_final';
function sumField(ev: any, field: F): number | null {
  let sum = 0;
  let any = false;
  for (const it of foodsByEvent.get(ev.id) || []) {
    if (it[field] != null) {
      sum += Number(it[field]);
      any = true;
    }
  }
  if (any) return sum;
  const legacy = ev[`food_${field}`];
  return legacy != null ? Number(legacy) : null;
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const events = evSnap.docs
  .map((d) => d.data() as any)
  .filter((e) => !e.deleted_at && e.event_type === 'WEDDING' && (e.start_datetime || '').startsWith(YEAR))
  .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1));

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet(`${YEAR} 웨딩`);
ws.columns = [
  { header: '행사일', key: 'date', width: 12 },
  { header: '요일', key: 'wd', width: 6 },
  { header: '시간', key: 'time', width: 8 },
  { header: '상태', key: 'status', width: 10 },
  { header: '행사명', key: 'name', width: 34 },
  { header: '홀', key: 'halls', width: 16 },
  { header: 'GTD(계약)', key: 'gtdC', width: 11 },
  { header: 'GTD(최종)', key: 'gtdF', width: 11 },
  { header: 'EXP(계약)', key: 'expC', width: 11 },
  { header: 'EXP(최종)', key: 'expF', width: 11 },
  { header: '실제 식사 인원', key: 'actual', width: 14 },
  { header: '결제 식사 인원', key: 'paid', width: 14 },
  { header: '리뷰 작성', key: 'hasReview', width: 10 },
];
ws.getRow(1).font = { bold: true };
ws.views = [{ state: 'frozen', ySplit: 1 }];

const byStatus: Record<string, number> = {};
let withReview = 0;
let withGtd = 0;
for (const e of events) {
  const date = (e.start_datetime || '').slice(0, 10);
  const rv = reviewByEvent.get(e.id);
  const gtdC = sumField(e, 'gtd_contract');
  const gtdF = sumField(e, 'gtd_final');
  if (rv) withReview++;
  if (gtdC != null || gtdF != null) withGtd++;
  byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  ws.addRow({
    date,
    wd: WD[new Date(date + 'T00:00:00').getDay()],
    time: (e.start_datetime || '').slice(11, 16),
    status: e.status,
    name: e.event_name || '',
    halls: (e.halls || []).join(' / '),
    gtdC,
    gtdF,
    expC: sumField(e, 'exp_contract'),
    expF: sumField(e, 'exp_final'),
    actual: rv?.actual_meal_count ?? null,
    paid: rv?.paid_meal_count ?? null,
    hasReview: rv ? 'O' : '',
  });
}
ws.autoFilter = { from: 'A1', to: 'M1' };

const outDir = path.resolve(process.cwd(), '_out');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `웨딩_GTD-EXP_식사인원_${YEAR}.xlsx`);
await wb.xlsx.writeFile(out);

// 고객 이름은 콘솔에 찍지 않는다 — 건수만
console.log(`2026 WEDDING 행사 ${events.length}건 / GTD 입력 ${withGtd}건 / 리뷰 있음 ${withReview}건`);
console.log('상태별:', JSON.stringify(byStatus));
console.log('저장:', out);
process.exit(0);
