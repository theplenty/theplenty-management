// 일괄 이관된 MICE 문의 정리 — 한꺼번에 들어간(같은 분에 5건+) 인콜 문의 중 통화 기록이 없는 것을
// 'DB 수집(통화 아님)' 으로 바꾼다. 미처리 인콜·인콜 집계에서 빠지고 DB 수집 카드로 간다.
// 사용: npx tsx scripts/_cleanup-bulk-import-incalls.ts [--apply]   (기본 dry-run)
import './_loadEnv.js';
import { nanoid } from 'nanoid';

const APPLY = process.argv.includes('--apply');
const { firestore } = await import('../src/lib/firebase.js');
const snap = await firestore.collection('mice_customers').get();

type Cand = { customerId: string; inqId: string; minute: string };
const all: Cand[] = [];
const customers = new Map<string, any>();
for (const d of snap.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  customers.set(c.id, c);
  for (const q of c.inquiries || []) {
    const checks = ['quote_sent', 'contract_sent', 'contract_replied', 'deposit_paid'].some((k) => q[k]);
    if (q.inquiry_channel !== 'INCALL' || q.progress_status !== '문의' || checks) continue;
    all.push({ customerId: c.id, inqId: q.id, minute: (q.created_at || '').slice(0, 16) });
  }
}
const perMin = new Map<string, number>();
for (const r of all) perMin.set(r.minute, (perMin.get(r.minute) || 0) + 1);
const targets = all.filter((r) => (perMin.get(r.minute) || 0) >= 5).filter((r) => {
  const q = customers.get(r.customerId).inquiries.find((x: any) => x.id === r.inqId);
  return !q.call_date;
});
const byMin = new Map<string, number>();
for (const t of targets) byMin.set(t.minute, (byMin.get(t.minute) || 0) + 1);
const byCustomer = new Map<string, string[]>();
for (const t of targets) {
  if (!byCustomer.has(t.customerId)) byCustomer.set(t.customerId, []);
  byCustomer.get(t.customerId)!.push(t.inqId);
}
console.log(`미처리 인콜 후보 ${all.length}건 → 일괄 이관분(통화일 없음) ${targets.length}건 / 고객 ${byCustomer.size}명`);
console.log('생성 시각별:', [...byMin.entries()].sort().map(([m, n]) => `${m}:${n}`).join('  '));
if (!APPLY) {
  console.log('[dry-run] --apply 로 반영');
  process.exit(0);
}

const now = new Date().toISOString();
let batch = firestore.batch();
let ops = 0;
let changed = 0;
for (const [customerId, inqIds] of byCustomer) {
  const c = customers.get(customerId);
  const ids = new Set(inqIds);
  const inquiries = (c.inquiries || []).map((q: any) =>
    ids.has(q.id)
      ? { ...q, inquiry_channel: 'DB', progress_status: 'DB수집', status_changed_at: now }
      : q,
  );
  batch.update(firestore.collection('mice_customers').doc(customerId), { inquiries, updated_at: now });
  const logId = nanoid(10);
  batch.set(firestore.collection('change_logs').doc(logId), {
    id: logId,
    entity_type: 'mice_customer',
    entity_id: customerId,
    action: 'update',
    summary: `일괄 이관분 정리 — 통화 기록 없는 문의 ${inqIds.length}건을 인콜 → DB 수집으로`,
    changed_by_id: 'system-cleanup',
    changed_by_name: '시스템 정리',
    changed_at: now,
  });
  changed += inqIds.length;
  ops += 2;
  if (ops >= 400) {
    await batch.commit();
    batch = firestore.batch();
    ops = 0;
  }
}
if (ops > 0) await batch.commit();
console.log(`반영 완료: 문의 ${changed}건 / 고객 ${byCustomer.size}명 (변경이력 기록)`);
process.exit(0);
