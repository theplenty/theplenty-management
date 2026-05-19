import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../types';
import {
  canSeeMice,
  canSeeWedding,
  canSeeReviews,
  canSeeDashboard,
  canManageUsers,
  canManageApiKeys,
  canManageTrash,
} from '../auth/permissions';
import clsx from 'clsx';
import GlobalSearch from './GlobalSearch';
import HelpPopover from './HelpPopover';

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
  // md 이하에서 사이드바는 슬라이드 drawer. 기본은 닫힘.
  const [mobileOpen, setMobileOpen] = useState(false);

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
    // 관리자 전용 탭 — admin role 만 노출.
    { to: '/admin/users', label: '사용자 관리', visible: !!user && canManageUsers(role) },
    { to: '/admin/api-keys', label: '외부 API 키', visible: !!user && canManageApiKeys(role) },
    { to: '/admin/activity-log', label: '📜 활동 로그', visible: !!user && canManageUsers(role) },
    { to: '/admin/trash', label: '🗑️ 휴지통', visible: !!user && canManageTrash(role) },
  ];

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full">
      {/* 모바일 backdrop — drawer가 열렸을 때만 노출 */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 사이드바 — md 이상: 정상 노출 / md 미만: 슬라이드 drawer */}
      <aside
        className={clsx(
          'bg-gray-900 text-gray-100 flex flex-col z-50',
          // 데스크탑: 일반 박스
          'md:static md:translate-x-0 md:w-60',
          // 모바일: fixed 슬라이드
          'fixed inset-y-0 left-0 w-64 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="text-base font-bold">플렌티컨벤션</div>
            <div className="text-xs text-gray-400 mt-0.5">운영 통합관리</div>
          </div>
          {/* 모바일: drawer 닫기 버튼 */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-gray-400 hover:text-white text-xl leading-none px-2"
            aria-label="메뉴 닫기"
          >
            ×
          </button>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
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
                        onClick={() => setMobileOpen(false)}
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
                  onClick={() => setMobileOpen(false)}
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
          v0.3
        </div>
      </aside>

      {/* 메인 */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 px-3 md:px-6 flex items-center justify-between border-b bg-white gap-2 md:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {/* 모바일 햄버거 */}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden text-gray-700 p-1 -ml-1"
              aria-label="메뉴 열기"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="hidden lg:block text-sm text-gray-600 truncate">내부 운영 시스템</div>
          </div>
          {/* 전역 검색 — 헤더 가운데, 모바일에선 아이콘만 */}
          {user && (
            <div className="flex-1 max-w-md flex justify-center md:justify-start">
              <GlobalSearch />
            </div>
          )}
          {user && (
            <div className="flex items-center gap-2 md:gap-3 text-sm min-w-0">
              <HelpPopover />
              <div className="text-right min-w-0 hidden sm:block">
                <div className="font-medium text-gray-900 truncate">{user.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {user.email} · {ROLE_LABEL[user.role]}
                </div>
              </div>
              <button onClick={handleLogout} className="btn-secondary !py-1.5 !px-2 md:!px-3 shrink-0">
                로그아웃
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 overflow-auto p-3 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
