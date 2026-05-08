import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, required, hint, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

interface StatusBadgeProps {
  value: string;
  variant?: string;
}

const STATUS_STYLES: Record<string, string> = {
  INQ: 'bg-gray-200 text-gray-700',
  TEN: 'bg-yellow-200 text-yellow-900',
  DEF: 'bg-green-200 text-green-900',
  LOS: 'bg-red-200 text-red-900 line-through',
  X: 'bg-gray-100 text-gray-500',
  단순문의: 'bg-gray-100 text-gray-500',
  신규문의: 'bg-blue-100 text-blue-800',
  상담: 'bg-indigo-100 text-indigo-800',
  상담취소: 'bg-orange-100 text-orange-800 line-through',
};

export function StatusBadge({ value, variant }: StatusBadgeProps) {
  const v = variant || value;
  const cls = STATUS_STYLES[v] || 'bg-gray-100 text-gray-700';
  return <span className={`badge ${cls}`}>{value}</span>;
}
