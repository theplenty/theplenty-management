import type { Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, ensureHydrated } from '../store/mockStore.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import type { Role, User } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      // 멀티테넌시 — 현재 요청이 속한 테넌트. attachTenant 가 채운다.
      tenantId?: string;
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
    // 테넌트 미지정 기존 사용자는 기본 테넌트로 백필
    if (!user.tenant_id) {
      user.tenant_id = DEFAULT_TENANT_ID;
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
    // 현재는 단일 테넌트 — 자동 생성 사용자도 기본 테넌트 소속.
    // Phase 3(셀프 온보딩)에서 가입 흐름이 적절한 테넌트를 배정.
    tenant_id: DEFAULT_TENANT_ID,
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
  // Cloud Functions cold start 시 Firestore에서 데이터를 in-memory로 로드 (한 번만).
  try {
    await ensureHydrated();
  } catch (e) {
    console.error('[auth] hydrate 실패, 다음 요청에서 재시도:', e);
  }

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

// 멀티테넌시 — 현재 요청의 테넌트를 결정한다.
// 현재: 로그인 사용자의 tenant_id 기준(미지정 시 기본 테넌트).
// 향후: 서브도메인/헤더, 공유 토큰(레코드의 tenant_id)으로 확장.
export function attachTenant(req: Request, _res: Response, next: NextFunction) {
  req.tenantId = req.user?.tenant_id || DEFAULT_TENANT_ID;
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
