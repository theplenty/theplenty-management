// 재무팀 매출표(엑셀) → 행사 매출 반영. 엑셀이 기준(master)이다.
// 사용: npx tsx scripts/_import-sales-excel.ts <rows.json> <report.json> [--apply]
//   rows.json 은 엑셀을 바꾼 것(날짜·행사명·금액·세부항목) — repo 밖에 둔다.
//   기본 dry-run: 매칭 결과·변경 예정만 report.json 에 쓴다. --apply 로 Firestore 반영.
// 규칙
//   - 같은 날짜의 행사 중 행사명(또는 연결 업체명)이 가장 비슷한 것에 붙인다. 애매하면 안 쓰고 report 에 남긴다.
//   - 엑셀에 값이 있는 칸만 쓴다. 엑셀이 비어 있다고 앱 값을 지우지 않는다 (계약금 자동반영 등 앱이 채운 값 보호).
//   - 세부 매출 라인은 엑셀에 항목 금액이 하나라도 있을 때만 그 행사의 라인을 엑셀 것으로 통째로 바꾼다.
import './_loadEnv.js';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { DEFAULT_TENANT_ID } from '../src/types.js';

const [rowsPath, reportPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APPLY = process.argv.includes('--apply');
if (!rowsPath || !reportPath) {
  console.error('usage: <rows.json> <report.json> [--apply]');
  process.exit(1);
}
type Row = {
  sheet: string; no: string; date: string; status: string; type: 'MICE' | 'WEDDING'; name: string; org: string;
  hall: string; time: string; discount_rate: number | null; gateway_fee: number | null; contract_date: string | null;
  contract_amount: number | null; sales_total_amount: number | null; wp_total: number | null;
  items: Record<string, number | null>;
  event_id?: string; // 사람이 지정한 매칭
};
const rows: Row[] = JSON.parse(fs.readFileSync(rowsPath, 'utf-8'));

const { firestore } = await import('../src/lib/firebase.js');
const [evSnap, linkSnap, miceSnap, riSnap, lineSnap] = await Promise.all([
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
  firestore.collection('mice_customers').get(),
  firestore.collection('revenue_items').get(),
  firestore.collection('event_revenue_lines').get(),
]);
const events = evSnap.docs.map((d) => d.data() as any).filter((e) => !e.deleted_at);
const orgName = new Map<string, string>();
for (const d of miceSnap.docs) orgName.set((d.data() as any).id, (d.data() as any).organization_name || '');
const orgsByEvent = new Map<string, string[]>();
for (const d of linkSnap.docs) {
  const l = d.data() as any;
  const n = orgName.get(l.customer_id);
  if (!n) continue;
  if (!orgsByEvent.has(l.event_id)) orgsByEvent.set(l.event_id, []);
  orgsByEvent.get(l.event_id)!.push(n);
}
const codeToId: Record<string, string> = {};
for (const d of riSnap.docs) codeToId[(d.data() as any).code] = (d.data() as any).id;
const linesByEvent = new Map<string, any[]>();
for (const d of lineSnap.docs) {
  const l = d.data() as any;
  if (!linesByEvent.has(l.event_id)) linesByEvent.set(l.event_id, []);
  linesByEvent.get(l.event_id)!.push({ ref: d.ref, ...l });
}

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/\(\s*\d{1,2}:\d{2}\s*\)/g, '') // "(12:00)" 시간 접두
    .replace(/웨딩|wedding|wd|예식|님|\(.*?\)|\[.*?\]/g, '')
    .replace(/[^0-9a-z가-힣]/g, '');
const bigrams = (s: string) => {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};
function score(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  const bx = bigrams(x), by = bigrams(y);
  let hit = 0;
  for (const g of bx) if (by.has(g)) hit++;
  return (2 * hit) / (bx.size + by.size || 1);
}
const hourOf = (name: string) => {
  const m = /\((\d{1,2}):\d{2}\)/.exec(name || '');
  return m ? Number(m[1]) : null;
};
const SKIP_STATUS = new Set(['LOS', 'CXL', 'CANCEL']);

