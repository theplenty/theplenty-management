// 문의 ↔ 행사 연결 모달 (S2)
//
// 세일즈가 "이 문의는 이 행사가 됐다" 를 짚어주는 자리. 서버가 후보를 점수순으로 제안하고
// (이 고객에 연결된 행사 / 행사예정일 근접 / 행사명에 업체명 포함), 확정인데 행사가 아직
// 없으면 여기서 바로 만들어 연결한다.
import { useCallback, useEffect, useState } from 'react';
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
  /** 이 행사의 계약금 원본을 쥔 다른 업체 문의 — 있으면 이 연결은 '참조'가 된다 */
  deposit_owner: { org: string; inquiry_no: number } | null;
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
  const [search, setSearch] = useState('');
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState(customerName);

  const base = `/api/customers/mice/${customerId}/inquiries/${inquiry.id}`;

  // 후보 조회 — q 를 주면 추천 대신 검색 결과를 받는다 (추천에 안 걸리는 행사를 직접 찾을 때)
  const load = useCallback(
    (q?: string) => {
      setCands(null);
      const url = `${base}/event-candidates` + (q ? `?q=${encodeURIComponent(q)}` : '');
      api
        .get<{ candidates: Candidate[]; guessed_date: string | null; searched?: boolean }>(url)
        .then((r) => {
          setCands(r.candidates);
          setSearched(!!r.searched);
          setGuessed(r.guessed_date);
          if (!q) setNewDate(r.guessed_date ? `${r.guessed_date}T09:00` : '');
        })
        .catch((e) => setErr(String(e)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base],
  );
  useEffect(() => { load(); }, [load]);

  // 타이핑이 멎으면 검색 (비우면 추천으로 복귀)
  useEffect(() => {
    const t = setTimeout(() => load(search.trim() || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const link = async (eventId: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{
        customer: MiceCustomer;
        pushed: { filled: string[]; amount: number }[];
        link_role?: 'primary' | 'secondary';
        owner_org?: string | null;
        owner_inquiry_no?: number | null;
      }>(`${base}/link`, { event_id: eventId });
      const filled = r.pushed?.find((p) => p.filled.length);
      onLinked(
        r.link_role === 'secondary'
          ? `참조 연결 완료 — 계약금·매출은 ${r.owner_org || '다른 업체'} 문의 #${r.owner_inquiry_no || '?'} 에서 관리됩니다`
          : filled
            ? `연결 완료 — 매출에 ${filled.filled.join(', ')} 반영됨`
            : '행사 연결 완료',
        r.customer,
      );
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
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {searched ? '검색 결과' : '추천 후보'} {cands ? `(${cands.length})` : ''}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  className="input text-sm py-1"
                  style={{ width: 240 }}
                  placeholder="행사명 또는 날짜로 검색 (예: 송년회, 2026-12, 12/20)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" className="btn-xs" onClick={() => setSearch('')}>
                    추천으로
                  </button>
                )}
              </div>
            </div>
            {cands === null && <div className="text-sm text-gray-400 py-4">불러오는 중...</div>}
            {cands && !cands.length && (
              <div className="text-sm text-gray-500 py-3">
                {searched
                  ? '검색 결과가 없습니다. 다른 말로 찾아보거나, 아래에서 새로 만들어 연결하세요.'
                  : '추천할 후보가 없습니다. 위에서 검색하거나, 아래에서 새로 만들어 연결하세요.'}
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
                    {/* 다른 업체 문의가 계약금 원본인 행사 — 연결은 되지만 '참조'가 됨을 미리 알린다.
                        한 행사에 주최사·대행사 등 여러 컨택포인트가 붙는 실무 때문(2026-08-26). */}
                    {c.deposit_owner && !c.already_linked && (
                      <div className="text-[11px] text-amber-700 mt-0.5">
                        💰 계약금은 <b>{c.deposit_owner.org}</b> 문의 #{c.deposit_owner.inquiry_no} 에서 관리 중 —
                        여기서는 <b>참조 연결</b>됩니다 (이 문의의 계약금은 매출로 반영되지 않음)
                      </div>
                    )}
                  </div>
                  {c.already_linked ? (
                    <span className="text-xs text-emerald-700 font-semibold shrink-0 ml-3">연결됨</span>
                  ) : (
                    <button
                      type="button"
                      className={
                        'btn-xs shrink-0 ml-3 ' +
                        (c.deposit_owner
                          ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                          : 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700')
                      }
                      disabled={busy}
                      onClick={() => link(c.id)}
                    >
                      {c.deposit_owner ? '참조 연결' : '연결'}
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
