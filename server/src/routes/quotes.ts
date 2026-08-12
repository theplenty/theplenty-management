// 견적 버전 (B2) — 통짜 JSON 을 1급 엔티티로 올린 뒤의 읽기·쓰기 경로.
//
// 핵심 규칙: **덮어쓰지 않는다.** 저장할 때마다 버전을 하나 더 쌓는다.
// 이전 구조(`event_inquiry.calc_payload`)는 매번 덮어써서 "처음에 얼마를 불렀는지"가
// 남지 않았다. 금액 협상 이력은 나중에 되짚을 일이 반드시 생긴다.
//
// 수정·삭제 라우트를 일부러 두지 않았다. 견적 이력은 감사 기록에 가까워서,
// 잘못 냈으면 새 버전을 쌓아 바로잡는 게 맞다.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import type { QuoteVersion } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 견적은 웨딩 세일즈 업무 — 조회는 활성 사용자 전원, 작성은 admin + 세일즈.
function canWrite(role: string): boolean {
  return role === 'admin' || role === 'sales_wedding' || role === 'sales_mice';
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 문의 id 로 소속 고객을 찾는다 (문의는 고객 문서 안의 배열이라 역인덱스가 없다) */
function findCustomerByInquiry(inquiryId: string) {
  for (const c of store.wedding_customers) {
    if (c.deleted_at) continue;
    const q = (c.event_inquiries || []).find((x) => x.id === inquiryId);
    if (q) return { customer: c, inquiry: q };
  }
  return null;
}

// ===== 목록 =====
// GET /api/quotes?inquiry_id=... | ?customer_id=...
// 둘 다 없으면 전체(통계·점검용). 최신 버전이 위로 온다.
router.get('/', (req, res) => {
  const inquiryId = str(req.query.inquiry_id);
  const customerId = str(req.query.customer_id);
  let rows = store.quote_versions as QuoteVersion[];
  if (inquiryId) rows = rows.filter((q) => q.inquiry_id === inquiryId);
  else if (customerId) rows = rows.filter((q) => q.customer_id === customerId);
  const sorted = [...rows].sort((a, b) =>
    a.inquiry_id === b.inquiry_id ? b.version - a.version : a.inquiry_id < b.inquiry_id ? 1 : -1
  );
  res.json({ quotes: sorted });
});

// ===== 단건 =====
router.get('/:id', (req, res) => {
  const q = store.quote_versions.find((x) => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'not_found' });
  res.json({ quote: q });
});

// ===== 새 버전 저장 =====
// 계산은 클라이언트(weddingCalc)가 이미 했으므로 결과를 받아 스냅샷으로 굳힌다.
// 기준단가가 나중에 바뀌어도 이 버전의 금액은 변하지 않아야 한다 — 그게 스냅샷의 목적.
router.post('/', (req, res) => {
  if (!canWrite(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const b = req.body as Record<string, unknown>;

  const inquiryId = str(b.inquiry_id);
  if (!inquiryId) return res.status(400).json({ error: 'inquiry_id 는 필수입니다.' });

  const found = findCustomerByInquiry(inquiryId);
  if (!found) return res.status(400).json({ error: 'inquiry_not_found' });

  // 원본 입력이 없으면 나중에 이 견적을 다시 열어볼 수 없다 — 버전의 의미가 사라진다.
  const inputsJson = str(b.inputs_json);
  if (!inputsJson) return res.status(400).json({ error: 'inputs_json 은 필수입니다.' });
  try {
    JSON.parse(inputsJson);
  } catch {
    return res.status(400).json({ error: 'inputs_json 이 올바른 JSON 이 아닙니다.' });
  }

  const total = num(b.total_amount, NaN);
  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ error: 'total_amount 가 올바르지 않습니다.' });
  }

  const prev = store.quote_versions.filter((q) => q.inquiry_id === inquiryId);
  const version = prev.reduce((m, q) => Math.max(m, q.version), 0) + 1;

  const row: QuoteVersion = {
    id: nanoid(12),
    tenant_id: req.tenantId || DEFAULT_TENANT_ID,
    customer_id: found.customer.id,
    inquiry_id: inquiryId,
    version,
    created_at: new Date().toISOString(),
    created_by_id: req.user!.id,
    created_by_name: req.user!.name,

    groom: str(b.groom),
    bride: str(b.bride),
    wedding_date: str(b.wedding_date) || null,
    wedding_time: str(b.wedding_time),
    slot: str(b.slot),
    guests: num(b.guests),
    customer_type: str(b.customer_type),
    course: str(b.course),
    meal_discount_rate: num(b.meal_discount_rate),
    flower_bill: str(b.flower_bill),
    flower_give: str(b.flower_give),
    flower_upgrade: !!b.flower_upgrade,
    noodle: !!b.noodle,

    total_amount: total,
    list_total: num(b.list_total),
    total_benefit: num(b.total_benefit),
    meal_revenue: num(b.meal_revenue),
    flower_revenue: num(b.flower_revenue),
    rent_revenue: num(b.rent_revenue),
    margin_rate: b.margin_rate === null || b.margin_rate === undefined ? null : num(b.margin_rate),

    inputs_json: inputsJson,
    summary_text: str(b.summary_text),
    note: str(b.note),
  };

  store.quote_versions.push(row);
  persistDoc('quote_versions', row.id);
  res.status(201).json({ quote: row });
});

export default router;
