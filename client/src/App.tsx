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
import AdminUsers from './pages/AdminUsers';
import AdminApiKeys from './pages/AdminApiKeys';
import Trash from './pages/Trash';
import WeddingProfile from './pages/WeddingProfile';
import MiceProfile from './pages/MiceProfile';
import ErrorBoundary from './components/ErrorBoundary';
import Dashboard from './pages/Dashboard';
import PublicCalendar from './pages/PublicCalendar';
import ApiDocs from './pages/ApiDocs';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 공개 — 인증 없이 접근, 토큰 기반 외부 공유 */}
        <Route path="/public/calendar/:token" element={<PublicCalendar />} />
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
        <Route
          path="/customers/mice"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice']}>
              <MiceCustomers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customers/wedding"
          element={
            <ProtectedRoute allow={['admin', 'sales_wedding']}>
              <WeddingCustomers />
            </ProtectedRoute>
          }
        />

        <Route path="/calendar" element={<Calendar />} />
        <Route path="/events" element={<Events />} />

        {/* 통합 고객 프로필 — 검색 결과나 다른 화면에서 진입. 풀스크린 읽기 뷰. */}
        <Route
          path="/customer/wedding/:id"
          element={
            <ProtectedRoute allow={['admin', 'sales_wedding', 'banquet', 'kitchen']}>
              <WeddingProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/customer/mice/:id"
          element={
            <ProtectedRoute allow={['admin', 'sales_mice', 'banquet', 'kitchen']}>
              <MiceProfile />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reviews"
          element={
            <ProtectedRoute allow={['admin', 'banquet', 'sales_mice', 'sales_wedding']}>
              <Reviews />
            </ProtectedRoute>
          }
        />

        <Route path="/files" element={<Files />} />
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
      </Route>

      <Route path="*" element={<Navigate to="/calendar" replace />} />
    </Routes>
  );
}
