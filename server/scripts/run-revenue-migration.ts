// 2026 매출 엑셀 데이터 → Firestore 일괄 마이그레이션 (독립 실행용)
// 서버 전체를 켜지 않고 이 스크립트만 실행하면 됩니다.
//
// 사용:
//   cd server
//   npx tsx scripts/run-revenue-migration.ts --dry-run   # 미리보기 (Firestore 쓰기 없음)
//   npx tsx scripts/run-revenue-migration.ts              # 실제 실행

import './_loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// ── JSON 파일 로드 ────────────────────────────────────────────────────────────
const jsonPath = path.resolve(__dirname, '../src/store/revenueExcel2026Data.json');
if (!fs.existsSync(jsonPath)) {
  console.error('[ERROR] revenueExcel2026Data.json 파일이 없습니다:', jsonPath);
  process.exit(1);
}
type ExcelRow = {
  no: string; date: string; status: string; event_name: string;
  discount_rate: number | null; gateway_fee: number | null;
  contract_date: string | null; contract_amount: number | null;
  sales_total_amount: number | null;
  items: Record<string, number | null>;
};
const excelRows: ExcelRow[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
console.log(`[init] 엑셀 데이터 로드: ${excelRows.length}건`);

// ── Firestore 연결 ────────────────────────────────────────────────────────────
const { firestore } = await import('../src/lib/firebase.js');

// ── Firestore에서 events / revenue_items 로드 ─────────────────────────────────
console.log('[init] Firestore에서 events 로드 중...');
const eventsSnap = await firestore.collection('events').get();
type FSEvent = {
  id: string; event_name: string; start_datetime: string; deleted_at?: string | null;
  sales_total_amount?: number | null;
  [key: string]: unknown;
};
const events: FSEvent[] = eventsSnap.docs
  .map((d) => ({ id: d.id, ...d.data() } as FSEvent))
  .filter((e) => !e.deleted_at);
console.log(`[init] events: ${events.length}건`);

console.log('[init] Firestore에서 revenue_items 로드 중...');
const riSnap = await firestore.collection('revenue_items').get();
type FSRevenueItem = { id: string; code: string; [key: string]: unknown };
const revenueItems: FSRevenueItem[] = riSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FSRevenueItem));
console.log(`[init] revenue_items: ${revenueItems.length}건`);

// ── revenue_items 없으면 자동 시드 ───────────────────────────────────────────
const REVENUE_ITEMS_SEED = [
  { code: 'CONV',      name_ko: '컨벤션이용료',   category: '공간', default_account: '4010', sort_order: 1  },
  { code: 'FOOD',      name_ko: 'Food',           category: '식음', default_account: '4020', sort_order: 2  },
  { code: 'CB',        name_ko: 'Coffee Break',   category: '식음', default_account: '4021', sort_order: 3  },
  { code: 'SNACK',     name_ko: 'Snack Plate',    category: '식음', default_account: '4022', sort_order: 4  },
  { code: 'BEV',       name_ko: 'Bev.',           category: '식음', default_account: '4023', sort_order: 5  },
  { code: 'CORKAGE',   name_ko: 'Corkage',        category: '식음', default_account: '4024', sort_order: 6  },
  { code: 'MEDIAWALL', name_ko: 'Media Wall/LCD', category: '장비', default_account: '4030', sort_order: 7  },
  { code: 'BOOTH',     name_ko: 'Booth',          category: '장비', default_account: '4031', sort_order: 8  },
  { code: 'STAGE',     name_ko: 'Stage/catering', category: '장비', default_account: '4032', sort_order: 9  },
  { code: 'SYSTEM',    name_ko: 'System',         category: '장비', default_account: '4033', sort_order: 10 },
  { code: 'FLOWER',    name_ko: 'Flower',         category: '장식', default_account: '4040', sort_order: 11 },
];

if (revenueItems.length === 0 && !DRY_RUN) {
  console.log('[seed] revenue_items 비어있음 → Firestore에 시드 데이터 등록 중...');
  const seedBatch = firestore.batch();
  const seedNow = new Date().toISOString();
  for (const item of REVENUE_ITEMS_SEED) {
    const id = nanoid(10);
    const ref = firestore.collection('revenue_items').doc(id);
    seedBatch.set(ref, { id, ...item, is_active: true, created_at: seedNow, updated_at: seedNow });
    revenueItems.push({ id, code: item.code } as FSRevenueItem);
  }
  await seedBatch.commit();
  console.log(`[seed] revenue_items ${REVENUE_ITEMS_SEED.length}건 등록 완료`);
} else if (revenueItems.length === 0 && DRY_RUN) {
  console.log('[DRY] revenue_items 비어있음 → 실행 시 자동 시드 예정');
}

