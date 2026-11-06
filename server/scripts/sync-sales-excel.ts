// 재무팀 매출표 자동 반영 — 폴더의 최신 "(PLENTY)Sales 매출_YYMMDD(..).xlsx" 를 행사 매출에 반영한다.
// Windows 작업 스케줄러가 30분마다 실행(scripts/sync-sales-excel.cmd). 새 파일이 없으면 아무것도 안 한다.
//
// 사용: cd server && npx tsx scripts/sync-sales-excel.ts [--dry-run] [--force] [--file <경로>]
//   --dry-run  매칭·변경 예정만 출력 (쓰기 없음)
//   --force    이미 반영한 파일이어도 다시
//
// 규칙 (2026-10-08 첫 반영 때 정한 것 그대로)
//  - 엑셀이 기준. 단 엑셀이 빈칸인 칸은 앱 값을 지우지 않는다(계약금 자동반영 등 보호).
//  - 세부 매출 라인은 그 행에 항목 금액이 하나라도 있으면 통째로 교체. 매출 탭에서 바꿔 둔 '부서' 는 항목별로 잇는다.
//  - 같은 날짜 행사 중 행사명(또는 연결 업체명)이 가장 비슷한 확정 행사에 붙인다. 애매하면 쓰지 않고 '못 붙임' 으로 남긴다.
//  - 한 번 붙은 짝(날짜|엑셀 행사명 → 행사)은 Firestore system_meta/sales_excel_links 에 기억해 다음부터 그대로 쓴다.
//  - 머리글이 예상과 다르면(양식 변경) 아무것도 쓰지 않고 멈춘다.
//  - 반영 후 system_meta/data_revision.revenue_at 를 올려 서버가 1분 안에 다시 읽게 한다(재배포 불필요).
// 고객·행사 이름은 로그 파일에만(server/_out/*.log, git 제외). 이 파일에는 적지 않는다.
import './_loadEnv.js';
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { DEFAULT_TENANT_ID } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, '../.env') }); // SLACK_WEBHOOK_URL 등 (루트 .env 는 _loadEnv 가)
const ExcelJS = createRequire(path.resolve(here, '../../client/package.json'))('exceljs');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const FOLDER = process.env.SALES_EXCEL_DIR || 'C:/CLADE-Cowork-MYON/HK-Financial/HK-Financial/2026/Sales 매출';
const LOG = path.resolve(here, '../_out/sales-sync.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const logLines: string[] = [];
const log = (s: string) => {
  logLines.push(s);
  console.log(s);
};
const flushLog = () => fs.appendFileSync(LOG, `\n===== ${new Date().toISOString()}${DRY ? ' (dry-run)' : ''}\n${logLines.join('\n')}\n`, 'utf-8');

// ── 1. 최신 파일 고르기 ──
const NAME_RE = /^\(PLENTY\)Sales 매출_(\d{6})\(([^)]*)\)(?:_(\d+))?\.xlsx$/;
function pickLatest(): { file: string; name: string; mtime: string } | null {
  if (fileArg) {
    const st = fs.statSync(fileArg);
    return { file: fileArg, name: path.basename(fileArg), mtime: st.mtime.toISOString() };
  }
  const cands = fs
    .readdirSync(FOLDER)
    .map((n) => ({ n, m: NAME_RE.exec(n) }))
    .filter((x) => x.m)
    .map((x) => ({ name: x.n, ymd: x.m![1], ver: Number(x.m![3] || 0), st: fs.statSync(path.join(FOLDER, x.n)) }))
    .sort((a, b) => a.ymd.localeCompare(b.ymd) || a.ver - b.ver || a.st.mtimeMs - b.st.mtimeMs);
  const last = cands[cands.length - 1];
  return last ? { file: path.join(FOLDER, last.name), name: last.name, mtime: last.st.mtime.toISOString() } : null;
}

