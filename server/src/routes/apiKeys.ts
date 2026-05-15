// 외부 클라이언트용 API 키 관리 — admin 전용.
// 발급 시 token 평문 한 번만 응답에 포함 (full_token). list/조회 시에는 마스킹된 형태(masked_token)만.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireRoles } from '../middleware/auth.js';
import type { ApiKey, ApiKeyScope } from '../types.js';

const router = Router();
router.use(requireRoles('admin'));

const VALID_SCOPES: ApiKeyScope[] = ['all', 'summary', 'wedding', 'mice'];

function generateToken(): string {
  // pk_<32 hex> — 외부에서 식별 쉽게 prefix 부여
  return 'pk_' + crypto.randomBytes(16).toString('hex');
}

function maskToken(token: string): string {
  if (token.length <= 10) return token;
  return token.slice(0, 6) + '…' + token.slice(-4);
}

// 목록 — 평문 토큰은 절대 포함하지 않음
function toSafe(k: ApiKey) {
  return {
    id: k.id,
    label: k.label,
    masked_token: maskToken(k.token),
    scope: k.scope,
    created_by_id: k.created_by_id,
    created_by_name: k.created_by_name,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    active: k.active,
  };
}

router.get('/', (_req, res) => {
  const list = store.api_keys
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .map(toSafe);
  res.json({ api_keys: list });
});

router.post('/', (req, res) => {
  const body = req.body as { label?: string; scope?: ApiKeyScope };
  const label = (body.label || '').trim();
  const scope = body.scope;
  if (!label) return res.status(400).json({ error: 'label_required' });
  if (!scope || !VALID_SCOPES.includes(scope)) {
    return res.status(400).json({ error: 'invalid_scope', valid: VALID_SCOPES });
  }
  const now = new Date().toISOString();
  const item: ApiKey = {
    id: nanoid(10),
    label,
    token: generateToken(),
    scope,
    created_by_id: req.user!.id,
    created_by_name: req.user!.name,
    created_at: now,
    last_used_at: null,
    active: true,
  };
  store.api_keys.push(item);
  persistDoc('api_keys', item.id);
  // 발급 직후 한 번만 평문 token 노출
  res.status(201).json({
    api_key: toSafe(item),
    full_token: item.token,
    warning: '이 토큰은 다시 표시되지 않습니다. 안전한 곳에 보관하세요.',
  });
});

router.patch('/:id', (req, res) => {
  const item = store.api_keys.find((k) => k.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const body = req.body as { label?: string; scope?: ApiKeyScope; active?: boolean };
  if (body.label !== undefined) {
    const l = String(body.label).trim();
    if (!l) return res.status(400).json({ error: 'label_required' });
    item.label = l;
  }
  if (body.scope !== undefined) {
    if (!VALID_SCOPES.includes(body.scope)) {
      return res.status(400).json({ error: 'invalid_scope', valid: VALID_SCOPES });
    }
    item.scope = body.scope;
  }
  if (body.active !== undefined) item.active = !!body.active;
  persistDoc('api_keys', item.id);
  res.json({ api_key: toSafe(item) });
});

router.delete('/:id', (req, res) => {
  const idx = store.api_keys.findIndex((k) => k.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const removed = store.api_keys[idx];
  store.api_keys.splice(idx, 1);
  persistDelete('api_keys', removed.id);
  res.json({ ok: true });
});

export default router;