// code → id 맵
const codeToId: Record<string, string> = {};
for (const ri of revenueItems) codeToId[ri.code] = ri.id;

// ── 단어 겹침 점수 ────────────────────────────────────────────────────────────
function overlap(a: string, b: string): number {
  const tokA = new Set(a.split(/[\s&()\-_,\.\/]+/).filter(Boolean));
  const tokB = new Set(b.split(/[\s&()\-_,\.\/]+/).filter(Boolean));
  let n = 0;
  for (const t of tokA) if (tokB.has(t)) n++;
  return n;
}

// ── 매칭 + Firestore 업데이트 ─────────────────────────────────────────────────
let matched = 0, skipped = 0, unmatched = 0, errors = 0;
const unmatchedRows: string[] = [];
const processedEventIds = new Set<string>(); // 이번 실행에서 이미 처리한 event ID 추적
const now = new Date().toISOString();

for (const row of excelRows) {
  if (!row.date || row.status === 'LOS') continue;

  // 같은 날짜 후보 (이번 실행에서 이미 처리한 이벤트 제외)
  const candidates = events.filter(
    (e) => e.start_datetime?.startsWith(row.date) && !processedEventIds.has(e.id)
  );
  if (candidates.length === 0) {
    unmatched++;
    unmatchedRows.push(`${row.date} | ${row.event_name}`);
    continue;
  }

  // 행사명 겹침으로 최고 매칭
  let target = candidates[0];
  if (candidates.length > 1) {
    let best = -1;
    for (const ev of candidates) {
      const score = overlap(row.event_name, ev.event_name ?? '');
      if (score > best) { best = score; target = ev; }
    }
  }

  // 이미 sales_total_amount 있으면 스킵
  if (target.sales_total_amount != null) {
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`[DRY] 매칭: "${row.event_name}" → "${target.event_name}" (${row.date}) | 계약 ${row.contract_amount?.toLocaleString()} | 실매출 ${row.sales_total_amount?.toLocaleString()}`);
    processedEventIds.add(target.id);
    matched++;
    continue;
  }

  // ── Firestore 쓰기 (배치) ──────────────────────────────────────────────────
  try {
    const batch = firestore.batch();

    // events 문서 업데이트
    batch.update(firestore.collection('events').doc(target.id), {
      contract_amount: row.contract_amount ?? null,
      sales_total_amount: row.sales_total_amount ?? null,
      discount_rate: row.discount_rate ?? null,
      discount_reason: '',
      contract_date: row.contract_date ?? null,
      gateway_fee: row.gateway_fee ?? null,
      updated_at: now,
    });

    // 기존 revenue_lines 삭제 후 재생성
    const existingLines = await firestore
      .collection('event_revenue_lines')
      .where('event_id', '==', target.id)
      .get();
    for (const doc of existingLines.docs) {
      batch.delete(doc.ref);
    }

    // 새 revenue_lines 추가
    for (const [code, amount] of Object.entries(row.items)) {
      if (amount == null || !codeToId[code]) continue;
      const lineId = nanoid(10);
      batch.set(firestore.collection('event_revenue_lines').doc(lineId), {
        id: lineId,
        event_id: target.id,
        revenue_item_id: codeToId[code],
        amount,
        note: '',
        created_at: now,
        updated_at: now,
      });
    }

    await batch.commit();
    processedEventIds.add(target.id);
    matched++;

    if (matched % 10 === 0) {
      process.stdout.write(`\r  처리 중: 매칭 ${matched}건...`);
    }
  } catch (e) {
    console.error(`\n[ERROR] ${row.date} ${row.event_name}:`, e);
    errors++;
  }
}

// ── 결과 출력 ─────────────────────────────────────────────────────────────────
console.log('\n');
console.log('═'.repeat(60));
console.log(`결과: 매칭 ${matched}건 | 기존재 스킵 ${skipped}건 | 미매칭 ${unmatched}건 | 오류 ${errors}건`);
if (DRY_RUN) console.log('※ DRY-RUN 모드 — Firestore에 쓰지 않았습니다.');

if (unmatchedRows.length > 0) {
  console.log('\n미매칭 행사 (날짜·행사명 불일치):');
  for (const r of unmatchedRows) console.log(`  - ${r}`);
}
console.log('═'.repeat(60));
process.exit(0);
