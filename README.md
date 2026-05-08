# 플렌티컨벤션 운영 통합관리 (HK_Sales통합관리)

내부 운영 웹 시스템 — 세일즈 / 연회 / 주방 / 관리자 용.

## 현재 상태 (Phase 1 — 기반)

- [x] 프로젝트 스캐폴딩 (client + server, TypeScript)
- [x] Express + 모킹 데이터 저장소 (JSON 파일 백킹)
- [x] 인증/세션 (모킹) — 데모 계정 6종 자동 생성
- [x] 사이드바 레이아웃 + 역할별 메뉴 가드
- [x] 관리자용 사용자 관리 화면 (권한 부여 / 회수 / 비활성화)
- [ ] Phase 2 — 고객정보 DB (MICE/WEDDING)
- [ ] Phase 3 — 행사정보 캘린더 + 행사 상세 탭 화면
- [ ] Phase 4 — 첨부파일 + 연회팀 행사리뷰
- [ ] Phase 5 — Firebase 연결 (`plenty-sales` 프로젝트)

## 기술 스택

- **Frontend**: Vite + React + TypeScript + Tailwind CSS (port 5173)
- **Backend**: Node.js + Express + TypeScript (port 3001)
- **Data (mock)**: JSON 파일 (`server/data/`)
- **Auth (mock)**: HTTP-only 쿠키 + 데모 로그인. Phase 5에서 Firebase Auth(Google)로 교체

## 실행 방법

```bash
# 1) 의존성 설치 (최초 1회)
npm run install:all

# 2) 개발 서버 실행 (client + server 동시)
npm run dev

# → 브라우저에서 http://localhost:5173 접속
```

## 데모 계정

| 이메일 | 권한 |
|---|---|
| admin@example.com | 관리자 (실제 값은 `.env`의 `SUPER_ADMIN_EMAIL`로 주입) |
| mice.demo@plenty.test | 기업세일즈(MICE) |
| wedding.demo@plenty.test | 웨딩세일즈(WEDDING) |
| banquet.demo@plenty.test | 연회팀 |
| kitchen.demo@plenty.test | 주방팀 |
| pending.demo@plenty.test | 권한대기 |

로그인 화면에서 **빠른 데모 로그인** 버튼으로 즉시 전환 가능.

## 디렉토리 구조

```
e:/HK_Sales통합관리/
├── client/        # Vite + React 프론트엔드
│   └── src/
│       ├── auth/        # 인증 컨텍스트, 권한 헬퍼
│       ├── components/  # Layout, ProtectedRoute
│       ├── pages/       # 5개 메뉴 + 로그인/대기/관리자
│       └── lib/api.ts   # fetch 래퍼
├── server/        # Express + TypeScript 백엔드
│   ├── src/
│   │   ├── routes/      # auth, users, customers, events
│   │   ├── store/       # 모킹 데이터 저장소
│   │   ├── middleware/  # 권한 미들웨어
│   │   └── types.ts
│   └── data/           # JSON 파일 (자동 생성)
└── package.json   # 루트 — concurrently로 두 서버 동시 실행
```

## Firebase 연결 (예정)

새 프로젝트 `plenty-sales` 생성 후:
1. Firebase Admin SDK 키 파일을 `참고/` 폴더에 두기
2. `.env`의 `FIREBASE_PROJECT_ID`와 `VITE_FIREBASE_*` 값을 새 프로젝트 값으로 교체
3. `server/src/store/`에 Firestore 어댑터 추가, mock과 스왑
4. 클라이언트는 Firebase Auth(Google) ID 토큰을 받아서 `/api/auth/login`에 전송 → 서버에서 Admin SDK로 토큰 검증
