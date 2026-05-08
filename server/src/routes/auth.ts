import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persist } from '../store/mockStore.js';
import { requireUser } from '../middleware/auth.js';

const router = Router();

// 모킹 로그인: email만 받아서 사용자가 있으면 반환, 없으면 pending으로 신규 생성.
// Firebase 전환 시 ID 토큰을 받아 검증하는 핸들러로 교체된다.
router.post('/login', (req, res) => {
  const { email, name, picture } = req.body as { email?: string; name?: string; picture?: string };
  if (!email) return res.status(400).json({ error: 'email_required' });

  let user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  const now = new Date().toISOString();
  if (!user) {
    user = {
      id: nanoid(10),
      email,
      name: name || email.split('@')[0],
      picture: picture || null,
      role: 'pending',
      team: null,
      created_at: now,
      updated_at: now,
    };
    store.users.push(user);
    persist('users');
  }

  // httpOnly 쿠키에 사용자 id 저장 (모킹 세션)
  res.cookie('uid', user.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14, // 14일
  });
  res.json({ user });
});

router.post('/logout', (_req, res) => {
  res.clearCookie('uid');
  res.json({ ok: true });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});

export default router;
