import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const [evs, invs] = await Promise.all([
  firestore.collection('events').get(),
  firestore.collection('invoices').get(),
]);
const invByEv = new Map(invs.docs.map((d) => [(d.data() as any).event_id, d.data() as any]));
const rows: any[] = [];
for (const d of evs.docs) {
  const e = d.data() as any;
  if (e.deleted_at || e.event_type !== 'WEDDING') continue;
  if (!(Number(e.gateway_fee) > 0)) continue;
  const inv = invByEv.get(d.id);
  rows.push({
    date: (e.start_datetime || '').slice(0, 10),
    status: e.status,
    gw: Number(e.gateway_fee),
    contract: Number(e.contract_amount) || 0,
    sales: Number(e.sales_total_amount) || 0,
    pay: inv?.payment_amount ?? '',
    payStatus: inv?.payment_status ?? '',
  });
}
rows.sort((a, b) => a.date.localeCompare(b.date));
console.log('웨딩 gateway_fee>0:', rows.length);
console.table(rows.slice(0, 20));
const uniq = [...new Set(rows.map((r) => r.gw))].sort((a, b) => a - b);
console.log('금액 종류:', uniq.map((v) => v.toLocaleString()).join(' / '));
// MICE 비교
const mice: number[] = [];
for (const d of evs.docs) {
  const e = d.data() as any;
  if (e.deleted_at || e.event_type !== 'MICE' || !(Number(e.gateway_fee) > 0)) continue;
  mice.push(Number(e.gateway_fee));
}
console.log('MICE gateway_fee>0:', mice.length, '· 중앙값', mice.sort((a,b)=>a-b)[Math.floor(mice.length/2)]?.toLocaleString());
