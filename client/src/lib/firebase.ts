// Firebase Web SDK 초기화 + Google 로그인 헬퍼.
// 환경변수는 .env의 VITE_FIREBASE_* 에서 로드. 값이 비어있으면 (개발 초기) Google 로그인 비활성.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onIdTokenChanged,
  setPersistence,
  browserSessionPersistence,
  type User as FirebaseUser,
  type Auth,
} from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const FIREBASE_CONFIGURED = !!(cfg.apiKey && cfg.projectId && cfg.appId);

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _persistenceReady: Promise<void> | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!_app) {
    if (!FIREBASE_CONFIGURED) {
      throw new Error(
        'Firebase 환경변수 미설정. .env의 VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID 확인.'
      );
    }
    _app = initializeApp(cfg);
  }
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(getFirebaseApp());
    // 세션 단위 지속성 — 브라우저(또는 탭)를 닫으면 로그인 풀림, 새로고침은 유지.
    // setPersistence는 비동기이므로 첫 로그인 호출 전에 await 해야 함.
    _persistenceReady = setPersistence(_auth, browserSessionPersistence).catch((e) => {
      console.warn('[firebase] setPersistence 실패:', (e as Error).message);
    });
  }
  return _auth;
}

// Firebase Auth가 저장소(sessionStorage)에서 사용자 복원을 끝낼 때까지 기다림.
// 새로고침 직후 /api/auth/me 호출이 Bearer 토큰 없이 나가는 race를 막는 용도.
export async function waitForAuthReady(): Promise<void> {
  if (!FIREBASE_CONFIGURED) return;
  const auth = getFirebaseAuth();
  if (_persistenceReady) await _persistenceReady;
  await auth.authStateReady();
}

export async function signInWithGoogle(): Promise<{ idToken: string; user: FirebaseUser }> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const idToken = await result.user.getIdToken();
  return { idToken, user: result.user };
}

export async function signOut(): Promise<void> {
  if (!FIREBASE_CONFIGURED) return;
  const auth = getFirebaseAuth();
  await firebaseSignOut(auth);
}

// 매 요청마다 최신 ID 토큰 반환 (만료 자동 갱신은 Firebase가 처리).
export async function getCurrentIdToken(): Promise<string | null> {
  if (!FIREBASE_CONFIGURED) return null;
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) return null;
  return u.getIdToken();
}

export function onTokenChange(cb: (user: FirebaseUser | null) => void): () => void {
  if (!FIREBASE_CONFIGURED) return () => {};
  const auth = getFirebaseAuth();
  return onIdTokenChanged(auth, cb);
}