// ── 2. 엑셀 읽기 (2026 양식 고정 열 — 머리글로 검증) ──
type Row = {
  key: string; sheet: string; date: string; status: string; type: 'MICE' | 'WEDDING'; name: string; org: string;
  discount_rate: number | null; gateway_fee: number | null; contract_date: string | null;
  contract_amount: number | null; sales_total_amount: number | null; items: Record<string, number | null>;
};
const ITEM_COL: Record<string, number> = { CONV: 20, FOOD: 21, CB: 22, SNACK: 23, BEV: 24, CORKAGE: 25, MEDIAWALL: 26, BOOTH: 27, STAGE: 28, FLOWER: 29, SYSTEM: 30 }; // T..AD (1-based)
const EXPECT: Array<[number, number, string]> = [
  [3, 1, 'No.'], [3, 7, '행사명'], [3, 16, '계약서 금액'], [3, 17, 'Sales 총매출'], [4, 14, '대관료'], [4, 15, '입금일자'],
  [4, 20, '컨벤션 이용료'], [4, 21, 'Food'], [4, 22, 'Coffee Break'], [4, 24, 'Bev.'], [4, 25, 'Corkage'], [4, 29, 'Flower'], [4, 30, 'System'],
];
const cellVal = (c: { value: unknown }): unknown => {
  const v = c.value as any;
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map((t: { text: string }) => t.text).join('');
    if (v instanceof Date) return v;
    if ('text' in v) return v.text;
  }
  return v;
};
const num = (v: unknown): number | null => {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const day = (v: unknown): string | null => {
  if (v == null || v === '' || v === '-') return null;
  if (v instanceof Date) return new Date(v.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(v));
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};
const text = (v: unknown) => String(v ?? '').trim();

async function readRows(file: string): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows: Row[] = [];
  for (const ws of wb.worksheets) {
    const m = /^Sales (\d{4})_매출$/.exec(ws.name.trim());
    if (!m || Number(m[1]) < 2026) continue; // 2025 이전은 양식이 달라 대상 아님
    for (const [r, c, want] of EXPECT) {
      const got = text(cellVal(ws.getCell(r, c))).replace(/\s+/g, ' ');
      if (got !== want) throw new Error(`양식 변경 감지 — 시트 '${ws.name}' ${r}행 ${c}열: '${want}' 기대, '${got}' 발견. 반영 중단.`);
    }
    ws.eachRow((row: any, i: number) => {
      if (i < 5) return;
      const g = (c: number) => cellVal(row.getCell(c));
      const y = num(g(2)), mo = num(g(3)), d = num(g(4));
      const name = text(g(7));
      if (!y || !mo || !d || !name) return;
      const items: Record<string, number | null> = {};
      for (const [code, col] of Object.entries(ITEM_COL)) items[code] = num(g(col));
      const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      rows.push({
        key: `${date}|${name}`, sheet: ws.name, date, status: text(g(5)).toUpperCase(),
        type: text(g(6)).toLowerCase() === 'wedding' ? 'WEDDING' : 'MICE', name, org: text(g(8)),
        discount_rate: num(g(13)), gateway_fee: num(g(14)), contract_date: day(g(15)),
        contract_amount: num(g(16)), sales_total_amount: num(g(17)), items,
      });
    });
  }
  return rows;
}

// ── 3. 매칭 ──
const norm = (s: string) =>
  (s || '').toLowerCase().replace(/\(\s*\d{1,2}:\d{2}\s*\)/g, '').replace(/웨딩|wedding|wd|예식|님|\(.*?\)|\[.*?\]/g, '').replace(/[^0-9a-z가-힣]/g, '');
