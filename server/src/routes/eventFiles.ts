// 행사 첨부파일 관리. multer로 디스크 저장(server/data/uploads/<event_id>/).
// 한글 파일명은 latin1로 들어오므로 UTF-8로 디코딩.

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { store, persist } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import type { EventFile, EventFileType } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_ROOT = path.resolve(__dirname, '../../data/uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

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

function isValidEventId(eventId: string): boolean {
  return store.events.some((e) => e.id === eventId);
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const eventId = req.params.eventId;
    if (!isValidEventId(eventId)) {
      cb(new Error('event_not_found'), '');
      return;
    }
    const dir = path.join(UPLOAD_ROOT, eventId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const decoded = decodeKoreanName(file.originalname);
    const ext = path.extname(decoded);
    cb(null, `${nanoid(12)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const router = Router();

// 활성 사용자 모두 — 첨부파일은 행사 부속 정보, 권한은 행사 권한과 동일
router.use(requireActiveRole);

// 파일 업로드 권한 — 종류에 따라 분기.
// final_invoice는 행사리뷰 일환이므로 연회팀(+admin)만 가능.
// 그 외 견적서/계약서/BEO/기타는 영업 단계 파일이라 admin/sales 가능.
function canWriteFile(role: string, fileType: EventFileType): boolean {
  if (role === 'admin') return true;
  if (fileType === 'final_invoice') return role === 'banquet';
  return role === 'sales_mice' || role === 'sales_wedding';
}

// 업로드 — body에 file_type이 들어오는데, multer는 multipart 파싱 후에야 body가 채워지므로
// 권한 검사는 업로드 콜백 내부에서 수행한다.
router.post('/:eventId/files', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });

  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[upload]', err);
      return res.status(400).json({ error: 'upload_failed', detail: String(err) });
    }
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'no_file' });

    const file_type = sanitizeFileType(req.body.file_type);
    if (!canWriteFile(req.user!.role, file_type)) {
      // 권한 없으면 업로드된 파일 삭제
      try {
        fs.rmSync(f.path, { force: true });
      } catch {
        /* ignore */
      }
      return res.status(403).json({ error: 'forbidden' });
    }
    const originalName = decodeKoreanName(f.originalname);
    const record: EventFile = {
      id: nanoid(10),
      event_id: ev.id,
      file_type,
      file_name: originalName,
      file_url: `/api/events/${ev.id}/files/${f.filename}/download`,
      uploaded_by: req.user!.id,
      uploaded_at: new Date().toISOString(),
    };
    store.event_files.push(record);
    persist('event_files');
    res.status(201).json({ file: record });
  });
});

// 행사별 첨부파일 목록
router.get('/:eventId/files', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const files = store.event_files.filter((f) => f.event_id === ev.id);
  res.json({ files });
});

// 다운로드 — 원본 한글 파일명으로 반환
router.get('/:eventId/files/:storedName/download', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const filepath = path.join(UPLOAD_ROOT, ev.id, req.params.storedName);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'file_not_found' });
  // event_files에서 원본 이름 찾기 (다운로드 명에 사용)
  const record = store.event_files.find(
    (f) => f.event_id === ev.id && f.file_url.endsWith(`/${req.params.storedName}/download`)
  );
  res.download(filepath, record?.file_name || req.params.storedName);
});

// 삭제 — 파일 종류에 따라 권한 분기 (final_invoice는 banquet, 그 외는 sales/admin)
router.delete('/:eventId/files/:fileId', (req, res) => {
  const ev = store.events.find((e) => e.id === req.params.eventId);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  const idx = store.event_files.findIndex((f) => f.id === req.params.fileId && f.event_id === ev.id);
  if (idx === -1) return res.status(404).json({ error: 'file_not_found' });
  const removed = store.event_files[idx];
  if (!canWriteFile(req.user!.role, removed.file_type)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // 디스크에서도 삭제 — file_url 마지막 경로 segment가 stored filename
  const m = removed.file_url.match(/\/files\/([^/]+)\/download$/);
  if (m) {
    const stored = m[1];
    const filepath = path.join(UPLOAD_ROOT, ev.id, stored);
    fs.rmSync(filepath, { force: true });
  }
  store.event_files.splice(idx, 1);
  persist('event_files');
  res.json({ ok: true });
});

// 전체 첨부파일 목록 (관리 페이지용) — admin / sales / banquet은 전체, kitchen은 행사 권한대로
router.get('/_all', (_req, res) => {
  res.json({ files: store.event_files });
});

export default router;
