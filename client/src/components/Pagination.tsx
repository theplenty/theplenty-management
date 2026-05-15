import { useEffect, useMemo, useState } from 'react';

export const PAGE_SIZE = 20;

interface Props {
  total: number;
  page: number;
  onChange: (page: number) => void;
}

// 20개 단위 페이지네이션. 페이지 인디케이터 + 이전/다음/처음/끝 버튼.
export default function Pagination({ total, page, onChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  const fromIdx = page * PAGE_SIZE + 1;
  const toIdx = Math.min((page + 1) * PAGE_SIZE, total);
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
      <span className="text-gray-500">
        {fromIdx.toLocaleString()}–{toIdx.toLocaleString()} / {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        {btn('«', page === 0, () => onChange(0))}
        {btn('‹', page === 0, () => onChange(page - 1))}
        <span className="px-2 text-gray-600">
          {page + 1} / {totalPages}
        </span>
        {btn('›', page >= totalPages - 1, () => onChange(page + 1))}
        {btn('»', page >= totalPages - 1, () => onChange(totalPages - 1))}
      </div>
    </div>
  );
}

// 20개씩 페이지 단위로 슬라이스 + 페이지 상태 관리.
// resetKeys 가 바뀌면 page 가 0 으로 리셋됨 (검색/필터/정렬 변경 시).
export function usePaginated<T>(items: T[], resetKeys: unknown[] = []) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetKeys);
  const pageItems = useMemo(
    () => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [items, page]
  );
  // total 이 줄어들어 page 가 범위를 벗어나면 자동 보정
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [items.length, page]);
  return { page, setPage, pageItems };
}
