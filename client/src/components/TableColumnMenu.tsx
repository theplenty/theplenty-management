import { useEffect, useRef, useState } from 'react';

// 표 위쪽에 두는 "컬럼 설정" 드롭다운 — 각 컬럼의 표시/숨김을 토글.

export interface ColumnMeta {
  key: string;
  label: string;
}

interface Props {
  columns: ColumnMeta[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  onReset?: () => void;
}

export default function TableColumnMenu({ columns, hidden, onToggle, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hiddenCount = columns.filter((c) => hidden.has(c.key)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50 inline-flex items-center gap-1.5"
        title="컬럼 표시/숨김"
      >
        <span>⚙</span>
        <span>컬럼 설정{hiddenCount > 0 ? ` (${hiddenCount} 숨김)` : ''}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-white border rounded-md shadow-lg p-2 min-w-[200px] max-h-[60vh] overflow-y-auto">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1 px-1">
            표시할 컬럼
          </div>
          {columns.map((c) => {
            const checked = !hidden.has(c.key);
            return (
              <label
                key={c.key}
                className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(c.key)}
                />
                <span className={checked ? 'text-gray-900' : 'text-gray-400'}>{c.label}</span>
              </label>
            );
          })}
          {onReset && (
            <button
              type="button"
              onClick={() => {
                onReset();
                setOpen(false);
              }}
              className="mt-1 w-full text-left px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
            >
              ↻ 모두 보이기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
