import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 프로젝트 루트 = server/src/lib/firebase.ts → 3단계 상위
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

function resolveCredPath(): string {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS 환경변수가 설정되지 않았습니다 (.env 확인).'
    );
  }
  if (path.isAbsolute(credPath)) {
    if (!fs.existsSync(credPath)) {
      throw new Error(`Firebase credentials 파일 없음: ${credPath}`);
    }
    return credPath;
  }
  // 1) 현재 cwd 기준
  const fromCwd = path.resolve(process.cwd(), credPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  // 2) 프로젝트 루트 기준 (server/에서 돌더라도 동작)
  const fromRoot = path.resolve(PROJECT_ROOT, credPath);
  if (fs.existsSync(fromRoot)) return fromRoot;
  throw new Error(
    `Firebase credentials 파일을 찾을 수 없습니다.\n` +
      `  GOOGLE_APPLICATION_CREDENTIALS=${credPath}\n` +
      `  시도한 경로:\n` +
      `    1) ${fromCwd}\n` +
      `    2) ${fromRoot}`
  );
}

if (!admin.apps.length) {
  const isCloudFunctions = !!process.env.K_SERVICE || !!process.env.FUNCTION_TARGET;

  if (isCloudFunctions) {
    // Cloud Functions: FIREBASE_CONFIG 환경변수에서 projectId/storageBucket 자동 로드 +
    // default service account credential 자동 적용.
    // FIREBASE_STORAGE_BUCKET이 명시된 경우 우선 사용 (appspot.com vs firebasestorage.app 불일치 방지).
    // FIREBASE_* prefix는 Firebase CLI reserved → APP_STORAGE_BUCKET으로 override
    const cfStorageBucket = process.env.APP_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
    if (cfStorageBucket) {
      admin.initializeApp({ storageBucket: cfStorageBucket });
    } else {
      admin.initializeApp();
    }
    // eslint-disable-next-line no-console
    console.log(`[firebase] Admin SDK 초기화 (Cloud Functions, bucket: ${cfStorageBucket ?? 'auto'})`);
  } else {
    const credPath = resolveCredPath();
    const storageBucket =
      process.env.FIREBASE_STORAGE_BUCKET ||
      `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
    admin.initializeApp({
      credential: admin.credential.cert(credPath),
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[firebase] Admin SDK 초기화 (로컬, project: ${process.env.FIREBASE_PROJECT_ID}, bucket: ${storageBucket})`
    );
  }
}

export const firebaseAdmin = admin;
export const firestore = admin.firestore();
export const firebaseAuth = admin.auth();
export const firebaseStorage = admin.storage();
