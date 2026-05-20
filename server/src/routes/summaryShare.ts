// 캘린더 요약 공개 공유 토큰 — 단일 토큰을 발급/조회.
// 토큰은 한 번 만들면 재사용. 공개 열람은 /api/public/summary/:token 에서 처리.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { SummaryShare } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 토큰 조회 — 없으면 생성. 활성 사용자 누구나 (요약 공유는 운영 편의 기능).
router.get('/share', (req, res) => {
  let share = store.summary_shares[0];
  if (!share) {
    share = {
      id: nanoid(10),
      token: nanoid(24),
      created_at: new Date().toISOString(),
      created_by: req.user!.id,
    };
    store.summary_shares.push(share);
    persistDoc('summary_shares', share.id);
  }
  res.json({ token: share.token });
});

export default router;
