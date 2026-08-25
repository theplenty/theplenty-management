// 행사 수정 모달의 '매출' 탭.
// 기존 '가톨릭대관료' 탭(입금·계산서 관리)에 매출 정보(계약금액·실매출·할인·세부항목)를 합쳤다.
// 대관료가 계약금액의 큰 비중을 차지해 두 값을 한 화면에서 보는 편이 실무에 맞다.
//
// 저장 경로가 둘로 나뉜다 (권한 정책이 다르기 때문):
//   · 입금/계산서(invoice) → 행사 PATCH 의 invoice 필드 (행사 수정 권한과 동일)
//   · 매출(contract_amount 등) → PUT /api/events/:id/revenue (admin 전용, 서버에서 강제)

import { Field } from './Field';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  INVOICE_ISSUE_STATUS_OPTIONS,
  INVOICE_TYPE_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  type Invoice,
  type InvoiceIssueStatus,
  type InvoiceType,
  type PaymentStatus,
  type RevenueItem,
} from '../types';

// 신규/기존 모두에서 비어있을 수 있어 모든 필드를 부분적 입력으로 취급한다.
export type InvoiceDraft = Omit<Invoice, 'id' | 'event_id'>;

export function emptyInvoiceDraft(): InvoiceDraft {
  return {
    payment_status: '',
    invoice_type: '',
    invoice_issue_status: '',
    payment_amount: null,
    payment_date: null,
    tax_invoice_issue_date: null,
    depositor_name: '',
  };
}

// 매출 입력값은 쉼표 포함 문자열로 다룬다 (입력 중 포맷 유지). 저장 시 숫자로 변환.
export interface RevenueDraft {
  contract_amount: string;
  sales_total_amount: string;
  discount_rate: string; // % 단위 (예: '7' = 7%)
  discount_reason: string;
  gateway_fee: string;
  amounts: Record<string, string>; // revenue_item_id → 금액 문자열
}

export function emptyRevenueDraft(): RevenueDraft {
  return {
    contract_amount: '',
    sales_total_amount: '',
    discount_rate: '',
    discount_reason: '',
    gateway_fee: '',
    amounts: {},
  };
}

