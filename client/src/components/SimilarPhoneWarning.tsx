import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useDebouncedValue } from '../lib/useDebouncedValue';

// WEDDING 전화번호 입력 중 — 동일 전화번호의 기존 고객이 있는지 inline 경고.
// MICE 의 SimilarOrgWarning 과 짝이 되는 컴포넌트.

interface SimilarMatch {
  id: string;
  wedding_event_name: string;
  groom_name: string;
  bride_name: string;
  matched_party: 'groom' | 'bride';
  matched_phone: string;
  event_count: number;
}

interface Props {
  phone: string; // 신랑 또는 신부 전화번호
  party: '신랑' | '신부';
  editingId: string | null;
  onPickExisting?: (id: string) => void;
}

export default function SimilarPhoneWarning({ phone, party, editingId, onPickExisting }: Props) {
  const debounced = useDebouncedValue(phone, 300);
  const [items, setItems] = useState<SimilarMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [phone]);

  useEffect(() => {
    const q = (debounced || '').replace(/\D/g, '');
    // 최소 4자리 (뒷번호) 이상일 때만 검색
    if (q.length < 4) {
      setItems([]);
      return;
    }
    let aborted = false;
    setLoading(true);
    api
      .get<{ similar: SimilarMatch[] }>(
        `/api/customers/wedding/_similar-phone?phone=${encodeURIComponent(q)}&limit=5`
      )
      .then((res) => {
        if (aborted) return;
        const filtered = (res.similar || []).filter((x) => x.id !== editingId);
        setItems(filtered);
      })
      .catch((e) => {
        if (!aborted) {
          console.error('[SimilarPhoneWarning]', e);
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

  if (dismissed || (loading && items.length === 0) || !items.length) return null;

  return (
    <div className="mt-1.5 border rounded-md p-2.5 text-xs bg-red-50 border-red-300 text-red-900">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold">
          ⚠️ 동일한 {party} 전화번호의 고객이 이미 등록되어 있습니다 ({items.length}건)
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
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onPickExisting?.(it.id)}
              className="w-full text-left hover:underline truncate"
            >
              <span className="font-semibold">{it.wedding_event_name || '(이름 없음)'}</span>
              <span className="text-red-700"> · {it.groom_name} ♥ {it.bride_name}</span>
              <span className="text-red-600"> · {it.matched_party === 'groom' ? '신랑' : '신부'} {it.matched_phone}</span>
              {it.event_count > 0 && (
                <span className="ml-1.5 badge bg-white/60 border border-red-300 text-[10px]">
                  행사 {it.event_count}건
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[11px] opacity-80">
        같은 분이면 위 항목 중 하나를 클릭하여 기존 고객에 새 문의를 추가하세요.
      </div>
    </div>
  );
}
