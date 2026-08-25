import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const [evs, invs, evc, wed] = await Promise.all([
  firestore.collection('events').get(),
  firestore.collection('invoices').get(),
  firestore.collection('event_customers').get(),
  firestore.collection('wedding_customers').get(),
]);
const invByEv = new Map(invs.docs.map((d) => [(d.data() as any).event_id, d.data() as any]));
const wedMap = new Map(wed.docs.map((d) => [d.id, d.data() as any]));
const custByEv = new Map<string, any[]>();
for (const d of evc.docs) {
  const l = d.data() as any;
  const c = wedMap.get(l.customer_id);
  if (!c || c.deleted_at) continue;
  const a = custByEv.get(l.event_id) || []; a.push(c); custByEv.set(l.event_id, a);
}
const W = ['일','월','화','수','목','금','토'];
const rows: any[] = [];
for (const d of evs.docs) {
  const e = d.data() as any;
  if (e.deleted_at || e.event_type !== 'WEDDING' || !(Number(e.gateway_fee) > 0)) continue;
  const date = (e.start_datetime || '').slice(0, 10);
  const inv = invByEv.get(d.id);
  const cs = custByEv.get(d.id) || [];
  rows.push({
    date,
    dow: date ? W[new Date(date + 'T00:00:00+09:00').getDay()] : '',
    name: e.event_name || '',
    status: e.status,
    gw: Number(e.gateway_fee),
    pay: inv?.payment_status || '',
    depositor: inv?.depositor_name ? 'O' : '',
    invType: inv?.invoice_type || '',
    stage: cs.map((c) => c.progress_status).join('/') || '(고객 미연결)',
  });
}
rows.sort((a, b) => a.date.localeCompare(b.date));
rows.forEach((r, i) => {
  console.log([i + 1, r.date, r.dow, r.status, r.gw.toLocaleString(), r.pay || '-', r.depositor || '-', r.invType || '-', r.stage, r.name].join('\t'));
});
const noPay = rows.filter((r) => !r.pay).length;
console.log(`\n합계 ${rows.length}건 · 대관료 ${rows.reduce((s, r) => s + r.gw, 0).toLocaleString()}원 · 입금상태 비어있음 ${noPay}건`);
