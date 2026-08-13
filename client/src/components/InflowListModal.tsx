// 신규유입 리스트 모달 — 대시보드의 카드 클릭 시 표시.
// MICE / WEDDING 별로 컬럼이 다르므로 두 가지 모드 지원.

import { weekdayKoOf, insertWeekday } from '../lib/dateFmt';
import Modal from './Modal';
import { StatusBadge } from './Field';
import { miceStatusLabel } from '../types';
import type {
  MiceInflowRow,
  WeddingInflowRow,
} from '../lib/dashboardStats';

type Mode = 'MICE' | 'WEDDING';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  title: string;
  miceRows?: MiceInflowRow[];
  weddingRows?: WeddingInflowRow[];
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)})`;
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 날짜만 저장된 값은 그대로, 시간이 포함된 값은 시간까지 표시
function fmtDateOrDateTime(s: string | null | undefined): string {
  if (!s) return '-';
  if (!s.includes('T')) return insertWeekday(s);
  return fmtDateTime(s);
}

export default function InflowListModal({
  open,
  onClose,
  mode,
  title,
  miceRows,
  weddingRows,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      widthClass="max-w-6xl"
      footer={
        <button onClick={onClose} className="btn-secondary">
          닫기
        </button>
      }
    >
      {mode === 'MICE' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <Th>구분</Th>
                <Th>소속</Th>
                <Th>담당자</Th>
                <Th>연락처</Th>
                <Th>이메일</Th>
                <Th>통화일자</Th>
                <Th>문의행사일</Th>
                <Th>진행상황</Th>
                <Th>비고</Th>
              </tr>
            </thead>
            <tbody>
              {(miceRows || []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-gray-400 py-8">
                    해당 조건에 맞는 신규유입이 없습니다.
                  </td>
                </tr>
              ) : (
                (miceRows || []).map((r) => (
                  <tr key={r.inquiry_id} className="border-t hover:bg-gray-50">
                    <Td>{r.mice_category}</Td>
                    <Td className="font-medium text-gray-900">{r.organization_name}</Td>
                    <Td>{r.contact_name || '-'}</Td>
                    <Td>{r.phone || '-'}</Td>
                    <Td className="text-gray-600">{r.email || '-'}</Td>
                    <Td>{fmtDate(r.call_date)}</Td>
                    <Td>{r.inquiry_event_date_text || '-'}</Td>
                    <Td>
                      <StatusBadge value={miceStatusLabel(r.progress_status)} variant={r.progress_status} />
                    </Td>
                    <Td className="max-w-[14rem] truncate" title={r.customer_memo}>
                      {r.customer_memo || '-'}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <Th>행사명</Th>
                <Th>신규문의일자</Th>
                <Th>희망상담일자</Th>
                <Th>예식날짜</Th>
                <Th>진행단계</Th>
                <Th>신랑</Th>
                <Th>신부</Th>
                <Th>유입경로</Th>
                <Th>유입세부경로</Th>
                <Th>담당지배인</Th>
                <Th>견적비용</Th>
              </tr>
            </thead>
            <tbody>
              {(weddingRows || []).length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center text-gray-400 py-8">
                    해당 조건에 맞는 신규유입이 없습니다.
                  </td>
                </tr>
              ) : (
                (weddingRows || []).map((r) => (
                  <tr key={r.customer_id} className="border-t hover:bg-gray-50">
                    <Td className="font-medium text-gray-900">{r.wedding_event_name}</Td>
                    <Td>{fmtDateOrDateTime(r.inquiry_date)}</Td>
                    <Td>{fmtDateOrDateTime(r.desired_consultation_date)}</Td>
                    <Td>{fmtDateTime(r.wedding_datetime)}</Td>
                    <Td>
                      <StatusBadge value={r.progress_status} variant={r.progress_status} />
                    </Td>
                    <Td>
                      {r.groom_name || '-'}
                      <div className="text-xs text-gray-500">{r.groom_phone}</div>
                    </Td>
                    <Td>
                      {r.bride_name || '-'}
                      <div className="text-xs text-gray-500">{r.bride_phone}</div>
                    </Td>
                    <Td>{r.source || '-'}</Td>
                    <Td>{r.source_detail || '-'}</Td>
                    <Td>{r.assigned_manager_name || '-'}</Td>
                    <Td>{r.estimate_amount || '-'}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-3 py-2 font-semibold border-b">{children}</th>;
}
function Td({
  children,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { children?: React.ReactNode }) {
  return (
    <td className={`px-3 py-2 ${className || ''}`} {...rest}>
      {children}
    </td>
  );
}
