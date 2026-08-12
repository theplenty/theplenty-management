// MICE 콜 트래커 — 별도 사이트로 쓰던 문의 트래커를 흡수한 화면.
//
// 세일즈팀이 매일 보는 건 메모가 아니라 **네 개 체크와 콜백 기한**이다.
// 그래서 목록에서 바로 보이고 바로 눌러 바꿀 수 있게 했다. 모달을 열게 하면 안 쓴다.
//
// 탭은 쓰던 그대로 유지한다(문의/보류/확정/취소). 화면이 바뀌면 사람이 헤매기 때문.
// 내부 상태값 대응: 문의=단순문의 · 보류=INQ · 확정=DEF · 취소=LOS
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { canWriteMice } from '../auth/permissions';
import { todayKst, fmtDateW } from '../lib/dateFmt';
import type { MiceCustomer, MiceInquiry, MiceInquiryStatus } from '../types';

// 탭 ↔ 내부 상태값. 트래커의 '문의' 는 우리 INQ 가 아니라 '단순문의' 다 (글자만 보고 옮기면 안 된다).
const TABS: { key: string; label: string; status: MiceInquiryStatus }[] = [
  { key: 'inq', label: '문의 리스트', status: '단순문의' },
  { key: 'hold', label: '보류 콜 예정', status: 'INQ' },
  { key: 'def', label: '확정', status: 'DEF' },
  { key: 'los', label: '취소', status: 'LOS' },
];

const CHECKS: { key: keyof MiceInquiry; label: string }[] = [
  { key: 'quote_sent', label: '견적서' },
  { key: 'contract_sent', label: '계약서' },
  { key: 'contract_replied', label: '회신됨' },
  { key: 'deposit_paid', label: '계약금' },
];

interface Row {
  customer: MiceCustomer;
  inquiry: MiceInquiry;
}

/** 남은 일수 — 음수면 기한 지남 */
function daysLeft(due?: string | null): number | null {
  if (!due) return null;
  const t = new Date(`${todayKst()}T00:00:00`).getTime();
  const d = new Date(`${due}T00:00:00`).getTime();
  if (isNaN(d)) return null;
  return Math.round((d - t) / 86400000);
}

function DdayChip({ due }: { due?: string | null }) {
  const n = daysLeft(due);
  if (n === null) return <span className="text-xs text-gray-300">–</span>;
  const style =
    n < 0 ? 'bg-red-100 text-red-800'
      : n === 0 ? 'bg-red-600 text-white'
        : n <= 2 ? 'bg-amber-100 text-amber-800'
          : 'bg-gray-100 text-gray-600';
  const text = n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `D-${n}`;
  return <span className={`text-xs px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${style}`}>{text}</span>;
}

