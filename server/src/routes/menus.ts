import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc } from '../store/mockStore.js';
import { requireActiveRole, requireRoles } from '../middleware/auth.js';
import type { MenuDetail, MenuEventType, MenuMode, MenuDept } from '../types.js';

const router = Router();

const WRITE_ROLES = ['admin', 'sales_mice', 'sales_wedding'] as const;
const VALID_EVENT_TYPES: MenuEventType[] = ['MICE', 'WEDDING'];
const VALID_MODES: MenuMode[] = ['set', 'coffee', 'qty'];
const VALID_DEPTS: MenuDept[] = ['주방', '연회'];

// ── GET /api/menus ────────────────────────────────────────────────────
// query: q, name, event_type, active
router.get('/', requireActiveRole, (req, res) => {
  const { q, name, event_type, active } = req.query as Record<string, string | undefined>;

  let rows = [...store.menus];

  if (q?.trim()) {
    const kw = q.trim().toLowerCase();
    rows = rows.filter(
      (m) => m.name_ko.toLowerCase().includes(kw) || m.category.toLowerCase().includes(kw)
    );
  }
  if (name?.trim()) rows = rows.filter((m) => m.name_ko === name.trim());
  if (event_type?.trim()) rows = rows.filter((m) => m.event_type === event_type.trim());
  if (active === 'true') rows = rows.filter((m) => m.is_active);
  else if (active === 'false') rows = rows.filter((m) => !m.is_active);

  const NAME_ORDER = [
    'A set', 'B set', 'C set', 'D set',
    'Korean Lunch Box', 'Chinese Lunch Box',
    'Coffee Break',
    'Dessert Plate(M)', 'Dessert Plate(L)', 'Rice Cake Plate',
  ];
  rows.sort((a, b) => {
    const et = (a.event_type || 'MICE').localeCompare(b.event_type || 'MICE');
    if (et !== 0) return et;
    const ni = NAME_ORDER.indexOf(a.name_ko) - NAME_ORDER.indexOf(b.name_ko);
    if (ni !== 0) return ni;
    return a.category.localeCompare(b.category, 'ko');
  });

  const isAdmin = req.user?.role === 'admin';
  const result = isAdmin ? rows : rows.map(({ notes: _n, ...rest }) => rest);

  res.json({ menus: result, total: result.length });
});

// ── POST /api/menus ───────────────────────────────────────────────────
router.post('/', requireRoles(...WRITE_ROLES), (req, res) => {
  const {
    name_ko, category, event_type, dept, mode,
    serving_size_default, list_price, notes, is_active, details,
  } = req.body as {
    name_ko?: string;
    category?: string;
    event_type?: MenuEventType;
    dept?: MenuDept;
    mode?: MenuMode;
    serving_size_default?: number;
    list_price?: number | null;
    notes?: string;
    is_active?: boolean;
    details?: MenuDetail[];
  };

  if (!name_ko?.trim()) return res.status(400).json({ error: 'name_required' });
  if (!category?.trim()) return res.status(400).json({ error: 'category_required' });
  if (!event_type || !VALID_EVENT_TYPES.includes(event_type)) {
    return res.status(400).json({ error: 'event_type_required' });
  }

  const resolvedMode: MenuMode = mode && VALID_MODES.includes(mode) ? mode : 'set';
  const resolvedDept: MenuDept = dept && VALID_DEPTS.includes(dept) ? dept : '주방';
  const trimmedName = name_ko.trim();
  const trimmedCat = category.trim();

  const dup = store.menus.find(
    (m) => m.name_ko.trim() === trimmedName && m.category.trim() === trimmedCat && m.event_type === event_type
  );
  if (dup) return res.status(409).json({ error: 'duplicate_entry', id: dup.id });

  const resolvedDetails: MenuDetail[] = Array.isArray(details) ? details : [];
  const now = new Date().toISOString();
  const menu = {
    id: nanoid(10),
    tenant_id: req.tenantId,
    name_ko: trimmedName,
    category: trimmedCat,
    event_type,
    dept: resolvedDept,
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
router.patch('/:id', requireRoles(...WRITE_ROLES), (req, res) => {
  const menu = store.menus.find((m) => m.id === req.params.id);
  if (!menu) return res.status(404).json({ error: 'not_found' });

  const {
    name_ko, category, event_type, dept, mode,
    serving_size_default, list_price, notes, is_active, details,
  } = req.body as {
    name_ko?: string;
    category?: string;
    event_type?: MenuEventType;
    dept?: MenuDept;
    mode?: MenuMode;
    serving_size_default?: number;
    list_price?: number | null;
    notes?: string;
    is_active?: boolean;
    details?: MenuDetail[];
  };

  const newName = name_ko !== undefined ? name_ko.trim() : menu.name_ko;
  const newCat = category !== undefined ? category.trim() : menu.category;
  const newEvt = event_type !== undefined ? event_type : menu.event_type;

  if (name_ko !== undefined || category !== undefined || event_type !== undefined) {
    if (!newName) return res.status(400).json({ error: 'name_required' });
    if (!newCat) return res.status(400).json({ error: 'category_required' });
    const dup = store.menus.find(
      (m) =>
        m.name_ko.trim() === newName &&
        m.category.trim() === newCat &&
        m.event_type === newEvt &&
        m.id !== menu.id
    );
    if (dup) return res.status(409).json({ error: 'duplicate_entry', id: dup.id });
  }

  if (name_ko !== undefined) menu.name_ko = newName;
  if (category !== undefined) menu.category = newCat;
  if (event_type !== undefined && VALID_EVENT_TYPES.includes(event_type)) menu.event_type = event_type;
  if (dept !== undefined && VALID_DEPTS.includes(dept)) menu.dept = dept;
  if (mode !== undefined && VALID_MODES.includes(mode)) menu.mode = mode;
  if (serving_size_default !== undefined) menu.serving_size_default = Number(serving_size_default) || 1;
  if (list_price !== undefined) menu.list_price = list_price != null ? Number(list_price) : null;
  if (notes !== undefined) menu.notes = notes.trim();
  if (is_active !== undefined) menu.is_active = Boolean(is_active);
  if (details !== undefined) menu.details = Array.isArray(details) ? details : [];

  menu.updated_at = new Date().toISOString();
  persistDoc('menus', menu.id);
  res.json({ menu });
});

export default router;
