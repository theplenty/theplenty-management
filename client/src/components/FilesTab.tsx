import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { EVENT_FILE_TYPE_LABEL, type EventFile, type EventFileType } from '../types';

interface Props {
  eventId: string | null; // null = 신규 행사 → 저장 후 첨부 가능
  canWrite: boolean;
}

const TYPE_OPTIONS: EventFileType[] = ['estimate', 'contract', 'beo', 'final_invoice', 'other'];

const TYPE_BADGE: Record<EventFileType, string> = {
  estimate: 'bg-yellow-100 text-yellow-800',
  contract: 'bg-blue-100 text-blue-800',
  beo: 'bg-purple-100 text-purple-800',
  final_invoice: 'bg-emerald-100 text-emerald-800',
  other: 'bg-gray-100 text-gray-700',
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtBytes(_bytes: number): string {
  // multer는 size를 client로 안 보내고 우리 record에 size가 없으므로 미사용 — placeholder
  return '';
}

export default function FilesTab({ eventId, canWrite }: Props) {
  const [files, setFiles] = useState<EventFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<EventFileType>('estimate');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!eventId) return;
    setLoading(true);
    try {
      const res = await api.get<{ files: EventFile[] }>(`/api/events/${eventId}/files`);
      setFiles(res.files);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    if (file.size > 25 * 1024 * 1024) {
      alert('25MB 이하 파일만 업로드 가능합니다.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('file_type', uploadType);
      const res = await fetch(`/api/events/${eventId}/files`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { file: EventFile };
      setFiles((p) => [data.file, ...p]);
    } catch (err) {
      alert('업로드 실패');
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(f: EventFile) {
    if (!confirm(`[${f.file_name}] 파일을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/events/${f.event_id}/files/${f.id}`);
      setFiles((p) => p.filter((x) => x.id !== f.id));
    } catch (e) {
      alert('삭제 실패');
      console.error(e);
    }
  }

  if (!eventId) {
    return (
      <div className="border rounded-md p-6 text-center bg-gray-50/50">
        <div className="text-sm text-gray-600 mb-1">
          행사를 먼저 저장한 뒤 첨부파일을 등록할 수 있습니다.
        </div>
        <div className="text-xs text-gray-400">
          기본정보 입력 → 저장 → 다시 열어서 첨부파일 탭으로 진입
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm text-gray-600 mb-3">
        견적서 / 계약서 / BEO / 기타 파일을 업로드합니다. PDF, 이미지, 문서 등 25MB까지
        지원하며, BEO는 추후 행사정보 기반 워드 자동 생성과 연결될 예정입니다.
      </div>

      {canWrite && (
        <div className="border rounded-md p-3 bg-gray-50/40 mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500">파일 종류</label>
            <select
              className="input !py-1.5 !text-sm w-32"
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value as EventFileType)}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {EVENT_FILE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[11px] uppercase tracking-wide text-gray-500">파일 선택</label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              disabled={uploading}
              className="block text-sm file:mr-2 file:px-3 file:py-1 file:rounded file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer hover:file:bg-blue-700 disabled:opacity-50"
            />
          </div>
          {uploading && <div className="text-xs text-gray-500">업로드 중...</div>}
        </div>
      )}

      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">종류</th>
              <th className="text-left px-3 py-2 font-semibold">파일명</th>
              <th className="text-left px-3 py-2 font-semibold">업로드 일시</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-6">
                  불러오는 중...
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-6">
                  첨부된 파일이 없습니다.
                </td>
              </tr>
            ) : (
              files.map((f) => (
                <tr key={f.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <span className={`badge ${TYPE_BADGE[f.file_type]}`}>
                      {EVENT_FILE_TYPE_LABEL[f.file_type]}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-md truncate" title={f.file_name}>
                    <a
                      href={f.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {f.file_name}
                    </a>
                    {fmtBytes(0) /* keep helper used */}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmtDateTime(f.uploaded_at)}</td>
                  <td className="px-3 py-2">
                    {canWrite && (
                      <button
                        onClick={() => handleDelete(f)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