export default function Calls() {
  const { user } = useAuth();
  const canWrite = canWriteMice(user?.role);
  const [customers, setCustomers] = useState<MiceCustomer[]>([]);
  const [tab, setTab] = useState('inq');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  // 고객 DB 전체 문의는 1,000건이 넘는다. 트래커는 "지금 굴리고 있는 콜"만 보는 화면이라
  // 콜백 날짜가 잡힌 건만 기본으로 보여준다. 옛 문의까지 다 나오면 못 쓴다.
  const [onlyTracked, setOnlyTracked] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ customers: MiceCustomer[] }>('/api/customers/mice');
      setCustomers(r.customers);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 고객 안에 문의가 배열로 들어 있어서, 화면에서는 문의 단위로 펼쳐 쓴다.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const c of customers) {
      for (const q of c.inquiries || []) {
        if (onlyTracked && !q.callback_due && !q.callback_at && !q.confirmed_at) continue;
        out.push({ customer: c, inquiry: q });
      }
    }
    return out;
  }, [customers, onlyTracked]);

  const totalInquiries = useMemo(
    () => customers.reduce((n, c) => n + (c.inquiries || []).length, 0),
    [customers]
  );

  const countOf = useCallback(
    (status: MiceInquiryStatus) => rows.filter((r) => r.inquiry.progress_status === status).length,
    [rows]
  );

  const shown = useMemo(() => {
    const status = TABS.find((t) => t.key === tab)!.status;
    const list = rows.filter((r) => r.inquiry.progress_status === status);
    // 진행 중 탭은 급한 순서로 — 기한 없는 건 뒤로
    if (tab === 'inq' || tab === 'hold') {
      return list.sort((a, b) => {
        const ad = a.inquiry.callback_at || a.inquiry.callback_due || '9999';
        const bd = b.inquiry.callback_at || b.inquiry.callback_due || '9999';
        return ad.localeCompare(bd);
      });
    }
    return list.sort((a, b) => (b.inquiry.created_at || '').localeCompare(a.inquiry.created_at || ''));
  }, [rows, tab]);

  /** 문의 한 건을 고쳐서 저장 — 고객 문서 통째로 PATCH (문의가 고객 안의 배열이라) */
  async function patchInquiry(row: Row, patch: Partial<MiceInquiry>) {
    if (!canWrite) return;
    setSavingId(row.inquiry.id);
    const next = (row.customer.inquiries || []).map((q) =>
      q.id === row.inquiry.id ? { ...q, ...patch } : q
    );
    // 화면 먼저 반영 (체크박스가 느리면 두 번 누르게 된다)
    setCustomers((cs) => cs.map((c) => (c.id === row.customer.id ? { ...c, inquiries: next } : c)));
    try {
      await api.patch(`/api/customers/mice/${row.customer.id}`, { inquiries: next });
      // 서버가 자동 확정(3개 체크 → DEF)을 걸 수 있어 결과를 다시 읽는다
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setSavingId(null);
    }
  }

  const overdue = rows.filter(
    (r) =>
      (r.inquiry.progress_status === '단순문의' || r.inquiry.progress_status === 'INQ') &&
      (daysLeft(r.inquiry.callback_at || r.inquiry.callback_due) ?? 99) < 0
  ).length;

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">📞 MICE 콜 트래커</h1>
        <p className="text-sm text-gray-500 mt-1">
          문의를 받은 뒤 언제 다시 연락할지, 어디까지 진행됐는지 한 화면에서 봅니다.
        </p>
      </header>

      {overdue > 0 && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          콜백 기한이 지난 건이 <b>{overdue}건</b> 있습니다.
        </div>
      )}
      {error && <div className="mb-3 rounded bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded-full border transition ${
              tab === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50 border-gray-300'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-blue-100' : 'text-gray-400'}`}>
              {countOf(t.status)}
            </span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            className="w-3.5 h-3.5"
            checked={!onlyTracked}
            onChange={(e) => setOnlyTracked(!e.target.checked)}
          />
          고객 DB 전체 문의 보기 ({totalInquiries.toLocaleString('ko-KR')}건)
        </label>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 border-b">기관 / 문의</th>
                <th className="px-3 py-2 border-b whitespace-nowrap">담당</th>
                <th className="px-3 py-2 border-b whitespace-nowrap">
                  {tab === 'hold' ? '콜백 예정일' : '콜백 기한'}
                </th>
                {CHECKS.map((c) => (
                  <th key={String(c.key)} className="px-2 py-2 border-b text-center whitespace-nowrap">{c.label}</th>
                ))}
                <th className="px-3 py-2 border-b">메모</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const q = row.inquiry;
                const dateField = tab === 'hold' ? 'callback_at' : 'callback_due';
                const dateValue = (q[dateField] as string | null | undefined) || '';
                const busy = savingId === q.id;
                return (
                  <tr key={q.id} className={`hover:bg-blue-50/40 ${busy ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 border-b">
                      <div className="font-medium">{row.customer.organization_name || '(이름 없음)'}</div>
                      <div className="text-xs text-gray-500">
                        {[q.inquiry_event_date_text, q.inquiry_channel === 'OUTCALL' ? '아웃콜' : '인콜']
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap text-gray-600">
                      {q.assigned_manager_name || '-'}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={dateValue}
                          disabled={!canWrite}
                          onChange={(e) => patchInquiry(row, { [dateField]: e.target.value || null })}
                          className="border rounded px-1.5 py-1 text-xs"
                        />
                        <DdayChip due={dateValue} />
                      </div>
                    </td>
                    {CHECKS.map((c) => (
                      <td key={String(c.key)} className="px-2 py-2 border-b text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 cursor-pointer disabled:cursor-default"
                          disabled={!canWrite || busy}
                          checked={!!q[c.key]}
                          onChange={(e) => patchInquiry(row, { [c.key]: e.target.checked })}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 border-b max-w-[380px]">
                      <button
                        onClick={() => setOpenNote(openNote === q.id ? null : q.id)}
                        className="text-left text-xs text-gray-600 hover:text-gray-900 w-full"
                      >
                        {row.customer.memo
                          ? openNote === q.id
                            ? <span className="whitespace-pre-wrap">{row.customer.memo}</span>
                            : <span className="line-clamp-2">{row.customer.memo}</span>
                          : <span className="text-gray-300">메모 없음</span>}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && !loading && (
                <tr>
                  <td colSpan={4 + CHECKS.length} className="px-3 py-12 text-center text-gray-400">
                    이 탭에 해당하는 문의가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && <div className="px-3 py-2 text-xs text-blue-600 border-t">불러오는 중…</div>}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        견적서 · 회신됨 · 계약금 세 개가 모두 체크되면 자동으로 <b>확정</b> 탭으로 넘어갑니다.
        {!canWrite && ' · 조회 권한이라 수정은 할 수 없습니다.'}
      </p>
    </div>
  );
}
