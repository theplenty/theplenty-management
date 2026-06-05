// 행사 첨부파일 관리 — Firebase Storage 기반 (Phase 5).
// 업로드: 클라이언트가 Firebase Storage SDK로 직접 PUT (Firebase Hosting 우회).
//         업로드 완료 후 /confirm 엔드포인트로 DB 레코드 생성 요청.
// 다운로드: Admin SDK Signed URL로 redirect (10분 유효).

import { Router } from 'express';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
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
