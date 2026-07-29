// 결제 매핑 화면 — 행사별 수금 내역 관리
// 관리자: CRUD / 세일즈·연회: 읽기 전용

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtDateW, weekdayKo } from '../lib/dateFmt';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { canWritePayments } from '../auth/permissions';
import type {
  Event,
  Payment,
  PaymentType,
  PaymentMethod,
  CardCompany,
  RevenueItem,
  EventRevenueLine,
} from '../types';
import {
  PAYMENT_TYPE_LABEL,
  PAYMENT_METHOD_LABEL,
  CARD_COMPANY_LABEL,
  CARD_DEPOSIT_DAYS,
  PAYMENT_TYPE_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  CARD_COMPANY_OPTIONS,
} from '../types';

// ── 유틸 ──────────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('ko-KR');
const fmtW = (n: number) => `₩${fmt(n)}`;
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** 영업일 기준 N일 후 날짜 */
function addBusinessDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/** 카드 미입금 여부 */
function isDepositOverdue(p: Payment): boolean {
  if (p.method !== 'card' || p.bank_deposit_date || !p.paid_at || !p.card_company) return false;
  const days = CARD_DEPOSIT_DAYS[p.card_company] ?? 3;
  const deadline = addBusinessDays(p.paid_at, days);
  return new Date() > deadline;
}

// ── 결제 행 편집 폼 기본값 ────────────────────────────────────────────────────
const EMPTY_FORM = {
  payment_type: 'contract' as PaymentType,
  amount: '',
  paid_at: todayStr(),
  method: 'transfer' as PaymentMethod,
  card_company: '' as CardCompany | '',
  approval_no: '',
  business_name: '',
  bank_deposit_date: '',
  bank_deposit_amount: '',
  note: '',
};

