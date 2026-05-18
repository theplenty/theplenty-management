import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

// Google 로그인 전용 — 데모/모킹 로그인은 운영 보안상 제거됨.
// 인앱 브라우저(카카오톡/네이버 등)는 sessionStorage 격리로 signInWithPopup 가 실패하므로
// 감지 후 외부 브라우저로 열도록 안내.

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
  if (inApp.name === '카카오톡' && !inApp.isIOS) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
    return true;
  }
  if (inApp.name === '네이버 앱') {
    window.location.href =
      'naversearchapp://inappbrowser/close?target=' + encodeURIComponent(currentUrl);
    return true;
  }
  return false;
}

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { loginWithGoogle, firebaseConfigured } = useAuth();
  const navigate = useNavigate();
  const inApp = useMemo(detectInAppBrowser, []);

  function postLoginNavigate(role: string) {
    if (role === 'pending' || role === 'disabled') navigate('/pending');
    else navigate('/calendar');
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">플렌티컨벤션</h1>
          <p className="text-sm text-gray-500 mt-1">운영 통합관리 시스템</p>
        </div>

        {/* 인앱 브라우저(카카오톡/네이버/페북 등) 안내 */}
        {inApp && (
          <div className="mb-4 p-3 rounded-md border border-amber-300 bg-amber-50 text-xs text-amber-900">
            <div className="font-semibold mb-1">
              ⚠️ {inApp.name} 인앱 브라우저로 접속 중입니다.
            </div>
            <p className="leading-relaxed">
              인앱 브라우저는 보안상 Google 로그인이 동작하지 않습니다. 아래 버튼으로 외부 브라우저(Safari/Chrome)에서 열어주세요.
            </p>
            <button
              type="button"
              onClick={() => {
                const url = window.location.href;
                if (!openExternalBrowser(url, inApp)) {
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

        {/* Google 로그인 */}
        <button
          onClick={doGoogleLogin}
          disabled={busy || !firebaseConfigured || !!inApp}
          className={
            'w-full flex items-center justify-center gap-2 border rounded-md py-3 text-sm transition ' +
            (firebaseConfigured && !inApp
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
          {busy ? '로그인 중...' : firebaseConfigured ? 'Google로 로그인' : 'Google 로그인 (Firebase 미설정)'}
        </button>

        {error && (
          <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}

        <div className="mt-6 pt-5 border-t text-center">
          <p className="text-xs text-gray-500">
            관리자에게 계정 등록을 요청한 후 Google 계정으로 로그인하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
