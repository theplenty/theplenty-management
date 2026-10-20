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

router.get('/menu-cost', async (req, res) => {
  const month = req.query.month;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'bad_request', message: MESSAGE.bad_request });
  send(res, await getStorageMenuCost(month));
});

router.get('/cogs', async (req, res) => {
  const month = req.query.month;
  if (!isValidMonth(month)) return res.status(400).json({ error: 'bad_request', message: MESSAGE.bad_request });
  send(res, await getStorageCogs(month));
});

// 구매 시스템에서 마감 해제·재마감했을 때 — 이 인스턴스의 캐시만 비운다
router.post('/refresh', requireRoles('admin'), (_req, res) => {
  clearStorageCache();
  res.json({ ok: true });
});

export default router;
