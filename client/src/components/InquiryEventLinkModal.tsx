// 문의 ↔ 행사 연결 모달 (S2)
//
// 세일즈가 "이 문의는 이 행사가 됐다" 를 짚어주는 자리. 서버가 후보를 점수순으로 제안하고
// (이 고객에 연결된 행사 / 행사예정일 근접 / 행사명에 업체명 포함), 확정인데 행사가 아직
// 없으면 여기서 바로 만들어 연결한다.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { weekdayKoOf } from '../lib/dateFmt';
import type { MiceCustomer, MiceInquiry } from '../types';

interface Candidate {
  id: string;
  event_name: string;
  status: string;
  start_datetime: string;
  halls: string[];
  gateway_fee: number | null;
  already_linked: boolean;
  reasons: string[];
}

interface Props {
  customerId: string;
  customerName: string;
  inquiry: MiceInquiry;
  inquiryNo: number;
  onClose: () => void;
  /**
   * 연결·해제·생성 결과. 서버가 돌려준 고객을 함께 넘긴다 —
   * 편집 창에 저장 안 된 수정이 남아 있어도 링크 필드만 골라 동기화해야
   * 다음 저장이 링크를 지우지 않는다.
   */
  onLinked: (msg: string, customer: MiceCustomer) => void;
}

function fmtDay(s: string): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} (${weekdayKoOf(d)}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function InquiryEventLinkModal({
  customerId,
  customerName,
  inquiry,
  inquiryNo,
  onClose,
  onLinked,
}: Props) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [guessed, setGuessed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState(customerName);

  const base = `/api/customers/mice/${customerId}/inquiries/${inquiry.id}`;

  useEffect(() => {
    api
      .get<{ candidates: Candidate[]; guessed_date: string | null }>(`${base}/event-candidates`)
      .then((r) => {
        setCands(r.candidates);
        setGuessed(r.guessed_date);
        setNewDate(r.guessed_date ? `${r.guessed_date}T09:00` : '');
      })
      .catch((e) => setErr(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, inquiry.id]);

  const link = async (eventId: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ customer: MiceCustomer; pushed: { filled: string[]; amount: number }[] }>(
        `${base}/link`,
        { event_id: eventId },
      );
      const filled = r.pushed?.find((p) => p.filled.length);
      onLinked(filled ? `연결 완료 — 매출에 ${filled.filled.join(', ')} 반영됨` : '행사 연결 완료', r.customer);
      onClose();
    } catch (e) {
      setErr((e as { payload?: { error?: string } })?.payload?.error || String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!window.confirm('행사 연결을 해제할까요?\n(이미 반영된 매출 값은 그대로 남습니다)')) return;
    setBusy(true);
    try {
      const r = await api.delete<{ customer: MiceCustomer }>(`${base}/link`);
      onLinked('연결 해제됨', r.customer);
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const createEvent = async () => {
    if (!newDate) return setErr('행사 일시를 입력하세요.');
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ customer: MiceCustomer; pushed: { filled: string[] }[] }>(
        `${base}/create-event`,
        { start_datetime: new Date(newDate).toISOString(), event_name: newName },
      );
      const filled = r.pushed?.find((p) => p.filled.length);
      onLinked(
        filled
          ? `행사 생성·연결 완료 — 매출에 ${filled.filled.join(', ')} 반영됨`
          : '행사 생성·연결 완료 (캘린더에서 홀·시간을 채워주세요)',
        r.customer,
      );
      onClose();
    } catch (e) {
      setErr((e as { payload?: { error?: string } })?.payload?.error || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <div className="font-semibold">행사 연결 — 문의 #{inquiryNo}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {customerName}
              {inquiry.inquiry_event_date_text ? ` · 예정일 "${inquiry.inquiry_event_date_text}"` : ''}
              {guessed ? ` → ${guessed} 로 인식` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">
            ×
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {err && <div className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{err}</div>}

          {inquiry.linked_event_id && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
              <span className="text-sm">
                현재 연결됨
                {inquiry.linked_by_name ? ` · ${inquiry.linked_by_name}` : ''}
                {inquiry.revenue_pushed_at ? ' · 매출 반영 완료' : ''}
              </span>
              <button type="button" className="btn-xs" disabled={busy} onClick={unlink}>
                연결 해제
              </button>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              후보 행사 {cands ? `(${cands.length})` : ''}
            </div>
            {cands === null && <div className="text-sm text-gray-400 py-4">불러오는 중...</div>}
            {cands && !cands.length && (
              <div className="text-sm text-gray-500 py-3">
                조건에 맞는 행사가 없습니다. 아래에서 새로 만들어 연결하세요.
              </div>
            )}
            <div className="space-y-2">
              {(cands || []).map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center justify-between rounded border px-3 py-2 ${
                    c.already_linked ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {c.event_name || '(행사명 없음)'}{' '}
                      <span className="text-xs font-normal text-gray-500">{c.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {fmtDay(c.start_datetime)}
                      {c.halls?.length ? ` · ${c.halls.join(' / ')}` : ''}
                      {c.gateway_fee ? ` · 대관료 ${Number(c.gateway_fee).toLocaleString()}원 입력됨` : ''}
                    </div>
                    <div className="text-[11px] text-blue-600 mt-0.5">{c.reasons.join(' · ')}</div>
                  </div>
                  {c.already_linked ? (
                    <span className="text-xs text-emerald-700 font-semibold shrink-0 ml-3">연결됨</span>
                  ) : (
                    <button
                      type="button"
                      className="btn-xs border-blue-600 bg-blue-600 text-white hover:bg-blue-700 shrink-0 ml-3"
                      disabled={busy}
                      onClick={() => link(c.id)}
                    >
                      연결
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              또는 새 행사 만들어 연결
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-gray-600">
                행사명
                <input className="input mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </label>
              <label className="text-xs text-gray-600">
                일시
                <input
                  type="datetime-local"
                  className="input mt-1"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
              </label>
              <button type="button" className="btn-xs border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy} onClick={createEvent}>
                만들고 연결
              </button>
            </div>
            <div className="text-[11px] text-gray-400 mt-1.5">
              확정(DEF) 상태로 생성됩니다. 홀·시간·식음 인원은 캘린더에서 이어서 입력하세요.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