const bigrams = (s: string) => { const o = new Set<string>(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
function score(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  const bx = bigrams(x), by = bigrams(y);
  let hit = 0;
  for (const g of bx) if (by.has(g)) hit++;
  return (2 * hit) / (bx.size + by.size || 1);
}
const hourOf = (name: string) => { const m = /\((\d{1,2}):\d{2}\)/.exec(name || ''); return m ? Number(m[1]) : null; };

// ── 실행 ──
const { firestore } = await import('../src/lib/firebase.js');
const meta = firestore.collection('system_meta');
const picked = pickLatest();
if (!picked) {
  log(`매출표 파일 없음 — 폴더: ${FOLDER}`);
  flushLog();
  process.exit(0);
}
const lastDoc = await meta.doc('sales_excel_sync').get();
const last = lastDoc.exists ? (lastDoc.data() as any) : null;
if (!FORCE && !DRY && last && last.file === picked.name && last.file_mtime === picked.mtime && last.status === 'ok') {
  process.exit(0); // 새 파일 없음 — 로그도 남기지 않는다 (30분마다 돌기 때문)
}
// 저장 중인 파일은 건드리지 않는다 (OneDrive 동기화·엑셀 저장 직후)
if (!fileArg && Date.now() - new Date(picked.mtime).getTime() < 3 * 60_000) {
  log(`최근 3분 안에 바뀐 파일이라 다음 실행에서 처리: ${picked.name}`);
  flushLog();
  process.exit(0);
}

log(`파일: ${picked.name} (수정 ${picked.mtime})`);
let rows: Row[];
try {
  rows = await readRows(picked.file);
} catch (e) {
  const msg = (e as Error).message;
  log(`❌ ${msg}`);
  flushLog();
  if (!DRY) await meta.doc('sales_excel_sync').set({ file: picked.name, file_mtime: picked.mtime, ran_at: new Date().toISOString(), status: 'error', error: msg }, { merge: true });
  await notify(`❌ 매출표 자동 반영 실패 — ${picked.name}\n${msg}`);
  process.exit(1);
}

const [evSnap, linkSnap, miceSnap, riSnap, lineSnap, linksDoc] = await Promise.all([
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
  firestore.collection('mice_customers').get(),
  firestore.collection('revenue_items').get(),
  firestore.collection('event_revenue_lines').get(),
  meta.doc('sales_excel_links').get(),
]);
const events = evSnap.docs.map((d) => d.data() as any).filter((e) => !e.deleted_at);
const evById = new Map(events.map((e) => [e.id, e]));
const orgName = new Map(miceSnap.docs.map((d) => [(d.data() as any).id, (d.data() as any).organization_name || '']));
const orgsByEvent = new Map<string, string[]>();
for (const d of linkSnap.docs) {
  const l = d.data() as any;
  const n = orgName.get(l.customer_id);
  if (n) orgsByEvent.set(l.event_id, [...(orgsByEvent.get(l.event_id) || []), n]);
}
const codeToId: Record<string, string> = {};
for (const d of riSnap.docs) codeToId[(d.data() as any).code] = (d.data() as any).id;
const linesByEvent = new Map<string, any[]>();
for (const d of lineSnap.docs) {
  const l = d.data() as any;
  linesByEvent.set(l.event_id, [...(linesByEvent.get(l.event_id) || []), { ref: d.ref, ...l }]);
}
const links: Record<string, string> = (linksDoc.exists ? (linksDoc.data() as any).links : null) || {};
const SKIP = new Set(['LOS', 'CXL', 'CANCEL']);

const taken = new Set<string>();
const plan: Array<{ eventId: string; row: Row; evPatch: Record<string, unknown>; replaceLines: boolean }> = [];
const unmatched: Array<{ date: string; name: string; status: string; reason: string }> = [];
let nochange = 0;
const newLinks: Record<string, string> = {};
for (const row of rows) {
  if (SKIP.has(row.status)) continue;
  let eventId: string | null = null;
  const remembered = links[row.key];
  if (remembered && evById.has(remembered) && !taken.has(remembered)) eventId = remembered;
  if (!eventId) {
    const sameDay = events.filter((e) => String(e.start_datetime || '').slice(0, 10) === row.date);
    const h = hourOf(row.name);
    const cands = sameDay
      .map((e) => ({
        id: e.id, status: e.status, typeOk: e.event_type === row.type,
        hourOk: h == null || Number(String(e.start_datetime || '').slice(11, 13)) === h,
        score: Math.max(score(row.name, e.event_name), ...(orgsByEvent.get(e.id) || []).map((o) => score(row.name, o)), row.org ? score(row.org, e.event_name) : 0),
      }))
      .filter((c) => !taken.has(c.id))
      .sort((a, b) => b.score - a.score);
    const good = cands.filter((c) => c.status === 'DEF' && c.typeOk && c.score >= 0.5 && c.hourOk);
    if (good.length === 1 || (good.length > 1 && good[0].score - good[1].score >= 0.25)) eventId = good[0].id;
    else if (!good.length) {
      const only = cands.filter((c) => c.status === 'DEF' && c.typeOk);
      if (only.length === 1 && sameDay.filter((e) => e.status === 'DEF').length === 1) eventId = only[0].id;
    }
    if (!eventId) {
      unmatched.push({ date: row.date, name: row.name, status: row.status, reason: sameDay.length ? '같은 날 행사 중 애매함' : '그날 캘린더에 행사 없음' });
      continue;
    }
  }
  taken.add(eventId);
  if (links[row.key] !== eventId) newLinks[row.key] = eventId;
  const ev = evById.get(eventId);
  const evPatch: Record<string, unknown> = {};
  if (row.contract_amount != null) evPatch.contract_amount = row.contract_amount;
  if (row.sales_total_amount != null) evPatch.sales_total_amount = row.sales_total_amount;
  if (row.discount_rate != null) evPatch.discount_rate = row.discount_rate;
  if (row.gateway_fee != null) evPatch.gateway_fee = row.gateway_fee;
  if (row.contract_date) evPatch.contract_date = row.contract_date;
  for (const k of Object.keys(evPatch)) if ((ev[k] ?? null) === evPatch[k]) delete evPatch[k];
  // 라인: 엑셀 항목 금액이 있고, 지금 라인과 다를 때만 교체
  const want = Object.entries(row.items).filter(([c, v]) => v != null && codeToId[c]).map(([c, v]) => `${codeToId[c]}:${v}`).sort().join('|');
  const have = (linesByEvent.get(eventId) || []).filter((l) => l.amount != null).map((l) => `${l.revenue_item_id}:${l.amount}`).sort().join('|');
  const replaceLines = !!want && want !== have;
  if (!Object.keys(evPatch).length && !replaceLines) { nochange++; continue; }
  plan.push({ eventId, row, evPatch, replaceLines });
}

log(`엑셀 ${rows.length}행 → 반영 ${plan.length} · 변경 없음 ${nochange} · 못 붙임 ${unmatched.length}`);
for (const p of plan) {
  const ev = evById.get(p.eventId);
  log(`  반영 ${p.row.date} ${p.row.name} → ${ev.event_name} · ${Object.keys(p.evPatch).join(',') || '-'}${p.replaceLines ? ' · 세부라인' : ''}`);
}
for (const u of unmatched) log(`  못 붙임 ${u.date} [${u.status}] ${u.name} — ${u.reason}`);

if (DRY) {
  log('[dry-run] 쓰지 않음');
  flushLog();
  process.exit(0);
}

const now = new Date().toISOString();
let batch = firestore.batch();
let ops = 0;
const flush = async () => { if (ops) { await batch.commit(); batch = firestore.batch(); ops = 0; } };
for (const p of plan) {
  if (Object.keys(p.evPatch).length) { batch.update(firestore.collection('events').doc(p.eventId), { ...p.evPatch, updated_at: now }); ops++; }
  if (p.replaceLines) {
    const prev = linesByEvent.get(p.eventId) || [];
    const deptByItem = new Map(prev.filter((l) => l.dept).map((l) => [l.revenue_item_id, l.dept]));
    for (const l of prev) { batch.delete(l.ref); ops++; }
    for (const [code, amount] of Object.entries(p.row.items)) {
      if (amount == null || !codeToId[code]) continue;
      const id = nanoid(10);
      const itemId = codeToId[code];
      batch.set(firestore.collection('event_revenue_lines').doc(id), {
        id, tenant_id: DEFAULT_TENANT_ID, event_id: p.eventId, revenue_item_id: itemId, amount, note: '',
        ...(deptByItem.has(itemId) ? { dept: deptByItem.get(itemId) } : {}),
        created_at: now, updated_at: now,
      });
      ops++;
    }
  }
  if (ops >= 350) await flush();
}
await flush();
if (Object.keys(newLinks).length) await meta.doc('sales_excel_links').set({ links: { ...links, ...newLinks }, updated_at: now }, { merge: true });
if (plan.length) await meta.doc('data_revision').set({ revenue_at: now }, { merge: true });
await meta.doc('sales_excel_sync').set({
  file: picked.name, file_mtime: picked.mtime, ran_at: now, status: 'ok',
  rows: rows.length, applied: plan.length, nochange, unmatched,
}, { merge: false });
log(`✅ 반영 완료 ${plan.length}건`);
flushLog();
if (plan.length || unmatched.length) {
  await notify(
    `📥 매출표 자동 반영 — ${picked.name}\n반영 ${plan.length}건 · 변경 없음 ${nochange}건 · 못 붙임 ${unmatched.length}건` +
      (unmatched.length ? `\n못 붙인 행: ${unmatched.slice(0, 8).map((u) => `${u.date} ${u.name}`).join(' / ')}${unmatched.length > 8 ? ' …' : ''}` : '')
  );
}
process.exitCode = 0;

async function notify(text: string) {
  try {
    const { sendSlack, slackConfigured } = await import('../src/lib/slack.js');
    if (slackConfigured()) await sendSlack(text);
  } catch {
    /* 알림 실패는 반영 결과에 영향 없음 */
  }
}
