import { useCallback, useMemo, useState } from 'react';

// 고객 목록 등에서 컬럼 숨기기/보이기 + 컬럼 클릭 정렬 상태를 localStorage에 보존.
// 페이지마다 storageKey를 다르게 주면 독립적으로 기억됨.

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string | null;
  dir: SortDir;
}

interface Options {
  storageKey: string;
  defaultHidden?: string[];
  // localStorage에 저장된 정렬이 없을 때 사용할 초기 정렬. 미지정이면 정렬 없음(서버 순서).
  defaultSort?: SortState;
}

export interface TableControls {
  hidden: Set<string>;
  sort: SortState;
  toggleHidden: (key: string) => void;
  setHiddenAll: (keys: string[]) => void;
  toggleSort: (key: string) => void;
  isHidden: (key: string) => boolean;
}

function readHidden(storageKey: string, fallback: string[]): Set<string> {
  try {
    const raw = localStorage.getItem(`${storageKey}.hidden`);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set(fallback);
}

function readSort(storageKey: string, fallback: SortState): SortState {
  try {
    const raw = localStorage.getItem(`${storageKey}.sort`);
    if (raw) {
      const parsed = JSON.parse(raw) as SortState;
      if (parsed.dir === 'asc' || parsed.dir === 'desc') return parsed;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function useTableControls({
  storageKey,
  defaultHidden = [],
  defaultSort = { key: null, dir: 'asc' },
}: Options): TableControls {
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(storageKey, defaultHidden));
  const [sort, setSort] = useState<SortState>(() => readSort(storageKey, defaultSort));

  const persistHidden = useCallback(
    (s: Set<string>) => {
      try {
        localStorage.setItem(`${storageKey}.hidden`, JSON.stringify([...s]));
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  );

  const persistSort = useCallback(
    (s: SortState) => {
      try {
        localStorage.setItem(`${storageKey}.sort`, JSON.stringify(s));
      } catch {
        /* ignore */
      }
    },
    [storageKey]
  );

  const toggleHidden = useCallback(
    (key: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistHidden(next);
        return next;
      });
    },
    [persistHidden]
  );

  const setHiddenAll = useCallback(
    (keys: string[]) => {
      const next = new Set(keys);
      persistHidden(next);
      setHidden(next);
    },
    [persistHidden]
  );

  // 정렬 토글: 같은 컬럼 클릭 시 asc → desc → 해제 순환. 다른 컬럼이면 asc부터.
  const toggleSort = useCallback(
    (key: string) => {
      setSort((prev) => {
        let next: SortState;
        if (prev.key !== key) next = { key, dir: 'asc' };
        else if (prev.dir === 'asc') next = { key, dir: 'desc' };
        else next = { key: null, dir: 'asc' };
        persistSort(next);
        return next;
      });
    },
    [persistSort]
  );

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  return useMemo(
    () => ({ hidden, sort, toggleHidden, setHiddenAll, toggleSort, isHidden }),
    [hidden, sort, toggleHidden, setHiddenAll, toggleSort, isHidden]
  );
}

// 정렬 값 비교 — null/undefined는 항상 뒤로.
export function compareSortValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir
): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // 빈 값은 항상 뒤
  if (bEmpty) return -1;
  let cmp = 0;
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
  else cmp = String(a).localeCompare(String(b), 'ko');
  return dir === 'asc' ? cmp : -cmp;
}
