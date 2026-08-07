import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { isSales, isAdmin } from './auth/permissions';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Pending from './pages/Pending';
import MiceCustomers from './pages/MiceCustomers';
import WeddingCustomers from './pages/WeddingCustomers';
import Calendar from './pages/Calendar';
import Events from './pages/Events';
import EventWorkspace from './pages/EventWorkspace';
import Reviews from './pages/Reviews';
import Files from './pages/Files';
import Collaborations from './pages/Collaborations';
import AdminUsers from './pages/AdminUsers';
import AdminApiKeys from './pages/AdminApiKeys';
import AdminNotifications from './pages/AdminNotifications';
import Trash from './pages/Trash';
import WeddingProfile from './pages/WeddingProfile';
import MiceProfile from './pages/MiceProfile';
import CalendarSummary from './pages/CalendarSummary';
import ActivityLog from './pages/ActivityLog';
import ErrorBoundary from './components/ErrorBoundary';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Stats from './pages/Stats';
import Field from './pages/Field';
import Menus from './pages/Menus';
import MenuCost from './pages/MenuCost';
import AdminWeddingCalc from './pages/AdminWeddingCalc';
import Revenue from './pages/Revenue';
import PublicCalendar from './pages/PublicCalendar';
import PublicSummary from './pages/PublicSummary';
import WeddingLandingPublic from './pages/WeddingLandingPublic';
import ApiDocs from './pages/ApiDocs';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 — 인증 없이 접근, 토큰 기반 외부 공유 */}
        <Route path="/public/calendar/:token" element={<PublicCalendar />} />
        <Route path="/public/summary/:token" element={<PublicSummary />} />
        {/* 공개 — 웨딩 가예약 고객 랜딩 (짧은 주소, 카톡 공유용) */}
        <Route path="/l/:token" element={<WeddingLandingPublic />} />
        {/* 공개 — API 문서 (외부 개발자용) */}
        <Route path="/api-docs" element={<ApiDocs />} />

        {/* 그 외에는 AuthProvider + ErrorBoundary 로 감싼 보호된 영역.
            렌더링 에러가 나도 페이지 전체가 백지가 되지 않고 친절한 안내가 표시됨. */}
        <Route
          path="*"
          element={
            <AuthProvider>
              <ErrorBoundary>
                <ProtectedRoutes />
              </ErrorBoundary>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function ProtectedRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pending" element={<Pending />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DefaultLanding />} />
        {/* 역할별 홈 — 세일즈팀 + 관리자 전용. 그 외 역할은 캘린더로 랜딩. */}
        <Route
          path="/home"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding']}>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'banquet']}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/* 통계 분석(A8) — 매출 축이 있어 대시보드와 같은 범위로 제한 */}
        <Route
          path="/stats"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'banquet']}>
              <Stats />
            </ProtectedRoute>
          }
        />

        <Route path="/customers" element={<Navigate to="/customers/mice" replace />} />
        {/* MICE 고객 DB: admin + 양 세일즈(CRUD) + banquet/kitchen(뷰어). h_kitchen 제외. */}
        <Route
          path="/customers/mice"
          element={
            <ProtectedRoute
              allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}
            >
              <MiceCustomers />
            </ProtectedRoute>
          }
        />
        {/* WEDDING 고객 DB: admin + 양 세일즈(CRUD) + banquet/kitchen(뷰어). h_kitchen 제외. */}
        <Route
          path="/customers/wedding"
          element={
            <ProtectedRoute
              allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}
            >
              <WeddingCustomers />
            </ProtectedRoute>
          }
        />

        <Route path="/calendar" element={<Calendar />} />
        {/* 캘린더 요약 — 뷰어 포함 모든 활성 사용자 접근 (h_kitchen 도 가능) */}
        <Route path="/calendar/summary" element={<CalendarSummary />} />
        <Route path="/events" element={<Events />} />
        {/* 행사 원스톱 워크스페이스 — 한 행사=한 화면. ?tab=revenue 처럼 탭까지 딥링크 가능.
            열람 권한은 서버가 행사 구분(MICE/WEDDING)으로 다시 판단한다. */}
        <Route path="/events/:id" element={<EventWorkspace />} />

        {/* 통합 고객 프로필 — 양 세일즈/관리자/뷰어 모두 접근. h_kitchen 제외. */}
        <Route
          path="/customer/wedding/:id"
          element={
            <ProtectedRoute
              allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}
            >
              <WeddingProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer/mice/:id"
          element={
            <ProtectedRoute
              allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}
            >
              <MiceProfile />
            </ProtectedRoute>
          }
        />

        {/* 연회팀 행사리뷰 — 뷰어 포함 모든 활성 사용자 조회. 작성은 admin/banquet 만 (Reviews 페이지 내부 게이트) */}
        <Route
          path="/reviews"
          element={
            <ProtectedRoute
              allow={['admin', 'banquet', 'sales_mice', 'sales_wedding', 'kitchen', 'h_kitchen']}
            >
              <Reviews />
            </ProtectedRoute>
          }
        />

        <Route path="/files" element={<Files />} />
        {/* 메뉴 마스터 — 활성 사용자 전원 조회 가능. 등록·수정은 페이지 내부에서 권한 게이트. */}
        <Route path="/menus" element={<Menus />} />
        {/* 메뉴별 원가 — 원가율은 민감 정보. 관리자/주방/연회만. */}
        <Route
          path="/menu-cost"
          element={
            <ProtectedRoute allow={['admin', 'kitchen', 'banquet']}>
              <MenuCost />
            </ProtectedRoute>
          }
        />
        {/* 매출 관리 — 조회: 활성 사용자 전원. 수정: admin only (페이지 내부 게이트). */}
        <Route
          path="/revenue"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}>
              <Revenue />
            </ProtectedRoute>
          }
        />
        {/* 결제 매핑은 매출 관리로 통합 — 기존 북마크·링크 보호를 위해 리다이렉트 유지 */}
        <Route path="/payments" element={<Navigate to="/revenue" replace />} />
        <Route
          path="/collaborations"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'kitchen', 'banquet']}>
              <Collaborations />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        {/* 웨딩 마진계산기 기본값 — 관리자 전용 */}
        <Route
          path="/admin/wedding-calc"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminWeddingCalc />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/api-keys"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminApiKeys />
            </ProtectedRoute>
          }
        />
        {/* 알림 자동화 점검 — 발송 내용에 전사 운영 현황이 담겨 관리자 전용 */}
        <Route
          path="/admin/notifications"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminNotifications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/trash"
          element={
            <ProtectedRoute allow={['admin']}>
              <Trash />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/activity-log"
          element={
            <ProtectedRoute allow={['admin']}>
              <ActivityLog />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* 현장 모드(A6) — Layout(사이드바) 바깥에 둔다.
          폰 화면에서 좁은 폭을 사이드바가 먹으면 안 되고, 홈화면에 설치했을 때
          전체화면으로 떠야 하기 때문. PWA manifest 의 start_url 이 여기다. */}
      <Route
        path="/field"
        element={
          <ProtectedRoute>
            <Field />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<DefaultLanding />} />
    </Routes>
  );
}

// 로그인 후 기본 랜딩 — 세일즈/관리자는 역할별 홈, 그 외(연회·주방 등)는 캘린더.
function DefaultLanding() {
  const { user } = useAuth();
  const role = user?.role;
  return <Navigate to={isSales(role) || isAdmin(role) ? '/home' : '/calendar'} replace />;
}
