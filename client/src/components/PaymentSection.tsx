// 행사 1건의 결제 내역 — 매출관리 펼침 패널 안에서 쓰인다.
// 기존 '결제 매핑' 페이지의 우측 패널을 컴포넌트로 분리한 것.
// 매출(계약금액·실매출)과 결제(입금)를 한 화면에서 대조해야 정산 차액이 눈에 띈다.

import { useState } from 'react';
import { api } from '../lib/api';
import { fmtDateW } from '../lib/dateFmt';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  CARD_COMPANY_LABEL,
  CARD_COMPANY_OPTIONS,
  CARD_DEPOSIT_DAYS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_TYPE_LABEL,
  PAYMENT_TYPE_OPTIONS,
  type CardCompany,
  type Payment,
  type PaymentMethod,
  type PaymentType,
} from '../types';
import clsx from 'clsx';

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 영업일(주말 제외) 더하기 — 카드사 입금 기한 계산
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

/** 카드 결제인데 입금 기한을 넘겼고 아직 입금 확인이 안 된 건 */
export function isDepositOverdue(p: Payment): boolean {
  if (p.method !== 'card' || p.bank_deposit_date || !p.paid_at || !p.card_company) return false;
  const days = CARD_DEPOSIT_DAYS[p.card_company] ?? 3;
  return new Date() > addBusinessDays(p.paid_at, days);
}

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

