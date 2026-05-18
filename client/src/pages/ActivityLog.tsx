import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

// 관리자 — 전체 사용자 활동 로그 실시간 모니터링.
// 폴링 기반 (기본 8초마다). 일시정지 가능.
// 엔티티 타입·사용자별 필터. 클릭 시 해당 엔티티로 이동.

type EntityType = 'event' | 'mice_customer' | 'wedding_customer';
type Action = 'create' | 'update' | 'delete';

interface ActivityEntry {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  action: Action;
  summary: string;
  changes?: Array<{ field: string; before: unknown; after: unknown }>;
  changed_by_id: string;
  changed_by_name: string;
  changed_at: string;
  entity_name: string | null;
  entity_deleted: boolean;
}

interface ActivityResponse {
  logs: ActivityEntry[];
  total_filtered: number;
  total_in_store: number;
  returned: number;
  user_stats: Array<{ id: string; name: string; count: number }>;
  server_time: string;
}

const ENTITY_LABEL: Record<EntityType, string> = {
  event: '행사',
  mice_customer: 'MICE 고객',
  wedding_customer: 'WEDDING 고객',
};

const ENTITY_ICON: Record<EntityType, string> = {
  event: '📅',
  mice_customer: '🏢',
  wedding_customer: '💍',
};

const ACTION_BADGE: Record<Action, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
};

const ACTION_LABEL: Record<Action, string> = {
  create: '생성',
  update: '수정',
  delete: '삭제',
};

const POLL_INTERVAL_MS = 8000;

function fmt(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function timeAgo(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 5000) return '방금';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}초 전`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전`;
  return `${Math.floor(ms / 86_400_000)}일 전`;
}

