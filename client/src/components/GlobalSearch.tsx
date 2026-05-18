import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';

// 전역 검색 — 모든 페이지의 헤더에 노출.
// 모바일: 풀스크린 오버레이 (탭하기 쉬운 큰 결과 카드).
// 데스크탑: 가운데 드롭다운 패널.
// 단축키: Cmd/Ctrl+K → 포커스 진입.

interface SearchItem {
  id: string;
  label: string;
  subtitle: string;
  event_count?: number;
  matched: string[];
}

interface SearchResponse {
  query: string;
  took_ms: number;
  wedding: SearchItem[];
  mice: SearchItem[];
  events: SearchItem[];
  total: number;
}

type GroupKey = 'wedding' | 'mice' | 'events';

interface GroupDef {
  key: GroupKey;
  label: string;
  icon: string;
  href: (id: string) => string;
}

const GROUP_DEFS: GroupDef[] = [
  // 고객 검색 결과 → 통합 프로필 페이지 (풀스크린 읽기 뷰 + 연결 행사 + 활동 타임라인)
  { key: 'wedding', label: 'WEDDING 고객', icon: '💍', href: (id) => `/customer/wedding/${id}` },
  { key: 'mice', label: 'MICE 고객', icon: '🏢', href: (id) => `/customer/mice/${id}` },
  // 행사 검색 결과 → 행사목록에서 해당 행사 모달 자동 오픈
  { key: 'events', label: '행사', icon: '📅', href: (id) => `/events?focus=${id}` },
];

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 200);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // 모든 결과를 평탄화 — 키보드 네비용
  const flat = useMemo(() => {
    if (!results) return [] as Array<{ group: GroupDef; item: SearchItem }>;
    const arr: Array<{ group: GroupDef; item: SearchItem }> = [];
    for (const g of GROUP_DEFS) {
      for (const item of results[g.key]) arr.push({ group: g, item });
    }
    return arr;
  }, [results]);

  // Cmd/Ctrl+K — 어디서든 포커스
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 열릴 때 input 자동 포커스
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // 검색 fetch
  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setResults(null);
      return;
    }
    let aborted = false;
    setLoading(true);
    api
      .get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (!aborted) {
          setResults(res);
          setActiveIdx(0);
        }
      })
      .catch((e) => {
        if (!aborted) {
          console.error('[GlobalSearch]', e);
          setResults(null);
        }
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [debounced]);

  function close() {
    setOpen(false);
    setQuery('');
    setResults(null);
  }

  function go(href: string) {
    close();
    navigate(href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flat[activeIdx];
      if (target) go(target.group.href(target.item.id));
    } else if (e.key === 'Escape') {
      close();
    }
  }

  return (
    <>
      {/* 헤더 트리거 — 모바일/PC 모두 "전체 검색" 텍스트 노출 (모바일은 아이콘+짧은 텍스트, PC 는 폭 넓게) */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500 text-sm h-9 w-full md:w-72"
        title="전체 검색 (Ctrl+K)"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
        <span className="truncate">전체 검색…</span>
        <kbd className="hidden md:inline ml-auto text-[10px] bg-gray-100 border border-gray-300 rounded px-1 text-gray-500">
          Ctrl K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex md:items-start md:pt-20 md:justify-center"
          onClick={close}
        >
          <div
            className="bg-white w-full md:max-w-2xl md:rounded-lg md:shadow-2xl flex flex-col md:max-h-[80vh] h-full md:h-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 입력 헤더 */}
            <div className="flex items-center gap-2 px-3 py-3 border-b">
              <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="이름 · 전화 · 이메일 · 업체 · 행사명…"
                className="flex-1 text-base outline-none placeholder:text-gray-400 min-w-0"
                autoFocus
                autoComplete="off"
              />
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-700 text-sm px-2 py-1 shrink-0"
                title="닫기"
              >
                ✕
              </button>
            </div>

            {/* 결과 */}
            <div className="flex-1 overflow-y-auto">
              {!query.trim() ? (
                <div className="p-6 text-center text-sm text-gray-400">
                  <p>이름·전화 뒷자리·이메일·업체명·행사명 어떤 것이든 입력하세요.</p>
                  <p className="text-xs mt-2 text-gray-300">
                    초성 검색 가능 (예: <code>ㄱㅁ</code>) · 전화 뒷자리 4자리만으로 매칭
                  </p>
                </div>
              ) : loading && !results ? (
                <div className="p-6 text-center text-sm text-gray-400">검색 중...</div>
              ) : results && results.total === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">
                  <p>&quot;{results.query}&quot; 에 대한 결과가 없습니다.</p>
                  <p className="text-xs mt-2 text-gray-300">
                    철자·띄어쓰기를 확인하거나 일부만 입력해 보세요.
                  </p>
                </div>
              ) : results ? (
                <div className="divide-y">
                  {GROUP_DEFS.map((g) => {
                    const items = results[g.key];
                    if (!items.length) return null;
                    return (
                      <div key={g.key} className="py-1">
                        <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
                          {g.icon} {g.label} ({items.length})
                        </div>
                        <ul>
                          {items.map((item) => {
                            const flatIndex = flat.findIndex(
                              (f) => f.group.key === g.key && f.item.id === item.id
                            );
                            const active = flatIndex === activeIdx;
                            return (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  onClick={() => go(g.href(item.id))}
                                  onMouseEnter={() => setActiveIdx(flatIndex)}
                                  className={
                                    'w-full text-left px-3 py-3 md:py-2 hover:bg-blue-50 active:bg-blue-100 flex items-center gap-3 ' +
                                    (active ? 'bg-blue-50' : '')
                                  }
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm text-gray-900 truncate">
                                      {item.label}
                                    </div>
                                    {item.subtitle && (
                                      <div className="text-xs text-gray-500 truncate">
                                        {item.subtitle}
                                      </div>
                                    )}
                                  </div>
                                  {typeof item.event_count === 'number' && item.event_count > 0 && (
                                    <span className="badge bg-emerald-100 text-emerald-800 shrink-0">
                                      행사 {item.event_count}건
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* 하단 힌트 (데스크탑만 표시) */}
            <div className="hidden md:flex items-center gap-3 px-3 py-2 border-t bg-gray-50 text-[11px] text-gray-500">
              <span>↑↓ 이동</span>
              <span>↵ 선택</span>
              <span>ESC 닫기</span>
              {results && (
                <span className="ml-auto">
                  {results.total}건 · {results.took_ms}ms
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
