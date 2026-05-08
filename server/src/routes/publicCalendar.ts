import { Router } from 'express';
import { store } from '../store/mockStore.js';

// 인증 없이 토큰만으로 접근 가능.
// 토큰에 매핑된 (year, month) 범위 내의 행사만 노출하며, 행사 상세는 노출하지 않는다.

const router = Router();

router.get('/calendar/:token', (req, res) => {
  const { token } = req.params;
  const share = store.calendar_shares.find((s) => s.token === token);
  if (!share) return res.status(404).json({ error: 'invalid_token' });

  const { year, month, event_type_filter } = share;
  // 해당 월의 시작/끝 시각 (KST 가정 — 실 배포 시 timezone 명시 필요)
  const start = new Date(year, month - 1, 1, 0, 0, 0).getTime();
  const end = new Date(year, month, 1, 0, 0, 0).getTime();

  const events = store.events
    .filter((e) => {
      const evStart = new Date(e.start_datetime).getTime();
      const evEnd = new Date(e.end_datetime).getTime();
      // 시작/종료가 해당 월과 조금이라도 겹치면 노출
      if (evEnd < start || evStart >= end) return false;
      if (event_type_filter !== 'ALL' && e.event_type !== event_type_filter) return false;
      // LOS 행사는 외부 공유에서 제외 (운영상 안전)
      if (e.status === 'LOS') return false;
      return true;
    })
    // 외부에 노출되지 않아야 할 정보 제거 — 행사 식별과 일정만 남김
    .map((e) => ({
      id: e.id,
      event_type: e.event_type,
      status: e.status,
      halls: e.halls,
      start_datetime: e.start_datetime,
      end_datetime: e.end_datetime,
      event_name: e.event_name,
    }));

  res.json({
    share: {
      year: share.year,
      month: share.month,
      label: share.label,
      event_type_filter: share.event_type_filter,
    },
    events,
  });
});

export default router;
