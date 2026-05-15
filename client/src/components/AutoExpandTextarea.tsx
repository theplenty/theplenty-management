import { useEffect, useRef, type ChangeEvent, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
};

// 입력 내용 길이에 따라 height 가 자동으로 늘어나는 textarea.
// 스크롤바를 만들지 않고 전체 내용을 한 화면에 노출 — 행사 메모처럼 짧을 때는 1줄,
// 길어지면 그만큼 늘어남.
export default function AutoExpandTextarea({ value, onChange, className, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // value 가 바뀌거나 컴포넌트가 마운트될 때 높이 재계산
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={1}
      className={(className || '') + ' resize-none overflow-hidden'}
      {...rest}
    />
  );
}
