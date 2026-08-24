// S2 ⑥ 소급 매칭 후보 제안 (읽기 전용) — 확정 문의 ↔ 기존 행사 짝 찾기.
// 자동 연결하지 않는다. 사장님이 목록을 보고 승인한 것만 연결한다.
import './_loadEnv.js';
import fs from 'fs';
const { firestore } = await import('../src/lib/firebase.js');
const get = async (c: string) => (await firestore.collection(c).get()).docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
const [events, links, customers] = await Promise.all([get('events'), get('event_customers'), get('mice_customers')]);

const norm = (s: string) => String(s || '').replace(/\s+/g, '');
const guessDate = (q: any): string | null => {
  const t = q.inquiry_event_date_text || '';
  const iso = /(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const year = (q.call_date || q.created_at || '').slice(0, 4) || '2026';
  const ko = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(t);
  if (ko) return `${year}-${ko[1].padStart(2, '0')}-${ko[2].padStart(2, '0')}`;
  return null;
};
const miceEv = events.filter((e) => e.event_type === 'MICE' && !e.deleted_at);
const linkByCust = new Map<string, Set<string>>();
for (const l of links) {
  const s = linkByCust.get(l.customer_id) || new Set<string>();
  s.add(l.event_id); linkByCust.set(l.customer_id, s);
}
const taken = new Set<string>();
for (const c of customers) for (const q of c.inquiries || []) if (q.linked_event_id) taken.add(q.linked_event_id);

type Row = { cust: string; custId: string; inqNo: number; inqId: string; deposit: boolean; date: string | null; ev: string; evId: string; evDay: string; gw: number | null; why: string[]; score: number };
const rows: Row[] = [];
let defTotal = 0, noCand = 0;
for (const c of customers) {
  const inqs = c.inquiries || [];
  inqs.forEach((q: any, i: number) => {
    if (q.progress_status !== 'DEF' || q.linked_event_id) return;
    defTotal++;
    const target = guessDate(q);
    const orgKey = norm(c.organization_name);
    const custEvents = linkByCust.get(c.id) || new Set<string>();
    const best: Row[] = [];
    for (const e of miceEv) {
      if (taken.has(e.id)) continue;
      const day = (e.start_datetime || '').slice(0, 10);
      const gap = target && day ? Math.abs((new Date(day).getTime() - new Date(target).getTime()) / 86400000) : null;
      const nameHit = orgKey.length >= 2 && norm(e.event_name).includes(orgKey);
      const why: string[] = [];
      if (custEvents.has(e.id)) why.push('고객연결');
      if (nameHit) why.push('행사명일치');
      if (gap != null && gap <= 7) why.push(gap === 0 ? '날짜일치' : `날짜±${Math.round(gap)}일`);
      if (!why.length) continue;
      if (gap != null && gap > 60) why.push(`⚠날짜 ${Math.round(gap)}일 차이`);
      if (target && gap == null) why.push('⚠행사일 미상');
      // 날짜가 크게 벌어진 건은 신뢰도를 깎는다 — '고객연결' 하나만으로 2년 차이 행사가 1등이 되던 문제
      const farPenalty = gap != null && gap > 60 ? 60 : 0;
      const score = (custEvents.has(e.id) ? 100 : 0) + (nameHit ? 50 : 0) + (gap != null ? Math.max(0, 30 - gap) : 0) - farPenalty;
      best.push({ cust: c.organization_name, custId: c.id, inqNo: i + 1, inqId: q.id, deposit: !!q.deposit_paid, date: target, ev: e.event_name, evId: e.id, evDay: day, gw: e.gateway_fee ?? null, why, score });
    }
    best.sort((a, b) => b.score - a.score);
    if (!best.length) { noCand++; return; }
    rows.push(best[0]);
  });
}
rows.sort((a, b) => b.score - a.score);
console.log(`미연결 확정 문의 ${defTotal}건 · 후보 있음 ${rows.length} · 후보 없음 ${noCand}\n`);
console.log('점수\t계약금\t업체 / 문의#\t예정일\t→ 행사 / 행사일\t대관료\t근거');
for (const r of rows) {
  console.log(`${Math.round(r.score)}\t${r.deposit ? '✓' : '-'}\t${r.cust.slice(0, 16)} #${r.inqNo}\t${r.date || '-'}\t→ ${r.ev.slice(0, 22)} / ${r.evDay}\t${r.gw ? Number(r.gw).toLocaleString() : '-'}\t${r.why.join(',')}`);
}
const tier = (r: Row) => (r.why.some((w) => w.startsWith('⚠')) ? 'check' : r.score >= 150 ? 'high' : r.score >= 80 ? 'mid' : 'low');
const grouped: Record<string, Row[]> = { high: [], mid: [], low: [], check: [] };
for (const r of rows) grouped[tier(r)].push(r);
const pairStr = (list: Row[]) => list.map((r) => r.custId + ':' + r.inqId + ':' + r.evId).join(',');
fs.writeFileSync('data/inquiry-link-candidates.json', JSON.stringify({
  counts: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length])),
  pairs: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, pairStr(v)])),
  rows,
}, null, 1));
const summary = ['', '신뢰도 — 높음(150+) ' + grouped.high.length, '보통(80+) ' + grouped.mid.length, '낮음 ' + grouped.low.length, '확인필요 ' + grouped.check.length].join(' · ');
console.log(summary);
console.log('후보 파일: data/inquiry-link-candidates.json (승인 즉시 쓸 pairs 문자열 포함)');
process.exit(0);
