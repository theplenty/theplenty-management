import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const [invs, mice, wed] = await Promise.all([
  firestore.collection('invoices').get(),
  firestore.collection('mice_customers').get(),
  firestore.collection('wedding_customers').get(),
]);
let invHas = 0;
for (const d of invs.docs) if ((d.data() as any).tax_invoice_issue_date) invHas++;
let miceHas = 0;
for (const d of mice.docs) for (const q of (d.data() as any).inquiries || []) if (q.tax_invoice_issue_date) miceHas++;
let wedHas = 0;
for (const d of wed.docs) for (const q of (d.data() as any).event_inquiries || []) if (q.tax_invoice_issue_date) wedHas++;
console.log(`invoices ${invs.size}건 중 세금계산서발행일자 있음: ${invHas}건`);
console.log(`MICE 문의 중 값 있음: ${miceHas}건 · 웨딩 후보 중 값 있음: ${wedHas}건`);
