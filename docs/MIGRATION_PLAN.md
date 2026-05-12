# Firebase 마이그레이션 계획서

**대상 프로젝트**: `plenty-management` (신규)
**시작일**: 2026-05-08
**현재 시스템**: Express + JSON 파일 저장소 + 모킹 인증
**목표 시스템**: Firebase (Firestore + Auth + Storage + Hosting)

---

## 전체 단계 — 7 Phase

각 Phase는 **검증 통과** 후에만 다음으로 진행합니다.

| Phase | 내용 | 검증 방법 | 사용자 액션 필요 |
|---|---|---|:-:|
| 1 | Firebase Admin SDK 연결 + 스키마 설계 | `_health` 컬렉션 read/write 라운드트립 | ✅ Firestore 활성화 |
| 2 | JSON → Firestore 데이터 마이그레이션 | 카운트 비교 + 샘플 doc 검증 리포트 | - |
| 3 | 백엔드 store 추상화 (JSON/Firestore 스위치) | `STORE_BACKEND=firestore` 모드로 모든 GET 라우트 응답 동일 | - |
| 4 | Mock 인증 → Firebase Auth (Google) | Sarah 본인 Google 계정으로 로그인 → admin 권한 확인 | ✅ Auth/Google 활성화 |
| 5 | 파일 업로드 → Firebase Storage | 테스트 파일 업로드 → Console에 보임 | ✅ Storage 활성화 |
| 6 | Firebase Hosting 배포 (client + Functions) | `https://plenty-management.web.app` 접속 → 로그인 → 데이터 조회 | ✅ Blaze 플랜 + Hosting 활성화 |
| 7 | 운영 검증 페이지 + 최종 리포트 | 앱 내 `/admin/firebase-status` 페이지에 실시간 헬스 + 카운트 표시 | - |

---

## Phase 1 상세 — Foundation

### 작업 (Claude)
1. ✅ 비공개 키 `참고/` 이동 완료
2. `.env` 갱신: `FIREBASE_PROJECT_ID=plenty-management`, `GOOGLE_APPLICATION_CREDENTIALS=참고/...`
3. `firebase-admin` npm 패키지 설치 (server)
4. `server/src/lib/firebase.ts` 모듈 — Admin SDK 초기화
5. `docs/FIRESTORE_SCHEMA.md` — 13개 JSON → Firestore 컬렉션 매핑 명세
6. `firebase.json`, `.firebaserc` 호스팅 config 초안
7. `server/scripts/firebase-health.ts` — 연결 진단 스크립트

### Sarah 액션 — 즉시 시작 가능
1. https://console.firebase.google.com/project/plenty-management 접속
2. 좌측 메뉴 **Firestore Database** → **Create database**
3. 모드 선택: **Production mode** (보안 규칙 자동 차단)
4. 위치: **`asia-northeast3 (Seoul)`** ⚠️ 한 번 정하면 못 바꿈
5. **사용 설정**

### 검증
```bash
cd server && npx tsx scripts/firebase-health.ts
```
**기대 출력**:
```
[OK] Firebase Admin SDK initialized (project: plenty-management)
[OK] Firestore write _health/{ts} successful
[OK] Firestore read back successful
[OK] Cleanup complete
✅ Phase 1 PASS
```

---

## Phase 2 상세 — 데이터 마이그레이션

### 작업
1. `server/scripts/migrate-to-firestore.ts` — JSON 13개 파일 → Firestore 일괄 import
2. `server/scripts/verify-migration.ts` — 카운트/샘플 비교 리포트 생성
3. `docs/MIGRATION_REPORT.md` — 결과 자동 기록

### 검증
```bash
cd server && npx tsx scripts/migrate-to-firestore.ts --dry-run  # 먼저 미리보기
cd server && npx tsx scripts/migrate-to-firestore.ts            # 실행
cd server && npx tsx scripts/verify-migration.ts                # 검증
```
**기대 출력**: 모든 컬렉션 카운트 일치, 샘플 doc 비교 100% 매칭.

---

## Phase 3 상세 — Store 추상화

### 작업
1. `server/src/store/storeAdapter.ts` — 인터페이스 정의
2. `jsonStoreAdapter.ts` — 기존 mockStore 로직
3. `firestoreStoreAdapter.ts` — 새 어댑터
4. `mockStore.ts`를 어댑터 위임으로 변경 — 기존 라우트 코드 0줄 수정
5. `STORE_BACKEND=json|firestore` env 스위치

