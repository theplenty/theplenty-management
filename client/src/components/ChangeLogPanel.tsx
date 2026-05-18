import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ChangeLog, ChangeLogEntityType } from '../types';

interface Props {
  entityType: ChangeLogEntityType;
  entityId: string | null; // null이면 fetch 안 함 (신규 등록 모드)
  refreshKey?: number; // 외부에서 변경 후 강제 reload
}

const ACTION_BADGE: Record<string, string> = {
  create: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
};

const ACTION_LABEL: Record<string, string> = {
  create: '생성',
  update: '수정',
  delete: '삭제',
};

function fmt(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// before/after 가 객체/배열인 경우 — JSX 에 그대로 박으면 React error #31 ("Objects are not valid
// as a React child") 로 페이지 전체가 백지가 됨. 안전하게 문자열화.
function toDisplay(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// 요약 라벨 — 우선 changes[] 에서 field 만 추출, 없으면 summary 그대로.
function shortSummary(l: ChangeLog): string {
  if (l.changes && l.changes.length > 0) {
    const labels = l.changes.map((c) => c.field);
    if (labels.length > 6) return labels.slice(0, 6).join(', ') + ` 외 ${labels.length - 6}개`;
    return labels.join(', ');
  }
  return l.summary;
}

export default function ChangeLogPanel({ entityType, entityId, refreshKey }: Props) {
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!entityId) {
      setLogs([]);
      return;
    }
    setLoading(true);
    const path =
      entityType === 'mice_customer'
        ? `/api/customers/mice/${entityId}/logs`
        : entityType === 'wedding_customer'
          ? `/api/customers/wedding/${entityId}/logs`
          : `/api/events/${entityId}/logs`;
    api
      .get<{ logs: ChangeLog[] }>(path)
      .then((res) => setLogs(res.logs))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [entityType, entityId, refreshKey]);

  if (!entityId) return null;

  const last = logs[0];

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="border rounded-md mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs bg-gray-50 hover:bg-gray-100"
      >
        <span className="text-gray-600">
          📋 수정 이력 {logs.length > 0 && `(${logs.length})`}
          {last && (
            <span className="ml-2 text-gray-400">
              · 최종 {last.changed_by_name}, {fmt(last.changed_at)}
            </span>
          )}
        </span>
        <span className="text-gray-400">{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {open && (
        <div className="p-2 max-h-72 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-gray-400 px-2 py-3">불러오는 중...</div>
          ) : logs.length === 0 ? (
            <div className="text-xs text-gray-400 px-2 py-3">기록이 없습니다.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {logs.map((l) => {
                const isOpen = expanded.has(l.id);
                const hasDetail = !!(l.changes && l.changes.length > 0);
                return (
                  <li key={l.id} className="border rounded">
                    <button
                      type="button"
                      onClick={() => hasDetail && toggleRow(l.id)}
                      className={
                        'w-full text-left flex items-center gap-2 px-2 py-1.5 ' +
                        (hasDetail ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default')
                      }
                    >
                      <span className="text-gray-400 shrink-0">{fmt(l.changed_at)}</span>
                      <span className="text-gray-300">/</span>
                      <span className="font-medium text-gray-800 shrink-0">{l.changed_by_name}</span>
                      <span className="text-gray-300">/</span>
                      <span className={`badge ${ACTION_BADGE[l.action] || 'bg-gray-100'} shrink-0`}>
                        {ACTION_LABEL[l.action] || l.action}
                      </span>
                      <span className="text-gray-700 truncate flex-1">{shortSummary(l)}</span>
                      {hasDetail && (
                        <span className="text-gray-400 shrink-0">{isOpen ? '▲' : '▼'}</span>
                      )}
                    </button>
                    {hasDetail && isOpen && (
                      <div className="border-t bg-gray-50/60 px-3 py-2">
                        <ul className="space-y-1.5">
                          {l.changes!.map((c, idx) => (
                            <li
                              key={idx}
                              className="grid grid-cols-12 gap-2 items-start text-[11px]"
                            >
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
      )}
    </div>
  );
}
