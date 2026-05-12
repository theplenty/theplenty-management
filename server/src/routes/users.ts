import { Router } from 'express';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireRoles, requireActiveRole } from '../middleware/auth.js';
import type { Role, Team } from '../types.js';

const router = Router();

// 관리자: 전체 사용자 목록
router.get('/', requireRoles('admin'), (_req, res) => {
  res.json({ users: store.users });
});

// 활성 사용자 목록 — 모든 활성 사용자가 호출 가능 (작성자/담당자 드롭박스용)
// id + name + role 만 노출. pending/disabled는 제외.
router.get('/active', requireActiveRole, (_req, res) => {
  const list = store.users
    .filter((u) => u.role !== 'pending' && u.role !== 'disabled')
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  res.json({ users: list });
});

// 관리자: 권한/팀 부여 또는 회수
router.patch('/:id', requireRoles('admin'), (req, res) => {
  const { id } = req.params;
  const { role, team, name } = req.body as { role?: Role; team?: Team; name?: string };
  const user = store.users.find((u) => u.id === id);
  if (!user) return res.status(404).json({ error: 'not_found' });

  if (role) user.role = role;
  if (team !== undefined) user.team = team;
  if (typeof name === 'string') user.name = name;
  user.updated_at = new Date().toISOString();
  persistDoc('users', user.id);
  res.json({ user });
});

// 관리자: 사용자 삭제 (선택)
router.delete('/:id', requireRoles('admin'), (req, res) => {
  const { id } = req.params;
  const idx = store.users.findIndex((u) => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  // super admin 보호: 마지막 admin 제거 차단
  const admins = store.users.filter((u) => u.role === 'admin');
  if (store.users[idx].role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: 'cannot_remove_last_admin' });
  }
  const removedId = store.users[idx].id;
  store.users.splice(idx, 1);
  persistDelete('users', removedId);
  res.json({ ok: true });
});

// 활성 사용자: 본인 정보 수정 (이름만)
router.patch('/me/profile', requireActiveRole, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const { name } = req.body as { name?: string };
  if (typeof name === 'string' && name.trim()) {
    req.user.name = name.trim();
    req.user.updated_at = new Date().toISOString();
    persistDoc('users', req.user.id);
  }
  res.json({ user: req.user });
});

export default router;
