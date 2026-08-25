// 이미 연결된 문의에 행사 입금 기록을 1회 역채움 (운영, 빈 칸만) — 이후 진실은 문의 쪽.
// 사용: npx tsx scripts/backfill-deposit-details.ts [--apply]
import './_loadEnv.js';
import fs from 'fs';
const { firestore } = await import('../src/lib/firebase.js');

const APPLY = process.argv.includes('--apply');
const get = async (c: string) => (await firestore.collection(c).get()).docs;
const [custDocs, evDocs, invDocs] = await Promise.all([get('mice_customers'), get('events'), get('invoices')]);
const events = new Map(evDocs.map((d) => [d.id, d.data() as any]));
const invByEvent = new Map(invDocs.map((d) => [(d.data() as any).event_id, d.data() as any]));

const backup: any[] = [];
let touched = 0;
for (const doc of custDocs) {
  const c = doc.data() as any;
  let changed = false;
  const pulls: string[] = [];
  for (const q of c.inquiries || []) {
    if (!q.linked_event_id) continue;
    const ev = events.get(q.linked_event_id);
    if (!ev) continue;
    const inv = invByEvent.get(q.linked_event_id);
    const empty = (v: any) => v === undefined || v === null || String(v) === '' || v === 0;
    const has = (v: any) => !(v === undefined || v === null || String(v) === '' || v === 0);
    const pull = (label: string, cur: any, from: any, set: (v: any) => void) => {
      if (empty(cur) && has(from)) { set(from); pulls.push(label); changed = true; }
    };
    pull('계약금', q.deposit_amount, ev.gateway_fee ?? inv?.payment_amount, (v) => { q.deposit_amount = Number(v); });
    pull('입금자명', q.deposit_depositor, inv?.depositor_name, (v) => { q.deposit_depositor = String(v); });
    pull('입금일자', q.deposit_date, inv?.payment_date, (v) => { q.deposit_date = String(v); });
    pull('계산서발행', q.invoice_type, inv?.invoice_type, (v) => { q.invoice_type = String(v); });
    pull('발행상태', q.invoice_issue_status, inv?.invoice_issue_status, (v) => { q.invoice_issue_status = String(v); });
    pull('세금계산서발행일', q.tax_invoice_issue_date, inv?.tax_invoice_issue_date, (v) => { q.tax_invoice_issue_date = String(v); });
    if (!q.deposit_paid && inv?.payment_status === '입금완료') {
      q.deposit_paid = true;
      q.deposit_paid_at = q.deposit_paid_at || inv.payment_date || new Date().toISOString();
      pulls.push('계약금체크'); changed = true;
    }
  }
  if (changed) {
    touched++;
    console.log(`${APPLY ? '적용' : '예정'}: ${c.organization_name} — ${[...new Set(pulls)].join(', ')}`);
    if (APPLY) {
      backup.push({ id: doc.id, before: doc.data() });
      await doc.ref.update({ inquiries: c.inquiries });
    }
  }
}
if (APPLY) {
  fs.writeFileSync('data/deposit-backfill-backup.json', JSON.stringify(backup, null, 1));
  console.log(`\n역채움 완료 ${touched}곳 (백업: data/deposit-backfill-backup.json) — functions 재배포 필요`);
} else {
  console.log(`\n대상 ${touched}곳 (dry-run — --apply 로 실행)`);
}
process.exit(0);
