// 행사 첨부파일 관리 — Firebase Storage 기반 (Phase 5).
// multer.memoryStorage로 업로드 받아 Firebase Storage 버킷에 PUT.
// 다운로드는 signed URL로 redirect (10분 유효).

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { store, persistDoc, persistDelete } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { EventFile, EventFileType } from '../types.js';

// multer가 file.originalname을 latin1로 디코드하므로 UTF-8로 재해석한다.
function decodeKoreanName(s: string): string {
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch {
    return s;
  }
}

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const router = Router();
router.use(requireActiveRole);

function canWriteFile(role: string, fileType: EventFileType): boolean {
  if (role === 'admin') return true;
  if (fileType === 'final_invoice') return role === 'banquet';
  return role === 'sales_mice' || role === 'sales_wedding';
}

// Storage 객체 키 생성: events/<event_id>/<random>.<ext>
function buildStorageKey(eventId: string, originalName: string): string {
  const ext = path.extname(originalName) || '';
  return `events/${eventId}/${nanoid(16)}${ext}`;
}

// 클라이언트 응답용 — DB에 저장된 file_url(storage path)을 클릭 가능한 download URL로 변환.
// 클라이언트는 file.id로 다운로드 라우트 호출 → 서버가 signed URL로 redirect.
function toClientFile(f: EventFile): EventFile {
  return {
    ...f,
    file_url: `/api/events/${f.event_id}/files/${f.id}/download`,
  };
}

// 업로드 — multer로 메모리 buffer 받아서 Firebase Storage에 저장.
router.post('/:eventId/files', upload.single('file'), async (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });

  const f = req.file;
  if (!f) return res.status(400).json({ error: 'no_file' });

  const file_type = sanitizeFileType(req.body.file_type);
  if (!canWriteFile(req.user!.role, file_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const originalName = decodeKoreanName(f.originalname);
  const storageKey = buildStorageKey(ev.id, originalName);

  try {
    const { firebaseStorage } = await import('../lib/firebase.js');
    const bucket = firebaseStorage.bucket();
    await bucket.file(storageKey).save(f.buffer, {
      contentType: f.mimetype || 'application/octet-stream',
      metadata: {
        metadata: {
          original_name: originalName,
          uploaded_by: req.user!.id,
          event_id: ev.id,
          file_type,
        },
      },
    });
  } catch (e) {
    console.error('[upload] Firebase Storage 저장 실패:', e);
    return res.status(500).json({ error: 'storage_failed', detail: (e as Error).message });
  }

  const record: EventFile = {
    id: nanoid(10),
    event_id: ev.id,
    file_type,
    file_name: originalName,
    // file_url에 storage object key 저장. 클라이언트는 /download 라우트로 접근.
    file_url: storageKey,
    uploaded_by: req.user!.id,
    uploaded_at: new Date().toISOString(),
  };
  store.event_files.push(record);
  persistDoc('event_files', record.id);
  res.status(201).json({ file: toClientFile(record) });
});

// 행사별 첨부파일 목록
router.get('/:eventId/files', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const files = store.event_files.filter((f) => f.event_id === ev.id).map(toClientFile);
  res.json({ files });
});

// 다운로드 — Firebase Storage에서 signed URL 생성 후 redirect.
// 클라이언트는 /api/events/:eventId/files/:fileId/download 호출 → 302 → 실제 파일.
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
      // download 시 원본 한글 파일명으로 저장되도록 Content-Disposition 강제
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
  // Storage에서도 삭제 (실패해도 메타데이터 삭제는 진행)
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

// 전체 첨부파일 목록 (관리 페이지용) — 휴지통(삭제된 행사)의 파일은 제외.
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
