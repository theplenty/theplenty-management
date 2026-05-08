import type { Request, Response, NextFunction } from 'express';
import { store } from '../store/mockStore.js';
import type { Role, User } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// 모킹 단계에서는 쿠키에 담긴 user_id로 사용자를 조회한다.
// Firebase 연결 시 이 미들웨어만 ID 토큰 검증으로 교체하면 된다.
export function attachUser(req: Request, _res: Response, next: NextFunction) {
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