const won = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('ko-KR')}원`;

interface Props {
  eventId: string;
  payments: Payment[];
  canWrite: boolean;
  /** 저장/삭제 후 상위가 목록을 다시 불러오도록 */
  onChanged: () => void;
}

export default function PaymentSection({ eventId, payments, canWrite, onChanged }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(p: Payment) {
    setForm({
      payment_type: p.payment_type,
      amount: p.amount ? Number(p.amount).toLocaleString('ko-KR') : '',
      paid_at: p.paid_at || todayStr(),
      method: p.method,
      card_company: p.card_company ?? '',
      approval_no: p.approval_no ?? '',
      business_name: p.business_name ?? '',
      bank_deposit_date: p.bank_deposit_date ?? '',
      bank_deposit_amount: p.bank_deposit_amount
        ? Number(p.bank_deposit_amount).toLocaleString('ko-KR')
        : '',
      note: p.note ?? '',
    });
    setEditingId(p.id);
    setShowForm(true);
  }

  const num = (s: string): number | null => {
    const d = s.replace(/[^\d]/g, '');
    return d ? Number(d) : null;
  };

  async function save() {
    const amount = num(form.amount);
    if (!amount) {
      alert('결제 금액을 입력해 주세요.');
      return;
    }
    if (!form.paid_at) {
      alert('결제일을 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        event_id: eventId,
        payment_type: form.payment_type,
        amount,
        paid_at: form.paid_at,
        method: form.method,
        card_company: form.method === 'card' ? form.card_company || undefined : undefined,
        approval_no: form.approval_no || undefined,
        business_name: form.business_name || undefined,
        bank_deposit_date: form.bank_deposit_date || undefined,
        bank_deposit_amount: num(form.bank_deposit_amount) ?? undefined,
        note: form.note || undefined,
      };
      if (editingId) await api.patch(`/api/payments/${editingId}`, body);
      else await api.post('/api/payments', body);
      reset();
      onChanged();
    } catch (e) {
      console.error(e);
      alert('결제 저장에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('이 결제 내역을 삭제할까요? (복구 불가)')) return;
    setBusy(true);
    try {
      await api.delete(`/api/payments/${id}`);
      onChanged();
    } catch {
      alert('삭제에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...payments].sort((a, b) => (a.paid_at < b.paid_at ? -1 : 1));

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          결제 내역
        </div>
        <span className="text-xs text-gray-400">{sorted.length}건</span>
        {canWrite && !showForm && (
          <button
            type="button"
            className="ml-auto text-xs text-blue-600 hover:underline"
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingId(null);
              setShowForm(true);
            }}
          >
            + 결제 추가
          </button>
        )}
      </div>

      {sorted.length === 0 && !showForm ? (
        <div className="text-sm text-gray-400 py-3 text-center bg-white border rounded">
          등록된 결제가 없습니다.
        </div>
      ) : (
        sorted.length > 0 && (
          <div className="overflow-x-auto bg-white border rounded">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-50 border-b text-gray-600">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">구분</th>
                  <th className="px-2 py-1.5 text-right font-medium">금액</th>
                  <th className="px-2 py-1.5 text-left font-medium">결제일</th>
                  <th className="px-2 py-1.5 text-left font-medium">수단</th>
                  <th className="px-2 py-1.5 text-left font-medium">카드사 입금</th>
                  <th className="px-2 py-1.5 text-left font-medium">비고</th>
                  {canWrite && <th className="w-16" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map((p) => {
                  const overdue = isDepositOverdue(p);
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5">
                        <span
                          className={clsx(
                            'px-1.5 py-0.5 rounded font-medium',
                            p.payment_type === 'refund'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                          )}
                        >
                          {PAYMENT_TYPE_LABEL[p.payment_type]}
                        </span>
                      </td>
                      <td
                        className={clsx(
                          'px-2 py-1.5 text-right tabular-nums font-medium',
                          p.payment_type === 'refund' && 'text-red-600'
                        )}
                      >
                        {p.payment_type === 'refund' ? '-' : ''}
                        {won(p.amount)}
                      </td>
                      <td className="px-2 py-1.5 text-gray-600">{fmtDateW(p.paid_at)}</td>
                      <td className="px-2 py-1.5 text-gray-600">
                        {PAYMENT_METHOD_LABEL[p.method]}
                        {p.card_company ? ` (${CARD_COMPANY_LABEL[p.card_company]})` : ''}
                      </td>
                      <td className="px-2 py-1.5">
                        {p.bank_deposit_date ? (
                          <span className="text-green-600">{fmtDateW(p.bank_deposit_date)}</span>
                        ) : overdue ? (
                          <span className="text-red-600 font-semibold">⚠ 입금 지연</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 max-w-[160px] truncate">
                        {p.note || '—'}
                      </td>
                      {canWrite && (
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            className="text-blue-600 hover:underline mr-1.5"
                            onClick={() => startEdit(p)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="text-red-500 hover:underline"
                            onClick={() => remove(p.id)}
                          >
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {showForm && canWrite && (
        <div className="mt-2 bg-white border rounded p-3">
          <div className="text-xs font-semibold text-gray-600 mb-2">
            {editingId ? '결제 수정' : '결제 추가'}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <label className="block">
              <span className="text-gray-500">구분</span>
              <select
                className="input !text-xs !py-1 mt-0.5"
                value={form.payment_type}
                onChange={(e) => setForm({ ...form, payment_type: e.target.value as PaymentType })}
              >
                {PAYMENT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{PAYMENT_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-gray-500">금액 (원)</span>
              <input
                className="input !text-xs !py-1 mt-0.5 text-right tabular-nums"
                value={form.amount}
                inputMode="numeric"
                onChange={(e) => setForm({ ...form, amount: formatKoreanCommas(e.target.value) })}
              />
            </label>
            <label className="block">
              <span className="text-gray-500">결제일</span>
              <input
                type="date"
                className="input !text-xs !py-1 mt-0.5"
                value={form.paid_at}
                onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-gray-500">수단</span>
              <select
                className="input !text-xs !py-1 mt-0.5"
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}
              >
                {PAYMENT_METHOD_OPTIONS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
                ))}
              </select>
            </label>

            {form.method === 'card' && (
              <>
                <label className="block">
                  <span className="text-gray-500">카드사</span>
                  <select
                    className="input !text-xs !py-1 mt-0.5"
                    value={form.card_company}
                    onChange={(e) =>
                      setForm({ ...form, card_company: e.target.value as CardCompany | '' })
                    }
                  >
                    <option value="">선택</option>
                    {CARD_COMPANY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{CARD_COMPANY_LABEL[c]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-gray-500">승인번호</span>
                  <input
                    className="input !text-xs !py-1 mt-0.5"
                    value={form.approval_no}
                    onChange={(e) => setForm({ ...form, approval_no: e.target.value })}
                  />
                </label>
              </>
            )}

            <label className="block">
              <span className="text-gray-500">카드사 입금일</span>
              <input
                type="date"
                className="input !text-xs !py-1 mt-0.5"
                value={form.bank_deposit_date}
                onChange={(e) => setForm({ ...form, bank_deposit_date: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-gray-500">입금액 (수수료 차감 후)</span>
              <input
                className="input !text-xs !py-1 mt-0.5 text-right tabular-nums"
                value={form.bank_deposit_amount}
                inputMode="numeric"
                onChange={(e) =>
                  setForm({ ...form, bank_deposit_amount: formatKoreanCommas(e.target.value) })
                }
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-gray-500">사업자명 (계산서/현금영수증)</span>
              <input
                className="input !text-xs !py-1 mt-0.5"
                value={form.business_name}
                onChange={(e) => setForm({ ...form, business_name: e.target.value })}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-gray-500">비고</span>
              <input
                className="input !text-xs !py-1 mt-0.5"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              className="btn-primary !text-xs !py-1 !px-3"
              disabled={busy}
              onClick={save}
            >
              {busy ? '저장 중…' : editingId ? '수정' : '추가'}
            </button>
            <button
              type="button"
              className="btn-secondary !text-xs !py-1 !px-3"
              disabled={busy}
              onClick={reset}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
