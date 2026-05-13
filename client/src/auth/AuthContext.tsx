import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api';
import {
  FIREBASE_CONFIGURED,
  signInWithGoogle,
  signOut as firebaseSignOut,
  onTokenChange,
  waitForAuthReady,
} from '../lib/firebase';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  firebaseConfigured: boolean;
  loginMock: (email: string, name?: string) => Promise<User>;
  loginWithGoogle: () => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initialRefreshDone = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ user: User }>('/api/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // 부팅 시 1회 + Firebase auth state 변경 시 자동 갱신.
  // 주의: Firebase가 sessionStorage에서 사용자 복원을 마치기 전에 /api/auth/me 를 부르면
  // Bearer 토큰 없이 요청 → 새로고침 = 로그아웃 처럼 보임. waitForAuthReady로 race 차단.
  useEffect(() => {
    if (!initialRefreshDone.current) {
      initialRefreshDone.current = true;
      waitForAuthReady().then(refresh);
    }
    if (!FIREBASE_CONFIGURED) return;
    const unsub = onTokenChange(() => {
      // ID 토큰이 갱신되거나 사라질 때마다 백엔드 재조회
      refresh();
    });
    return unsub;
  }, [refresh]);

  // 모킹 로그인 (개발용)
  const loginMock = useCallback(async (email: string, name?: string) => {
    const res = await api.post<{ user: User }>('/api/auth/login', { email, name });
    setUser(res.user);
    return res.user;
  }, []);

  // Firebase Google 로그인
  const loginWithGoogle = useCallback(async () => {
    const { idToken } = await signInWithGoogle();
    const res = await api.post<{ user: User }>('/api/auth/login', { idToken });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    if (FIREBASE_CONFIGURED) {
      await firebaseSignOut().catch(() => {});
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        firebaseConfigured: FIREBASE_CONFIGURED,
        loginMock,
        loginWithGoogle,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
