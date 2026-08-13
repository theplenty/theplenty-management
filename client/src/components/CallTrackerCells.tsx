// 콜 트래커 셀 — MICE 고객정보 표 안에서 바로 눌러 바꾸는 칸들.
//
// 팀이 매일 보는 건 메모가 아니라 콜백 기한과 체크 네 개다.
// 모달을 열어야 바꿀 수 있으면 안 쓰게 되므로, 목록에서 바로 편집한다.
import { needsCall, type CallbackView } from '../lib/callTracker';

export function DdayChip({ view }: { view: CallbackView }) {
  if (view.state === 'none') return <span className="text-xs text-gray-300">–</span>;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${view.cls}`}>
      {view.label}
    </span>
  );
}

export function CallbackCell({
  value,
  view,
  disabled,
  onChange,
  onToggleDone,
}: {
  value: string;
  view: CallbackView;
  disabled: boolean;
  onChange: (v: string | null) => void;
  /** "더 이상 콜백 안 함" 토글. 확정/취소 건은 이미 종료라 버튼을 내보내지 않는다. */
  onToggleDone: (done: boolean) => void;
}) {
  const canClose = needsCall(view.state) || view.state === 'done';
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        // 행 클릭(수정 모달 열기)까지 번지지 않게 — 날짜만 바꾸려던 건데 모달이 뜨면 성가시다
        onClick={(e) => e.stopPropagation()}
        className="border rounded px-1 py-0.5 text-xs w-[7.5rem] disabled:bg-gray-50"
      />
      <DdayChip view={view} />
      {canClose && !disabled && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone(view.state !== 'done');
          }}
          title={view.state === 'done' ? '콜백 다시 열기' : '더 이상 콜백하지 않음으로 표시'}
          className={`text-xs px-1 rounded leading-5 ${
            view.state === 'done'
              ? 'text-gray-400 hover:text-gray-600'
              : 'text-gray-300 hover:text-emerald-600 hover:bg-emerald-50'
          }`}
        >
          {view.state === 'done' ? '↩' : '✓'}
        </button>
      )}
    </div>
  );
}

export function CheckCell({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="block text-center">
      <input
        type="checkbox"
        className="w-4 h-4 cursor-pointer disabled:cursor-default"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    </span>
  );
}
