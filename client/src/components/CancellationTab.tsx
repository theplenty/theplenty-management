import { Field } from './Field';
import AutoExpandTextarea from './AutoExpandTextarea';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  CATHOLIC_REFUND_STATUS_OPTIONS,
  type Cancellation,
  type CatholicRefundStatus,
} from '../types';

export type CancellationDraft = Omit<Cancellation, 'id' | 'event_id'>;

export function emptyCancellationDraft(): CancellationDraft {
  return {
    cancel_requested_at: null,
    cancel_reason: '',
    plenty_cancel_fee: null,
    plenty_cancel_fee_paid_at: null,
    catholic_rental_refund_status: '',
  };
}

interface Props {
  draft: CancellationDraft;
  onChange: (next: CancellationDraft) => void;
}

export default function CancellationTab({ draft, onChange }: Props) {
  function set<K extends keyof CancellationDraft>(key: K, value: CancellationDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  const feeStr =
    draft.plenty_cancel_fee != null
      ? formatKoreanCommas(String(draft.plenty_cancel_fee))
      : '';

  function onFeeChange(s: string) {
    const formatted = formatKoreanCommas(s);
    const digits = formatted.replace(/[^\d]/g, '');
    set('plenty_cancel_fee', digits ? Number(digits) : null);
  }

  return (
    <div>
      <div className="text-sm text-gray-600 mb-4">
        행사 상태가 <strong>LOS</strong>일 때만 입력 가능합니다. 상태가 LOS에서 다른 값으로
        변경되면 이 탭의 정보는 자동으로 삭제됩니다.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="취소 요청 일시">
          <input
            type="datetime-local"
            className="input"
            value={draft.cancel_requested_at || ''}
            onChange={(e) => set('cancel_requested_at', e.target.value || null)}
          />
        </Field>

        <Field label="가톨릭 대관료 환불 상태">
          <select
            className="input"
            value={draft.catholic_rental_refund_status}
            onChange={(e) =>
              set('catholic_rental_refund_status', e.target.value as CatholicRefundStatus)
            }
          >
            {CATHOLIC_REFUND_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || '선택 안 함'}
              </option>
            ))}
          </select>
        </Field>

        <Field label="취소 사유" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.cancel_reason}
            placeholder="고객 사정 / 일정 변경 / 예산 미달 등"
            onChange={(e) => set('cancel_reason', e.target.value)}
          />
        </Field>

        <Field label="플렌티 취소수수료 금액 (원)">
          <input
            className="input text-right tabular-nums"
            value={feeStr}
            placeholder="0"
            inputMode="numeric"
            onChange={(e) => onFeeChange(e.target.value)}
          />
        </Field>

        <Field label="플렌티 취소수수료 입금일자">
          <input
            type="date"
            className="input"
            value={draft.plenty_cancel_fee_paid_at || ''}
            onChange={(e) => set('plenty_cancel_fee_paid_at', e.target.value || null)}
          />
        </Field>
      </div>
    </div>
  );
}
