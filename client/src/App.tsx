import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Pending from './pages/Pending';
import MiceCustomers from './pages/MiceCustomers';
import WeddingCustomers from './pages/WeddingCustomers';
import Calendar from './pages/Calendar';
import Events from './pages/Events';
import Reviews from './pages/Reviews';
import Files from './pages/Files';
import Collaborations from './pages/Collaborations';
import AdminUsers from './pages/AdminUsers';
import AdminApiKeys from './pages/AdminApiKeys';
import Trash from './pages/Trash';
import WeddingProfile from './pages/WeddingProfile';
import MiceProfile from './pages/MiceProfile';
import CalendarSummary from './pages/CalendarSummary';
import ActivityLog from './pages/ActivityLog';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import Menus from './pages/Menus';
import Revenue from './pages/Revenue';
import Payments from './pages/Payments';
import PublicCalendar from './pages/PublicCalendar';
import PublicSummary from './pages/PublicSummary';
import ApiDocs from './pages/ApiDocs';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 — 인증 없이 접근, 토큰 기반 외부 공유 */}
        <Route path="/public/calendar/:token" element={<PublicCalendar />} />
        <Route path="/public/summary/:token" element={<PublicSummary />} />
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
        <Route index element={<Navigate to="/calendar" replace />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'banquet']}>
              <Dashboard />
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
        {/* 매출 관리 — 조회: 활성 사용자 전원. 수정: admin only (페이지 내부 게이트). */}
        <Route
          path="/revenue"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}>
              <Revenue />
            </ProtectedRoute>
          }
        />
        {/* 결제 매핑 — 조회: 활성 사용자 전원. 수정: admin only. */}
        <Route
          path="/payments"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'sales_wedding', 'banquet', 'kitchen']}>
              <Payments />
            </ProtectedRoute>
          }
        />
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
        <Route
          path="/admin/api-keys"
          element={
            <ProtectedRoute allow={['admin']}>
              <AdminApiKeys />
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

      <Route path="*" element={<Navigate to="/calendar" replace />} />
    </Routes>
  );
}
