import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole, requireRoles } from '../middleware/auth.js';
import type { MenuCategory, MenuDetail, MenuMode } from '../types.js';

const router = Router();

// 쓰기 가능 역할 — 사장(admin) + 세일즈 매니저
const WRITE_ROLES = ['admin', 'sales_mice', 'sales_wedding'] as const;

// ── GET /api/menus ────────────────────────────────────────────────────
// 전체 조회 (활성 사용자 모두 접근 가능)
// query:
//   q        — 메뉴명 검색 (부분 일치, 대소문자 무시)
//   category — 카테고리 필터 (없으면 전체)
//   active   — 'true' = 활성만, 'false' = 비활성만, 없으면 전체
router.get('/', requireActiveRole, (req, res) => {
  const { q, category, active } = req.query as Record<string, string | undefined>;

  let rows = [...store.menus];

  // 검색
  if (q?.trim()) {
    const keyword = q.trim().toLowerCase();
    rows = rows.filter((m) => m.name_ko.toLowerCase().includes(keyword));
  }
  // 카테고리 필터
  if (category?.trim()) {
    rows = rows.filter((m) => m.category === category);
  }
  // 활성 여부
  if (active === 'true') rows = rows.filter((m) => m.is_active);
  else if (active === 'false') rows = rows.filter((m) => !m.is_active);

  // 정렬: 카테고리 → 이름
  const CAT_ORDER: MenuCategory[] = ['전식', '주식', '후식', '음료', '주류', '패키지'];
  rows.sort((a, b) => {
    const ci = CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category);
    if (ci !== 0) return ci;
    return a.name_ko.localeCompare(b.name_ko, 'ko');
  });

  // 관리자가 아니면 notes 필드 제거 (내부 메모 보호)
  const isAdmin = req.user?.role === 'admin';
  const result = isAdmin ? rows : rows.map(({ notes: _n, ...rest }) => rest);

  res.json({ menus: result, total: result.length });
});

// ── POST /api/menus ───────────────────────────────────────────────────
// 메뉴 등록 — 사장·세일즈 매니저만
router.post('/', requireRoles(...WRITE_ROLES), (req, res) => {
  const { name_ko, category, mode, serving_size_default, list_price, notes, is_active, details } = req.body as {
    name_ko?: string;
    category?: MenuCategory;
    mode?: MenuMode;
    serving_size_default?: number;
    list_price?: number | null;
    notes?: string;
    is_active?: boolean;
    details?: MenuDetail[];
  };

  // 필수 필드 검증
  if (!name_ko?.trim()) return res.status(400).json({ error: 'name_required' });
  if (!category) return res.status(400).json({ error: 'category_required' });

  const VALID_CATEGORIES: MenuCategory[] = ['전식', '주식', '후식', '음료', '주류', '패키지'];
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'invalid_category' });
  }
  const VALID_MODES: MenuMode[] = ['set', 'coffee', 'qty'];
  const resolvedMode: MenuMode = mode && VALID_MODES.includes(mode) ? mode : 'set';

  // 중복 이름 체크 (활성/비활성 불문 전체 비교)
  const trimmed = name_ko.trim();
  const dup = store.menus.find((m) => m.name_ko.trim() === trimmed);
  if (dup) return res.status(409).json({ error: 'duplicate_name', id: dup.id });

  // details 검증: 배열이면 그대로, 아니면 빈 배열
  const resolvedDetails: MenuDetail[] = Array.isArray(details) ? details : [];

  const now = new Date().toISOString();
  const menu = {
    id: nanoid(10),
    tenant_id: req.tenantId,
    name_ko: trimmed,
    category,
    mode: resolvedMode,
    serving_size_default: Number(serving_size_default) || 1,
    list_price: list_price != null ? Number(list_price) : null,
    is_active: is_active !== false, // 기본값 true
    notes: notes?.trim() ?? '',
    details: resolvedDetails,
    created_at: now,
    updated_at: now,
  };

  store.menus.push(menu);
  persistDoc('menus', menu.id);
  res.status(201).json({ menu });
});

// ── PATCH /api/menus/:id ──────────────────────────────────────────────
// 메뉴 수정 — 사장·세일즈 매니저만
router.patch('/:id', requireRoles(...WRITE_ROLES), (req, res) => {
  const menu = store.menus.find((m) => m.id === req.params.id);
  if (!menu) return res.status(404).json({ error: 'not_found' });

  const { name_ko, category, mode, serving_size_default, list_price, notes, is_active, details } = req.body as {
    name_ko?: string;
    category?: MenuCategory;
    mode?: MenuMode;
    serving_size_default?: number;
    list_price?: number | null;
    notes?: string;
    is_active?: boolean;
    details?: MenuDetail[];
  };

  // 이름 변경 시 중복 체크 (자기 자신 제외)
  if (name_ko !== undefined) {
    const trimmed = name_ko.trim();
    if (!trimmed) return res.status(400).json({ error: 'name_required' });
    const dup = store.menus.find((m) => m.name_ko.trim() === trimmed && m.id !== menu.id);
    if (dup) return res.status(409).json({ error: 'duplicate_name', id: dup.id });
    menu.name_ko = trimmed;
  }

  if (category !== undefined) {
    const VALID_CATEGORIES: MenuCategory[] = ['전식', '주식', '후식', '음료', '주류', '패키지'];
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'invalid_category' });
    }
    menu.category = category;
  }
  if (mode !== undefined) {
    const VALID_MODES: MenuMode[] = ['set', 'coffee', 'qty'];
    if (VALID_MODES.includes(mode)) menu.mode = mode;
  }
  if (serving_size_default !== undefined) menu.serving_size_default = Number(serving_size_default) || 1;
  if (list_price !== undefined) menu.list_price = list_price != null ? Number(list_price) : null;
  if (notes !== undefined) menu.notes = notes.trim();
  if (is_active !== undefined) menu.is_active = Boolean(is_active);
  // details 배열 통째로 교체 (undefined면 기존 유지)
  if (details !== undefined) {
    menu.details = Array.isArray(details) ? details : [];
  }

  menu.updated_at = new Date().toISOString();
  persistDoc('menus', menu.id);
  res.json({ menu });
});

export default router;
