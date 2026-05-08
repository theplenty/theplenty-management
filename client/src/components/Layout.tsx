import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../types';
import {
  canSeeMice,
  canSeeWedding,
  isAdmin,
  canSeeReviews,
  canSeeDashboard,
} from '../auth/permissions';
import clsx from 'clsx';

interface MenuLink {
  to: string;
  label: string;
  visible: boolean;
}

interface MenuGroup {
  label: string;
  visible: boolean;
  items: MenuLink[];
}

type MenuEntry = MenuLink | MenuGroup;

function isGroup(entry: MenuEntry): entry is MenuGroup {
  return (entry as MenuGroup).items !== undefined;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const role = user?.role;

  const menus: MenuEntry[] = [
    { to: '/dashboard', label: '대시보드', visible: !!user && canSeeDashboard(role) },
    {
      label: '고객정보 DB',
      visible: !!user && (canSeeMice(role) || canSeeWedding(role)),
      items: [
        {
          to: '/customers/mice',
          label: 'MICE 고객정보',
          visible: !!user && canSeeMice(role),
        },
        {
          to: '/customers/wedding',
          label: 'WEDDING 고객정보',
          visible: !!user && canSeeWedding(role),
        },
      ],
    },
    { to: '/calendar', label: '행사정보 캘린더', visible: !!user },
    { to: '/events', label: '행사 목록', visible: !!user },
    {
      to: '/reviews',
      label: '연회팀 행사리뷰',
      visible: !!user && canSeeReviews(role),
    },
    { to: '/files', label: '첨부파일 관리', visible: !!user },
    { to: '/admin/users', label: '사용자 관리', visible: !!user && isAdmin(role) },
  ];

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full">
      {/* 사이드바 */}
      <aside className="w-60 bg-gray-900 text-gray-100 flex flex-col">
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="text-base font-bold">플렌티컨벤션</div>
          <div className="text-xs text-gray-400 mt-0.5">운영 통합관리</div>
        </div>
        <nav className="flex-1 py-3">
          {menus
            .filter((m) => m.visible)
            .map((entry, idx) => {
              if (isGroup(entry)) {
                const visibleItems = entry.items.filter((i) => i.visible);
                if (visibleItems.length === 0) return null;
                return (
                  <div key={`grp-${idx}`} className="mb-2">
                    <div className="px-5 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
                      {entry.label}
                    </div>
                    {visibleItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          clsx(
                            'block pl-8 pr-5 py-2 text-sm transition border-l-4',
                            isActive
                              ? 'bg-gray-800 text-white border-blue-400'
                              : 'text-gray-300 hover:bg-gray-800 hover:text-white border-transparent'
                          )
                        }
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                );
              }
              return (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  className={({ isActive }) =>
                    clsx(
                      'block px-5 py-2 text-sm transition border-l-4',
                      isActive
                        ? 'bg-gray-800 text-white border-blue-400'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white border-transparent'
                    )
                  }
                >
                  {entry.label}
                </NavLink>
              );
            })}
        </nav>
        <div className="p-4 border-t border-gray-800 text-xs text-gray-400">
          mock-up build · v0.1
        </div>
      </aside>

      {/* 메인 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 px-6 flex items-center justify-between border-b bg-white">
          <div className="text-sm text-gray-600">내부 운영 시스템</div>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <div className="text-right">
                <div className="font-medium text-gray-900">{user.name}</div>
                <div className="text-xs text-gray-500">
                  {user.email} · {ROLE_LABEL[user.role]}
                </div>
              </div>
              <button onClick={handleLogout} className="btn-secondary !py-1.5">
                로그아웃
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