const report: any[] = [];
const plan: Array<{ eventId: string; row: Row; evPatch: Record<string, unknown>; replaceLines: boolean }> = [];
const taken = new Set<string>();
for (const row of rows) {
  if (!row.date || !row.name) continue;
  if (SKIP_STATUS.has(row.status.toUpperCase())) {
    report.push({ ...rowKey(row), action: 'SKIP_STATUS' });
    continue;
  }
  const sameDay = events.filter((e) => (e.start_datetime || '').slice(0, 10) === row.date);
  const h = hourOf(row.name);
  const cands = sameDay
    .map((e) => ({
      id: e.id, name: e.event_name, status: e.status, type: e.event_type, start: (e.start_datetime || '').slice(0, 16),
      score: Math.round(Math.max(score(row.name, e.event_name), ...(orgsByEvent.get(e.id) || []).map((o) => score(row.name, o)), row.org ? score(row.org, e.event_name) : 0, ...(row.org ? (orgsByEvent.get(e.id) || []).map((o) => score(row.org, o)) : [])) * 100) / 100,
      hourOk: h == null || Number((e.start_datetime || '').slice(11, 13)) === h,
      typeOk: e.event_type === row.type,
      taken: taken.has(e.id),
      sales_total_amount: e.sales_total_amount ?? null,
      contract_amount: e.contract_amount ?? null,
    }))
    .sort((a, b) => b.score - a.score);
  let pick = row.event_id ? cands.find((c) => c.id === row.event_id) || null : null;
  let how = pick ? 'manual' : '';
  if (!pick) {
    const good = cands.filter((c) => !c.taken && c.status === 'DEF' && c.typeOk && c.score >= 0.5 && c.hourOk);
    if (good.length === 1 || (good.length > 1 && good[0].score - good[1].score >= 0.25)) {
      pick = good[0];
      how = 'auto';
    } else if (good.length === 0) {
      // 그날 같은 종류의 DEF 행사가 딱 하나뿐이면 이름이 달라도 그 행사다 (대행사명 등)
      const only = cands.filter((c) => !c.taken && c.status === 'DEF' && c.typeOk);
      if (only.length === 1 && sameDay.filter((e) => e.status === 'DEF').length === 1) {
        pick = only[0];
        how = 'only-def-that-day';
      }
    }
  }
  if (!pick) {
    report.push({ ...rowKey(row), action: cands.length ? 'AMBIGUOUS' : 'NO_EVENT', cands: cands.slice(0, 5) });
    continue;
  }
  taken.add(pick.id);
  const evPatch: Record<string, unknown> = {};
  if (row.contract_amount != null) evPatch.contract_amount = row.contract_amount;
  if (row.sales_total_amount != null) evPatch.sales_total_amount = row.sales_total_amount;
  if (row.discount_rate != null) evPatch.discount_rate = row.discount_rate;
  if (row.gateway_fee != null) evPatch.gateway_fee = row.gateway_fee;
  if (row.contract_date) evPatch.contract_date = row.contract_date;
  const replaceLines = Object.values(row.items).some((v) => v != null);
  const ev = events.find((e) => e.id === pick!.id);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(evPatch)) if ((ev[k] ?? null) !== v) changes[k] = [ev[k] ?? null, v];
  const action = Object.keys(changes).length || replaceLines ? 'UPDATE' : 'NOCHANGE';
  report.push({ ...rowKey(row), action, how, pick: { id: pick.id, name: pick.name, score: pick.score }, changes, replaceLines });
  if (action === 'UPDATE') plan.push({ eventId: pick.id, row, evPatch, replaceLines });
}
function rowKey(r: Row) {
  return { sheet: r.sheet, no: r.no, date: r.date, type: r.type, name: r.name, status: r.status, sales_total: r.sales_total_amount, contract: r.contract_amount };
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1), 'utf-8');
const tally: Record<string, number> = {};
for (const r of report) tally[r.action] = (tally[r.action] || 0) + 1;
console.log(`엑셀 ${rows.length}행 →`, JSON.stringify(tally));
console.log('매칭 방식:', JSON.stringify(report.reduce((a: any, r: any) => { if (r.how) a[r.how] = (a[r.how] || 0) + 1; return a; }, {})));
if (!APPLY) {
  console.log('[dry-run] 쓰지 않음. 결과:', reportPath);
  process.exit(0);
}
const now = new Date().toISOString();
let batch = firestore.batch();
let ops = 0;
const flush = async () => { if (ops) { await batch.commit(); batch = firestore.batch(); ops = 0; } };
for (const p of plan) {
  batch.update(firestore.collection('events').doc(p.eventId), { ...p.evPatch, updated_at: now });
  ops++;
  if (p.replaceLines) {
    for (const l of linesByEvent.get(p.eventId) || []) { batch.delete(l.ref); ops++; }
    for (const [code, amount] of Object.entries(p.row.items)) {
      if (amount == null || !codeToId[code]) continue;
      const id = nanoid(10);
      batch.set(firestore.collection('event_revenue_lines').doc(id), {
        id, tenant_id: DEFAULT_TENANT_ID, event_id: p.eventId, revenue_item_id: codeToId[code], amount, note: '', created_at: now, updated_at: now,
      });
      ops++;
    }
  }
  if (ops >= 350) await flush();
}
await flush();
console.log(`반영 완료: 행사 ${plan.length}건`);
process.exit(0);
