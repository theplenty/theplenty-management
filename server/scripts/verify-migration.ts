// JSON 원본 vs Firestore 정합성 비교 + Markdown 리포트 생성.
// 사용: cd server && npx tsx scripts/verify-migration.ts

import './_loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const REPORT_PATH = path.resolve(__dirname, '../../docs/MIGRATION_REPORT.md');

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

interface VerifyRow {
  collection: string;
  jsonCount: number;
  fsCount: number;
  match: boolean;
  sampleId: string | null;
  sampleMatch: boolean;
  sampleDiff: string[];
}

function readJsonCollection(name: string): Array<Record<string, unknown>> {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf-8');
  if (!raw.trim()) return [];
  return JSON.parse(raw) as Array<Record<string, unknown>>;
}

// 두 객체를 깊이 비교, 차이 키 경로 반환
function deepDiff(a: unknown, b: unknown, prefix = ''): string[] {
  if (a === b) return [];
  if (a === null || b === null) return [`${prefix}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
  if (typeof a !== typeof b) return [`${prefix}: type ${typeof a} ≠ ${typeof b}`];
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${prefix}: array mismatch`];
    if (a.length !== b.length) return [`${prefix}: length ${a.length} ≠ ${b.length}`];
    const diffs: string[] = [];
    for (let i = 0; i < a.length; i++) {
      diffs.push(...deepDiff(a[i], b[i], `${prefix}[${i}]`));
    }
    return diffs;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    const diffs: string[] = [];
    for (const k of keys) {
      diffs.push(
        ...deepDiff(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          prefix ? `${prefix}.${k}` : k
        )
      );
    }
    return diffs;
  }
  return [`${prefix}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
}

async function verifyCollection(name: string): Promise<VerifyRow> {
  const { firestore } = await import('../src/lib/firebase.js');
  const jsonDocs = readJsonCollection(name);
  const collRef = firestore.collection(name);
  const countSnap = await collRef.count().get();
  const fsCount = countSnap.data().count;

  let sampleId: string | null = null;
  let sampleMatch = true;
  let sampleDiff: string[] = [];

  if (jsonDocs.length > 0) {
    // 무작위 샘플 1건 비교 (마지막 doc — 가장 최근 데이터)
    const sample = jsonDocs[jsonDocs.length - 1];
    sampleId = sample.id as string;
    if (sampleId) {
      const fsSnap = await collRef.doc(sampleId).get();
      if (!fsSnap.exists) {
        sampleMatch = false;
        sampleDiff = [`Firestore에 doc 없음`];
      } else {
        const fsData = fsSnap.data();
        // JSON 원본의 undefined 필드는 Firestore에선 누락되거나 null로 변환되었을 수 있음
        // sanitize 후 비교
        function strip(v: unknown): unknown {
          if (v === undefined) return null;
          if (Array.isArray(v)) return v.map(strip);
          if (v && typeof v === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
              if (val === undefined) continue;
              out[k] = strip(val);
            }
            return out;
          }
          return v;
        }
        const diffs = deepDiff(strip(sample), strip(fsData));
        if (diffs.length > 0) {
          sampleMatch = false;
          sampleDiff = diffs.slice(0, 5); // 최대 5개만
        }
      }
    }
  }

  return {
    collection: name,
    jsonCount: jsonDocs.length,
    fsCount,
    match: jsonDocs.length === fsCount,
    sampleId,
    sampleMatch,
    sampleDiff,
  };
}

async function main() {
  console.log(`\n검증 시작 — 프로젝트: ${process.env.FIREBASE_PROJECT_ID}\n`);
  const rows: VerifyRow[] = [];
  for (const name of COLLECTIONS) {
    process.stdout.write(`  검증 중: ${name}... `);
    const r = await verifyCollection(name);
    rows.push(r);
    const countOk = r.match ? '✅' : '❌';
    const sampleOk = r.sampleId ? (r.sampleMatch ? '✅' : '❌') : '➖';
    console.log(`count ${countOk} sample ${sampleOk}  (${r.jsonCount} → ${r.fsCount})`);
  }

  // 결과 출력
  console.log('\n' + '='.repeat(70));
  console.log('정합성 검증 결과');
  console.log('='.repeat(70));
  let allOk = true;
  for (const r of rows) {
    const status = r.match && (r.sampleId === null || r.sampleMatch) ? '✅' : '❌';
    if (status === '❌') allOk = false;
    console.log(
      `${status} ${r.collection.padEnd(22)} JSON=${String(r.jsonCount).padStart(5)} FS=${String(r.fsCount).padStart(5)} ${
        r.sampleId ? (r.sampleMatch ? '샘플일치' : '샘플불일치!') : ''
      }`
    );
    if (!r.sampleMatch && r.sampleDiff.length > 0) {
      for (const d of r.sampleDiff) console.log(`    └ ${d}`);
    }
  }
  console.log('='.repeat(70));

  // Markdown 리포트 생성
  const now = new Date().toISOString();
  let md = `# Firestore 마이그레이션 검증 리포트\n\n`;
  md += `**생성 시각**: ${now}\n`;
  md += `**프로젝트**: \`${process.env.FIREBASE_PROJECT_ID}\`\n\n`;
  md += `## 결과 요약\n\n`;
  md += `| 컬렉션 | JSON 원본 | Firestore | 카운트 일치 | 샘플 doc 일치 |\n`;
  md += `|---|--:|--:|:-:|:-:|\n`;
  for (const r of rows) {
    const countMark = r.match ? '✅' : '❌';
    const sampleMark = r.sampleId === null ? '➖' : r.sampleMatch ? '✅' : '❌';
    md += `| \`${r.collection}\` | ${r.jsonCount} | ${r.fsCount} | ${countMark} | ${sampleMark} |\n`;
  }
  md += `\n`;
  const failed = rows.filter((r) => !r.match || (r.sampleId && !r.sampleMatch));
  if (failed.length > 0) {
    md += `## 불일치 상세\n\n`;
    for (const r of failed) {
      md += `### ${r.collection}\n\n`;
      if (!r.match) md += `- **카운트 불일치**: JSON ${r.jsonCount} ≠ Firestore ${r.fsCount}\n`;
      if (r.sampleId && !r.sampleMatch) {
        md += `- **샘플 doc 불일치** (\`${r.sampleId}\`):\n`;
        for (const d of r.sampleDiff) md += `  - \`${d}\`\n`;
      }
      md += `\n`;
    }
  } else {
    md += `## ✅ 전체 정합성 PASS\n\n`;
    md += `모든 컬렉션의 카운트와 샘플 doc이 JSON 원본과 100% 일치합니다.\n`;
  }
  md += `\n---\n\n`;
  md += `_이 리포트는 \`server/scripts/verify-migration.ts\` 가 자동 생성합니다._\n`;

  fs.writeFileSync(REPORT_PATH, md, 'utf-8');
  console.log(`\n📄 리포트 저장: ${REPORT_PATH}`);

  if (allOk) {
    console.log('\n✅ Phase 2 PASS — 모든 컬렉션 정합성 일치');
    process.exit(0);
  } else {
    console.log('\n❌ Phase 2 FAIL — 위 불일치 항목 확인 필요');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n검증 실패:', e);
  process.exit(1);
});
