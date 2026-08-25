/**
 * 웨딩 진행단계 ↔ 행사 상태 통합(W2) 스모크.
 * 사용: STORE_BACKEND=json PORT=4191 npx tsx src/server.ts & → SMOKE_BASE=http://localhost:4191 npx tsx scripts/_smoke-wedding-stage.ts
 * (포트 4190 은 fetch 표준 차단 포트라 쓰지 말 것)
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:4191';
const ADMIN = '0u1bMDz4xK';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`, extra !== undefined ? JSON.stringify(extra) : '');
  }
}

async function raw(method: string, path: string, body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: `uid=${ADMIN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await raw(method, path, body);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface Cust { id: string; progress_status: string; wedding_event_name: string; event_inquiries: any[]; stage_manual_at?: string | null }
interface Ev { id: string; status: string; event_name: string; start_datetime: string }

const stamp = Date.now();
console.log('\n=== 웨딩 단계 통합(W2) 스모크 ===\n');

async function newCustomer(name: string, stage: string, day: string): Promise<Cust> {
  const r = await api<{ customer: Cust }>('POST', '/api/customers/wedding', {
    wedding_event_name: name,
    progress_status: stage,
    event_inquiries: [{ wedding_datetime: `${day}T12:00` }],
  });
  return r.customer;
}
async function newEvent(name: string, day: string, status = 'INQ'): Promise<Ev> {
  const r = await api<{ event: Ev }>('POST', '/api/events', {
    event_type: 'WEDDING',
    event_name: name,
    status,
    start_datetime: `${day}T12:00:00.000Z`,
    end_datetime: `${day}T15:00:00.000Z`,
    halls: ['Hall A+B'],
  });
  return r.event;
}
const getCust = async (id: string) => (await api<{ customer: Cust }>('GET', `/api/customers/wedding/${id}`)).customer;
const getEv = async (id: string) => (await api<{ event: Ev }>('GET', `/api/events/${id}`)).event;

// ── 1) 행사 생성 → 고객 자동 INQ ─────────────────────────────
const c1 = await newCustomer(`[W2] 생성전파 ${stamp}`, '상담', '2027-03-06');
const e1 = await newEvent(`[W2] 예식 ${stamp}`, '2027-03-06');
await api('PATCH', `/api/events/${e1.id}`, {
  customer_links: [{ customer_id: c1.id, customer_role: '신랑측', is_contact_point: true }],
});
// 링크는 PATCH 로 붙였으므로 그 PATCH 가 전파를 태운다
check('가블록 행사 연결 시 고객이 상담 → INQ 로 자동 승격', (await getCust(c1.id)).progress_status === 'INQ');

// ── 2) 캘린더에서 취소 → 고객 자동 LOS (16번 사례) ───────────
await api('PATCH', `/api/events/${e1.id}`, { status: 'LOS' });
check('행사 LOS 로 바꾸면 고객도 LOS (캘린더만 취소되던 누락 해소)', (await getCust(c1.id)).progress_status === 'LOS');

// ── 3) 캘린더에서 확정 → 고객 자동 DEF (26번 사례) ───────────
await api('PATCH', `/api/events/${e1.id}`, { status: 'DEF' });
check('행사 DEF 로 바꾸면 고객도 DEF (계약했는데 반영 안 되던 누락 해소)', (await getCust(c1.id)).progress_status === 'DEF');

// ── 4) 반대 방향 — 고객 DB 에서 바꾸면 행사가 따라온다 ────────
const r4 = await api<{ customer: Cust; event_synced: { from: string; to: string } | null }>(
  'PATCH',
  `/api/customers/wedding/${c1.id}`,
  { progress_status: 'LOS' }
);
check('고객을 LOS 로 바꾸면 행사도 LOS', (await getEv(e1.id)).status === 'LOS');
check('무엇이 바뀌었는지 응답에 담김', r4.event_synced?.to === 'LOS', r4.event_synced);

// ── 5) 대응 없는 단계(상담)로 내리면 행사는 두고 '수동 지정' 표시 ──
await api('PATCH', `/api/customers/wedding/${c1.id}`, { progress_status: '상담' });
const c1b = await getCust(c1.id);
check('상담으로 되돌리면 행사 상태는 그대로 LOS', (await getEv(e1.id)).status === 'LOS');
check('일부러 다르게 둔 건 수동 지정으로 기록됨', !!c1b.stage_manual_at, c1b.stage_manual_at);

// ── 6) 목록 응답에 불일치 표시 ────────────────────────────────
const list = await api<{ stages: Record<string, { mismatch: boolean; manual: boolean; eventStatus: string }> }>(
  'GET',
  '/api/customers/wedding'
);
check('목록에서 단계 불일치로 잡힘', list.stages[c1.id]?.mismatch === true, list.stages[c1.id]);
check('수동 지정 표시도 함께 내려옴', list.stages[c1.id]?.manual === true);

// ── 7) 행사 없이 INQ/DEF 선택 차단 ────────────────────────────
const c2 = await newCustomer(`[W2] 행사없음 ${stamp}`, '상담', '2027-04-10');
const blocked = await raw('PATCH', `/api/customers/wedding/${c2.id}`, { progress_status: 'DEF' });
check('행사 없이 DEF 로 바꾸면 400 으로 거절', blocked.status === 400, blocked.status);
check('거절돼도 단계는 상담 그대로', (await getCust(c2.id)).progress_status === '상담');
const payload = (await blocked.json()) as { error?: string; message?: string };
check('거절 사유에 안내문이 담김', !!payload.message && payload.error === 'event_required', payload);

// ── 8) 이미 어긋난 옛 데이터의 다른 항목은 수정 가능해야 한다 ──
// (행사 없는 DEF 3건 같은 기존 데이터를 못 고치면 정리할 방법이 없어진다)
const c3 = await newCustomer(`[W2] 옛데이터 ${stamp}`, '상담', '2027-05-15');
await api('PATCH', `/api/customers/wedding/${c3.id}`, { memo: '메모만 수정' });
check('행사 없는 고객도 단계를 안 바꾸면 저장됨', (await getCust(c3.id)).memo === '메모만 수정');

// ── 9) 미팅·시식 상태는 딜 단계가 아니라 전파하지 않는다 ───────
const c4 = await newCustomer(`[W2] 미팅 ${stamp}`, '상담', '2027-06-19');
const e4 = await newEvent(`[W2] 미팅행사 ${stamp}`, '2027-06-19', 'INQ');
await api('PATCH', `/api/events/${e4.id}`, {
  customer_links: [{ customer_id: c4.id, customer_role: '신랑측', is_contact_point: true }],
});
await api('PATCH', `/api/events/${e4.id}`, { status: '미팅' });
check('행사를 미팅으로 바꿔도 고객 단계는 안 건드림', (await getCust(c4.id)).progress_status === 'INQ');

console.log(`\n결과: ${pass} 통과 / ${fail} 실패\n`);
process.exit(fail ? 1 : 0);
