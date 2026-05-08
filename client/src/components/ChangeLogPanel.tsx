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

export default function ChangeLogPanel({ entityType, entityId, refreshKey }: Props) {
  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

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
        <div className="p-3 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-gray-400">불러오는 중...</div>
          ) : logs.length === 0 ? (
            <div className="text-xs text-gray-400">기록이 없습니다.</div>
          ) : (
            <ul className="space-y-2 text-xs">
              {logs.map((l) => (
                <li key={l.id} className="border-b last:border-b-0 pb-2 last:pb-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`badge ${ACTION_BADGE[l.action] || 'bg-gray-100'}`}>
                      {ACTION_LABEL[l.action] || l.action}
                    </span>
                    <span className="font-medium text-gray-800">{l.changed_by_name}</span>
                    <span className="text-gray-400">{fmt(l.changed_at)}</span>
                  </div>
                  <div className="text-gray-600 pl-1">{l.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
