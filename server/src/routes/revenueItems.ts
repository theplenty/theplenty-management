import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persist, persistDoc } from '../store/mockStore.js';
import { requireActiveRole, requireRoles } from '../middleware/auth.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import type { RevenueCategory } from '../types.js';

const router = Router();
const ADMIN_ROLES = ['admin'] as const;
const VALID_CATS: RevenueCategory[] = ['공간', '식음', '장비', '장식', '기타'];

// GET / — 전체 목록 (활성 role이면 OK)
router.get('/', requireActiveRole, (_req, res) => {
  const items = [...store.revenue_items].sort((a, b) => a.sort_order - b.sort_order);
  res.json({ revenue_items: items });
});

// POST / — 관리자 전용 생성
router.post('/', requireRoles(...ADMIN_ROLES), (req, res) => {
  const { code, name_ko, category, default_account, sort_order, is_active } = req.body as {
    code?: string; name_ko?: string; category?: RevenueCategory;
    default_account?: string; sort_order?: number; is_active?: boolean;
  };
  if (!code?.trim()) return res.status(400).json({ error: 'code_required' });
  if (!name_ko?.trim()) return res.status(400).json({ error: 'name_required' });
  if (!category || !VALID_CATS.includes(category)) return res.status(400).json({ error: 'category_required' });
  if (store.revenue_items.find(i => i.code === code.trim())) {
    return res.status(409).json({ error: 'duplicate_code' });
  }
  const now = new Date().toISOString();
  const item = {
    id: nanoid(10), tenant_id: DEFAULT_TENANT_ID,
    code: code.trim(), name_ko: name_ko.trim(), category,
    default_account: default_account?.trim() ?? '',
    sort_order: Number(sort_order) || (store.revenue_items.length + 1),
    is_active: is_active !== false,
    created_at: now, updated_at: now,
  };
  store.revenue_items.push(item);
  persistDoc('revenue_items', item.id);
  res.status(201).json({ revenue_item: item });
});

// PATCH /:id — 관리자 전용 수정
router.patch('/:id', requireRoles(...ADMIN_ROLES), (req, res) => {
  const item = store.revenue_items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const { name_ko, category, default_account, sort_order, is_active } = req.body as {
    name_ko?: string; category?: RevenueCategory; default_account?: string;
    sort_order?: number; is_active?: boolean;
  };
  if (name_ko !== undefined) item.name_ko = name_ko.trim();
  if (category !== undefined && VALID_CATS.includes(category)) item.category = category;
  if (default_account !== undefined) item.default_account = default_account.trim();
  if (sort_order !== undefined) item.sort_order = Number(sort_order);
  if (is_active !== undefined) item.is_active = Boolean(is_active);
  item.updated_at = new Date().toISOString();
  persistDoc('revenue_items', item.id);
  res.json({ revenue_item: item });
});

// suppress unused import warning
void persist;

export default router;
