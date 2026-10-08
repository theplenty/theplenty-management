// 웨딩 고객 유입 세부경로(source_detail) 값 정리 — 엑셀로 들어온 옛 값을 현재 옵션으로.
//   네이버 → 네이버검색 (2026-10-08 대표님 결정) · 선택안함 → 빈값 · 모르는 값 → 빈값
//   유입경로(source) 값이 세부경로 칸에 들어간 건은 source 가 비어 있으면 그쪽으로 옮긴다.
// 사용: npx tsx scripts/_cleanup-wedding-source-detail.ts [--apply]   (기본 dry-run)
import './_loadEnv.js';
import { normalizeWeddingSourceDetail } from '../src/types.js';
import type { WeddingSource } from '../src/types.js';

const APPLY = process.argv.includes('--apply');
const { firestore } = await import('../src/lib/firebase.js');
const snap = await firestore.collection('wedding_customers').get();

// 세부경로 칸에 잘못 들어간 유입경로 값 → source 로
const SOURCE_IN_DETAIL: Record<string, WeddingSource> = {
  '성모병원 (의사, 간호사)': '성모병원(의사 및 간호사)',
  '성모병원(의사 및 간호사)': '성모병원(의사 및 간호사)',
  워크인: '워크인',
};
const SOURCE_ALIAS: Record<string, WeddingSource> = { '성모병원 (의사, 간호사)': '성모병원(의사 및 간호사)' };

const tally = new Map<string, number>();
const bump = (k: string) => tally.set(k, (tally.get(k) || 0) + 1);
const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
for (const d of snap.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  const patch: Record<string, unknown> = {};
  const rawDetail = String(c.source_detail ?? '').trim();
  let source: string = String(c.source ?? '').trim();
  if (SOURCE_ALIAS[source]) {
    bump(`source: '${source}' → '${SOURCE_ALIAS[source]}'`);
    source = SOURCE_ALIAS[source];
    patch.source = source;
  }
  let detail: string;
  if (rawDetail && SOURCE_IN_DETAIL[rawDetail]) {
    detail = '';
    if (!source) {
      patch.source = SOURCE_IN_DETAIL[rawDetail];
      bump(`detail '${rawDetail}' → source '${SOURCE_IN_DETAIL[rawDetail]}' (source 비어 있어 이동)`);
    } else {
      bump(`detail '${rawDetail}' → '' (source 이미 '${source}')`);
    }
  } else {
    detail = normalizeWeddingSourceDetail(rawDetail);
    if (detail !== rawDetail) bump(`detail '${rawDetail || '(빈값)'}' → '${detail || '(빈값)'}'`);
  }
  if (detail !== rawDetail) patch.source_detail = detail;
  if (Object.keys(patch).length) updates.push({ id: c.id, patch });
}
console.log(`웨딩 고객 ${snap.size}건 중 수정 대상 ${updates.length}건`);
for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
if (!APPLY) {
  console.log('[dry-run] --apply 로 반영');
  process.exit(0);
}
const now = new Date().toISOString();
let batch = firestore.batch();
let n = 0;
for (const u of updates) {
  batch.update(firestore.collection('wedding_customers').doc(u.id), { ...u.patch, updated_at: now });
  if (++n % 400 === 0) {
    await batch.commit();
    batch = firestore.batch();
  }
}
if (n % 400 !== 0) await batch.commit();
console.log(`반영 완료: ${n}건`);
process.exit(0);
