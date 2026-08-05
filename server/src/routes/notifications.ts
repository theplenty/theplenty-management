// 알림 자동화 (로드맵 A4) — 관리자용 조작·점검 엔드포인트.
//   GET  /api/notifications/config   — Slack 연결 상태 (URL 자체는 노출하지 않음)
//   GET  /api/notifications/preview  — 지금 보낼 내용 미리보기 (발송 X, 이력 X)
//   POST /api/notifications/run      — 즉시 발송 (?force=1 이면 중복제거 무시)
//
// 정기 발송은 index.ts 의 스케줄 함수(dailyAlerts)가 같은 runAlerts() 를 호출한다.
import { Router } from 'express';
import { requireRoles } from '../middleware/auth.js';
import { runAlerts } from '../lib/alerts.js';
import { slackConfigured, slackTargetHint } from '../lib/slack.js';
import { store } from '../store/mockStore.js';

const router = Router();
// 운영 전체 현황이 담기므로 관리자 전용.
router.use(requireRoles('admin'));

router.get('/config', (_req, res) => {
  res.json({
    slack_configured: slackConfigured(),
    // 전체 URL 은 비밀값 — 끝 6자리만 힌트로.
    slack_target: slackTargetHint(),
    app_base_url: process.env.APP_BASE_URL || 'https://plenty-management.web.app',
    sent_log_count: store.notification_logs.length,
  });
});

router.get('/preview', async (_req, res) => {
  try {
    const result = await runAlerts({ dryRun: true, force: true });
    res.json(result);
  } catch (e) {
    console.error('[notifications] preview 실패', e);
    res.status(500).json({ error: 'preview_failed' });
  }
});

router.post('/run', async (req, res) => {
  const force = req.query.force === '1' || req.body?.force === true;
  try {
    const result = await runAlerts({ force });
    res.json(result);
  } catch (e) {
    console.error('[notifications] run 실패', e);
    res.status(500).json({ error: 'run_failed' });
  }
});

export default router;
