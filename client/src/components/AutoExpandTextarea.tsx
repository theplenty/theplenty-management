import { useEffect, useRef, type ChangeEvent, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  /** 비어 있을 때 보일 줄 수 (기본 1줄) */
  minRows?: number;
  /** 이 줄 수를 넘으면 더 늘리지 않고 안에서 스크롤 (기본 20줄) */
  maxRows?: number;
};

// 입력 내용에 맞춰 높이가 저절로 늘어나는 textarea.
//
// 메모 칸이 고정 높이라 볼 때마다 모서리를 끌어 늘려야 했다 — 그게 번거로워서 만든 것.
// 비어 있으면 1줄, 10줄이면 10줄. 다만 무한정 늘리지는 않는다: 수백 줄짜리 메모가
// 들어오면 모달 전체가 밀려 저장 버튼까지 안 보이므로, maxRows 를 넘으면 스크롤로 넘긴다.
export default function AutoExpandTextarea({
  value,
  onChange,
  className,
  minRows = 1,
  maxRows = 20,
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // value 가 바뀌거나 마운트될 때 높이 재계산.
  // 모달이 열리면서 내용을 그대로 받는 경우가 많아 마운트 시 계산이 특히 중요하다.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 한 줄 높이는 실제 계산된 line-height 에서 읽는다 (폰트·클래스가 화면마다 다름)
    const cs = window.getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) || 0;
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) || 0;
    const max = line * maxRows + pad + border;

    el.style.height = 'auto';
    const needed = el.scrollHeight;
    const capped = Math.min(needed, max);
    el.style.height = capped + 'px';
    // 한도에 닿았을 때만 스크롤을 허용 — 평소엔 스크롤바가 안 보이는 게 깔끔하다
    el.style.overflowY = needed > max ? 'auto' : 'hidden';
  }, [value, maxRows]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      // resize-y 유지 — 자동 높이가 마음에 안 들면 사용자가 직접 끌 수 있게
      className={(className || '') + ' resize-y'}
      {...rest}
    />
  );
}
