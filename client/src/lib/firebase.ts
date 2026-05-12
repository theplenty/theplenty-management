// Firebase Web SDK 초기화 + Google 로그인 헬퍼.
// 환경변수는 .env의 VITE_FIREBASE_* 에서 로드. 값이 비어있으면 (개발 초기) Google 로그인 비활성.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onIdTokenChanged,
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
  if (!_auth) _auth = getAuth(getFirebaseApp());
  return _auth;
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