### 검증
```bash
# JSON 모드 (기본) — 기존과 동일 동작
STORE_BACKEND=json npm run dev

# Firestore 모드 — 데이터 출처만 바뀌고 응답은 동일해야 함
STORE_BACKEND=firestore npm run dev
curl http://localhost:3001/api/customers/wedding | jq '.customers | length'
# → 543 (Firestore에서 읽은 값. JSON 모드와 동일해야 함)
```

---

## Phase 4 상세 — Firebase Auth

### 작업
1. 클라이언트 Firebase SDK 설치 (`firebase/auth`)
2. `client/src/auth/firebase.ts` — Firebase Auth 초기화
3. Login 페이지: Google 로그인 버튼 추가 (mock quick-login은 dev에서만)
4. 백엔드 미들웨어 `attachUser`: cookie → Firebase ID token 검증
5. 첫 로그인 시 Firestore `users/{uid}` 자동 생성 (super admin email 매칭하면 admin role)

### Sarah 액션
1. Firebase Console → **Authentication** → **Get started**
2. Sign-in method 탭 → **Google** → 활성화 → 저장
3. Settings → Authorized domains → `localhost` 이미 포함 확인

### 검증
- 시크릿 창에서 http://localhost:5173 접속
- "Google로 로그인" 클릭 → Google 계정 선택 → Sarah 계정으로
- 로그인 후 사이드바에 "관리자" 권한 메뉴들이 보임 (사용자관리, 대시보드 등)

---

## Phase 5 상세 — Storage

### 작업
1. `firebase-admin/storage` 사용
2. `eventFiles.ts` 라우트 multer → Firebase Storage 전환
3. 기존 `server/data/uploads/` 파일 (현재 0개) Storage로 옮기는 스크립트

### Sarah 액션
1. Firebase Console → **Storage** → **Get started** → Production mode

### 검증
- 행사 등록 모달 → 첨부파일 탭 → 파일 업로드
- Console Storage에서 해당 파일 확인
- 다시 다운로드 → 정상 열림

---

## Phase 6 상세 — Hosting + Functions

### 작업
1. `firebase.json` 확장: hosting + functions 섹션
2. `functions/` 폴더 생성 — Express 앱을 Cloud Functions에서 wrapping
3. `client/vite.config.ts` — `VITE_API_BASE` 본번 분기
4. `firebase deploy --only hosting,functions`

### Sarah 액션
1. **Blaze 플랜 업그레이드** (Cloud Functions 외부 호출용 필수)
   - https://console.firebase.google.com/project/plenty-management/usage/details
   - "Modify plan" → Blaze → 결제 카드 등록
2. Firebase CLI 설치 (PowerShell):
   ```powershell
   npm install -g firebase-tools
   firebase login
   ```

### 검증
- 배포 완료 후 https://plenty-management.web.app 접속
- Google 로그인 → 메뉴 동작 확인
- 행사 등록 → Firestore Console에서 즉시 확인

---

## Phase 7 상세 — 검증 페이지 + 리포트

### 작업
1. `client/src/pages/FirebaseStatus.tsx` — 관리자 전용 페이지
   - 각 컬렉션별 실시간 카운트
   - 마지막 마이그레이션 시각
   - 헬스체크 버튼
2. `docs/MIGRATION_REPORT.md` — 단계별 결과 + 스크린샷 + 성능 측정
3. `git commit` + push

### 검증
- /admin/firebase-status 접속 → 모든 컬렉션 ✅ 표시
- 리포트 문서 내 모든 단계 PASS

---

## 사고 시 롤백 정책

각 Phase는 reversible. 문제 발생 시:
- Phase 2: `node server/scripts/clear-firestore.ts` 로 Firestore 초기화
- Phase 3: `STORE_BACKEND=json` 으로 즉시 복귀 (코드 변경 없음)
- Phase 4: 클라이언트 코드만 git revert
- Phase 5: multer 코드 git revert
- Phase 6: 배포 안 한 상태로 롤백 (Hosting/Functions 미배포)

원본 JSON 데이터 (`server/data/*.json`)는 **마이그레이션 후에도 보존** — 안전망.

---

이 문서는 작업 진행하면서 실시간 업데이트됩니다.
