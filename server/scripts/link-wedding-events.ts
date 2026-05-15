// 일괄 import 된 WEDDING 행사들을 같은 이름의 WEDDING 고객과 자동 연결.
// 매칭 규칙: event.event_name === customer.wedding_event_name
//           (양쪽 모두 앞 특수기호 ★ ♣ ♠ 등과 공백 제거 후 비교)
//
// 부수효과: 매칭된 행사의 assigned_manager_id/name 가 비어있으면
//          연결된 고객의 첫 예식후보 담당지배인으로 자동 채움.
//
// 사용:
//   cd server
//   npx tsx scripts/link-wedding-events.ts          # dry-run (제안 목록 출력)
//   npx tsx scripts/link-wedding-events.ts --apply  # 실제 연결 생성

import './_loadEnv.js';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apply = process.argv.includes('--apply');

// 출력 디렉토리: server/_out/ (gitignored 권장 — server/data 와 같은 카테고리)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../_out');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// 엑셀에서 한글 깨지지 않게 UTF-8 BOM 으로 저장
function writeCsv(file: string, rows: string[][]) {
  const escape = (v: string) => {
    if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  };
  const body = rows.map((r) => r.map(escape).join(',')).join('\r\n');
  fs.writeFileSync(file, '﻿' + body, 'utf-8');
}

const { firestore } = await import('../src/lib/firebase.js');

