import type { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import type { Role, User } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Firebase ID 토큰 검증 결과를 짧게 캐싱 (5분).
// 매 요청마다 verifyIdToken을 호출하면 Firebase Auth 서버 round-trip 발생 → 캐싱이 합리적.
interface CachedToken {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedToken>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

async function verifyFirebaseIdToken(token: string): Promise<CachedToken | null> {
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached;

  try {
    const { firebaseAuth } = await import('../lib/firebase.js');
    const decoded = await firebaseAuth.verifyIdToken(token);
    if (!decoded.email) return null;
    const result: CachedToken = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name as string | undefined,
      picture: decoded.picture as string | undefined,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    };
    tokenCache.set(token, result);
    return result;
  } catch (e) {
    console.warn('[auth] Firebase ID token 검증 실패:', (e as Error).message);
    return null;
  }
}

// 이메일로 User 조회 → 없으면 자동 생성 (pending 또는 admin if SUPER_ADMIN_EMAIL 일치).
function findOrCreateUserByEmail(
  email: string,
  name?: string,
  picture?: string
): User {
  let user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (user) {
    let dirty = false;
    if (name && !user.name) {
      user.name = name;
      dirty = true;
    }
    if (picture && !user.picture) {
      user.picture = picture;
      dirty = true;
    }
    if (dirty) {
      user.updated_at = new Date().toISOString();
      persistDoc('users', user.id);
    }
    return user;
  }
  const isSuperAdmin =
    !!process.env.SUPER_ADMIN_EMAIL &&
    email.toLowerCase() === process.env.SUPER_ADMIN_EMAIL.toLowerCase();
  const now = new Date().toISOString();
  user = {
    id: nanoid(10),
    email,
    name: name || email.split('@')[0],
    picture: picture || null,
    role: isSuperAdmin ? 'admin' : 'pending',
    team: isSuperAdmin ? 'admin' : null,
    created_at: now,
    updated_at: now,
  };
  store.users.push(user);
  persistDoc('users', user.id);
  return user;
}

// 인증 미들웨어 — 두 가지 인증 방식 지원
//   1) Authorization: Bearer <Firebase ID 토큰>  ← 운영 (Phase 4 이후)
//   2) Cookie: uid=<user.id>                       ← 로컬 dev mock 로그인 호환
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  // 1) Bearer ID token 우선
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const verified = await verifyFirebaseIdToken(token);
    if (verified) {
      req.user = findOrCreateUserByEmail(verified.email, verified.name, verified.picture);
      return next();
    }
    // 잘못된 토큰이면 401 반환은 안 하고, 단지 user를 채우지 않음.
    // requireUser 미들웨어에서 401을 던질 것.
  }
  // 2) Cookie 기반 mock 로그인 (dev 환경)
  const uid = req.cookies?.uid as string | undefined;
  if (uid) {
    const user = store.users.find((u) => u.id === uid);
    if (user) req.user = user;
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function requireActiveRole(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (req.user.role === 'pending' || req.user.role === 'disabled') {
    return res.status(403).json({ error: 'role_not_granted', role: req.user.role });
  }
  next();
}

export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', need: roles, have: req.user.role });
    }
    next();
  };
}

export function isAdmin(user: User | undefined): user is User {
  return !!user && user.role === 'admin';
}
