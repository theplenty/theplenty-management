// 행사 첨부파일 관리 — Firebase Storage 기반 (Phase 5).
// 업로드: 클라이언트가 Firebase Storage SDK로 직접 PUT (Firebase Hosting 우회).
//         업로드 완료 후 /confirm 엔드포인트로 DB 레코드 생성 요청.
// 다운로드: Admin SDK Signed URL로 redirect (10분 유효).

import { Router } from 'express';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import {
  buildEml,
  buildMiceMail,
  buildWeddingMail,
  guessMime,
  ymd,
  ymdDow,
  addDays,
} from '../lib/mailDraft.js';
import type { Request, Response } from 'express';
import type { EventFile, EventFileType } from '../types.js';

function sanitizeFileType(s: unknown): EventFileType {
  const v = String(s || 'other');
  if (
    v === 'estimate' ||
    v === 'contract' ||
    v === 'beo' ||
    v === 'final_invoice' ||
    v === 'other'
  )
    return v;
  return 'other';
}

const router = Router();
router.use(requireActiveRole);

function canWriteFile(role: string, fileType: EventFileType): boolean {
  if (role === 'admin') return true;
  if (fileType === 'final_invoice') return role === 'banquet';
  return role === 'sales_mice' || role === 'sales_wedding';
}

// 클라이언트 응답용 — DB에 저장된 file_url(storage path)을 /download 라우트로 변환.
function toClientFile(f: EventFile): EventFile {
  return {
    ...f,
    file_url: `/api/events/${f.event_id}/files/${f.id}/download`,
  };
}

// ──────────────────────────────────────────────────────────
// 업로드 완료 확인 (DB 레코드 생성)
//   POST /api/events/:eventId/files/confirm
//   body: { storage_key, filename, mimetype, file_type }
//   returns: { file }
// ──────────────────────────────────────────────────────────
router.post('/:eventId/files/confirm', async (req: Request, res: Response) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });

  const { storage_key, filename, file_type: rawType } = req.body as {
    storage_key?: string;
    filename?: string;
    file_type?: string;
  };

  if (!storage_key || !filename) {
    return res.status(400).json({ error: 'storage_key_and_filename_required' });
  }

  // storage_key가 올바른 경로인지 검증 (path injection 방지)
  const expectedPrefix = `events/${ev.id}/`;
  if (!storage_key.startsWith(expectedPrefix)) {
    return res.status(400).json({ error: 'invalid_storage_key' });
  }

  const file_type = sanitizeFileType(rawType);
  if (!canWriteFile(req.user!.role, file_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Storage에 실제로 파일이 존재하는지 확인
  try {
    const { firebaseStorage } = await import('../lib/firebase.js');
    const [exists] = await firebaseStorage.bucket().file(storage_key).exists();
    if (!exists) {
      console.warn(`[confirm] 파일이 Storage에 없음: ${storage_key}`);
      return res.status(400).json({ error: 'file_not_uploaded' });
    }
  } catch (e) {
    console.error('[confirm] Storage 확인 실패:', e);
    return res.status(500).json({ error: 'storage_check_failed', detail: (e as Error).message });
  }

  const record: EventFile = {
    id: nanoid(10),
    event_id: ev.id,
    file_type,
    file_name: filename,
    file_url: storage_key,
    uploaded_by: req.user!.id,
    uploaded_at: new Date().toISOString(),
  };
  store.event_files.push(record);
  persistDoc('event_files', record.id);

  console.log(`[confirm] DB 저장 완료: ${record.id} (${filename})`);
  res.status(201).json({ file: toClientFile(record) });
});

// 행사별 첨부파일 목록
router.get('/:eventId/files', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const files = store.event_files.filter((f) => f.event_id === ev.id).map(toClientFile);
  res.json({ files });
});

