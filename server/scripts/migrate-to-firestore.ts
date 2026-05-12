// JSON 파일 → Firestore 일괄 마이그레이션.
// 사용:
//   cd server && npx tsx scripts/migrate-to-firestore.ts --dry-run     # 미리보기 (쓰기 안 함)
//   cd server && npx tsx scripts/migrate-to-firestore.ts                # 실제 실행
//   cd server && npx tsx scripts/migrate-to-firestore.ts --only users   # 특정 컬렉션만

import './_loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

// 의존성 순서대로 마이그레이션
const COLLECTIONS = [
  'users',
  'mice_customers',
  'wedding_customers',
  'events',
  'event_customers',
  'event_food_items',
  'invoices',
  'event_files',
  'cancellations',
  'event_reviews',
  'calendar_shares',
  'sales_targets',
  'change_logs',
] as const;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const onlyIdx = args.indexOf('--only');
const onlyCollection = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

interface MigrationResult {
  collection: string;
  jsonCount: number;
  firestoreCount: number;
  written: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

function readJsonCollection(name: string): unknown[] {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8');
  if (!raw.trim()) return [];
  return JSON.parse(raw) as unknown[];
}

// undefined 필드는 Firestore가 거부 → 깊게 sanitize
function sanitize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return value;
}

async function migrateCollection(name: string): Promise<MigrationResult> {
  const t0 = Date.now();
  const docs = readJsonCollection(name);
  const result: MigrationResult = {
    collection: name,
    jsonCount: docs.length,
    firestoreCount: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
  };

  if (docs.length === 0) {
    console.log(`  [SKIP] ${name}: JSON 비어있음`);
    return result;
  }

  if (dryRun) {
    console.log(`  [DRY-RUN] ${name}: ${docs.length}건 쓸 예정`);
    result.skipped = docs.length;
    result.durationMs = Date.now() - t0;
    return result;
  }

  const { firestore } = await import('../src/lib/firebase.js');
  const collRef = firestore.collection(name);
  const BATCH_SIZE = 400; // Firestore 한도 500, 안전 마진

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const slice = docs.slice(i, i + BATCH_SIZE);
    const batch = firestore.batch();
    for (const doc of slice) {
      const obj = doc as Record<string, unknown>;
      const id = obj.id as string;
      if (!id || typeof id !== 'string') {
        result.failed++;
        continue;
      }
      batch.set(collRef.doc(id), sanitize(obj) as Record<string, unknown>);
    }
    try {
      await batch.commit();
      result.written += slice.length;
      process.stdout.write(`\r  [WRITE] ${name}: ${result.written}/${docs.length}`);
    } catch (e) {
      console.error(`\n  [BATCH FAIL] ${name} batch starting at ${i}:`, e);
      result.failed += slice.length;
    }
  }
  process.stdout.write('\n');

  // 실제 Firestore 카운트 검증
  const snap = await collRef.count().get();
  result.firestoreCount = snap.data().count;
  result.durationMs = Date.now() - t0;
  return result;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Firestore 마이그레이션');
  console.log(`  모드: ${dryRun ? 'DRY RUN (쓰기 안 함)' : 'LIVE WRITE'}`);
  console.log(`  대상: ${onlyCollection || '전체 13개 컬렉션'}`);
  console.log(`  프로젝트: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log('='.repeat(60));

  const targets = onlyCollection
    ? COLLECTIONS.filter((c) => c === onlyCollection)
    : COLLECTIONS;

  if (targets.length === 0) {
    console.error(`알 수 없는 컬렉션: ${onlyCollection}`);
    process.exit(1);
  }

  const results: MigrationResult[] = [];
  for (const name of targets) {
    console.log(`\n[${name}]`);
    const r = await migrateCollection(name);
    results.push(r);
  }

  console.log('\n' + '='.repeat(60));
  console.log('결과 요약');
  console.log('='.repeat(60));
  console.log(
    'collection'.padEnd(22) +
      'JSON'.padStart(8) +
      'Firestore'.padStart(11) +
      'written'.padStart(9) +
      'failed'.padStart(8) +
      'ms'.padStart(8)
  );
  console.log('-'.repeat(66));
  let totalJson = 0;
  let totalFs = 0;
  let totalFailed = 0;
  for (const r of results) {
    totalJson += r.jsonCount;
    totalFs += r.firestoreCount;
    totalFailed += r.failed;
    console.log(
      r.collection.padEnd(22) +
        String(r.jsonCount).padStart(8) +
        String(r.firestoreCount).padStart(11) +
        String(r.written).padStart(9) +
        String(r.failed).padStart(8) +
        String(r.durationMs).padStart(8)
    );
  }
  console.log('-'.repeat(66));
  console.log(
    'TOTAL'.padEnd(22) +
      String(totalJson).padStart(8) +
      String(totalFs).padStart(11) +
      ''.padStart(9) +
      String(totalFailed).padStart(8)
  );
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\nℹ️  DRY RUN 완료. 실제 적용하려면 --dry-run 빼고 다시 실행.');
  } else if (totalFailed === 0 && totalJson === totalFs) {
    console.log('\n✅ 마이그레이션 성공 — 모든 카운트 일치');
  } else if (totalFailed > 0) {
    console.log(`\n❌ ${totalFailed}건 실패 — 위 로그 확인 필요`);
    process.exit(1);
  } else {
    console.log(
      `\n⚠️  카운트 불일치: JSON=${totalJson}, Firestore=${totalFs}. verify 스크립트로 상세 확인 권장.`
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ 마이그레이션 실패:', e);
  process.exit(1);
});
