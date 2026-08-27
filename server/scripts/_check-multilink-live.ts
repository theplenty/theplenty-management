// 읽기 전용: 사장님이 지적한 두 건이 이제 연결 가능한지 확인
import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');

const [mice, evs] = await Promise.all([
  firestore.collection('mice_customers').get(),
  firestore.collection('events').get(),
]);
const evMap = new Map(evs.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Record<string, unknown>) }]));

// 어느 문의가 어느 행사를 물고 있나
const linkedBy = new Map<string, { org: string; no: number }[]>();
for (const d of mice.docs) {
  const c = d.data() as { organization_name?: string; inquiries?: { linked_event_id?: string | null }[]; deleted_at?: string | null };
  if (c.deleted_at) continue;
  (c.inquiries || []).forEach((q, i) => {
    if (!q.linked_event_id) return;
    const arr = linkedBy.get(q.linked_event_id) || [];
    arr.push({ org: c.organization_name || '', no: i + 1 });
    linkedBy.set(q.linked_event_id, arr);
  });
}

for (const name of ['인터엠디', '대한여성성의학회']) {
  const doc = mice.docs.find((d) => (d.data() as { organization_name?: string }).organization_name === name);
  if (!doc) { console.log(`\n${name}: 없음`); continue; }
  const c = doc.data() as { organization_name: string; inquiries?: Record<string, unknown>[] };
  console.log(`\n=== ${c.organization_name} (문의 ${(c.inquiries || []).length}건) ===`);
  (c.inquiries || []).forEach((q, i) => {
    const ev = q.linked_event_id ? evMap.get(String(q.linked_event_id)) : null;
    console.log(
      `  문의#${i + 1} [${q.progress_status}] 예정일"${q.inquiry_event_date_text || '-'}" → ` +
        (ev ? `${ev.event_name} (${String(ev.start_datetime).slice(0, 10)})` : '미연결')
    );
  });
}

// 여러 업체가 물고 있는 행사 (이제 가능해진 형태)
console.log('\n=== 한 행사에 여러 업체 문의가 붙은 건 ===');
let n = 0;
for (const [evId, list] of linkedBy) {
  if (list.length < 2) continue;
  const ev = evMap.get(evId);
  console.log(`  ${ev?.event_name} (${String(ev?.start_datetime).slice(0, 10)}) ← ${list.map((x) => `${x.org} #${x.no}`).join(' + ')}`);
  n++;
}
if (!n) console.log('  (아직 없음 — 화면에서 연결하면 생깁니다)');

// 종근당 웹세미나가 지금 누구 것인지
console.log('\n=== 종근당 웹세미나 현황 ===');
for (const [, e] of evMap) {
  const ev = e as { id: string; event_name?: string; start_datetime?: string; source_customer_id?: string | null; deleted_at?: string | null };
  if (ev.deleted_at || !(ev.event_name || '').includes('종근당')) continue;
  const owner = ev.source_customer_id
    ? (mice.docs.find((d) => d.id === ev.source_customer_id)?.data() as { organization_name?: string } | undefined)?.organization_name
    : null;
  console.log(`  ${ev.event_name} (${String(ev.start_datetime).slice(0, 10)}) · 계약금 원본: ${owner || '(없음 — 먼저 연결하는 문의가 원본이 됩니다)'}`);
  console.log(`    현재 연결된 문의: ${(linkedBy.get(ev.id) || []).map((x) => `${x.org} #${x.no}`).join(', ') || '없음'}`);
}
