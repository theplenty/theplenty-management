import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';

// MICE 업체명 입력 중 — 유사 업체가 이미 등록되어 있는지 인라인 경고.
// 'editingId' 가 본인이면 자기 자신은 제외.

interface SimilarOrg {
  id: string;
  organization_name: string;
  normalized: string;
  score: number;
  match_type: 'exact_after_normalize' | 'substring' | 'levenshtein';
  distance?: number;
  event_count: number;
}

interface Props {
  name: string;
  editingId: string | null;
  onPickExisting?: (id: string) => void; // 클릭 시 부모가 기존 고객을 열도록
}

export default function SimilarOrgWarning({ name, editingId, onPickExisting }: Props) {
  const debounced = useDebouncedValue(name, 300);
  const [items, setItems] = useState<SimilarOrg[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // name 이 바뀌면 dismiss 리셋
  useEffect(() => {
    setDismissed(false);
  }, [name]);

  useEffect(() => {
    const q = (debounced || '').trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    let aborted = false;
    setLoading(true);
    api
      .get<{ similar: SimilarOrg[] }>(
        `/api/customers/mice/_similar-org?name=${encodeURIComponent(q)}&limit=5`
      )
      .then((res) => {
        if (aborted) return;
        // 본인은 제외
        const filtered = (res.similar || []).filter((x) => x.id !== editingId);
        setItems(filtered);
      })
      .catch((e) => {
        if (!aborted) {
          console.error('[SimilarOrgWarning]', e);
          setItems([]);
        }
      })
      .finally(() => {
        if (!aborted) setLoading(false);
      });
    return () => {
      aborted = true;
    };
  }, [debounced, editingId]);

  if (dismissed) return null;
  if (loading && items.length === 0) return null;
  if (!items.length) return null;

  // 가장 높은 score 가 1.0 (정규화 후 완전 일치) 이면 빨강, substring/levenshtein 이면 주황
  const topScore = items[0]?.score ?? 0;
  const isStrong = topScore >= 0.99;
  const color = isStrong
    ? 'bg-red-50 border-red-300 text-red-900'
    : 'bg-amber-50 border-amber-300 text-amber-900';
  const headerLabel = isStrong
    ? '⚠️ 동일한 업체가 이미 등록되어 있습니다'
    : '🔍 비슷한 업체가 이미 등록되어 있습니다';

  return (
    <div className={`mt-1.5 border rounded-md p-2.5 text-xs ${color}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold">
          {headerLabel} ({items.length}건)
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[11px] underline opacity-70 hover:opacity-100"
          title="이번 입력에서만 숨김"
        >
          닫기
        </button>
      </div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2">
            <span className="font-mono text-[10px] opacity-60 shrink-0">
              {Math.round(it.score * 100)}%
            </span>
            <button
              type="button"
              onClick={() => onPickExisting?.(it.id)}
              className="flex-1 text-left hover:underline truncate"
              title="이 업체로 이동 (모달에 열기)"
            >
              {it.organization_name}
              {it.event_count > 0 && (
                <span className="ml-1.5 badge bg-white/60 text-current border border-current/30 text-[10px]">
                  행사 {it.event_count}건
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[11px] opacity-80">
        같은 업체라면 위 항목 중 하나를 클릭하세요. 다른 업체라면 그대로 저장하면 됩니다.
      </div>
    </div>
  );
}