export function toNum(s: string): number {
  const digits = String(s ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

const won = (n: number) => n.toLocaleString('ko-KR');

interface Props {
  invoice: InvoiceDraft;
  onInvoiceChange: (next: InvoiceDraft) => void;
  revenue: RevenueDraft;
  onRevenueChange: (next: RevenueDraft) => void;
  revenueItems: RevenueItem[];
  /** 매출 수정 권한 (admin). false 면 매출 영역은 읽기 전용 */
  canWriteRevenue: boolean;
  /** 신규 행사는 아직 id 가 없어 매출을 저장할 수 없다 */
  isNewEvent: boolean;
  /** 매출 데이터 로딩 중 */
  loading?: boolean;
  /**
   * 출처 (S2 · W1) — 대관료가 어느 계약금에서 자동 반영됐는지.
   * MICE 는 고객정보의 '문의', 웨딩은 고객정보의 '예식 후보' 가 원본이다.
   */
  depositSource?: {
    type?: 'mice' | 'wedding';
    customerId: string;
    customerName: string;
    inquiryNo: number;
    amount: number | null;
    pushedAt: string | null;
  } | null;
}

export default function RevenueTab({
  invoice,
  onInvoiceChange,
  revenue,
  onRevenueChange,
  revenueItems,
  canWriteRevenue,
  isNewEvent,
  loading,
  depositSource,
}: Props) {
  function setInv<K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) {
    onInvoiceChange({ ...invoice, [key]: value });
  }
  function setRev<K extends keyof RevenueDraft>(key: K, value: RevenueDraft[K]) {
    onRevenueChange({ ...revenue, [key]: value });
  }
  function setAmount(itemId: string, val: string) {
    onRevenueChange({
      ...revenue,
      amounts: { ...revenue.amounts, [itemId]: formatKoreanCommas(val) },
    });
  }

  const amountStr =
    invoice.payment_amount != null ? formatKoreanCommas(String(invoice.payment_amount)) : '';

  function onInvoiceAmountChange(s: string) {
    const digits = formatKoreanCommas(s).replace(/[^\d]/g, '');
    setInv('payment_amount', digits ? Number(digits) : null);
  }

  // ── 합계 계산 ──
  const linesTotal = revenueItems.reduce((s, it) => s + toNum(revenue.amounts[it.id] || ''), 0);
  const gatewayNum = toNum(revenue.gateway_fee);
  // 출처가 웨딩이면 안내문·링크를 웨딩 쪽으로 — 웨딩 행사도 이 탭을 그대로 쓴다
  const sourceIsWedding = depositSource?.type === 'wedding';
  const contractNum = toNum(revenue.contract_amount);
  const salesNum = toNum(revenue.sales_total_amount);
  const discountPct = revenue.discount_rate ? Number(revenue.discount_rate) : 0;
  // 실매출 권장값 = 계약금액 × (1 - 할인율/100)
  const suggested = contractNum ? Math.round(contractNum * (1 - discountPct / 100)) : 0;
  const suggestDiffers = suggested > 0 && salesNum > 0 && Math.abs(suggested - salesNum) >= 1;
  // 세부항목 총계(항목합 + 대관료) vs 실매출 — 둘 다 입력됐는데 다르면 경고
  const itemsGrandTotal = linesTotal + gatewayNum;
  const totalsMismatch =
    itemsGrandTotal > 0 && salesNum > 0 && Math.abs(itemsGrandTotal - salesNum) >= 1;

  const roRev = !canWriteRevenue || isNewEvent;

  return (
    <div className="space-y-6">
      {isNewEvent && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
          매출 정보는 <b>행사를 먼저 저장한 뒤</b> 입력할 수 있습니다. (입금·계산서 정보는 지금도 입력 가능)
        </div>
      )}
      {!isNewEvent && !canWriteRevenue && (
        <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
          매출 정보는 <b>관리자만 수정</b>할 수 있어 읽기 전용으로 표시됩니다.
        </div>
      )}

      {/* ───────── 1. 매출 정보 ───────── */}
      <section>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          매출 정보
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="계약금액 (원)">
            {roRev ? (
              <div className="text-sm text-gray-800 py-2">{contractNum ? won(contractNum) : '—'}</div>
            ) : (
              <input
                className="input text-right tabular-nums"
                value={revenue.contract_amount}
                placeholder="0"
                inputMode="numeric"
                onChange={(e) => setRev('contract_amount', formatKoreanCommas(e.target.value))}
              />
            )}
          </Field>

          <Field label="할인율 (%)">
            {roRev ? (
              <div className="text-sm text-gray-800 py-2">{discountPct ? `${discountPct}%` : '—'}</div>
            ) : (
              <input
                className="input text-right tabular-nums"
                value={revenue.discount_rate}
                placeholder="0"
                inputMode="decimal"
                onChange={(e) => setRev('discount_rate', e.target.value.replace(/[^\d.]/g, ''))}
              />
            )}
          </Field>

          <Field
            label="실매출 (원)"
            hint={
              !roRev && suggested > 0
                ? `계약금액 × (1-할인율) = ${won(suggested)}원`
                : undefined
            }
          >
            {roRev ? (
              <div className="text-sm text-gray-800 py-2">{salesNum ? won(salesNum) : '—'}</div>
            ) : (
              <div className="flex gap-1">
                <input
                  className="input text-right tabular-nums"
                  value={revenue.sales_total_amount}
                  placeholder="0"
                  inputMode="numeric"
                  onChange={(e) => setRev('sales_total_amount', formatKoreanCommas(e.target.value))}
                />
                {suggested > 0 && (
                  <button
                    type="button"
                    className="shrink-0 px-2 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                    title="계약금액과 할인율로 실매출을 채웁니다"
                    onClick={() => setRev('sales_total_amount', won(suggested))}
                  >
                    자동
                  </button>
                )}
              </div>
            )}
          </Field>

          <Field label="할인사유" className="md:col-span-3">
            {roRev ? (
              <div className="text-sm text-gray-800 py-2">{revenue.discount_reason || '—'}</div>
            ) : (
              <input
                className="input"
                value={revenue.discount_reason}
                placeholder="예: 재방문 고객 할인"
                onChange={(e) => setRev('discount_reason', e.target.value)}
              />
            )}
          </Field>
        </div>

        {suggestDiffers && !roRev && (
          <div className="mt-2 text-xs text-amber-700">
            ⚠️ 입력된 실매출({won(salesNum)}원)이 계약금액·할인율로 계산한 값({won(suggested)}원)과
            다릅니다. 의도한 값인지 확인해 주세요.
          </div>
        )}
      </section>

      {/* ───────── 2. 세부 매출 항목 ───────── */}
      {revenueItems.length > 0 && (
        <section>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            세부 매출 항목
          </div>
          {loading ? (
            <div className="text-sm text-gray-400">불러오는 중…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {revenueItems.map((it) => (
                  <Field key={it.id} label={it.name_ko}>
                    {roRev ? (
                      <div className="text-sm text-gray-800 py-2 text-right tabular-nums">
                        {toNum(revenue.amounts[it.id] || '') ? revenue.amounts[it.id] : '—'}
                      </div>
                    ) : (
                      <input
                        className="input text-right tabular-nums"
                        value={revenue.amounts[it.id] || ''}
                        placeholder="0"
                        inputMode="numeric"
                        onChange={(e) => setAmount(it.id, e.target.value)}
                      />
                    )}
                  </Field>
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-6 text-sm border-t border-gray-200 pt-2">
                <span className="text-gray-500">
                  항목 합계 <b className="text-gray-800 tabular-nums">{won(linesTotal)}</b>원
                </span>
                <span className="text-gray-500">
                  + 대관료 <b className="text-gray-800 tabular-nums">{won(gatewayNum)}</b>원
                </span>
                <span className="text-gray-700">
                  총계 <b className="text-gray-900 tabular-nums">{won(itemsGrandTotal)}</b>원
                </span>
              </div>

              {/* 매출이 events 문서(실매출)와 event_revenue_lines(세부항목) 두 곳에 나뉘어 저장되므로
                  둘이 어긋나면 정산 판정이 조용히 한쪽만 쓰게 된다. 화면에서 바로 잡아준다. */}
              {totalsMismatch && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                  ⚠️ 세부항목 총계({won(itemsGrandTotal)}원)가 실매출({won(salesNum)}원)과{' '}
                  {won(Math.abs(itemsGrandTotal - salesNum))}원 차이납니다. 정산 계산은 실매출을
                  우선 사용하므로 두 값을 맞춰 주세요.
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* ───────── 3. 가톨릭대관료 ───────── */}
      <section>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          가톨릭대관료
        </div>
        <div className="text-sm text-gray-600 mb-3">
          계약금(= 가톨릭대관료)과 입금·계산서 정보는{' '}
          <b>{sourceIsWedding ? '고객정보(WEDDING)의 예식 후보' : '고객정보(MICE)의 문의'}</b>에서
          입력·수정합니다. 이 화면은 읽기 전용이며, 고객정보를 저장하면 여기로 자동 반영됩니다.
        </div>

        {depositSource ? (
          <div className="mb-3 text-xs rounded border border-blue-200 bg-blue-50 px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-blue-900">
              출처: {sourceIsWedding ? '예식 후보' : '문의'} #{depositSource.inquiryNo}
            </span>
            <a
              href={`/customer/${sourceIsWedding ? 'wedding' : 'mice'}/${depositSource.customerId}`}
              className="text-blue-700 underline"
            >
              {depositSource.customerName} — 고객정보에서 수정
            </a>
            {depositSource.amount != null && gatewayNum > 0 && gatewayNum !== depositSource.amount && (
              <span className="badge bg-amber-100 text-amber-900">
                ⚠ 고객정보 계약금({won(depositSource.amount)})과 다름 — 고객정보를 다시 저장하면 맞춰집니다
              </span>
            )}
          </div>
        ) : (
          <div className="mb-3 text-xs rounded border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600">
            연결된 고객정보가 없습니다 — MICE 는 문의를 이 행사에 연결하고, 웨딩은 고객의 예식 후보
            날짜를 이 행사와 맞추면 계약금이 여기로 채워집니다.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="대관료 금액 (원)" hint="행사에 부과되는 가톨릭대 임대료">
            <div className="text-sm text-gray-800 py-2 tabular-nums">{gatewayNum ? won(gatewayNum) : '—'}</div>
          </Field>
          <Field label="입금상태">
            <div className="text-sm text-gray-800 py-2">{invoice.payment_status || '—'}</div>
          </Field>
          <Field label="입금자명">
            <div className="text-sm text-gray-800 py-2">{invoice.depositor_name || '—'}</div>
          </Field>
          <Field label="입금액 (원)">
            <div className="text-sm text-gray-800 py-2 tabular-nums">
              {invoice.payment_amount ? won(Number(invoice.payment_amount)) : '—'}
            </div>
          </Field>
          <Field label="입금일자">
            <div className="text-sm text-gray-800 py-2">{invoice.payment_date || '—'}</div>
          </Field>
          <Field label="계산서 발행">
            <div className="text-sm text-gray-800 py-2">{invoice.invoice_type || '—'}</div>
          </Field>
          <Field label="계산서 발행상태">
            <div className="text-sm text-gray-800 py-2">{invoice.invoice_issue_status || '—'}</div>
          </Field>
          {/* 세금계산서 발행일자는 2026-08-25 폐기 — 가톨릭이 발행해 우리가 확인할 수 없는 값이라
              입력칸을 없앴다. 옛 데이터가 있는 건만 참고로 보여준다. */}
          {invoice.tax_invoice_issue_date && (
            <Field label="세금계산서 발행일자 (옛 기록)">
              <div className="text-sm text-gray-500 py-2">{invoice.tax_invoice_issue_date}</div>
            </Field>
          )}
        </div>
      </section>
    </div>
  );
}
