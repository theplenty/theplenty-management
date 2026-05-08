import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { canWriteReview } from '../auth/permissions';
import EventFormModal from '../components/EventFormModal';
import {
  type Event,
  type EventCustomerLink,
  type EventWithFood,
  type FoodItem,
  type Invoice,
  type Cancellation,
  type CustomerType,
} from '../types';

interface EligibleEvent extends Event {
  has_review: boolean;
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Reviews() {
  const { user } = useAuth();
  const writable = canWriteReview(user?.role);

  const [list, setList] = useState<EligibleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'WAITING' | 'WRITTEN'>('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EventWithFood | null>(null);
  const [editingLinks, setEditingLinks] = useState<EventCustomerLink[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingCancellation, setEditingCancellation] = useState<Cancellation | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ events: EligibleEvent[] }>('/api/event-reviews/eligible');
      setList(res.events);
    } catch (e) {
      setError('목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return list
      .filter((e) => {
        if (filter === 'WAITING') return !e.has_review;
        if (filter === 'WRITTEN') return e.has_review;
        return true;
      })
      .sort((a, b) => (a.end_datetime < b.end_datetime ? 1 : -1));
  }, [list, filter]);

  async function openEvent(e: EligibleEvent) {
    try {
      const res = await api.get<{
        event: Event;
        food_items: FoodItem[];
        customer_links: EventCustomerLink[];
        invoice: Invoice | null;
        cancellation: Cancellation | null;
      }>(`/api/events/${e.id}`);
      setEditing({ ...res.event, food_items: res.food_items });
      setEditingLinks(res.customer_links || []);
      setEditingInvoice(res.invoice);
      setEditingCancellation(res.cancellation);
      setModalOpen(true);
    } catch (err) {
      alert('행사 정보를 불러오지 못했습니다.');
      console.error(err);
    }
  }

  const allowedTypes: CustomerType[] = useMemo(() => {
    if (
      user?.role === 'admin' ||
      user?.role === 'sales_mice' ||
      user?.role === 'sales_wedding'
    ) {
      return ['MICE', 'WEDDING'];
    }
    return [];
  }, [user]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">연회팀 행사리뷰</h1>
        {!writable && <span className="badge bg-gray-100 text-gray-600">조회 전용</span>}
      </div>

      <p className="text-sm text-gray-500 mb-4">
        DEF 상태 + 종료된 행사가 표시됩니다. 행사를 클릭하면 행사리뷰 탭에서 작성·확인할 수
        있습니다.
        {!writable && (
          <span className="block mt-1 text-xs">
            작성·수정은 관리자 / 연회팀만 가능하며, 그 외 권한은 조회만 가능합니다.
          </span>
        )}
      </p>

      <div className="bg-white border rounded-lg p-3 mb-4 flex items-center gap-3 text-xs flex-wrap">
        <select
          className="input !py-1 !text-xs !w-auto"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="ALL">전체</option>
          <option value="WAITING">리뷰 미작성</option>
          <option value="WRITTEN">리뷰 작성됨</option>
        </select>
        <span className="ml-auto text-gray-500">총 {filtered.length}건</span>
        <button onClick={load} className="btn-secondary !py-1 text-xs">
          새로고침
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">구분</th>
              <th className="text-left px-3 py-2 font-semibold">행사명</th>
              <th className="text-left px-3 py-2 font-semibold">시작일시</th>
              <th className="text-left px-3 py-2 font-semibold">종료일시</th>
              <th className="text-left px-3 py-2 font-semibold">사용홀</th>
              <th className="text-left px-3 py-2 font-semibold">리뷰 상태</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8">
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8">
                  대상 행사가 없습니다. (DEF 상태 + 종료된 행사만 표시)
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => openEvent(e)}
                  className="border-t hover:bg-blue-50 cursor-pointer"
                >
                  <td className="px-3 py-2">{e.event_type}</td>
                  <td className="px-3 py-2 font-medium text-gray-900">{e.event_name}</td>
                  <td className="px-3 py-2 text-gray-600">{fmt(e.start_datetime)}</td>
                  <td className="px-3 py-2 text-gray-600">{fmt(e.end_datetime)}</td>
                  <td className="px-3 py-2">{e.halls.join(' / ') || '-'}</td>
                  <td className="px-3 py-2">
                    {e.has_review ? (
                      <span className="badge bg-green-100 text-green-800">작성 완료</span>
                    ) : (
                      <span className="badge bg-yellow-100 text-yellow-800">미작성</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <EventFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          // 리뷰 저장이 일어났을 수도 있으니 목록 갱신
          load();
        }}
        initialEvent={editing}
        initialFoodItems={editing?.food_items || []}
        initialCustomerLinks={editingLinks}
        initialInvoice={editingInvoice}
        initialCancellation={editingCancellation}
        initialDate={null}
        allowedTypes={allowedTypes.length ? allowedTypes : ['MICE']}
        otherEvents={list as Event[]}
        onSaved={() => {
          // 리뷰는 별도 API라 onSaved 안에서 처리 안 함 — 모달 close 시 reload
        }}
        onDeleted={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}
