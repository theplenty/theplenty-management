import { Router } from 'express';
import { store } from '../store/mockStore.js';
import type { EventStatus } from '../types.js';

// 인증 없이 토큰만으로 접근 가능.
// 토큰에 매핑된 (year, month) 범위 내의 행사만 노출하며, 행사 상세는 노출하지 않는다.

const router = Router();

// ===== 캘린더 요약 공개 열람 =====
// 단일 토큰으로 로그인 없이 요약(사용홀·메뉴·GTD/EXP·비고 포함)을 열람.
// 상담/미팅/취소/LOS 행사는 제외. 휴지통 행사도 제외.
const SUMMARY_EXCLUDED = new Set<EventStatus>(['상담취소', '미팅', '미팅취소', 'LOS']);

router.get('/summary/:token', (req, res) => {
  const share = store.summary_shares.find((s) => s.token === req.params.token);
  if (!share) return res.status(404).json({ error: 'invalid_token' });

  const events = store.events
    .filter((e) => !e.deleted_at && !SUMMARY_EXCLUDED.has(e.status))
    .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1))
    .map((e) => ({
      id: e.id,
      event_type: e.event_type,
      status: e.status,
      halls: e.halls,
      start_datetime: e.start_datetime,
      end_datetime: e.end_datetime,
      event_name: e.event_name,
      food_items: store.event_food_items.filter((f) => f.event_id === e.id),
    }));

  res.json({ events });
});

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
      // 휴지통의 행사는 공유 링크에서도 제외.
      if (e.deleted_at) return false;
      const evStart = new Date(e.start_datetime).getTime();
      const evEnd = new Date(e.end_datetime).getTime();
      // 시작/종료가 해당 월과 조금이라도 겹치면 노출
      if (evEnd < start || evStart >= end) return false;
      if (event_type_filter !== 'ALL' && e.event_type !== event_type_filter) return false;
      // 외부 공유는 DEF(확정) 행사만 표시
      if (e.status !== 'DEF') return false;
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
