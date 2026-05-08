import { useAuth } from '../auth/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Pending() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const isDisabled = user?.role === 'disabled';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="bg-white rounded-2xl shadow p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-3">{isDisabled ? '🔒' : '⏳'}</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {isDisabled ? '계정이 비활성화되었습니다' : '관리자 권한 부여 대기 중'}
        </h1>
        <p className="text-sm text-gray-600 mb-1">{user?.email}</p>
        <p className="text-sm text-gray-500 mb-6">
          {isDisabled
            ? '관리자에게 문의해주세요.'
            : '관리자가 권한과 팀을 부여하면 시스템에 접근할 수 있습니다.'}
        </p>
        <div className="flex gap-2 justify-center">
          <button onClick={refresh} className="btn-secondary">
            새로고침
          </button>
          <button onClick={handleLogout} className="btn-primary">
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
