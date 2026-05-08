import 'dotenv/config';
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
import { attachUser } from './middleware/auth.js';
import { runSeed } from './store/seed.js';
import { runMigrations } from './store/migrate.js';

const app = express();
const PORT = Number(process.env.PORT || 3001);

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

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 인증 필요
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/customers', customersRouter);
// 첨부파일과 리뷰는 events 하위 경로 — events 라우터보다 먼저 등록해야 :id 매칭에 안 잡힘
app.use('/api/events', eventFilesRouter);
app.use('/api/event-reviews', eventReviewsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/calendar-shares', calendarSharesRouter);
app.use('/api/sales-targets', salesTargetsRouter);

// 공개(토큰만으로 접근) — 외부 업체에게 특정 월 캘린더 공유용
app.use('/api/public', publicCalendarRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] error:', err);
  res.status(500).json({ error: 'server_error' });
});

runMigrations();
runSeed();

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
