import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole, requireRoles } from '../middleware/auth.js';
import type { MenuDetail, MenuMode } from '../types.js';

const router = Router();

// 쓰기 가능 역할 — 사장(admin) + 세일즈 매니저
const WRITE_ROLES = ['admin', 'sales_mice', 'sales_wedding'] as const;

// ── GET /api/menus ────────────────────────────────────────────────────
// 전체 조회 (활성 사용자 모두 접근 가능)
// query:
//   q      — 메뉴명/카테고리 검색 (부분 일치, 대소문자 무시)
//   name   — 메뉴명 정확 필터 (없으면 전체)
//   active — 'true' = 활성만, 'false' = 비활성만, 없으면 전체
router.get('/', requireActiveRole, (req, res) => {
  const { q, name, active } = req.query as Record<string, string | undefined>;

  let rows = [...store.menus];

  // 검색 (메뉴명 또는 카테고리)
  if (q?.trim()) {
    const keyword = q.trim().toLowerCase();
    rows = rows.filter(
      (m) =>
        m.name_ko.toLowerCase().includes(keyword) ||
        m.category.toLowerCase().includes(keyword)
    );
  }
  // 메뉴명 필터 (탭 클릭)
  if (name?.trim()) {
    rows = rows.filter((m) => m.name_ko === name.trim());
  }
  // 활성 여부
  if (active === 'true') rows = rows.filter((m) => m.is_active);
  else if (active === 'false') rows = rows.filter((m) => !m.is_active);

  // 정렬: 메뉴명(MENU_OPTIONS 순) → 카테고리(알파벳)
  const NAME_ORDER = [
    'A set', 'B set', 'C set', 'D set',
    'Korean Lunch Box', 'Chinese Lunch Box',
    'Coffee Break',
    'Dessert Plate(M)', 'Dessert Plate(L)', 'Rice Cake Plate',
  ];
  rows.sort((a, b) => {
    const ni = NAME_ORDER.indexOf(a.name_ko) - NAME_ORDER.indexOf(b.name_ko);
    if (ni !== 0) return ni;
    return a.category.localeCompare(b.category, 'ko');
  });

  // 관리자가 아니면 notes 필드 제거 (내부 메모 보호)
  const isAdmin = req.user?.role === 'admin';
  const result = isAdmin ? rows : rows.map(({ notes: _n, ...rest }) => rest);

  res.json({ menus: result, total: result.length });
});

// ── POST /api/menus ───────────────────────────────────────────────────
// 메뉴 등록 — 사장·세일즈 매니저만
router.post('/', requireRoles(...WRITE_ROLES), (req, res) => {
  const { name_ko, category, mode, serving_size_default, list_price, notes, is_active, details } =
    req.body as {
      name_ko?: string;
      category?: string;
      mode?: MenuMode;
      serving_size_default?: number;
      list_price?: number | null;
      notes?: string;
      is_active?: boolean;
      details?: MenuDetail[];
    };

  // 필수 필드 검증
  if (!name_ko?.trim()) return res.status(400).json({ error: 'name_required' });
  if (!category?.trim()) return res.status(400).json({ error: 'category_required' });

  const VALID_MODES: MenuMode[] = ['set', 'coffee', 'qty'];
  const resolvedMode: MenuMode = mode && VALID_MODES.includes(mode) ? mode : 'set';

  const trimmedName = name_ko.trim();
  const trimmedCat = category.trim();

  // 중복 체크: (name_ko + category) 조합이 이미 존재하면 409
  const dup = store.menus.find(
    (m) => m.name_ko.trim() === trimmedName && m.category.trim() === trimmedCat
  );
  if (dup) return res.status(409).json({ error: 'duplicate_entry', id: dup.id });

  const resolvedDetails: MenuDetail[] = Array.isArray(details) ? details : [];

  const now = new Date().toISOString();
  const menu = {
    id: nanoid(10),
    tenant_id: req.tenantId,
    name_ko: trimmedName,
    category: trimmedCat,
    mode: resolvedMode,
    serving_size_default: Number(serving_size_default) || 1,
    list_price: list_price != null ? Number(list_price) : null,
    is_active: is_active !== false,
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

  const { name_ko, category, mode, serving_size_default, list_price, notes, is_active, details } =
    req.body as {
      name_ko?: string;
      category?: string;
      mode?: MenuMode;
      serving_size_default?: number;
      list_price?: number | null;
      notes?: string;
      is_active?: boolean;
      details?: MenuDetail[];
    };

  const newName = name_ko !== undefined ? name_ko.trim() : menu.name_ko;
  const newCat = category !== undefined ? category.trim() : menu.category;

  // 이름 또는 카테고리 변경 시 중복 체크 (자기 자신 제외)
  if (name_ko !== undefined || category !== undefined) {
    if (!newName) return res.status(400).json({ error: 'name_required' });
    if (!newCat) return res.status(400).json({ error: 'category_required' });
    const dup = store.menus.find(
      (m) =>
        m.name_ko.trim() === newName &&
        m.category.trim() === newCat &&
        m.id !== menu.id
    );
    if (dup) return res.status(409).json({ error: 'duplicate_entry', id: dup.id });
  }

  if (name_ko !== undefined) menu.name_ko = newName;
  if (category !== undefined) menu.category = newCat;
  if (mode !== undefined) {
    const VALID_MODES: MenuMode[] = ['set', 'coffee', 'qty'];
    if (VALID_MODES.includes(mode)) menu.mode = mode;
  }
  if (serving_size_default !== undefined) menu.serving_size_default = Number(serving_size_default) || 1;
  if (list_price !== undefined) menu.list_price = list_price != null ? Number(list_price) : null;
  if (notes !== undefined) menu.notes = notes.trim();
  if (is_active !== undefined) menu.is_active = Boolean(is_active);
  if (details !== undefined) {
    menu.details = Array.isArray(details) ? details : [];
  }

  menu.updated_at = new Date().toISOString();
  persistDoc('menus', menu.id);
  res.json({ menu });
});

export default router;
