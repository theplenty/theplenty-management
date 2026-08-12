// 콜 트래커 셀 — MICE 고객정보 표 안에서 바로 눌러 바꾸는 칸들.
//
// 팀이 매일 보는 건 메모가 아니라 콜백 기한과 체크 네 개다.
// 모달을 열어야 바꿀 수 있으면 안 쓰게 되므로, 목록에서 바로 편집한다.
import { daysLeft } from '../lib/callTracker';

export function DdayChip({ due }: { due?: string | null }) {
  const n = daysLeft(due);
  if (n === null) return <span className="text-xs text-gray-300">–</span>;
  const style =
    n < 0
      ? 'bg-red-100 text-red-800'
      : n === 0
        ? 'bg-red-600 text-white'
        : n <= 2
          ? 'bg-amber-100 text-amber-800'
          : 'bg-gray-100 text-gray-600';
  const text = n < 0 ? `${-n}일 지남` : n === 0 ? '오늘' : `D-${n}`;
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${style}`}>
      {text}
    </span>
  );
}

export function CallbackCell({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
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
      <DdayChip due={value} />
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
