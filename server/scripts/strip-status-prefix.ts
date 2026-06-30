// 행사명 앞에 수기로 붙인 상태 접두어(DEF_, INQ_, LOS_, TEN_ 등) 일괄 제거.
// 캘린더에 상태가 [DEF]로 병기되면서 이름 앞 접두어가 중복이 됨.
//
// 사용:
//   cd server
//   npx tsx scripts/strip-status-prefix.ts            # DRY-RUN (읽기전용, 변경 없음) — 기본
//   npx tsx scripts/strip-status-prefix.ts --apply    # 실제 적용 (Firestore 업데이트)
//
// 안전장치: 영문 상태코드(INQ/DEF/LOS/TEN)가 구분자(_, 공백, -, :)와 함께
// 행사명 맨 앞에 있을 때만 제거. 한글 이름 오제거 방지. 제거 후 이름이 비면 건너뜀.

import './_loadEnv.js';

const APPLY = process.argv.slice(2).includes('--apply');

// 영문 상태코드 + 구분자 접두어. 코드는 대소문자 무시.
const PREFIX_RE = /^\s*(INQ|DEF|LOS|TEN)[\s_\-.:]+/i;

// 정규식 메타문자 이스케이프 (한글 상태값을 안전하게 RegExp로)
function escRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function strip(name: string, status?: string): string {
  let out = name;
  // 1) 영문 상태코드 접두어 (DEF_/INQ_/LOS_/TEN_) — "DEF_INQ_"처럼 중복도 반복 제거
  while (PREFIX_RE.test(out)) out = out.replace(PREFIX_RE, '');
  // 2) 해당 행사의 '실제 상태'와 일치하는 접두어만 제거 (한글 미팅/시식/상담취소 등 안전 처리).
  //    자기 상태와 똑같은 글자가 맨 앞에 있을 때만 떼므로 오제거 불가능.
  if (status) {
    const stRe = new RegExp(`^\\s*${escRe(status)}[\\s_\\-.:]+`);
    while (stRe.test(out)) out = out.replace(stRe, '');
  }
  return out.trim();
}

const { firestore } = await import('../src/lib/firebase.js');

const snap = await firestore.collection('events').get();
console.log(`[init] events ${snap.size}건 로드`);

interface Hit { id: string; before: string; after: string; }
const hits: Hit[] = [];
let blanked = 0;

snap.forEach((doc) => {
  const data = doc.data() as { event_name?: string; status?: string; deleted_at?: string | null };
  const name = (data.event_name || '').toString();
  if (!name) return;
  const after = strip(name, data.status);
  if (after === name) return; // 변경 없음
  if (!after) { blanked++; return; } // 접두어 떼면 이름이 비어버림 → 보존(건너뜀)
  hits.push({ id: doc.id, before: name, after });
});

console.log(`\n[분석] 접두어 있는 행사: ${hits.length}건` + (blanked ? ` (이름이 접두어뿐이라 건너뜀: ${blanked}건)` : ''));
console.log('────────────────────────────────────────────');
hits.slice(0, 40).forEach((h, i) => {
  console.log(`  ${String(i + 1).padStart(3)}. "${h.before}"  →  "${h.after}"`);
});
if (hits.length > 40) console.log(`  … 외 ${hits.length - 40}건`);
console.log('────────────────────────────────────────────');

if (!APPLY) {
  console.log('\n[DRY-RUN] 실제 변경 없음. 적용하려면 --apply 플래그를 붙여 다시 실행하세요.');
  process.exit(0);
}

// ── 되돌리기용 백업 (gitignore된 data/ 폴더에 저장) ──────────────────────────
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.resolve(__dirname, `../data/strip-prefix-backup.${ts}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(hits, null, 2), 'utf-8');
  console.log(`[backup] 변경 전/후 매핑 저장: ${backupPath} (되돌리기용)`);
}

// ── 실제 적용 (배치 업데이트) ────────────────────────────────────────────────
console.log(`\n[APPLY] ${hits.length}건 업데이트 시작…`);
let done = 0;
for (let i = 0; i < hits.length; i += 400) {
  const chunk = hits.slice(i, i + 400);
  const batch = firestore.batch();
  for (const h of chunk) {
    batch.update(firestore.collection('events').doc(h.id), { event_name: h.after });
  }
  await batch.commit();
  done += chunk.length;
  console.log(`  … ${done}/${hits.length} 완료`);
}
console.log(`\n[완료] 행사명 접두어 ${done}건 제거됨.`);
process.exit(0);
