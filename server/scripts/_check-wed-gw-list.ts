import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const evs = await firestore.collection('events').get();
const rows: { ym: string; date: string; status: string; gw: number }[] = [];
let total = 0, withGw = 0;
const byYm = new Map<string, { all: number; gw: number }>();
for (const d of evs.docs) {
  const e = d.data() as any;
  if (e.deleted_at || e.event_type !== 'WEDDING') continue;
  total++;
  const date = (e.start_datetime || '').slice(0, 10);
  const ym = date.slice(0, 7);
  const slot = byYm.get(ym) || { all: 0, gw: 0 };
  slot.all++;
  if (Number(e.gateway_fee) > 0) {
    withGw++;
    slot.gw++;
    rows.push({ ym, date, status: e.status, gw: Number(e.gateway_fee) });
  }
  byYm.set(ym, slot);
}
console.log(`웨딩 행사 총 ${total}건 · 대관료 입력됨 ${withGw}건 (${Math.round(withGw/total*100)}%)`);
console.log('\n대관료 입력된 34건 (날짜/상태/금액):');
rows.sort((a,b)=>a.date.localeCompare(b.date));
console.log(rows.map(r=>`${r.date} ${r.status} ${r.gw.toLocaleString()}`).join('\n'));
console.log('\n월별 (대관료입력/전체):');
const keys=[...byYm.keys()].filter(Boolean).sort();
console.log(keys.map(k=>`${k}: ${byYm.get(k)!.gw}/${byYm.get(k)!.all}`).join('  '));
