import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// 카카오톡/네이버/페북 등 in-app 브라우저는 sessionStorage가 격리되어 있어 Firebase signInWithPopup/Redirect
// 가 "missing initial state" 오류를 발생시킴. 외부 브라우저로 열도록 유도해야 함.
function detectInAppBrowser(): { name: string; isIOS: boolean } | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  if (/KAKAOTALK/i.test(ua)) return { name: '카카오톡', isIOS };
  if (/NAVER\(inapp/i.test(ua) || /; NAVER /i.test(ua)) return { name: '네이버 앱', isIOS };
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return { name: '페이스북 앱', isIOS };
  if (/Instagram/i.test(ua)) return { name: '인스타그램', isIOS };
  if (/Line\//i.test(ua)) return { name: '라인', isIOS };
  if (/wv\)/i.test(ua) && /Android/i.test(ua)) return { name: 'Android 인앱', isIOS: false };
  return null;
}

function openExternalBrowser(currentUrl: string, inApp: { name: string; isIOS: boolean }) {
  // 카카오톡: kakaotalk://web/openExternal — Android에서 잘 동작. iOS는 동작 제한적이라 안내만.
  if (inApp.name === '카카오톡' && !inApp.isIOS) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
    return true;
  }
  // 네이버 앱: naversearchapp://inappbrowser/close
  if (inApp.name === '네이버 앱') {
    window.location.href =
      'naversearchapp://inappbrowser/close?target=' + encodeURIComponent(currentUrl);
    return true;
  }
  return false;
}

// 모킹 로그인 화면.
// 실 빌드에서는 Google 로그인 버튼만 노출하고,
// 데모용 quick-login은 NODE_ENV=development일 때만 보이게 한다.

// 데모 계정 — Public repo 노출 방지를 위해 코드에는 generic 이메일만.
// 실제 super admin 이메일은 .env의 VITE_SUPER_ADMIN_EMAIL로 주입 (gitignored).
const ADMIN_EMAIL = import.meta.env.VITE_SUPER_ADMIN_EMAIL || 'admin@example.com';
const DEMO_ACCOUNTS = [
  { email: ADMIN_EMAIL, name: '관리자', role: '관리자' },
  { email: 'mice.demo@plenty.test', name: '데모 MICE 세일즈', role: '기업세일즈(MICE)' },
  { email: 'wedding.demo@plenty.test', name: '데모 WEDDING 세일즈', role: '웨딩세일즈(WEDDING)' },
  { email: 'banquet.demo@plenty.test', name: '데모 연회팀', role: '연회팀' },
  { email: 'kitchen.demo@plenty.test', name: '데모 주방팀', role: '주방팀' },
  { email: 'pending.demo@plenty.test', name: '권한대기 사용자', role: '권한대기' },
];

export default function Login() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { loginMock, loginWithGoogle, firebaseConfigured } = useAuth();
  const navigate = useNavigate();
  const inApp = useMemo(detectInAppBrowser, []);

  function postLoginNavigate(role: string) {
    if (role === 'pending' || role === 'disabled') navigate('/pending');
    else navigate('/calendar');
  }

  async function doMockLogin(targetEmail: string, targetName?: string) {
    setError(null);
    setBusy(true);
    try {
      const u = await loginMock(targetEmail, targetName);
      postLoginNavigate(u.role);
    } catch (e) {
      setError('로그인 실패. 서버가 켜져있는지 확인해주세요.');
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function doGoogleLogin() {
    setError(null);
    setBusy(true);
    try {
      const u = await loginWithGoogle();
      postLoginNavigate(u.role);
    } catch (e) {
      const msg = (e as Error).message || 'Google 로그인 실패';
      if (msg.includes('popup-closed') || msg.includes('cancelled')) {
        setError('로그인 창이 닫혔습니다. 다시 시도해주세요.');
      } else {
        setError(`Google 로그인 실패: ${msg}`);
      }
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">플렌티컨벤션</h1>
          <p className="text-sm text-gray-500 mt-1">운영 통합관리 시스템</p>
        </div>

        {/* 인앱 브라우저(카카오톡/네이버/페북 등) 감지 시 안내 — Google 로그인은 sessionStorage 격리로 실패함 */}
        {inApp && (
          <div className="mb-4 p-3 rounded-md border border-amber-300 bg-amber-50 text-xs text-amber-900">
            <div className="font-semibold mb-1">
              ⚠️ {inApp.name} 인앱 브라우저로 접속 중입니다.
            </div>
            <p className="leading-relaxed">
              인앱 브라우저는 보안상 Google 로그인이 동작하지 않습니다.
              아래 버튼으로 외부 브라우저(Safari/Chrome)에서 열어주세요.
            </p>
            <button
              type="button"
              onClick={() => {
                const url = window.location.href;
                if (!openExternalBrowser(url, inApp)) {
                  // 자동 외부 열기가 안 되는 경우 (iOS 등) — 안내 모달 대신 URL 복사 폴백
                  navigator.clipboard?.writeText(url).catch(() => {});
                  alert(
                    'URL이 클립보드에 복사되었습니다.\nSafari 또는 Chrome 을 열어 주소창에 붙여넣고 접속해주세요.'
                  );
                }
              }}
              className="mt-2 w-full px-3 py-2 rounded bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700"
            >
              🌐 외부 브라우저에서 열기
            </button>
          </div>
        )}

        {/* Google 로그인 — Firebase config 있을 때만 활성. 인앱 브라우저면 비활성. */}
        <button
          onClick={doGoogleLogin}
          disabled={busy || !firebaseConfigured || !!inApp}
          className={
            'w-full flex items-center justify-center gap-2 border rounded-md py-2.5 text-sm transition ' +
            (firebaseConfigured
              ? 'border-gray-300 hover:bg-gray-50 text-gray-700'
              : 'border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed')
          }
          title={
            inApp
              ? `${inApp.name} 인앱 브라우저에서는 동작하지 않음 — 외부 브라우저로 열어주세요`
              : firebaseConfigured
                ? 'Google 계정으로 로그인'
                : 'Firebase config 미설정 (.env의 VITE_FIREBASE_* 확인)'
          }
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.61z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.46-.81 5.95-2.18l-2.9-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.71a5.4 5.4 0 0 1 0-3.42V4.97H.96a9 9 0 0 0 0 8.06l3.01-2.32z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.97l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          {firebaseConfigured ? 'Google로 로그인' : 'Google 로그인 (Firebase 미설정)'}
        </button>

        <div className="my-6 flex items-center gap-3 text-xs text-gray-400">
          <div className="flex-1 h-px bg-gray-200" />
          <span>모킹 로그인</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) doMockLogin(email.trim(), name.trim() || undefined);
          }}
          className="space-y-3"
        >
          <div>
            <label className="label">이메일</label>
            <input
              type="email"
              className="input"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">이름 (신규 가입 시)</label>
            <input
              type="text"
              className="input"
              placeholder="홍길동"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? '로그인 중...' : '로그인 / 가입'}
          </button>
        </form>

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        <div className="mt-6 pt-5 border-t">
          <div className="text-xs font-semibold text-gray-500 mb-2">빠른 데모 로그인</div>
          <div className="grid grid-cols-1 gap-1.5">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                onClick={() => doMockLogin(acc.email, acc.name)}
                disabled={busy}
                className="text-left px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-sm disabled:opacity-50"
              >
                <div className="font-medium text-gray-800">{acc.role}</div>
                <div className="text-xs text-gray-500">{acc.email}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
