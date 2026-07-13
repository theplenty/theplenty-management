// build: 2026-06-23 (cold start 강제 — 한식도시락 BOM 교정 반영)
// .env는 두 곳 모두 시도:
//   1) 프로젝트 루트 ../../.env  (로컬 dev 환경)
//   2) server/.env               (Cloud Functions 배포 환경)
// dotenv는 이미 채워진 env를 덮어쓰지 않으므로, 같은 키가 양쪽에 있으면 1)이 우선.
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../../.env') });
config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import customersRouter from './routes/customers.js';
import eventsRouter from './routes/events.js';
import eventFilesRouter from './routes/eventFiles.js';
import eventReviewsRouter from './routes/eventReviews.js';
import calendarSharesRouter from './routes/calendarShares.js';
import publicCalendarRouter from './routes/publicCalendar.js';
import salesTargetsRouter from './routes/salesTargets.js';
import apiKeysRouter from './routes/apiKeys.js';
import publicApiRouter from './routes/publicApi.js';
import trashRouter from './routes/trash.js';
import searchRouter from './routes/search.js';
import activityLogRouter from './routes/activityLog.js';
import holidaysRouter from './routes/holidays.js';
import collaborationRequestsRouter from './routes/collaborationRequests.js';
import summaryShareRouter from './routes/summaryShare.js';
import { landingStaffRouter, landingConsultRouter, landingPublicRouter, landingOgRouter } from './routes/weddingLanding.js';
import menusRouter from './routes/menus.js';
import revenueItemsRouter from './routes/revenueItems.js';
import eventRevenueRouter from './routes/eventRevenue.js';
import paymentsRouter from './routes/payments.js';
import menuCostRouter from './routes/menuCost.js';
import settingsRouter from './routes/settings.js';
import { attachUser, attachTenant } from './middleware/auth.js';
import { runSeed } from './store/seed.js';
import { runMigrations } from './store/migrate.js';
import { ensureHydrated } from './store/mockStore.js';

export const app = express();

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(attachUser);
app.use(attachTenant);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 인증 필요
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/customers', landingConsultRouter); // /wedding/:customerId/landing — customersRouter보다 먼저
app.use('/api/customers', customersRouter);
// 첨부파일과 리뷰는 events 하위 경로 — events 라우터보다 먼저 등록해야 :id 매칭에 안 잡힘
app.use('/api/events', eventFilesRouter);
// 웨딩 고객 랜딩 (직원용) — events 하위 경로
app.use('/api/events', landingStaffRouter);
app.use('/api/event-reviews', eventReviewsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/calendar-shares', calendarSharesRouter);
app.use('/api/sales-targets', salesTargetsRouter);
app.use('/api/admin/api-keys', apiKeysRouter);
app.use('/api/admin/trash', trashRouter);
app.use('/api/admin/activity-log', activityLogRouter);
app.use('/api/search', searchRouter);
app.use('/api/collaborations', collaborationRequestsRouter);
app.use('/api/calendar-summary', summaryShareRouter);
app.use('/api/menus', menusRouter);
app.use('/api/revenue-items', revenueItemsRouter);
app.use('/api/events', eventRevenueRouter);
app.use('/api/revenue', eventRevenueRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/menu-cost', menuCostRouter);
app.use('/api/settings', settingsRouter);
// 한국 공휴일 (구글 공식 캘린더 프록시) — 공개 정보, 별도 권한 체크 없음
app.use('/api/holidays', holidaysRouter);

// 외부 클라이언트용 공개 API (API 키 인증) — 더 specific 한 prefix 를 먼저 등록
app.use('/api/public/v1', publicApiRouter);
// 공개(토큰만으로 접근) — 외부 업체에게 특정 월 캘린더 공유용 (구버전)
app.use('/api/public', publicCalendarRouter);
// 공개(토큰만으로 접근) — 웨딩 가예약 고객 랜딩
app.use('/api/public', landingPublicRouter);
// 랜딩 링크 미리보기(OG) — hosting rewrite /l/** 가 이 함수로 들어옴
app.use(landingOgRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] error:', err);
  res.status(500).json({ error: 'server_error' });
});

// Firestore 모드: hydrate 완료 후 마이그레이션/시드 실행
// JSON 모드: 파일이 이미 로드된 상태이므로 즉시 실행
const _backend = (process.env.STORE_BACKEND || 'json').toLowerCase();
if (_backend === 'firestore') {
  ensureHydrated()
    .then(() => {
      runMigrations();
      runSeed();
    })
    .catch((e: unknown) => console.error('[init] hydrate 후 초기화 실패:', e));
} else {
  runMigrations();
  runSeed();
}

// Cloud Functions v2 export — Firebase Hosting의 /api/** rewrite가 이 함수로 라우팅됨.
// 로컬 dev에서는 src/server.ts가 app.listen()을 호출.
// firebase-functions는 deploy 시점에만 의존성으로 필요하므로 안전한 동기 import.
import { onRequest } from 'firebase-functions/v2/https';

export const api = onRequest(
  {
    region: 'asia-northeast3',
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
    cors: true,
    // Cloud Run invoker 공개 — 누구나 호출 가능. 실제 인증은 Express 미들웨어(attachUser)가 처리.
    // 이게 없으면 Cloud Run 레벨에서 401 차단되어 우리 코드가 실행조차 안 됨.
    invoker: 'public',
  },
  app
);