// 다운로드 — Admin SDK로 Signed Read URL 생성 후 redirect.
router.get('/:eventId/files/:fileId/download', async (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const record = store.event_files.find(
    (f) => f.id === req.params.fileId && f.event_id === ev.id
  );
  if (!record) return res.status(404).json({ error: 'file_not_found' });

  try {
    const { firebaseStorage } = await import('../lib/firebase.js');
    const bucket = firebaseStorage.bucket();
    const [exists] = await bucket.file(record.file_url).exists();
    if (!exists) return res.status(404).json({ error: 'file_not_found_in_storage' });
    const [signedUrl] = await bucket.file(record.file_url).getSignedUrl({
      action: 'read',
      expires: Date.now() + 10 * 60 * 1000,
      responseDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(record.file_name)}`,
    });
    res.redirect(signedUrl);
  } catch (e) {
    console.error('[download] signed URL 생성 실패:', e);
    res.status(500).json({ error: 'signed_url_failed' });
  }
});

// 고객 발송용 Outlook 메일 초안(.eml) — 견적서/계약서 파일을 첨부한 편집 초안 생성.
//   GET /api/events/:eventId/files/:fileId/mail-draft
//   받는사람(contact point 이메일)·제목·본문을 event/고객 데이터로 자동 매칭.
//   설치형 Outlook에서 열면 X-Unsent 헤더로 편집·전송 가능한 새 메일이 뜬다.
router.get('/:eventId/files/:fileId/mail-draft', async (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const record = store.event_files.find(
    (f) => f.id === req.params.fileId && f.event_id === ev.id
  );
  if (!record) return res.status(404).json({ error: 'file_not_found' });
  // 고객 발송 대상은 견적서/계약서만 (BEO 등 내부문서 제외)
  if (record.file_type !== 'estimate' && record.file_type !== 'contract') {
    return res.status(400).json({ error: 'not_sendable_file_type' });
  }
  const docLabel = record.file_type === 'estimate' ? '견적서' : '계약서';
  const senderName = req.user!.name || '';

  // CONTACT POINT 링크 → 고객/담당자/이메일 해석 (미지정이면 첫 링크로 fallback)
  const links = store.event_customers.filter((l) => l.event_id === ev.id);
  const cp = links.find((l) => l.is_contact_point) || links[0];

  let content;
  if (ev.event_type === 'WEDDING') {
    const cust = cp ? store.wedding_customers.find((c) => c.id === cp.customer_id) : undefined;
    const toEmail = !cust
      ? ''
      : cp?.contact_point_contact_id === 'bride'
        ? cust.bride_email || cust.groom_email || ''
        : cust.groom_email || cust.bride_email || '';
    content = buildWeddingMail({
      groomName: cust?.groom_name || '',
      brideName: cust?.bride_name || '',
      replyDeadline: ymdDow(addDays(new Date(), 1)), // 메일발송일 다음날
    });
    content.to = toEmail;
  } else {
    const cust = cp ? store.mice_customers.find((c) => c.id === cp.customer_id) : undefined;
    const contacts = cust ? cust.inquiries.flatMap((i) => i.contacts) : [];
    const contact = contacts.find((ct) => ct.id === cp?.contact_point_contact_id) || contacts[0];
    content = buildMiceMail({
      orgName: cust?.organization_name || '',
      contactName: contact?.name || '',
      senderName,
      docLabel,
      eventName: ev.event_name || '',
      eventDate: ymd(ev.start_datetime),
    });
    content.to = contact?.email || cust?.official_email || '';
  }

  // 첨부 바이트 로드 — Admin SDK로 서버 내부에서 직접 (CORS 무관)
  let buffer: Buffer;
  try {
    const { firebaseStorage } = await import('../lib/firebase.js');
    const [buf] = await firebaseStorage.bucket().file(record.file_url).download();
    buffer = buf;
  } catch (e) {
    console.error('[mail-draft] 첨부 파일 로드 실패:', e);
    return res.status(500).json({ error: 'attachment_load_failed' });
  }

  const eml = buildEml(content, {
    filename: record.file_name,
    mime: guessMime(record.file_name),
    buffer,
  });

  const safeEvent = (ev.event_name || 'event').replace(/[\\/:*?"<>|]/g, '_');
  const dlName = `${docLabel}_${safeEvent}.eml`;
  res.setHeader('Content-Type', 'message/rfc822; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(dlName)}`
  );
  res.send(eml);
});

// 삭제
router.delete('/:eventId/files/:fileId', async (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const idx = store.event_files.findIndex(
    (f) => f.id === req.params.fileId && f.event_id === ev.id
  );
  if (idx === -1) return res.status(404).json({ error: 'file_not_found' });
  const removed = store.event_files[idx];
  if (!canWriteFile(req.user!.role, removed.file_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { firebaseStorage } = await import('../lib/firebase.js');
    await firebaseStorage.bucket().file(removed.file_url).delete({ ignoreNotFound: true });
  } catch (e) {
    console.warn('[delete] Storage 객체 삭제 실패 (계속 진행):', (e as Error).message);
  }
  const removedId = removed.id;
  store.event_files.splice(idx, 1);
  persistDelete('event_files', removedId);
  res.json({ ok: true });
});

// 전체 첨부파일 목록 (관리 페이지용)
router.get('/_all', (_req, res) => {
  const deletedEventIds = new Set(
    store.events.filter((e) => e.deleted_at).map((e) => e.id)
  );
  const files = store.event_files
    .filter((f) => !deletedEventIds.has(f.event_id))
    .map(toClientFile);
  res.json({ files });
});

export default router;
