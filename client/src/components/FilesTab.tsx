import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { uploadFileToStorage } from '../lib/firebase';
import {
  EVENT_FILE_TYPE_LABEL,
  type CustomerType,
  type EventFile,
  type EventFileType,
} from '../types';

interface Props {
  eventId: string | null;
  canWrite: boolean;
  // 고객 발송(📧 Outlook) 버튼 노출 판단용 — MICE: 견적서/계약서, WEDDING: 계약서
  eventType?: CustomerType | null;
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

/** 파일 확장자 추출 (예: ".pdf") */
function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i) : '';
}

export default function FilesTab({ eventId, canWrite, eventType }: Props) {
  const [files, setFiles] = useState<EventFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadType, setUploadType] = useState<EventFileType>('estimate');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 고객 발송 가능 파일: MICE=견적서/계약서, WEDDING=계약서
  function canSend(t: EventFileType): boolean {
    if (t === 'estimate') return eventType === 'MICE';
    if (t === 'contract') return eventType === 'MICE' || eventType === 'WEDDING';
    return false;
  }

  // 📧 Outlook 발송 — 받는사람·제목·본문·첨부가 채워진 .eml 초안 다운로드
  async function sendViaOutlook(f: EventFile) {
    setSendingId(f.id);
    try {
      const { blob, filename } = await api.getBlob(
        `/api/events/${f.event_id}/files/${f.id}/mail-draft`
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'mail.eml';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      alert(
        'Outlook 메일 초안(.eml)이 다운로드되었습니다.\n' +
          '파일을 열면 받는사람·제목·본문·첨부가 채워진 Outlook 새 메일이 열립니다. 내용 확인 후 전송하세요.'
      );
    } catch (e) {
      const code = (e as { payload?: { error?: string } })?.payload?.error;
      const msg =
        code === 'not_sendable_file_type'
          ? '견적서/계약서만 발송할 수 있습니다.'
          : code === 'attachment_load_failed'
            ? '첨부 파일을 불러오지 못했습니다.'
            : code || '알 수 없는 오류';
      alert('메일 초안 생성 실패: ' + msg);
      console.error(e);
    } finally {
      setSendingId(null);
    }
  }

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
    setUploadPct(0);
    setUploadStatus('Storage에 업로드 중...');
    try {
      // STEP 1: Firebase Storage에 직접 업로드 (Firebase Hosting 완전 우회)
      const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const storagePath = `events/${eventId}/${uuid}${extOf(file.name)}`;

      await uploadFileToStorage(storagePath, file, (pct) => {
        setUploadPct(pct);
        setUploadStatus(`Storage에 업로드 중... ${pct}%`);
      });

      // STEP 2: 서버에 업로드 완료 통보 → DB 레코드 생성
      setUploadStatus('완료 처리 중...');
      const { file: created } = await api.post<{ file: EventFile }>(
        `/api/events/${eventId}/files/confirm`,
        {
          storage_key: storagePath,
          filename: file.name,
          mimetype: file.type || 'application/octet-stream',
          file_type: uploadType,
        }
      );
      setFiles((p) => [created, ...p]);
    } catch (err) {
      alert(`업로드 실패: ${(err as Error).message}`);
      console.error('[FilesTab] upload error:', err);
    } finally {
      setUploading(false);
      setUploadPct(0);
      setUploadStatus('');
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
        지원합니다. BEO는 하단 <span className="font-medium text-gray-700">📄 BEO 생성</span>{' '}
        버튼으로 행사정보·식음·업체정보를 모아 자동 생성(인쇄/PDF)할 수 있습니다.
        {(eventType === 'MICE' || eventType === 'WEDDING') && (
          <>
            {' '}
            <span className="font-medium text-blue-700">📧 Outlook 발송</span> 버튼은
            {eventType === 'MICE' ? ' 견적서·계약서를 ' : ' 계약서를 '}
            CONTACT POINT 담당자에게 보낼 Outlook 메일 초안(받는사람·제목·본문·첨부 자동)을 만듭니다.
          </>
        )}
      </div>

      {canWrite && (
        <div className="border rounded-md p-3 bg-gray-50/40 mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-gray-500">파일 종류</label>
            <select
              className="input !py-1.5 !text-sm w-32"
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value as EventFileType)}
              disabled={uploading}
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
          {uploading && (
            <div className="flex items-center gap-2 min-w-[140px]">
              {uploadPct > 0 && (
                <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              )}
              <span className="text-xs text-gray-500">{uploadStatus || '처리 중...'}</span>
            </div>
          )}
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
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{fmtDateTime(f.uploaded_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3 justify-end">
                      {canSend(f.file_type) && (
                        <button
                          onClick={() => sendViaOutlook(f)}
                          disabled={sendingId === f.id}
                          className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                          title="받는사람·제목·본문·첨부가 채워진 Outlook 메일 초안을 생성합니다"
                        >
                          {sendingId === f.id ? '생성 중...' : '📧 Outlook 발송'}
                        </button>
                      )}
                      {canWrite && (
                        <button
                          onClick={() => handleDelete(f)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          삭제
                        </button>
                      )}
                    </div>
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
