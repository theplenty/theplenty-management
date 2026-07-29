import { weekdayKoOf } from '../lib/dateFmt';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { type EventStatus, STATUS_HEX } from '../types';

// 한 고객이 연결된 행사 목록을 표시. 편집 모달과 프로필 페이지 양쪽에서 사용.
// /api/customers/{type}/:id/full 호출.

interface LinkedEvent {
  id: string;
  event_type: string;
  status: EventStatus;
  start_datetime: string;
  end_datetime: string;
  event_name: string;
  halls: string[];
  customer_role: string | null;
  is_contact_point: boolean;
  invoice_payment_status: string | null;
  cancellation: { reason: string } | null;
  has_review: boolean;
}

interface Props {
  customerType: 'mice' | 'wedding';
  customerId: string | null;
  // 프로필 페이지에서는 자체적으로 데이터를 이미 fetch 하므로 외부에서 주입 가능
  initialEvents?: LinkedEvent[];
  showProfileLink?: boolean; // 모달에서 보일 때 프로필 페이지 이동 링크 노출
}

function fmt(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LinkedEventsSection({
  customerType,
  customerId,
  initialEvents,
  showProfileLink = false,
}: Props) {
  const [events, setEvents] = useState<LinkedEvent[]>(initialEvents || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEvents) {
      setEvents(initialEvents);
      return;
    }
    if (!customerId) {
      setEvents([]);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .get<{ linked_events: LinkedEvent[] }>(`/api/customers/${customerType}/${customerId}/full`)
      .then((res) => setEvents(res.linked_events || []))
      .catch((e) => {
        setError('연결된 행사를 불러오지 못했습니다.');
        console.error('[LinkedEventsSection]', e);
      })
      .finally(() => setLoading(false));
  }, [customerType, customerId, initialEvents]);

  if (!customerId) {
    return (
      <div className="text-xs text-gray-400 italic py-2">
        새 고객 등록 후 행사와 연결할 수 있습니다.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-600">
          {loading ? '불러오는 중...' : `총 ${events.length}건`}
        </div>
        {showProfileLink && (
          <Link
            to={`/customer/${customerType}/${customerId}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-600 hover:underline"
            title="새 탭에서 통합 프로필 페이지 열기"
          >
            📄 통합 프로필 페이지 열기 ↗
          </Link>
        )}
      </div>
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-2">
          {error}
        </div>
      )}
      {events.length === 0 && !loading && !error ? (
        <div className="text-xs text-gray-400 italic py-2 text-center">
          이 고객과 연결된 행사가 아직 없습니다.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {events.map((ev) => (
            <LinkedEventCard key={ev.id} ev={ev} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkedEventCard({ ev }: { ev: LinkedEvent }) {
  const halls = ev.halls.join(' / ') || '홀 미지정';
  const color = STATUS_HEX[ev.status] || '#6b7280';
  return (
    <li>
      <Link
        to={`/events?focus=${ev.id}`}
        className="block w-full text-left border rounded p-2.5 hover:bg-blue-50 active:bg-blue-100 transition no-underline text-current"
      >
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="badge bg-gray-100 text-gray-700 text-[10px]">{ev.event_type}</span>
          <span className="badge text-white text-[10px]" style={{ background: color }}>
            {ev.status}
          </span>
          {ev.customer_role && (
            <span className="badge bg-purple-100 text-purple-800 text-[10px]">
              {ev.customer_role}
            </span>
          )}
          {ev.is_contact_point && (
            <span className="badge bg-blue-100 text-blue-800 text-[10px]">CP</span>
          )}
          {ev.has_review && (
            <span className="badge bg-emerald-100 text-emerald-800 text-[10px]">리뷰</span>
          )}
        </div>
        <div className="font-semibold text-sm text-gray-900 truncate">
          {ev.event_name || '(이름 없음)'}
        </div>
        <div className="text-xs text-gray-600 mt-0.5">
          {fmt(ev.start_datetime)} ~ {fmt(ev.end_datetime)} · {halls}
        </div>
        {ev.invoice_payment_status && (
          <div className="text-[11px] text-gray-500 mt-0.5">결제: {ev.invoice_payment_status}</div>
        )}
        {ev.cancellation?.reason && (
          <div className="text-[11px] text-red-600 mt-0.5">취소: {ev.cancellation.reason}</div>
        )}
      </Link>
    </li>
  );
}
