import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isActive } from '../auth/permissions';
import type { Role } from '../types';

interface Props {
  children: React.ReactNode;
  allow?: Role[]; // 비우면 활성 사용자 누구나
}

export default function ProtectedRoute({ children, allow }: Props) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        로딩 중...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!isActive(user.role)) {
    return <Navigate to="/pending" replace />;
  }
  if (allow && !allow.includes(user.role)) {
    return (
      <div className="p-8 text-center text-gray-600">
        <h2 className="text-xl font-semibold mb-2">접근 권한이 없습니다</h2>
        <p className="text-sm">이 메뉴에 접근하려면 다른 권한이 필요합니다.</p>
      </div>
    );
  }
  return <>{children}</>;
}
