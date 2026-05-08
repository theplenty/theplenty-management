import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persist } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { EventReview } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 작성·수정 권한: 관리자 + 연회팀
function canWriteReview(role: string): boolean {
  return role === 'admin' || role === 'banquet';
}

// 리뷰 작성 대상 행사 — DEF + 종료된 행사
router.get('/eligible', (_req, res) => {
  const now = Date.now();
  const events = store.events.filter(
    (e) => e.status === 'DEF' && new Date(e.end_datetime).getTime() < now
  );
  const enriched = events.map((e) => ({
    ...e,
    has_review: store.event_reviews.some((r) => r.event_id === e.id),
  }));
  res.json({ events: enriched });
});

// 전체 리뷰 — 대시보드 매출 집계용. 활성 사용자 누구나 조회 가능 (조회만).
router.get('/_all', (_req, res) => {
  res.json({ reviews: store.event_reviews });
});

// 단건 조회
router.get('/:eventId', (req, res) => {
  const review = store.event_reviews.find((r) => r.event_id === req.params.eventId);
  res.json({ review: review || null });
});

// 작성 또는 수정 (upsert)
router.put('/:eventId', (req, res) => {
  if (!canWriteReview(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });

  const body = req.body as Partial<EventReview>;
  const now = new Date().toISOString();
  let review = store.event_reviews.find((r) => r.event_id === ev.id);
  if (!review) {
    review = {
      id: nanoid(10),
      event_id: ev.id,
      banquet_manager: '',
      actual_meal_count: null,
      paid_meal_count: null,
      additional_sales: '',
      system_issues: '',
      event_special_notes: '',
      flower_issues: '',
      next_event_feedback: '',
      general_comment: '',
      final_revenue: null,
      created_by: req.user!.id,
      created_at: now,
      updated_at: now,
    };
    store.event_reviews.push(review);
  }
  if (body.banquet_manager !== undefined) review.banquet_manager = body.banquet_manager;
  if (body.actual_meal_count !== undefined) review.actual_meal_count = body.actual_meal_count;
  if (body.paid_meal_count !== undefined) review.paid_meal_count = body.paid_meal_count;
  if (body.additional_sales !== undefined) review.additional_sales = body.additional_sales;
  if (body.system_issues !== undefined) review.system_issues = body.system_issues;
  if (body.event_special_notes !== undefined) review.event_special_notes = body.event_special_notes;
  if (body.flower_issues !== undefined) review.flower_issues = body.flower_issues;
  if (body.next_event_feedback !== undefined) review.next_event_feedback = body.next_event_feedback;
  if (body.general_comment !== undefined) review.general_comment = body.general_comment;
  if (body.final_revenue !== undefined) review.final_revenue = body.final_revenue;
  review.updated_at = now;
  persist('event_reviews');
  res.json({ review });
});

// 삭제 (admin only)
router.delete('/:eventId', (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const idx = store.event_reviews.findIndex((r) => r.event_id === req.params.eventId);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  store.event_reviews.splice(idx, 1);
  persist('event_reviews');
  res.json({ ok: true });
});

export default router;
