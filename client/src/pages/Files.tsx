import { weekdayKoOf, insertWeekday } from '../lib/dateFmt';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import {
  COLLAB_TEAM_LABEL,
  EVENT_FILE_TYPE_LABEL,
  type CollaborationRequest,
  type EventFile,
  type EventFileType,
  type EventWithFood,
} from '../types';
import { collabEventName, listCollaborations, statusBadgeClass } from '../lib/collaboration';

const TYPE_BADGE: Record<EventFileType, string> = {
  estimate: 'bg-yellow-100 text-yellow-800',
  contract: 'bg-blue-100 text-blue-800',
  beo: 'bg-purple-100 text-purple-800',
  final_invoice: 'bg-emerald-100 text-emerald-800',
  other: 'bg-gray-100 text-gray-700',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Files() {
  const [files, setFiles] = useState<EventFile[]>([]);
  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [collabs, setCollabs] = useState<CollaborationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'ALL' | EventFileType>('ALL');
  const [filterEvent, setFilterEvent] = useState<'ALL' | string>('ALL');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [filesRes, evRes, collabRes] = await Promise.all([
        api.get<{ files: EventFile[] }>('/api/events/_all'),
        api.get<{ events: EventWithFood[] }>('/api/events'),
        listCollaborations().catch(() => [] as CollaborationRequest[]),
      ]);
      setFiles(filesRes.files);
      setEvents(evRes.events);
      setCollabs(collabRes);
    } catch (e) {
      setError('목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const eventById = useMemo(() => {
    const m = new Map<string, EventWithFood>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    return files
      .filter((f) => filterType === 'ALL' || f.file_type === filterType)
      .filter((f) => filterEvent === 'ALL' || f.event_id === filterEvent)
      .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
  }, [files, filterType, filterEvent]);

  // 행사별로 그룹화 (편의)
  const byEvent = useMemo(() => {
    const m = new Map<string, EventFile[]>();
    for (const f of filtered) {
      const arr = m.get(f.event_id) || [];
      arr.push(f);
      m.set(f.event_id, arr);
    }
    return m;
  }, [filtered]);

  const eventOptions = useMemo(() => {
    const ids = new Set(files.map((f) => f.event_id));
    return events
      .filter((e) => ids.has(e.id))
      .sort((a, b) => (a.start_datetime < b.start_datetime ? 1 : -1));
  }, [files, events]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold">첨부파일 관리</h1>
        <button onClick={load} className="btn-secondary">
          새로고침
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        견적서 / 계약서 / BEO / 기타 파일 — 행사 상세의 첨부파일 탭에서 업로드한 파일들이
        모두 여기에 모입니다. <strong>BEO</strong>는 추후 행사정보 기반 워드 자동 생성과
        연결될 예정입니다.
      </p>

      {/* 협업요청서 일괄 리스트 (작성된 협업요청서를 첨부파일 관리에서도 한눈에) */}
      {collabs.length > 0 && (
        <div className="bg-white border rounded-lg overflow-hidden mb-5">
          <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-3">
            <span className="font-semibold text-gray-800">🤝 협업요청서</span>
            <span className="text-xs text-gray-500">{collabs.length}건</span>
            <Link to="/collaborations" className="ml-auto text-xs text-blue-600 hover:underline">
              전체 보기 →
            </Link>
          </div>
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-white text-gray-700">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">요청일</th>
                <th className="text-left px-4 py-2 font-semibold">고객사/행사명</th>
                <th className="text-left px-4 py-2 font-semibold">작성자</th>
                <th className="text-left px-4 py-2 font-semibold">대상팀</th>
                <th className="text-left px-4 py-2 font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              {collabs.slice(0, 12).map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2 text-xs text-gray-500">{insertWeekday(c.created_at.slice(0, 10))}</td>
                  <td className="px-4 py-2">
                    <Link to="/collaborations" className="text-blue-600 hover:underline">
                      {collabEventName(c)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-700">{c.created_by_name}</td>
                  <td className="px-4 py-2 text-xs">
                    {c.target_teams.map((t) => COLLAB_TEAM_LABEL[t]).join('+')}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`badge border text-[11px] ${statusBadgeClass(c.status)}`}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border rounded-lg p-3 mb-4 flex items-center gap-3 text-xs flex-wrap">
        <select
          className="input !py-1 !text-xs !w-auto"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as 'ALL' | EventFileType)}
        >
          <option value="ALL">전체 종류</option>
          <option value="estimate">견적서</option>
          <option value="contract">계약서</option>
          <option value="beo">BEO</option>
          <option value="final_invoice">최종 INVOICE</option>
          <option value="other">기타</option>
        </select>
        <select
          className="input !py-1 !text-xs !w-auto max-w-xs"
          value={filterEvent}
          onChange={(e) => setFilterEvent(e.target.value)}
        >
          <option value="ALL">전체 행사</option>
          {eventOptions.map((e) => (
            <option key={e.id} value={e.id}>
              [{e.event_type}] {e.event_name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-gray-500">총 {filtered.length}건</span>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-12 text-center bg-white border rounded-lg">
          첨부된 파일이 없습니다. 행사 상세 → 첨부파일 탭에서 업로드해주세요.
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(byEvent.entries()).map(([eventId, list]) => {
            const ev = eventById.get(eventId);
            return (
              <div key={eventId} className="bg-white border rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-3">
                  <span className="badge bg-gray-200 text-gray-700">{ev?.event_type || '?'}</span>
                  <span className="font-medium">{ev?.event_name || '(삭제된 행사)'}</span>
                  {ev && (
                    <span className="text-xs text-gray-500">
                      {fmtDate(ev.start_datetime)} ~ {fmtDate(ev.end_datetime)}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-500">{list.length}건</span>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-white text-gray-700">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold">종류</th>
                      <th className="text-left px-4 py-2 font-semibold">파일명</th>
                      <th className="text-left px-4 py-2 font-semibold">업로드 일시</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((f) => (
                      <tr key={f.id} className="border-t">
                        <td className="px-4 py-2">
                          <span className={`badge ${TYPE_BADGE[f.file_type]}`}>
                            {EVENT_FILE_TYPE_LABEL[f.file_type]}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <a
                            href={f.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {f.file_name}
                          </a>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500">
                          {fmtDate(f.uploaded_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
