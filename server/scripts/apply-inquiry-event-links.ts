// S2 ⑥ 승인된 짝만 연결 — 사장님이 고른 pairs 만 반영. 백업 후 적용.
// 사용: npx tsx scripts/apply-inquiry-event-links.ts --pairs "custId:inqId:eventId,..." [--apply]
import './_loadEnv.js';
import fs from 'fs';
const { firestore } = await import('../src/lib/firebase.js');

const arg = process.argv.indexOf('--pairs');
const APPLY = process.argv.includes('--apply');
if (arg < 0) { console.error('--pairs 필요'); process.exit(2); }
const pairs = process.argv[arg + 1].split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
  const [custId, inqId, eventId] = p.split(':');
  return { custId, inqId, eventId };
});

const backup: unknown[] = [];
let ok = 0;
// 한 행사에 두 문의가 붙으면 매출이 꼬인다 — 서버 API 와 같은 규칙을 배치에도 적용
const usedEvents = new Set<string>();
{
  const all = (await firestore.collection('mice_customers').get()).docs;
  for (const d of all) for (const q of ((d.data() as any).inquiries || [])) if (q.linked_event_id) usedEvents.add(q.linked_event_id);
}
for (const { custId, inqId, eventId } of pairs) {
  if (usedEvents.has(eventId)) { console.log(`⏭ 건너뜀(이미 다른 문의가 연결): ${eventId}`); continue; }
  const cRef = firestore.collection('mice_customers').doc(custId);
  const eRef = firestore.collection('events').doc(eventId);
  const [cSnap, eSnap] = await Promise.all([cRef.get(), eRef.get()]);
  if (!cSnap.exists || !eSnap.exists) { console.log(`❌ ${custId}/${eventId} 없음`); continue; }
  const cust = cSnap.data() as any;
  const ev = eSnap.data() as any;
  const inq = (cust.inquiries || []).find((q: any) => q.id === inqId);
  if (!inq) { console.log(`❌ 문의 없음 ${inqId}`); continue; }

  const amount = Number(inq.deposit_amount) || 0;
  const willPush = inq.progress_status === 'DEF' && !!inq.deposit_paid && amount > 0
    && (ev.gateway_fee == null || Number(ev.gateway_fee) === 0);
  console.log(
    `${APPLY ? '적용' : '예정'}: ${cust.organization_name} #${(cust.inquiries || []).indexOf(inq) + 1} → ${ev.event_name}`
    + (willPush ? ` · 대관료 ${amount.toLocaleString()} 반영` : amount > 0 ? ' · 대관료 기존값 유지' : ' · 계약금 없음(연결만)'),
  );
  if (!APPLY) continue;

  backup.push({ custId, inqId, eventId, before: { inq: { ...inq }, gateway_fee: ev.gateway_fee ?? null } });
  inq.linked_event_id = eventId;
  inq.linked_at = new Date().toISOString();
  inq.linked_by_name = '소급 매칭(승인)';
  if (willPush) {
    inq.revenue_pushed_at = new Date().toISOString();
    inq.revenue_pushed_amount = amount;
    await eRef.update({ gateway_fee: amount, source_customer_id: custId, source_inquiry_id: inqId });
  } else {
    await eRef.update({ source_customer_id: custId, source_inquiry_id: inqId });
  }
  await cRef.update({ inquiries: cust.inquiries });
  usedEvents.add(eventId);
  // 고객↔행사 링크 (없을 때만)
  const dup = await firestore.collection('event_customers').where('event_id', '==', eventId).where('customer_id', '==', custId).get();
  if (dup.empty) {
    await firestore.collection('event_customers').add({
      event_id: eventId, customer_id: custId, customer_role: '주최사',
      is_contact_point: true, contact_point_contact_id: inq.contacts?.[0]?.id || '',
    });
  }
  ok++;
}
if (APPLY) {
  fs.writeFileSync('data/inquiry-link-backup.json', JSON.stringify(backup, null, 1));
  console.log(`\n연결 완료 ${ok}건 (백업: data/inquiry-link-backup.json) — functions 재배포하면 화면 반영`);
} else {
  console.log('\n(dry-run — --apply 로 실행)');
}
process.exit(0);
