import { useEffect, useMemo, useState } from 'react';

// 페이지당 표시 개수 — 20개 단위로 선택 가능. 기본 40개.
export const PAGE_SIZE_OPTIONS = [40, 60, 80, 100] as const;
export const DEFAULT_PAGE_SIZE = 40;

interface Props {
  total: number;
  page: number;
  onChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}

// 페이지 크기 선택(40/60/80/100) + 페이지 인디케이터 + 이전/다음/처음/끝 버튼.
export default function Pagination({ total, page, onChange, pageSize, onPageSizeChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 가장 작은 페이지 크기보다 적으면 페이지네이션·선택기 자체가 불필요.
  if (total <= PAGE_SIZE_OPTIONS[0]) return null;
  const fromIdx = page * pageSize + 1;
  const toIdx = Math.min((page + 1) * pageSize, total);
  const btn = (label: string, disabled: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 border rounded text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center justify-between mt-3 text-xs flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">
          {fromIdx.toLocaleString()}–{toIdx.toLocaleString()} / {total.toLocaleString()}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="border rounded px-1.5 py-1 text-xs text-gray-700 bg-white"
          aria-label="페이지당 표시 개수"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}개씩
            </option>
          ))}
        </select>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          {btn('«', page === 0, () => onChange(0))}
          {btn('‹', page === 0, () => onChange(page - 1))}
          <span className="px-2 text-gray-600">
            {page + 1} / {totalPages}
          </span>
          {btn('›', page >= totalPages - 1, () => onChange(page + 1))}
          {btn('»', page >= totalPages - 1, () => onChange(totalPages - 1))}
        </div>
      )}
    </div>
  );
}

// 페이지 단위로 슬라이스 + 페이지/페이지크기 상태 관리.
// resetKeys 가 바뀌면 page 가 0 으로 리셋됨 (검색/필터/정렬 변경 시).
export function usePaginated<T>(items: T[], resetKeys: unknown[] = []) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGE_SIZE);
  useEffect(() => {
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetKeys);
  const pageItems = useMemo(
    () => items.slice(page * pageSize, (page + 1) * pageSize),
    [items, page, pageSize]
  );
  // total 이 줄어들어 page 가 범위를 벗어나면 자동 보정
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [items.length, page, pageSize]);
  // 페이지 크기 변경 시 첫 페이지로 이동.
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(0);
  };
  return { page, setPage, pageItems, pageSize, setPageSize };
}
