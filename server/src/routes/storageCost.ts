// /api/storage/* — 구매 시스템 원가를 management 화면에 내주는 서버 프록시 (S1).
// 브라우저는 구매 시스템을 직접 부르지 않는다. 키(Secret)는 서버에만 있다.
// 404 는 그대로 404 + reason='not_closed' — 화면이 "아직 마감 전" 으로 그린다. 잠정값 없음.
import { Router } from 'express';
import { requireActiveRole, requireRoles } from '../middleware/auth.js';
import {
  clearStorageCache,
  getStorageCogs,
  getStorageMenuCost,
  getStorageMenus,
  isValidMonth,
  storageKeyConfigured,
  type StorageResult,
} from '../lib/storageCost.js';
import { computeConventionPnl, menuCodePreview, missingMealCountEvents, revenueDeptLabel } from '../lib/s1Pnl.js';
import { store } from '../store/mockStore.js';

// 원가율은 민감 정보 — 메뉴별 원가 화면과 같은 범위(관리자·주방·연회). 실제원가·P&L 은 관리자만.
const COST_ROLES = ['admin', 'kitchen', 'banquet'] as const;

const router = Router();
router.use(requireActiveRole);

const MESSAGE: Record<string, string> = {
  no_key: '구매 시스템 읽기 키가 아직 등록되지 않았습니다 (관리자: Secret STORAGE_READ_KEY).',
  not_closed: '아직 마감 전이거나 그 달 원가가 없습니다.',
  unauthorized: '구매 시스템 읽기 키가 맞지 않습니다 (키 교체 확인).',
  bad_request: '월 형식은 YYYY-MM 입니다.',
  storage_unconfigured: '구매 시스템 쪽에 키가 설정되지 않았습니다.',
  upstream_error: '구매 시스템 응답 오류입니다.',
  network: '구매 시스템에 연결하지 못했습니다.',
};

function send<T>(res: import('express').Response, r: StorageResult<T>) {
  if (r.ok) return res.json({ ...r.data, cached: r.cached });
  const status = r.reason === 'no_key' ? 503 : r.status === 0 ? 502 : r.status === 401 ? 502 : r.status;
  return res.status(status).json({ error: r.reason, message: MESSAGE[r.reason] || r.reason });
}

router.get('/status', (_req, res) => {
  res.json({ key_configured: storageKeyConfigured() });
});

router.get('/menus', async (_req, res) => {
  send(res, await getStorageMenus());
});

router.get('/menu-cost', requireRoles(...COST_ROLES), async (req, res) => {
  const month = req.query.month;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'bad_request', message: MESSAGE.bad_request });
  send(res, await getStorageMenuCost(month));
});

router.get('/cogs', requireRoles('admin'), async (req, res) => {
  const month = req.query.month;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'bad_request', message: MESSAGE.bad_request });
  send(res, await getStorageCogs(month));
});

// 컨벤션 P&L — 매출·식수는 management, 원가는 구매 시스템 스냅샷/실제원가. 404 면 그 칸만 빈칸.
router.get('/pnl', requireRoles('admin'), async (req, res) => {
  const month = req.query.month;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'bad_request', message: MESSAGE.bad_request });
  const [mc, cg] = await Promise.all([getStorageMenuCost(month), getStorageCogs(month)]);
  const status = (r: StorageResult<unknown>) => (r.ok ? 'ok' : r.reason);
  res.json({
    ...computeConventionPnl(month, mc.ok ? mc.data : null, cg.ok ? cg.data : null),
    menu_cost_status: status(mc),
    cogs_status: status(cg),
  });
});

// 행사 메뉴 ↔ 코드 매핑 미리보기 (쓰기 없음)
router.get('/menu-code-preview', requireRoles('admin'), (_req, res) => {
  res.json(menuCodePreview());
});

// 2026 이후 종료 · 식수 미입력 행사 — 연회팀 행사리뷰 화면 배너용
router.get('/missing-meal-counts', (_req, res) => {
  res.json({ events: missingMealCountEvents() });
});

// 매출 항목별 기본 부서 — 매출 탭 표시용
router.get('/revenue-depts', (_req, res) => {
  res.json({ items: store.revenue_items.map((i) => ({ id: i.id, code: i.code, default_label: revenueDeptLabel(i.code) })) });
});

// 구매 시스템에서 마감 해제·재마감했을 때 — 이 인스턴스의 캐시만 비운다
router.post('/refresh', requireRoles('admin'), (_req, res) => {
  clearStorageCache();
  res.json({ ok: true });
});

export default router;