type FormState = typeof EMPTY_FORM;

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function Payments() {
  const { user } = useAuth();
  const canWrite = canWritePayments(user?.role);

  // 행사 목록
  const [events, setEvents] = useState<Event[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [monthFilter, setMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // 선택된 행사
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // 매출 정보
  const [revenueItems, setRevenueItems] = useState<RevenueItem[]>([]);
  const [revenueLines, setRevenueLines] = useState<EventRevenueLine[]>([]);

  // 결제 목록
  const [payments, setPayments] = useState<Payment[]>([]);

  // 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null); // 기존 행 편집
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 알람
  const [alerts, setAlerts] = useState<(Payment & { event_name: string })[]>([]);

  // ── 데이터 로드 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get<{ items: Event[] }>('/api/events').then((r) => {
      setEvents((r as unknown as { events: Event[] }).events ?? []);
    }).catch(console.error);
    api.get<{ items: RevenueItem[] }>('/api/revenue-items').then((r) => {
      setRevenueItems((r as unknown as { items: RevenueItem[] }).items ?? []);
    }).catch(console.error);
    api.get<{ alerts: (Payment & { event_name: string })[] }>('/api/payments/alerts').then((r) => {
      setAlerts(r.alerts ?? []);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedEventId) { setPayments([]); setRevenueLines([]); return; }
    api.get<{ payments: Payment[] }>(`/api/payments?event_id=${selectedEventId}`).then((r) => {
      setPayments(r.payments ?? []);
    }).catch(console.error);
    api.get<{ event: Event; revenue_lines: EventRevenueLine[]; revenue_items: RevenueItem[] }>(
      `/api/events/${selectedEventId}/revenue`
    ).then((r) => {
      setRevenueLines(r.revenue_lines ?? []);
    }).catch(console.error);
  }, [selectedEventId]);

  // ── 행사 필터링 ─────────────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => {
        if (!e.start_datetime) return false;
        const datePrefix = e.start_datetime.slice(0, 7);
        if (monthFilter && datePrefix !== monthFilter) return false;
        if (searchQ) {
          const q = searchQ.toLowerCase();
          return e.event_name?.toLowerCase().includes(q);
        }
        return true;
      })
      .sort((a, b) => (a.start_datetime ?? '').localeCompare(b.start_datetime ?? ''));
  }, [events, monthFilter, searchQ]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  // ── 매출 합계 계산 ───────────────────────────────────────────────────────────
  const salesTotal = useMemo(() => {
    if (selectedEvent?.sales_total_amount) return selectedEvent.sales_total_amount;
    return revenueLines.reduce((s, l) => s + (l.amount ?? 0), 0);
  }, [selectedEvent, revenueLines]);

  const paymentTotal = useMemo(
    () => payments.filter((p) => p.payment_type !== 'refund').reduce((s, p) => s + (p.amount ?? 0), 0) -
      payments.filter((p) => p.payment_type === 'refund').reduce((s, p) => s + (p.amount ?? 0), 0),
    [payments]
  );

  const diff = paymentTotal - salesTotal;

  // ── 폼 리셋 ─────────────────────────────────────────────────────────────────
  const resetForm = useCallback(() => {
    setForm({ ...EMPTY_FORM, paid_at: todayStr() });
    setEditingId(null);
    setShowAddForm(false);
  }, []);

  function startEdit(p: Payment) {
    setForm({
      payment_type: p.payment_type,
      amount: String(p.amount),
      paid_at: p.paid_at,
      method: p.method,
      card_company: p.card_company ?? '',
      approval_no: p.approval_no ?? '',
      business_name: p.business_name ?? '',
      bank_deposit_date: p.bank_deposit_date ?? '',
      bank_deposit_amount: p.bank_deposit_amount != null ? String(p.bank_deposit_amount) : '',
      note: p.note ?? '',
    });
    setEditingId(p.id);
    setShowAddForm(true);
  }

  // ── 저장 ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!selectedEventId) return;
    setSaving(true);
    try {
      const body = {
        event_id: selectedEventId,
        payment_type: form.payment_type,
        amount: Number(String(form.amount).replace(/,/g, '')),
        paid_at: form.paid_at,
        method: form.method,
        card_company: form.card_company || undefined,
        approval_no: form.approval_no || undefined,
        business_name: form.business_name || undefined,
        bank_deposit_date: form.bank_deposit_date || undefined,
        bank_deposit_amount: form.bank_deposit_amount
          ? Number(String(form.bank_deposit_amount).replace(/,/g, ''))
          : undefined,
        note: form.note || undefined,
      };
      if (editingId) {
        const r = await api.patch<{ payment: Payment }>(`/api/payments/${editingId}`, body);
        setPayments((p) => p.map((x) => (x.id === editingId ? r.payment : x)));
      } else {
        const r = await api.post<{ payment: Payment }>('/api/payments', body);
        setPayments((p) => [r.payment, ...p]);
      }
      resetForm();
    } catch (e) {
      alert(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('이 결제 내역을 삭제하시겠습니까?')) return;
    await api.delete(`/api/payments/${id}`);
    setPayments((p) => p.filter((x) => x.id !== id));
  }

  async function handleReconcile(p: Payment) {
    const body = { reconciled_at: p.reconciled_at ? null : new Date().toISOString() };
    const r = await api.patch<{ payment: Payment }>(`/api/payments/${p.id}`, body);
    setPayments((prev) => prev.map((x) => (x.id === p.id ? r.payment : x)));
  }

  // ── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── 좌측 행사 목록 ───────────────────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 border-r flex flex-col bg-white">
        <div className="p-3 border-b space-y-2">
          <h2 className="font-semibold text-sm text-gray-700">결제 매핑</h2>
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="input !py-1 !text-sm w-full"
          />
          <input
            type="text"
            placeholder="행사명·주최사 검색"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="input !py-1 !text-sm w-full"
          />
        </div>

        {/* 미입금 알람 뱃지 */}
        {alerts.length > 0 && (
          <div className="mx-3 mt-2 px-2 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            ⚠ 카드 미입금 {alerts.length}건
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <p className="text-center text-gray-400 text-xs py-8">행사 없음</p>
          ) : (
            filteredEvents.map((ev) => {
              const isSelected = ev.id === selectedEventId;
              const evPayments = payments.filter((p) => p.event_id === ev.id);
              const hasAlert = alerts.some((a) => a.event_id === ev.id);
              return (
                <button
                  key={ev.id}
                  onClick={() => { setSelectedEventId(ev.id); resetForm(); }}
                  className={`w-full text-left px-3 py-2.5 border-b text-sm transition-colors ${
                    isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{ev.event_name}</p>
                      <p className="text-xs text-gray-500 truncate">{ev.halls?.join(', ')}</p>
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-end gap-0.5">
                      <span className="text-xs text-gray-400">{ev.start_datetime ? `${ev.start_datetime.slice(5, 10)} (${weekdayKo(ev.start_datetime)})` : ''}</span>
                      {hasAlert && <span className="text-[10px] text-red-500">카드미입금</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── 우측 패널 ────────────────────────────────────────────────────────── */}
      {!selectedEvent ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          좌측에서 행사를 선택하세요
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* 행사 헤더 */}
            <div className="bg-white rounded-lg border p-3 flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-base">{selectedEvent.event_name}</h3>
                <p className="text-sm text-gray-500">{selectedEvent.halls?.join(', ')} · {fmtDateW(selectedEvent.start_datetime)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                selectedEvent.event_type === 'MICE' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
              }`}>{selectedEvent.event_type}</span>
            </div>

            {/* 매출 요약 (read-only) */}
            <div className="bg-white rounded-lg border p-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">매출 정보 (읽기 전용)</h4>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">계약금액</p>
                  <p className="font-medium">{selectedEvent.contract_amount ? fmtW(selectedEvent.contract_amount) : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">할인율</p>
                  <p className="font-medium">{selectedEvent.discount_rate != null ? `${selectedEvent.discount_rate}%` : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">실매출(총매출)</p>
                  <p className="font-semibold text-blue-700">{salesTotal ? fmtW(salesTotal) : '—'}</p>
                </div>
              </div>
              {revenueLines.length > 0 && (
                <div className="mt-2 pt-2 border-t space-y-1">
                  {revenueLines.map((l) => {
                    const item = revenueItems.find((i) => i.id === l.revenue_item_id);
                    return (
                      <div key={l.id} className="flex justify-between text-xs text-gray-600">
                        <span>{item?.name_ko ?? l.revenue_item_id}</span>
                        <span>{l.amount != null ? fmtW(l.amount) : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 카드 미입금 알람 (해당 행사) */}
            {payments.some(isDepositOverdue) && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                <p className="font-semibold mb-1">⚠ 카드 미입금 알람</p>
                {payments.filter(isDepositOverdue).map((p) => (
                  <p key={p.id} className="text-xs">
                    {PAYMENT_TYPE_LABEL[p.payment_type]} {fmtW(p.amount)} ({CARD_COMPANY_LABEL[p.card_company!]}) —
                    결제일 {fmtDateW(p.paid_at)}, {CARD_DEPOSIT_DAYS[p.card_company!]}영업일 초과
                  </p>
                ))}
              </div>
            )}

            {/* 결제 행 표 */}
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">결제 내역</h4>
                {canWrite && !showAddForm && (
                  <button
                    onClick={() => { setShowAddForm(true); setEditingId(null); setForm({ ...EMPTY_FORM, paid_at: todayStr() }); }}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                  >
                    + 결제 추가
                  </button>
                )}
              </div>

              {/* 추가/편집 폼 */}
              {showAddForm && canWrite && (
                <div className="p-3 border-b bg-blue-50/40">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div>
                      <label className="field-label">결제 구분</label>
                      <select className="input !py-1 !text-sm" value={form.payment_type}
                        onChange={(e) => setForm((f) => ({ ...f, payment_type: e.target.value as PaymentType }))}>
                        {PAYMENT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">금액 (원)</label>
                      <input className="input !py-1 !text-sm" type="text" value={form.amount}
                        onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                        placeholder="1,000,000" />
                    </div>
                    <div>
                      <label className="field-label">결제일</label>
                      <input className="input !py-1 !text-sm" type="date" value={form.paid_at}
                        onChange={(e) => setForm((f) => ({ ...f, paid_at: e.target.value }))} />
                    </div>
                    <div>
                      <label className="field-label">결제 방법</label>
                      <select className="input !py-1 !text-sm" value={form.method}
                        onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as PaymentMethod, card_company: '' }))}>
                        {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
                      </select>
                    </div>
                    {form.method === 'card' && (
                      <>
                        <div>
                          <label className="field-label">카드사</label>
                          <select className="input !py-1 !text-sm" value={form.card_company}
                            onChange={(e) => setForm((f) => ({ ...f, card_company: e.target.value as CardCompany }))}>
                            <option value="">선택</option>
                            {CARD_COMPANY_OPTIONS.map((c) => <option key={c} value={c}>{CARD_COMPANY_LABEL[c]}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="field-label">승인번호</label>
                          <input className="input !py-1 !text-sm" type="text" value={form.approval_no}
                            onChange={(e) => setForm((f) => ({ ...f, approval_no: e.target.value }))}
                            placeholder="12345678" />
                        </div>
                        <div>
                          <label className="field-label">카드사 입금일</label>
                          <input className="input !py-1 !text-sm" type="date" value={form.bank_deposit_date}
                            onChange={(e) => setForm((f) => ({ ...f, bank_deposit_date: e.target.value }))} />
                        </div>
                        <div>
                          <label className="field-label">실입금액 (수수료 차감)</label>
                          <input className="input !py-1 !text-sm" type="text" value={form.bank_deposit_amount}
                            onChange={(e) => setForm((f) => ({ ...f, bank_deposit_amount: e.target.value }))}
                            placeholder="997,000" />
                        </div>
                      </>
                    )}
                    {(form.method === 'cash' || form.method === 'transfer') && (
                      <div>
                        <label className="field-label">사업자 (현금영수증·세금계산서)</label>
                        <input className="input !py-1 !text-sm" type="text" value={form.business_name}
                          onChange={(e) => setForm((f) => ({ ...f, business_name: e.target.value }))}
                          placeholder="(주)플렌티컨벤션" />
                      </div>
                    )}
                    <div className="col-span-2 sm:col-span-3">
                      <label className="field-label">메모</label>
                      <input className="input !py-1 !text-sm w-full" type="text" value={form.note}
                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                        placeholder="예: 5/20 100만원 환불 완료" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 justify-end">
                    <button onClick={resetForm} className="btn-secondary text-sm py-1 px-3">취소</button>
                    <button onClick={handleSave} disabled={saving} className="btn-primary text-sm py-1 px-3">
                      {saving ? '저장 중...' : editingId ? '수정' : '추가'}
                    </button>
                  </div>
                </div>
              )}

              {/* 결제 목록 테이블 */}
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">구분</th>
                    <th className="text-left px-3 py-2">결제일</th>
                    <th className="text-right px-3 py-2">금액</th>
                    <th className="text-left px-3 py-2">방법</th>
                    <th className="text-left px-3 py-2">카드사/입금일</th>
                    <th className="text-left px-3 py-2">메모</th>
                    <th className="text-center px-3 py-2">정산</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={canWrite ? 8 : 7} className="text-center text-gray-400 py-6 text-xs">
                        결제 내역이 없습니다
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => {
                      const overdue = isDepositOverdue(p);
                      return (
                        <tr key={p.id} className={`border-t ${overdue ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                          <td className="px-3 py-2">
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              p.payment_type === 'refund' ? 'bg-red-100 text-red-700' :
                              p.payment_type === 'contract' ? 'bg-purple-100 text-purple-700' :
                              p.payment_type === 'deposit' ? 'bg-yellow-100 text-yellow-700' :
                              p.payment_type === 'balance' ? 'bg-green-100 text-green-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>{PAYMENT_TYPE_LABEL[p.payment_type]}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600">{fmtDateW(p.paid_at)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">
                            {p.payment_type === 'refund' ? (
                              <span className="text-red-600">-{fmtW(p.amount)}</span>
                            ) : fmtW(p.amount)}
                          </td>
                          <td className="px-3 py-2 text-xs">{PAYMENT_METHOD_LABEL[p.method]}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {p.method === 'card' && (
                              <div>
                                <p>{p.card_company ? CARD_COMPANY_LABEL[p.card_company] : ''}</p>
                                {p.bank_deposit_date ? (
                                  <p className="text-green-600">입금 {fmtDateW(p.bank_deposit_date)}</p>
                                ) : overdue ? (
                                  <p className="text-red-600 font-medium">⚠ 미입금</p>
                                ) : (
                                  <p className="text-gray-400">미입금 대기</p>
                                )}
                                {p.bank_deposit_amount != null && (
                                  <p className="text-gray-400">{fmtW(p.bank_deposit_amount)}</p>
                                )}
                              </div>
                            )}
                            {p.approval_no && <p className="text-gray-400">#{p.approval_no}</p>}
                            {p.business_name && <p>{p.business_name}</p>}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500 max-w-[120px] truncate" title={p.note}>
                            {p.note}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {p.reconciled_at ? (
                              <span className="text-[10px] text-green-600 font-medium">✓ 완료</span>
                            ) : (
                              canWrite ? (
                                <button
                                  onClick={() => handleReconcile(p)}
                                  className="text-[10px] text-gray-400 hover:text-green-600 border border-gray-200 rounded px-1"
                                >
                                  매핑
                                </button>
                              ) : <span className="text-[10px] text-gray-300">미완료</span>
                            )}
                          </td>
                          {canWrite && (
                            <td className="px-2 py-2">
                              <div className="flex gap-1">
                                <button
                                  onClick={() => startEdit(p)}
                                  className="text-xs text-blue-600 hover:underline"
                                >수정</button>
                                <button
                                  onClick={() => handleDelete(p.id)}
                                  className="text-xs text-red-500 hover:underline"
                                >삭제</button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 정산 카드 — 화면 하단 고정 */}
          <div className={`flex-shrink-0 border-t p-3 ${
            diff === 0 ? 'bg-green-50' : diff > 0 ? 'bg-yellow-50' : 'bg-red-50'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500">매출 합계 <strong className="text-gray-800">{salesTotal ? fmtW(salesTotal) : '—'}</strong></span>
                <span className="text-gray-400">vs</span>
                <span className="text-gray-500">결제 합계 <strong className="text-gray-800">{fmtW(paymentTotal)}</strong></span>
                <span className="text-gray-400">·</span>
                <span>차액 <strong className={diff === 0 ? 'text-green-700' : diff > 0 ? 'text-yellow-700' : 'text-red-700'}>
                  {diff > 0 ? '+' : ''}{fmtW(diff)}
                </strong></span>
              </div>
              <div className={`text-sm font-semibold px-3 py-1 rounded-full ${
                diff === 0
                  ? 'bg-green-100 text-green-700'
                  : diff > 0
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {diff === 0 ? '✓ 정산 완료' : diff > 0 ? `미수 ${fmtW(diff)}` : '⚠ 초과 입금 확인 필요'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
