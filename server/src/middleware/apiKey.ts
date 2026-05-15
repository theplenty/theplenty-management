// 외부 클라이언트용 API 키 인증 미들웨어.
// `X-API-Key: <token>` 헤더 또는 `Authorization: Bearer <token>` 로 인증.
// 유효한 active 키면 req.apiKey 채워주고, last_used_at 갱신.

import type { Request, Response, NextFunction } from 'express';
import { store, persistDoc, ensureHydrated } from '../store/mockStore.js';
import type { ApiKey } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
    }
  }
}

function extractToken(req: Request): string | null {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  return null;
}

export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    await ensureHydrated();
  } catch (e) {
    console.error('[apiKey] hydrate 실패:', e);
  }
  const token = extractToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ error: 'missing_api_key', hint: 'X-API-Key 헤더 또는 Authorization: Bearer 토큰 필요' });
  }
  const key = store.api_keys.find((k) => k.token === token);
  if (!key) return res.status(401).json({ error: 'invalid_api_key' });
  if (!key.active) return res.status(403).json({ error: 'api_key_disabled' });

  // last_used_at — 분 단위 throttle (매 요청마다 디스크 쓰면 부담)
  const now = Date.now();
  const last = key.last_used_at ? new Date(key.last_used_at).getTime() : 0;
  if (now - last > 60_000) {
    key.last_used_at = new Date(now).toISOString();
    persistDoc('api_keys', key.id);
  }

  req.apiKey = key;
  next();
}
