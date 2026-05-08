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

interface Props {
  draft: InvoiceDraft;
  onChange: (next: InvoiceDraft) => void;
}

export default function InvoiceTab({ draft, onChange }: Props) {
  function set<K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  // payment_amount는 number지만 입력은 쉼표 적용된 문자열로 표시
  const amountStr =
    draft.payment_amount != null ? formatKoreanCommas(String(draft.payment_amount)) : '';

  function onAmountChange(s: string) {
    const formatted = formatKoreanCommas(s);
    const digits = formatted.replace(/[^\d]/g, '');
    set('payment_amount', digits ? Number(digits) : null);
  }

  return (
    <div>
      <div className="text-sm text-gray-600 mb-4">
        가톨릭대학교 대관료 입금현황을 관리합니다. 견적서 / 계약서 첨부는 첨부파일 탭에서
        업로드합니다.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="입금상태">
          <select
            className="input"
            value={draft.payment_status}
            onChange={(e) => set('payment_status', e.target.value as PaymentStatus)}
          >
            {PAYMENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || '선택 안 함'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="입금자명">
          <input
            className="input"
            value={draft.depositor_name}
            onChange={(e) => set('depositor_name', e.target.value)}
          />
        </Field>

        <Field label="입금액 (원)">
          <input
            className="input text-right tabular-nums"
            value={amountStr}
            placeholder="0"
            inputMode="numeric"
            onChange={(e) => onAmountChange(e.target.value)}
          />
        </Field>

        <Field label="입금일자">
          <input
            type="date"
            className="input"
            value={draft.payment_date || ''}
            onChange={(e) => set('payment_date', e.target.value || null)}
          />
        </Field>

        <Field label="계산서 발행">
          <select
            className="input"
            value={draft.invoice_type}
            onChange={(e) => set('invoice_type', e.target.value as InvoiceType)}
          >
            {INVOICE_TYPE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || '선택 안 함'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="계산서 발행상태">
          <select
            className="input"
            value={draft.invoice_issue_status}
            onChange={(e) => set('invoice_issue_status', e.target.value as InvoiceIssueStatus)}
          >
            {INVOICE_ISSUE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || '선택 안 함'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="세금계산서 발행일자" className="md:col-span-2">
          <input
            type="date"
            className="input"
            value={draft.tax_invoice_issue_date || ''}
            onChange={(e) => set('tax_invoice_issue_date', e.target.value || null)}
          />
        </Field>
      </div>
    </div>
  );
}