export default function ActivityLog() {
  const navigate = useNavigate();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterEntity, setFilterEntity] = useState<EntityType | ''>('');
  const [filterUser, setFilterUser] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0); // timeAgo 갱신용
  const newSinceRef = useRef<string | null>(null); // 마지막 fetch 의 server_time
  const [newCount, setNewCount] = useState(0); // 새 로그 개수 표시용

  const fetchData = useCallback(async (isPoll: boolean) => {
    try {
      const params = new URLSearchParams();
      if (filterEntity) params.set('entity_type', filterEntity);
      if (filterUser) params.set('user_id', filterUser);
      params.set('limit', '200');
      const res = await api.get<ActivityResponse>(
        `/api/admin/activity-log?${params.toString()}`
      );
      // 폴링 결과면 — 직전 fetch 의 마지막 timestamp 보다 늦은 로그 개수를 newCount 로
      if (isPoll && data && newSinceRef.current) {
        const sinceTs = newSinceRef.current;
        const newOnes = res.logs.filter((l) => l.changed_at > sinceTs).length;
        if (newOnes > 0) setNewCount((prev) => prev + newOnes);
      }
      setData(res);
      newSinceRef.current = res.server_time;
      setError(null);
    } catch (e) {
      setError('활동 로그를 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterEntity, filterUser, data]);

  // 초기 + 필터 변경 시 fetch
  useEffect(() => {
    setLoading(true);
    setNewCount(0);
    fetchData(false);
  }, [filterEntity, filterUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // 폴링
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => fetchData(true), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, fetchData]);

  // timeAgo 라벨용 1초마다 리렌더
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function navigateToEntity(entry: ActivityEntry) {
    if (entry.entity_deleted) {
      alert('이 항목은 삭제되었습니다. 휴지통(/admin/trash) 에서 복구 후 다시 시도하세요.');
      return;
    }
    if (entry.entity_type === 'event') {
      navigate(`/events?focus=${entry.entity_id}`);
    } else if (entry.entity_type === 'mice_customer') {
      navigate(`/customer/mice/${entry.entity_id}`);
    } else if (entry.entity_type === 'wedding_customer') {
      navigate(`/customer/wedding/${entry.entity_id}`);
    }
  }

  function resetNewCount() {
    setNewCount(0);
  }

  const visible = data?.logs || [];

  const lastUpdated = useMemo(() => {
    if (!data) return '';
    return timeAgo(data.server_time);
  }, [data]);

  return (
    <div className="max-w-6xl mx-auto pb-8">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">📜 활동 로그</h1>
          <p className="text-xs text-gray-500 mt-1">
            전체 사용자의 행사·고객 정보 수정 이력을 실시간으로 모니터링 (관리자 전용)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {newCount > 0 && (
            <button
              onClick={resetNewCount}
              className="badge bg-red-500 text-white animate-pulse"
              title="새 활동 확인"
            >
              새 활동 {newCount}건
            </button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            자동 새로고침 ({POLL_INTERVAL_MS / 1000}초)
          </label>
          <button
            onClick={() => {
              setLoading(true);
              fetchData(false);
            }}
            className="btn-secondary text-xs"
          >
            지금 새로고침
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-white border rounded-lg p-3 mb-4 flex items-center gap-3 text-xs flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">엔티티:</span>
          <select
            className="input !py-1 !text-xs !w-auto"
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value as EntityType | '')}
          >
            <option value="">전체</option>
            <option value="event">행사</option>
            <option value="mice_customer">MICE 고객</option>
            <option value="wedding_customer">WEDDING 고객</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">사용자:</span>
          <select
            className="input !py-1 !text-xs !w-auto"
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
          >
            <option value="">전체</option>
            {data?.user_stats.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.count}건)
              </option>
            ))}
          </select>
        </div>
        <span className="ml-auto text-gray-500">
          {data && (
            <>
              {data.total_filtered.toLocaleString('ko-KR')}건 (전체 {data.total_in_store.toLocaleString('ko-KR')}건) · 마지막 갱신{' '}
              <span className="text-gray-700">{lastUpdated}</span>
            </>
          )}
        </span>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {/* 로그 리스트 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center text-sm text-gray-400">불러오는 중...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">조건에 맞는 활동이 없습니다.</div>
        ) : (
          <ul className="divide-y">
            {visible.map((log) => {
              const hasDetail = !!(log.changes && log.changes.length > 0);
              const isOpen = expanded.has(log.id);
              return (
                <li key={log.id} className="text-sm">
                  <div
                    className={
                      'px-3 py-2.5 flex items-start gap-3 ' +
                      (hasDetail ? 'cursor-pointer hover:bg-gray-50' : '')
                    }
                    onClick={() => hasDetail && toggleExpand(log.id)}
                  >
                    {/* 시간 */}
                    <div className="text-xs text-gray-500 shrink-0 w-28 pt-0.5">
                      <div>{timeAgo(log.changed_at)}</div>
                      <div className="text-[10px] text-gray-400">{fmt(log.changed_at)}</div>
                    </div>
                    {/* 사용자 */}
                    <div className="text-xs font-medium text-gray-900 shrink-0 w-20 truncate pt-0.5">
                      {log.changed_by_name}
                    </div>
                    {/* 액션 badge */}
                    <span
                      className={`badge shrink-0 ${ACTION_BADGE[log.action] || 'bg-gray-100'}`}
                    >
                      {ACTION_LABEL[log.action]}
                    </span>
                    {/* 엔티티 (클릭 시 이동) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToEntity(log);
                      }}
                      className="text-left shrink-0 hover:underline disabled:no-underline"
                      disabled={log.entity_deleted}
                      title={log.entity_deleted ? '삭제됨' : '클릭하여 이동'}
                    >
                      <span className="text-xs text-gray-500">
                        {ENTITY_ICON[log.entity_type]} {ENTITY_LABEL[log.entity_type]}
                      </span>{' '}
                      <span
                        className={
                          'text-xs font-medium ' +
                          (log.entity_deleted ? 'text-gray-400 line-through' : 'text-blue-600')
                        }
                      >
                        {log.entity_name || '(이름 없음)'}
                      </span>
                    </button>
                    {/* summary */}
                    <span className="text-xs text-gray-700 flex-1 break-words">{log.summary}</span>
                    {hasDetail && (
                      <span className="text-xs text-gray-400 shrink-0">{isOpen ? '▲' : '▼'}</span>
                    )}
                  </div>
                  {hasDetail && isOpen && (
                    <div className="bg-gray-50 px-3 py-2 border-t">
                      <ul className="space-y-1 text-[11px]">
                        {log.changes!.map((c, i) => (
                          <li key={i} className="grid grid-cols-12 gap-2 items-start">
                            <div className="col-span-3 font-medium text-gray-700 truncate">
                              {c.field}
                            </div>
                            <div className="col-span-4 bg-red-50 border border-red-100 rounded px-1.5 py-1 text-red-800 break-words font-mono whitespace-pre-wrap">
                              {toDisplay(c.before)}
                            </div>
                            <div className="col-span-1 text-center text-gray-400 pt-1">→</div>
                            <div className="col-span-4 bg-green-50 border border-green-100 rounded px-1.5 py-1 text-green-800 break-words font-mono whitespace-pre-wrap">
                              {toDisplay(c.after)}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function toDisplay(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
