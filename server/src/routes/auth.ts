import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireUser } from '../middleware/auth.js';

const router = Router();

// 로그인 — 두 가지 입력 지원
//   1) idToken: Firebase ID 토큰 → Admin SDK로 검증 → user 매칭/생성 → 쿠키도 같이 발급
//   2) email (+ name, picture): 모킹 로그인 — DEV_MOCK_LOGIN_ENABLED=true 일 때만 허용
//
// 운영 환경에서는 반드시 idToken만 사용하도록 .env에 DEV_MOCK_LOGIN_ENABLED=false 둘 것.
router.post('/login', async (req, res) => {
  const body = req.body as {
    idToken?: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  // ===== 1) Firebase ID 토큰 인증 =====
  if (body.idToken) {
    try {
      const { firebaseAuth } = await import('../lib/firebase.js');
      const decoded = await firebaseAuth.verifyIdToken(body.idToken);
      const email = decoded.email;
      if (!email) return res.status(400).json({ error: 'no_email_in_token' });
      let user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      const now = new Date().toISOString();
      if (!user) {
        const isSuperAdmin =
          !!process.env.SUPER_ADMIN_EMAIL &&
          email.toLowerCase() === process.env.SUPER_ADMIN_EMAIL.toLowerCase();
        user = {
          id: nanoid(10),
          email,
          name: (decoded.name as string | undefined) || email.split('@')[0],
          picture: (decoded.picture as string | undefined) || null,
          role: isSuperAdmin ? 'admin' : 'pending',
          team: isSuperAdmin ? 'admin' : null,
          created_at: now,
          updated_at: now,
        };
        store.users.push(user);
        persistDoc('users', user.id);
      } else {
        let dirty = false;
        if (decoded.name && !user.name) {
          user.name = decoded.name as string;
          dirty = true;
        }
        if (decoded.picture && !user.picture) {
          user.picture = decoded.picture as string;
          dirty = true;
        }
        if (dirty) {
          user.updated_at = now;
          persistDoc('users', user.id);
        }
      }
      // 쿠키도 함께 발급해서 dev 환경의 fetch 호환 보존
      res.cookie('uid', user.id, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 14,
      });
      return res.json({ user });
    } catch (e) {
      console.warn('[auth] idToken 검증 실패:', (e as Error).message);
      return res.status(401).json({ error: 'invalid_id_token' });
    }
  }

  // ===== 2) 모킹 로그인 (dev only) =====
  const mockEnabled = (process.env.DEV_MOCK_LOGIN_ENABLED || 'true').toLowerCase() === 'true';
  if (!mockEnabled) {
    return res.status(403).json({ error: 'mock_login_disabled' });
  }
  const { email, name, picture } = body;
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
    persistDoc('users', user.id);
  }

  res.cookie('uid', user.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14,
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
