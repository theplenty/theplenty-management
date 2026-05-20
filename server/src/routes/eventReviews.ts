import { Router } from 'express';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { EventReview } from '../types.js';

const router = Router();
router.use(requireActiveRole);

// 작성·수정 권한: 관리자 + 연회팀
function canWriteReview(role: string): boolean {
  return role === 'admin' || role === 'banquet';
}

// 리뷰 작성 대상 행사 — DEF + 시작 시간이 지난 행사 (종료 전에도 작성 가능)
router.get('/eligible', (_req, res) => {
  const now = Date.now();
  const events = store.events.filter(
    (e) => e.status === 'DEF' && new Date(e.start_datetime).getTime() < now
  );
  const enriched = events.map((e) => ({
    ...e,
    has_review: store.event_reviews.some((r) => r.event_id === e.id),
  }));
  res.json({ events: enriched });
});

// 전체 리뷰 — 대시보드 매출 집계용. 활성 사용자 누구나 조회 가능 (조회만).
// 휴지통(삭제된 행사)의 리뷰는 제외.
router.get('/_all', (_req, res) => {
  const deletedEventIds = new Set(
    store.events.filter((e) => e.deleted_at).map((e) => e.id)
  );
  const reviews = store.event_reviews.filter((r) => !deletedEventIds.has(r.event_id));
  res.json({ reviews });
});

// 일괄 upsert — 엑셀 import 용. event_id로 매칭, 있으면 update / 없으면 create.
// dryRun=true면 변경 없이 카운트만 반환.
router.post('/_bulk-upsert', (req, res) => {
  if (!canWriteReview(req.user!.role)) return res.status(403).json({ error: 'forbidden' });
  const body = req.body as { rows?: Array<Partial<EventReview>>; dryRun?: boolean };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = !!body.dryRun;
  let added = 0;
  let updated = 0;
  const errors: Array<{ row?: number; key?: string; reason: string }> = [];
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const eventId = r.event_id;
    if (!eventId) {
      errors.push({ row: i + 1, reason: 'event_id가 비어있습니다' });
      continue;
    }
    const ev = store.events.find((e) => e.id === eventId);
    if (!ev) {
      errors.push({ row: i + 1, key: eventId, reason: '해당 행사를 찾을 수 없음' });
      continue;
    }
    const existing = store.event_reviews.find((rv) => rv.event_id === eventId);
    if (dryRun) {
      if (existing) updated++;
      else added++;
      continue;
    }
    let review = existing;
    if (!review) {
      review = {
        id: nanoid(10),
        event_id: eventId,
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
      added++;
    } else {
      updated++;
    }
    if (r.banquet_manager !== undefined) review.banquet_manager = r.banquet_manager;
    if (r.actual_meal_count !== undefined) review.actual_meal_count = r.actual_meal_count;
    if (r.paid_meal_count !== undefined) review.paid_meal_count = r.paid_meal_count;
    if (r.additional_sales !== undefined) review.additional_sales = r.additional_sales;
    if (r.system_issues !== undefined) review.system_issues = r.system_issues;
    if (r.event_special_notes !== undefined) review.event_special_notes = r.event_special_notes;
    if (r.flower_issues !== undefined) review.flower_issues = r.flower_issues;
    if (r.next_event_feedback !== undefined) review.next_event_feedback = r.next_event_feedback;
    if (r.general_comment !== undefined) review.general_comment = r.general_comment;
    if (r.final_revenue !== undefined) review.final_revenue = r.final_revenue;
    review.updated_at = now;
    persistDoc('event_reviews', review.id);
  }
  res.json({
    ok: added + updated,
    failed: errors.length,
    added,
    updated,
    errors,
    dryRun,
  });
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
  persistDoc('event_reviews', review.id);
  res.json({ review });
});

// 삭제 (admin only)
router.delete('/:eventId', (req, res) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const idx = store.event_reviews.findIndex((r) => r.event_id === req.params.eventId);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const removedId = store.event_reviews[idx].id;
  store.event_reviews.splice(idx, 1);
  persistDelete('event_reviews', removedId);
  res.json({ ok: true });
});

export default router;
