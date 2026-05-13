# 플렌티컨벤션 운영 통합관리 (HK_Sales통합관리)

내부 운영 웹 시스템 — 세일즈(MICE/WEDDING) / 연회 / 주방 / 관리자 용.

**현재 버전**: `v0.1` (2026-05-13) — Firebase 풀 운영 단계 [GitHub release](https://github.com/theplenty/theplenty-management/releases/tag/v0.1)
**프로덕션**: https://plenty-management.web.app

---

## 진행 상태

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | Firebase Admin SDK + Firestore 스키마 설계 | ✅ |
| 2 | JSON → Firestore 마이그레이션 + 정합성 검증 | ✅ |
| 3 | 서버 스토어 추상화 (JSON / dual / firestore 백엔드 스위치) | ✅ |
| 4 | Firebase Auth (Google 로그인) — 세션 단위 지속성 | ✅ |
| 5 | 파일 업로드 → Firebase Storage | ✅ |
| 6 | Hosting + Cloud Functions v2 배포 | ✅ |
| 7 | 검증 대시보드 + 최종 리포트 | 진행 중 |

---

## 주요 기능

### 행사정보 캘린더
- FullCalendar 기반 연/월/주/일/리스트 뷰
- 행사 상태(INQ/TEN/DEF/LOS) 색상 + 상담 일정 통합 표시
- 같은 홀·시간 충돌 자동 감지 (강/약 충돌 2단계)
- 외부 업체용 월별 캘린더 공유 링크 (토큰 인증)

### 고객정보 DB (MICE / WEDDING)
- 한 고객 다중 문의(MICE) / 다중 예식 후보(WEDDING) 모델
- 한국어 초성·부분일치·전화번호 끝자리 fuzzy 검색
- 컬럼별 정렬 + 컬럼 표시/숨김 설정 (localStorage 보존)
- 중복 등록 방지 — 업체명 입력 시 유사 업체 후보 표시
- 변경 이력 자동 기록

### 행사 목록
- 검색 + 컬럼 정렬 + 컬럼 표시/숨김 + 구분/상태/연도 필터
- 식음 메뉴 드롭다운 추가 (중복 허용) + 메뉴별 계약/확정 GTD·EXP 입력
- 행사-고객 연결, 가톨릭대관료(INVOICE), 첨부파일, 취소 정보, 행사리뷰 통합 모달

### 연회팀 행사 리뷰
- DEF 상태 + 종료된 행사 자동 필터
- 행사담당자는 연회팀 권한 사용자만 드롭다운 선택
- 최종 INVOICE 파일 업로드 (Firebase Storage)
- "미작성" 클릭 시 리뷰 탭으로 직접 진입

### 대시보드
- NVIDIA 디자인 시스템 — 검정 hero 헤더 + 그린 액센트
- 신규 유입 (MICE/WEDDING) 일/주/월 KPI + 진행단계별 카운트
- WEDDING 유입경로 분석 + 상담→DEF 전환율 차트
- SALES 통합 매출 목표(Forecasting / Actual / 달성률) 표

### 엑셀 일괄 업로드 (upsert)
- **단일 소스 원칙**: 모든 import는 dry-run 미리보기 → confirm → 실제 처리
- **중복 방지 upsert**: 시스템 ID 1차, 자연 키(업체명/행사명/이름+일시) 2차 매칭
  - MICE 고객: `customer_id` → `organization_name`
  - WEDDING 고객: `customer_id` → `wedding_event_name`
  - 행사: `행사 ID` → `event_name + start_datetime + event_type`
  - 행사 리뷰: `event_id` (필수)
- 매칭되면 update, 없으면 insert — 중복 생성 절대 없음
- 자식 데이터(inquiries, food_items)는 Excel에 있는 경우만 교체, 비어있으면 보존 (partial import 안전)
- 결과 리포트: 신규 추가 / 기존 업데이트 / 오류 건수 + 오류 상세

---

## 기술 스택

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS (port 5173)
- **Backend**: Node.js 20 + Express + TypeScript (port 3001 로컬, Cloud Functions v2 운영)
- **DB**: Firestore (in-memory mirror via lazy hydrate on cold start)
- **Auth**: Firebase Auth (Google) + Bearer ID 토큰. 세션 단위 지속성 (탭/창 닫으면 로그아웃, 새로고침은 유지)
- **Storage**: Firebase Storage (계약서/BEO/최종 INVOICE 첨부파일)
- **Hosting**: Firebase Hosting + `/api/**` rewrite → Cloud Functions
- **Region**: asia-northeast3 (Seoul)

---

## 실행 방법

### 로컬 개발

PowerShell 두 창:

```powershell
# 창 1 — 서버
cd e:\HK_Sales통합관리\server
npm run dev

# 창 2 — 클라이언트
cd e:\HK_Sales통합관리\client
npm run dev
```

브라우저: http://localhost:5173 (Vite가 `/api`를 3001로 proxy)

로컬에서 프로덕션 Firestore에 쓰지 않으려면 `server/.env`에 `STORE_BACKEND=json`로 설정.

### 운영 배포

```powershell
cd e:\HK_Sales통합관리
firebase deploy --project plenty-management
```

빌드(client+server) + Functions + Hosting 모두 한 번에. 5~7분 소요.

배포 완료 후 https://plenty-management.web.app 에서 **Ctrl+Shift+R**로 캐시 무시 새로고침.

### 배포 결과 확인
```powershell
firebase functions:log --project plenty-management
```

---

## 디렉토리 구조

```
HK_Sales통합관리/
├── client/                  # Vite + React 프론트엔드
│   └── src/
│       ├── auth/                # 인증 컨텍스트, 권한 헬퍼
│       ├── components/          # 공통 컴포넌트 (모달, ExcelButtons 등)
│       ├── pages/               # Dashboard, Calendar, Customers, Events, Reviews 등
│       ├── lib/
│       │   ├── api.ts               # fetch 래퍼 + Bearer 토큰
│       │   ├── firebase.ts          # Firebase Web SDK
│       │   ├── excel.ts             # ExcelJS export/import
│       │   ├── customerColumns.ts   # 엑셀 컬럼 정의 (MICE/WEDDING)
│       │   ├── useTableControls.ts  # 컬럼 숨김/정렬 훅
│       │   └── ...
│       └── types.ts             # 도메인 타입
│
├── server/                  # Express + TypeScript 백엔드
│   ├── src/
│   │   ├── index.ts             # Express app + Cloud Functions export
│   │   ├── server.ts            # 로컬 dev entrypoint
│   │   ├── lib/firebase.ts      # Admin SDK (Firestore/Auth/Storage)
│   │   ├── middleware/auth.ts   # Bearer 토큰 검증 + Firestore hydrate
│   │   ├── routes/              # auth, users, customers, events, eventReviews 등
│   │   ├── store/
│   │   │   ├── mockStore.ts         # in-memory + JSON + Firestore dual-write
│   │   │   ├── migrate.ts           # 스키마 마이그레이션 (멱등)
│   │   │   ├── seed.ts              # 초기 데이터 시드
│   │   │   └── changeLog.ts         # 변경 이력 기록
│   │   └── types.ts
│   ├── scripts/                 # 운영 스크립트 (migration, clear-events 등)
│   └── data/                    # JSON 파일 (gitignored — 실제 데이터)
│
├── firebase.json            # Hosting + Functions 설정
├── firestore.rules          # Firestore 보안 규칙
├── storage.rules            # Storage 보안 규칙
├── CLAUDE.md                # AI 에이전트 작업 규칙 (commit 안전성, 토큰 관리 등)
├── .gitignore               # 민감 파일 자동 제외
├── .env                     # gitignored — Firebase 키, SUPER_ADMIN_EMAIL 등
└── .env.example             # 환경변수 템플릿
```

---

## 권한 모델

| 권한 | 고객정보 | 행사 | 리뷰 | 매출목표 | 관리자 도구 |
|---|---|---|---|---|---|
| admin | 모두 R/W | R/W | R/W | R/W | 사용자 관리, 일괄 삭제 |
| sales_mice | MICE R/W, WEDDING R | R/W | R | R | — |
| sales_wedding | WEDDING R/W, MICE R | R/W | R | R | — |
| banquet | R | R | R/W | R | — |
| kitchen | R | R | R | R | — |
| pending | — | — | — | — | (권한 부여 대기 화면만) |
| disabled | — | — | — | — | (로그인 차단) |

`SUPER_ADMIN_EMAIL`에 지정된 이메일로 첫 로그인 시 자동 admin 부여.

---

## 보안 / 운영 규칙

이 저장소는 **공개(public) GitHub 저장소**입니다. 다음은 절대 commit 금지 ([.gitignore](.gitignore)로 자동 보호):

- `.env`, `.env.*` — API 키
- `server/data/*.json` — 고객 1,600+명 데이터
- `*.xlsx`, `*.csv` — 고객 정보 export
- `*-firebase-adminsdk-*.json` — 서비스 계정 키
- `참고/` — Firebase 서비스 계정 키 보관 폴더

자세한 사항은 [CLAUDE.md](CLAUDE.md) 참조.

---

## 버전 이력

- **v0.1** (2026-05-13) — 안정 운영 시작점. Firebase 풀 마이그레이션 + 엑셀 upsert + 대시보드 NVIDIA UI 적용. [태그 보기](https://github.com/theplenty/theplenty-management/releases/tag/v0.1)

---

## 관련 문서

- [CLAUDE.md](CLAUDE.md) — AI 에이전트 작업 규칙 (commit 안전성, 토큰 관리, 데이터 보호)
- [.env.example](.env.example) — 환경변수 템플릿
- [docs/](docs/) — 마이그레이션 리포트 및 스키마 문서
