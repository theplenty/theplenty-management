import { useEffect, useState } from 'react';
import { weekdayKoOf } from '../lib/dateFmt';
import Modal from './Modal';
import { Field } from './Field';
import { api } from '../lib/api';
import type { CalendarShare } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_OPTIONS: Array<CalendarShare['event_type_filter']> = ['ALL', 'MICE', 'WEDDING'];

export default function ShareCalendarModal({ open, onClose }: Props) {
  const [shares, setShares] = useState<CalendarShare[]>([]);
  const [loading, setLoading] = useState(false);

  // 폼 상태
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [label, setLabel] = useState('');
  const [typeFilter, setTypeFilter] = useState<CalendarShare['event_type_filter']>('ALL');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ shares: CalendarShare[] }>('/api/calendar-shares');
      setShares(res.shares);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function create() {
    setCreating(true);
    try {
      const res = await api.post<{ share: CalendarShare }>('/api/calendar-shares', {
        year,
        month,
        label: label || `${year}년 ${month}월`,
        event_type_filter: typeFilter,
      });
      setShares((prev) => [...prev, res.share]);
      setLabel('');
    } catch (e) {
      alert('생성 실패');
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  async function remove(s: CalendarShare) {
    if (!confirm(`[${s.label}] 공유 링크를 삭제하시겠습니까?\n외부에 공유한 URL은 즉시 무효화됩니다.`)) return;
    try {
      await api.delete(`/api/calendar-shares/${s.id}`);
      setShares((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      alert('삭제 실패');
      console.error(e);
    }
  }

  function shareUrl(token: string): string {
    return `${window.location.origin}/public/calendar/${token}`;
  }

  async function copyUrl(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      alert('공유 URL이 복사되었습니다.');
    } catch {
      prompt('URL을 직접 복사하세요:', shareUrl(token));
    }
  }

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="월별 캘린더 공유 링크"
      widthClass="max-w-3xl"
      footer={
        <button onClick={onClose} className="btn-secondary">
          닫기
        </button>
      }
    >
      <div className="text-sm text-gray-600 mb-4">
        외부 업체에 특정 월의 캘린더만 공유하기 위한 링크입니다. 링크 보유자는 해당 월
        캘린더만 볼 수 있고, <strong>다른 달 이동·행사 상세 조회는 불가</strong>합니다. LOS
        취소 행사는 외부 공유에서 자동 제외됩니다.
      </div>

      <div className="border rounded-md p-4 mb-5 bg-gray-50/60">
        <div className="text-sm font-semibold mb-3">신규 공유 링크 생성</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="연도">
            <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="월">
            <select
              className="input"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
          </Field>
          <Field label="행사 유형 필터">
            <select
              className="input"
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as CalendarShare['event_type_filter'])
              }
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === 'ALL' ? '전체' : t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="메모 (선택)">
            <input
              className="input"
              placeholder="ABC 케이터링용"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-3">
          <button onClick={create} disabled={creating} className="btn-primary">
            {creating ? '생성중...' : '+ 공유 링크 생성'}
          </button>
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">기존 공유 링크</div>
        {loading ? (
          <div className="text-xs text-gray-400 py-4">불러오는 중...</div>
        ) : shares.length === 0 ? (
          <div className="text-xs text-gray-400 py-4">아직 생성된 링크가 없습니다.</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="text-left px-3 py-2">대상 월</th>
                  <th className="text-left px-3 py-2">필터</th>
                  <th className="text-left px-3 py-2">메모</th>
                  <th className="text-left px-3 py-2">생성일</th>
                  <th className="text-left px-3 py-2">URL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shares
                  .slice()
                  .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
                  .map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2">
                        {s.year}년 {s.month}월
                      </td>
                      <td className="px-3 py-2">
                        {s.event_type_filter === 'ALL' ? '전체' : s.event_type_filter}
                      </td>
                      <td className="px-3 py-2">{s.label}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(s.created_at).toLocaleDateString('ko-KR')} ({weekdayKoOf(new Date(s.created_at))})
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <code className="text-[11px] break-all text-gray-700">
                          /public/calendar/{s.token}
                        </code>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => copyUrl(s.token)}
                          className="text-blue-600 hover:underline text-xs mr-2"
                        >
                          URL 복사
                        </button>
                        <button
                          onClick={() => remove(s)}
                          className="text-red-600 hover:underline text-xs"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
