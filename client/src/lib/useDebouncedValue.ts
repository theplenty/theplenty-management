import { useEffect, useState } from 'react';

// 입력값이 짧은 시간 동안 변하지 않을 때만 결과값을 갱신.
// 예: 검색창에서 사용자가 타이핑 중일 때 1글자마다 fuzzy match 돌리지 않도록.
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
