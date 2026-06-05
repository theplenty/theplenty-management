// 행사 첨부파일 관리 — Firebase Storage 기반 (Phase 5).
// busboy로 multipart 파싱 (multer 대신 — Cloud Functions v2 호환성).
// 다운로드는 signed URL로 redirect (10분 유효).

import { Router } from 'express';
import Busboy from 'busboy';
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

// Storage 객체 키 생성: events/<event_id>/<random>.<ext>
function buildStorageKey(eventId: string, originalName: string): string {
  const ext = path.extname(originalName) || '';
  return `events/${eventId}/${nanoid(16)}${ext}`;
}

// multipart/form-data 파싱 (busboy 직접 사용 — Cloud Functions v2에서 multer보다 안정적)
interface ParsedMultipart {
  file?: { buffer: Buffer; mimetype: string; filename: string };
  fields: Record<string, string>;
}
function parseMultipart(req: Request): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers });
    } catch (e) {
      return reject(new Error(`Busboy 초기화 실패: ${(e as Error).message}`));
    }

    let fileData: ParsedMultipart['file'] | undefined;
    const fields: Record<string, string> = {};
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve({ file: fileData, fields });
    };

    bb.on('file', (name, stream, info) => {
      if (name === 'file') {
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 25 * 1024 * 1024) {
            stream.destroy(new Error('파일 크기 초과 (25MB 제한)'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          fileData = {
            buffer: Buffer.concat(chunks),
            mimetype: info.mimeType || 'application/octet-stream',
            filename: info.filename || 'upload',
          };
        });
        stream.on('error', (e: Error) => done(e));
      } else {
        stream.resume(); // 불필요한 필드는 drain
      }
    });

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('finish', () => done());
    bb.on('error', (e: Error) => done(e));

    req.pipe(bb);
  });
}

// 클라이언트 응답용 — DB에 저장된 file_url(storage path)을 클릭 가능한 download URL로 변환.
function toClientFile(f: EventFile): EventFile {
  return {
    ...f,
    file_url: `/api/events/${f.event_id}/files/${f.id}/download`,
  };
}

// 업로드 — busboy로 multipart 파싱 → Firebase Storage에 저장.
router.post('/:eventId/files', async (req: Request, res: Response) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });

  // multipart 파싱
  let parsed: ParsedMultipart;
  try {
    parsed = await parseMultipart(req);
  } catch (e) {
    console.error('[upload] multipart 파싱 실패:', e);
    return res.status(400).json({ error: 'parse_failed', detail: (e as Error).message });
  }

  const { file: f, fields } = parsed;
  if (!f || !f.buffer.length) {
    return res.status(400).json({ error: 'no_file' });
  }

  const file_type = sanitizeFileType(fields.file_type);
  if (!canWriteFile(req.user!.role, file_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const originalName = f.filename;
  const storageKey = buildStorageKey(ev.id, originalName);

  console.log(`[upload] 시작: ${originalName} (${f.buffer.length} bytes, type=${file_type}, key=${storageKey})`);

  try {
    const { firebaseStorage } = await import('../lib/firebase.js');
    const bucket = firebaseStorage.bucket();
    console.log(`[upload] bucket name: ${bucket.name}`);
    await bucket.file(storageKey).save(f.buffer, {
      contentType: f.mimetype,
      metadata: {
        metadata: {
          original_name: originalName,
          uploaded_by: req.user!.id,
          event_id: ev.id,
          file_type,
        },
      },
    });
    console.log(`[upload] Storage 저장 완료: ${storageKey}`);
  } catch (e) {
    console.error('[upload] Firebase Storage 저장 실패:', e);
    return res.status(500).json({ error: 'storage_failed', detail: (e as Error).message });
  }

  const record: EventFile = {
    id: nanoid(10),
    event_id: ev.id,
    file_type,
    file_name: originalName,
    file_url: storageKey,
    uploaded_by: req.user!.id,
    uploaded_at: new Date().toISOString(),
  };
  store.event_files.push(record);
  persistDoc('event_files', record.id);
  console.log(`[upload] DB 저장 완료: ${record.id}`);
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
