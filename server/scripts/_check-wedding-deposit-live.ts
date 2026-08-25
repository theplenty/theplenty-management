// 읽기 전용: 운영에서 웨딩 계약금 화면이 어떻게 보일지 점검 (INQ/DEF 고객의 자동 매칭·기존 대관료)
import './_loadEnv.js';
const { firestore } = await import('../src/lib/firebase.js');

const [wed, evs, evc, invs] = await Promise.all([
  firestore.collection('wedding_customers').get(),
  firestore.collection('events').get(),
  firestore.collection('event_customers').get(),
  firestore.collection('invoices').get(),
]);

interface Ev { id: string; event_name?: string; status?: string; start_datetime?: string; gateway_fee?: number | null; event_type?: string; deleted_at?: string | null }
const evMap = new Map<string, Ev>(evs.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Ev) }]));
const invByEv = new Map(invs.docs.map((d) => [(d.data() as { event_id: string }).event_id, d.data() as Record<string, unknown>]));
const evByCust = new Map<string, Ev[]>();
for (const d of evc.docs) {
  const l = d.data() as { customer_id: string; event_id: string };
  const e = evMap.get(l.event_id);
  if (!e || e.deleted_at || e.event_type !== 'WEDDING') continue;
  const a = evByCust.get(l.customer_id) || [];
  a.push(e);
  evByCust.set(l.customer_id, a);
}

function resolve(custId: string, day: string, evList: Ev[]): Ev | null {
  if (day) {
    const same = evList.filter((e) => (e.start_datetime || '').slice(0, 10) === day);
    if (same.length === 1) return same[0];
    if (same.length > 1) return null;
  }
  return evList.length === 1 ? evList[0] : null;
}

let inqShown = 0;
let defWithFee = 0;
let unmatched = 0;
console.log('=== INQ 고객 (계약금 칸이 새로 보이는 대상) ===');
for (const d of wed.docs) {
  const c = d.data() as { progress_status?: string; wedding_event_name?: string; deleted_at?: string | null; event_inquiries?: { wedding_datetime?: string | null }[] };
  if (c.deleted_at || c.progress_status !== 'INQ') continue;
  const evList = evByCust.get(d.id) || [];
  for (const [i, q] of (c.event_inquiries || []).entries()) {
    const day = (q.wedding_datetime || '').slice(0, 10);
    const t = resolve(d.id, day, evList);
    inqShown++;
    if (!t) unmatched++;
    console.log(
      ` ${c.wedding_event_name} 후보#${i + 1} ${day || '(일시없음)'} → ` +
        (t ? `${t.status}/${(t.start_datetime || '').slice(0, 10)} 대관료=${t.gateway_fee ?? '없음'}` : '⚠ 자동매칭 없음(화면에서 선택 필요)')
    );
  }
}

for (const d of wed.docs) {
  const c = d.data() as { progress_status?: string; deleted_at?: string | null; event_inquiries?: { wedding_datetime?: string | null }[] };
  if (c.deleted_at || c.progress_status !== 'DEF') continue;
  const evList = evByCust.get(d.id) || [];
  for (const q of c.event_inquiries || []) {
    const t = resolve(d.id, (q.wedding_datetime || '').slice(0, 10), evList);
    if (t && (Number(t.gateway_fee) > 0 || invByEv.get(t.id))) defWithFee++;
  }
}
console.log(`\nINQ 후보 ${inqShown}개 (자동매칭 실패 ${unmatched}개)`);
console.log(`DEF 후보 중 행사에 대관료·입금기록이 이미 있는 건: ${defWithFee}개 — 후보를 열어 저장하면 그 값이 보인다`);