// 비교용 normalize — 앞 특수기호/공백 제거 + 전체 공백 제거 + 소문자.
const NORMALIZE_PREFIX_RE = /^[★♣♠♥♦◆▲●○☆♡△▽■□*~\-\s]+/;
function normalize(s: string): string {
  return (s || '')
    .replace(NORMALIZE_PREFIX_RE, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

interface EventRow {
  id: string;
  event_type: string;
  event_name: string;
  assigned_manager_id?: string;
  assigned_manager_name?: string;
}
interface WeddingInquiryShape {
  assigned_manager_id?: string;
  assigned_manager_name?: string;
}
interface WCust {
  id: string;
  wedding_event_name: string;
  event_inquiries?: WeddingInquiryShape[];
}
interface Link {
  id: string;
  event_id: string;
  customer_id: string;
}

console.log('\n📥 데이터 로드 중...');
const [evSnap, cusSnap, linkSnap] = await Promise.all([
  firestore.collection('events').get(),
  firestore.collection('wedding_customers').get(),
  firestore.collection('event_customers').get(),
]);

const events: EventRow[] = evSnap.docs.map((d) => d.data() as EventRow);
const customers: WCust[] = cusSnap.docs.map((d) => d.data() as WCust);
const links: Link[] = linkSnap.docs.map((d) => d.data() as Link);

const weddingEvents = events.filter((e) => e.event_type === 'WEDDING');
const linkedEventIds = new Set(links.map((l) => l.event_id));

console.log(`  · WEDDING 행사: ${weddingEvents.length}건`);
console.log(`  · WEDDING 고객: ${customers.length}건`);
console.log(`  · 기존 event_customers 연결: ${links.length}건\n`);

// 고객 인덱스: normalize(wedding_event_name) -> WCust[]
const cusByName = new Map<string, WCust[]>();
for (const c of customers) {
  const k = normalize(c.wedding_event_name);
  if (!k) continue;
  const arr = cusByName.get(k) || [];
  arr.push(c);
  cusByName.set(k, arr);
}

let matched = 0;
let alreadyLinked = 0;
let noMatch = 0;
let ambiguous = 0;

const proposals: Array<{ event: EventRow; customer: WCust }> = [];
const noMatchList: EventRow[] = [];
const ambiguousList: Array<{ event: EventRow; candidates: WCust[] }> = [];

for (const ev of weddingEvents) {
  if (linkedEventIds.has(ev.id)) {
    alreadyLinked++;
    continue;
  }
  const k = normalize(ev.event_name);
  const candidates = cusByName.get(k) || [];
  if (candidates.length === 0) {
    noMatch++;
    noMatchList.push(ev);
    continue;
  }
  if (candidates.length > 1) {
    ambiguous++;
    ambiguousList.push({ event: ev, candidates });
    continue;
  }
  proposals.push({ event: ev, customer: candidates[0] });
  matched++;
}

console.log('📊 매칭 결과');
console.log(`  ✅ 매칭 가능:        ${matched}건`);
console.log(`  ⏭  이미 연결됨:     ${alreadyLinked}건`);
console.log(`  ❌ 매칭 실패:        ${noMatch}건`);
console.log(`  ⚠️  후보 다수 (스킵): ${ambiguous}건\n`);

if (noMatchList.length > 0) {
  console.log(`❌ 매칭 실패 (${noMatchList.length}건) — 고객DB에 같은 이름의 행사가 없음:`);
  for (const e of noMatchList.slice(0, 30)) console.log(`  · ${e.event_name}`);
  if (noMatchList.length > 30) console.log(`  ... 외 ${noMatchList.length - 30}건`);
  console.log('');
}

if (ambiguousList.length > 0) {
  console.log(`⚠️  후보가 둘 이상 (${ambiguousList.length}건) — 수동 확인 필요:`);
  for (const { event, candidates } of ambiguousList.slice(0, 20)) {
    console.log(`  · ${event.event_name}`);
    for (const c of candidates) console.log(`      → ${c.wedding_event_name} (id=${c.id})`);
  }
  if (ambiguousList.length > 20) console.log(`  ... 외 ${ambiguousList.length - 20}건`);
  console.log('');
}

if (!apply) {
  console.log(`✅ 매칭 가능 항목 (${proposals.length}건) 미리보기:`);
  for (const { event, customer } of proposals.slice(0, 30)) {
    const tag =
      event.event_name === customer.wedding_event_name
        ? ''
        : `  (원본: "${customer.wedding_event_name}")`;
    console.log(`  · ${event.event_name}${tag}`);
  }
  if (proposals.length > 30) console.log(`  ... 외 ${proposals.length - 30}건`);

  // CSV 출력 — 수동 검토용
  const matchesFile = path.join(OUT_DIR, 'wedding_link_matches.csv');
  writeCsv(matchesFile, [
    ['event_id', 'event_name', 'customer_id', 'customer_wedding_event_name'],
    ...proposals.map(({ event, customer }) => [
      event.id,
      event.event_name,
      customer.id,
      customer.wedding_event_name,
    ]),
  ]);

  const noMatchFile = path.join(OUT_DIR, 'wedding_link_no_match.csv');
  writeCsv(noMatchFile, [
    ['event_id', 'event_name'],
    ...noMatchList.map((e) => [e.id, e.event_name]),
  ]);

  // ambiguous 는 한 행사당 후보가 여러개라 long-form 으로 풀어서 저장
  const ambiguousFile = path.join(OUT_DIR, 'wedding_link_ambiguous.csv');
  const ambiguousRows: string[][] = [
    ['event_id', 'event_name', 'candidate_customer_id', 'candidate_customer_name'],
  ];
  for (const { event, candidates } of ambiguousList) {
    for (const c of candidates) {
      ambiguousRows.push([event.id, event.event_name, c.id, c.wedding_event_name]);
    }
  }
  writeCsv(ambiguousFile, ambiguousRows);

  console.log('\n📄 CSV 파일 (엑셀에서 바로 열기 가능 — UTF-8 BOM):');
  console.log(`   · 매칭 가능:   ${matchesFile}`);
  console.log(`   · 매칭 실패:   ${noMatchFile}`);
  console.log(`   · 후보 다수:   ${ambiguousFile}`);
  console.log('\n💡 실제로 연결하려면:  npx tsx scripts/link-wedding-events.ts --apply\n');
  process.exit(0);
}

console.log(`🔄 연결 생성 중 (${proposals.length}건)...`);
let created = 0;
let managerUpdated = 0;

let batch = firestore.batch();
let batchCount = 0;
async function flush() {
  if (batchCount === 0) return;
  await batch.commit();
  batch = firestore.batch();
  batchCount = 0;
}

for (const { event, customer } of proposals) {
  const linkId = nanoid(10);
  batch.set(firestore.collection('event_customers').doc(linkId), {
    id: linkId,
    event_id: event.id,
    customer_id: customer.id,
    customer_role: '주최사',
    is_contact_point: true,
    // WEDDING은 'groom'/'bride' 또는 빈 문자열. 클라이언트가 빈 값일 때 자동 선택하므로 ''로 둠.
    contact_point_contact_id: '',
  });
  batchCount++;
  created++;

  // 담당지배인 auto-fill — event.assigned_manager_id 가 비어있을 때만
  const inq = customer.event_inquiries?.[0];
  const inqMgrId = inq?.assigned_manager_id || '';
  const inqMgrName = inq?.assigned_manager_name || '';
  const eventHasManager = !!(event.assigned_manager_id || event.assigned_manager_name);
  if (!eventHasManager && (inqMgrId || inqMgrName)) {
    batch.update(firestore.collection('events').doc(event.id), {
      assigned_manager_id: inqMgrId,
      assigned_manager_name: inqMgrName,
    });
    batchCount++;
    managerUpdated++;
  }

  // Firestore batch 한도 (500 ops). 안전하게 400 마다 flush.
  if (batchCount >= 400) await flush();
}
await flush();

console.log('\n✅ 완료');
console.log(`  · 행사-고객 연결 생성:   ${created}건`);
console.log(`  · 담당지배인 자동 입력:   ${managerUpdated}건`);
console.log(
  '\n⚠️  Cloud Functions가 캐싱한 데이터는 cold-start 시 다시 hydrate됩니다.'
);
console.log('   바로 반영하려면 firebase deploy 또는 functions:log 모니터링.\n');

process.exit(0);
