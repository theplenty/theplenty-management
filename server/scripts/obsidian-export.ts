// Firestore(라이브 마스터) → Obsidian 수집함 내보내기  ★ 읽기 전용, 단방향
//
// 안전 원칙:
//   - Firestore 에서 "읽기"만 한다. 절대 쓰지 않는다.(verify-migration 과 동일한 admin SDK 연결)
//   - 결과는 볼트의 00_수집함(Inbox)/_가져옴(auto)/ 에만 기록(gitignore 보호 볼트).
//   - 실행할 때마다 _가져옴(auto) 하위를 새로 써서 "최신 기준"으로 정리·재축적.
//   - 사용자가 손으로 만든 도메인 지식 노트는 건드리지 않는다.
//
// 사용: cd server && npx tsx scripts/obsidian-export.ts   (또는 npm run obsidian)

import './_loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(__dirname, '../../theplenty-management');
const OUT = path.join(VAULT, '00_수집함(Inbox)', '_가져옴(auto)');
const TENANT_DEFAULT = 'plenty';
const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

function s(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function yamlVal(v: unknown): string {
  if (v === null || v === undefined) return '""';
  if (Array.isArray(v)) return '[' + v.map((x) => JSON.stringify(s(x))).join(', ') + ']';
  const str = s(v);
  return /[:#\-?[\]{}",\n]/.test(str) ? JSON.stringify(str) : str;
}
function fm(obj: Record<string, unknown>): string {
  return `---\n${Object.entries(obj).map(([k, v]) => `${k}: ${yamlVal(v)}`).join('\n')}\n---\n`;
}
// 파일명용 정제 — Windows/Obsidian 금지문자 제거, 공백 정리, 길이 제한.
function sanitizeName(name: string): string {
  return (name || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
// 파일명 = "<제목> (<꼬리표>).md" — 제목으로 그래프/정렬, 꼬리표(짧은 id)로 중복 방지.
function fileName(name: string, tail: string, fallback: string): string {
  const base = sanitizeName(name);
  return base ? `${base} (${tail}).md` : `${fallback}.md`;
}
function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}
function resetSub(sub: string) {
  const dir = path.join(OUT, sub);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}
function writeNote(sub: string, filename: string, frontmatter: Record<string, unknown>, body: string) {
  ensureDir(path.join(OUT, sub));
  fs.writeFileSync(path.join(OUT, sub, filename), fm(frontmatter) + '\n' + body, 'utf-8');
}

const READONLY_WARN =
  '> ⚠️ 시스템(Firestore)에서 자동 가져온 **읽기 전용 미러**입니다. 여기 수정은 원본에 반영되지 않습니다.\n' +
  '> 큐레이션: 가치 있으면 도메인 폴더에 지식 노트를 만들고 이 노트를 `[[링크]]` 하세요.\n';
const KNOWLEDGE_BLOCK = '\n## 지식(우리 해석)\n- 인사이트 / 다음 액션 / 메모\n';

const counts = { events: 0, mice: 0, wedding: 0, users: 0 };

async function run() {
  const { firestore } = await import('../src/lib/firebase.js');
  ensureDir(OUT);

  // ----- 담당자(users) -----
  resetSub('담당자');
  const usersSnap = await firestore.collection('users').get();
  for (const doc of usersSnap.docs) {
    const u = doc.data() as Record<string, unknown>;
    const role = s(u.role);
    if (role === 'pending' || role === 'disabled') continue;
    writeNote('담당자', fileName(s(u.name), doc.id.slice(0, 6), `USER-${doc.id}`), {
      type: 'user', source: 'firestore', source_id: doc.id,
      tenant_id: u.tenant_id || TENANT_DEFAULT, sync: 'readonly', last_synced: today,
      title: s(u.name), role, aliases: [s(u.name)].filter(Boolean),
    }, `# 담당자 — ${s(u.name) || doc.id}\n\n${READONLY_WARN}\n## 원본(시스템) — 읽기 전용\n- 이름: ${s(u.name) || '-'}\n- 역할: ${role}\n- 팀: ${s(u.team) || '-'}\n${KNOWLEDGE_BLOCK}`);
    counts.users++;
  }

  // ----- MICE 고객 -----
  resetSub('고객-MICE');
  const miceSnap = await firestore.collection('mice_customers').get();
  for (const doc of miceSnap.docs) {
    const c = doc.data() as Record<string, unknown>;
    if (c.deleted_at) continue;
    const inqs = Array.isArray(c.inquiries) ? (c.inquiries as Record<string, unknown>[]) : [];
    const latest = inqs[inqs.length - 1] || {};
    const mgr = inqs.map((i) => s(i.assigned_manager_name)).filter(Boolean).join(', ');
    writeNote('고객-MICE', fileName(s(c.organization_name), doc.id.slice(0, 6), `MICE-${doc.id}`), {
      type: 'customer-mice', source: 'firestore', source_id: doc.id,
      tenant_id: c.tenant_id || TENANT_DEFAULT, sync: 'readonly', last_synced: today,
      title: s(c.organization_name), mice_category: s(c.mice_category), aliases: [s(c.organization_name)].filter(Boolean),
    }, `# ${s(c.organization_name) || '(이름없음)'} (MICE)\n\n${READONLY_WARN}\n## 원본(시스템) — 읽기 전용\n- 업종: ${s(c.mice_category) || '-'}\n- 문의 수: ${inqs.length}건\n- 최근 진행상황: ${s(latest.progress_status) || '-'} (${s(latest.inquiry_channel) || '-'})\n- 담당자: ${mgr || '-'}\n${KNOWLEDGE_BLOCK}\n- 도메인: [[30_사업영역/세일즈-MICE/claude]]\n`);
    counts.mice++;
  }

  // ----- WEDDING 고객 -----
  resetSub('고객-WEDDING');
  const wedSnap = await firestore.collection('wedding_customers').get();
  for (const doc of wedSnap.docs) {
    const c = doc.data() as Record<string, unknown>;
    if (c.deleted_at) continue;
    const eis = Array.isArray(c.event_inquiries) ? (c.event_inquiries as Record<string, unknown>[]) : [];
    const mgr = eis.map((i) => s(i.assigned_manager_name)).filter(Boolean).join(', ');
    writeNote('고객-WEDDING', fileName(s(c.wedding_event_name), doc.id.slice(0, 6), `WED-${doc.id}`), {
      type: 'customer-wedding', source: 'firestore', source_id: doc.id,
      tenant_id: c.tenant_id || TENANT_DEFAULT, sync: 'readonly', last_synced: today,
      title: s(c.wedding_event_name), progress_status: s(c.progress_status), aliases: [s(c.wedding_event_name)].filter(Boolean),
    }, `# ${s(c.wedding_event_name) || '(이름없음)'} (WEDDING)\n\n${READONLY_WARN}\n## 원본(시스템) — 읽기 전용\n- 진행단계: ${s(c.progress_status) || '-'}\n- 신규문의일: ${s(c.inquiry_date) || '-'}\n- 희망상담일: ${s(c.desired_consultation_date) || '-'}\n- 유입경로: ${s(c.source) || '-'} / ${s(c.source_detail) || '-'}\n- 담당자: ${mgr || '-'}\n${KNOWLEDGE_BLOCK}\n- 도메인: [[30_사업영역/세일즈-WEDDING/claude]]\n`);
    counts.wedding++;
  }

  // ----- 행사(events) — 캘린더 + 담당자 -----
  resetSub('캘린더-행사');
  const evSnap = await firestore.collection('events').get();
  for (const doc of evSnap.docs) {
    const e = doc.data() as Record<string, unknown>;
    if (e.deleted_at) continue;
    const d = s(e.start_datetime).slice(0, 10) || '0000-00-00';
    const domain = s(e.event_type) === 'MICE' ? '세일즈-MICE' : '세일즈-WEDDING';
    const halls = Array.isArray(e.halls) ? (e.halls as unknown[]).map(s).join(' / ') : '';
    writeNote('캘린더-행사', fileName(s(e.event_name), `${d} ${doc.id.slice(0, 6)}`, `EV-${d}-${doc.id}`), {
      type: 'event', source: 'firestore', source_id: doc.id,
      tenant_id: e.tenant_id || TENANT_DEFAULT, sync: 'readonly', last_synced: today,
      title: s(e.event_name), event_type: s(e.event_type), status: s(e.status),
      start_datetime: s(e.start_datetime), end_datetime: s(e.end_datetime),
      assigned_manager: s(e.assigned_manager_name), aliases: [s(e.event_name)].filter(Boolean),
    }, `# ${s(e.event_name) || '(이름없음)'}\n\n${READONLY_WARN}\n## 원본(시스템) — 읽기 전용\n- 구분/상태: ${s(e.event_type) || '-'} / ${s(e.status) || '-'}\n- 일시: ${s(e.start_datetime) || '-'} ~ ${s(e.end_datetime) || '-'}\n- 사용홀: ${halls || '-'}\n- 담당자: ${s(e.assigned_manager_name) || '-'}\n- 좌석: ${e.seats ?? '-'}\n${KNOWLEDGE_BLOCK}\n- 도메인: [[30_사업영역/${domain}/claude]]\n`);
    counts.events++;
  }

  // ----- 인덱스 -----
  const idx = `---\ntype: import-index\nsource: firestore (라이브 마스터, 읽기 전용)\nlast_run: ${stamp}\n---\n\n# 📥 가져오기 인덱스 (자동 — 손대지 마세요)\n\n> **Firestore(라이브)** 에서 읽기 전용으로 가져온 미러입니다. 실행할 때마다 최신 기준으로 새로 씁니다.\n> 로컬 PC 데이터가 아니라 **라이브 데이터**를 따릅니다.\n\n- 마지막 실행: **${stamp}**\n- 캘린더/행사: **${counts.events}**\n- MICE 고객: **${counts.mice}** · WEDDING 고객: **${counts.wedding}**\n- 담당자: **${counts.users}**\n\n## 폴더\n- [[캘린더-행사]] · [[고객-MICE]] · [[고객-WEDDING]] · [[담당자]]\n\n## 다시 가져오기\n\`\`\`\ncd server\nnpm run obsidian      # Firestore 최신 기준으로 재축적\n\`\`\`\n`;
  fs.writeFileSync(path.join(OUT, '📥 가져오기 인덱스.md'), idx, 'utf-8');

  console.log('[Firestore → Obsidian 완료]', JSON.stringify(counts));
  console.log('출력:', OUT);
  process.exit(0);
}

run().catch((e) => {
  console.error('내보내기 실패:', e);
  process.exit(1);
});
