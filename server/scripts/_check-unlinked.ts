import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');
const mice = await firestore.collection('mice_customers').get();
const norm = (s: any) => (s === 'DEF' ? 'DEF' : s === 'LOS' ? 'LOS' : s === '입금확인중' ? '입금확인중' : '문의');

let custs = 0, lastDefUnlinked = 0, anyDefUnlinked = 0;
let inqTotal = 0, inqDefUnlinked = 0, inqDefLinked = 0;
const byStatusUnlinked: Record<string, number> = {};
const hidden: string[] = [];

for (const d of mice.docs) {
  const c = d.data() as any;
  if (c.deleted_at) continue;
  custs++;
  const list = c.inquiries || [];
  const last = list[list.length - 1];
  const lastHit = last && norm(last.progress_status) === 'DEF' && !last.linked_event_id;
  if (lastHit) lastDefUnlinked++;
  let anyHit = false;
  for (const q of list) {
    inqTotal++;
    const st = norm(q.progress_status);
    if (!q.linked_event_id) byStatusUnlinked[st] = (byStatusUnlinked[st] || 0) + 1;
    if (st === 'DEF') {
      if (q.linked_event_id) inqDefLinked++; else { inqDefUnlinked++; anyHit = true; }
    }
  }
  if (anyHit) anyDefUnlinked++;
  if (anyHit && !lastHit && hidden.length < 10) {
    hidden.push(`${c.organization_name} — 문의 ${list.length}건, 마지막=${norm(last?.progress_status)}`);
  }
}
console.log(`MICE 고객 ${custs}명 · 문의 ${inqTotal}건`);
console.log(`\n[탭에 실제로 뜨는 것] 마지막 문의가 DEF+미연결인 고객: ${lastDefUnlinked}명`);
console.log(`[대표님이 기대하는 것?] DEF+미연결 문의를 하나라도 가진 고객: ${anyDefUnlinked}명`);
console.log(`  → 마지막 문의가 아니라서 탭에서 빠지는 고객: ${anyDefUnlinked - lastDefUnlinked}명`);
console.log(`\nDEF 문의: 연결됨 ${inqDefLinked}건 / 미연결 ${inqDefUnlinked}건`);
console.log(`\n행사 미연결 문의를 상태별로 세면:`, byStatusUnlinked);
console.log(`\n탭에서 빠지는 고객 샘플:`);
hidden.forEach((h) => console.log('  ' + h));
