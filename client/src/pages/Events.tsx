import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { canCreateEvent, isAdmin } from '../auth/permissions';
import { useAuth } from '../auth/AuthContext';
import {
  type Cancellation,
  type Event,
  type EventCustomerLink,
  type EventStatus,
  type EventWithFood,
  type CustomerType,
  type Invoice,
} from '../types';
import { StatusBadge } from '../components/Field';
import ExcelButtons from '../components/ExcelButtons';
import EventFormModal from '../components/EventFormModal';
import type { ColumnDef } from '../lib/excel';

// 행사 목록 엑셀 컬럼 — food_items는 요약 텍스트로
const EVENT_COLUMNS: ColumnDef<EventWithFood>[] = [
  { header: '구분', key: 'event_type', width: 10 },
  { header: '상태', key: 'status', width: 8 },
  { header: '이용시간', key: 'usage_type', width: 10 },
  {
    header: '사용홀',
    key: 'halls',
    width: 24,
    format: (v) => (Array.isArray(v) ? v.join(' / ') : ''),
    parse: (v) => (typeof v === 'string' ? v.split(/\s*\/\s*/).filter(Boolean) : []),
  },
  { header: '시작일시', key: 'start_datetime', width: 18 },
  { header: '종료일시', key: 'end_datetime', width: 18 },
  { header: '행사명', key: 'event_name', width: 32 },
  { header: '좌석수', key: 'seats', width: 10 },
  { header: '식음 GTD (계약)', key: 'food_gtd_contract', width: 12 },
  { header: '식음 EXP (계약)', key: 'food_exp_contract', width: 12 },
  { header: '식음 GTD (최종)', key: 'food_gtd_final', width: 12 },
  { header: '식음 EXP (최종)', key: 'food_exp_final', width: 12 },
  {
    header: '식음 메뉴 요약',
    key: 'food_items',
    width: 36,
    format: (v) =>
      Array.isArray(v)
        ? (v as { menu_name: string }[]).map((f) => f.menu_name).join(', ')
        : '',
    // 가져올 때는 요약을 다시 항목으로 풀지 않음 (사용자가 행사 화면에서 입력)
    parse: () => [],
  },
  // 작성일자/작성자 — 일괄등록 시 직접 지정 가능 (비워두면 현재 사용자/현재시각으로 자동 입력)
  { header: '작성일자', key: 'created_at', width: 20 },
  { header: '작성자', key: 'created_by_name', width: 14 },
];

export default function Events() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'MICE' | 'WEDDING'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | EventStatus>('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EventWithFood | null>(null);
  const [editingLinks, setEditingLinks] = useState<EventCustomerLink[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingCancellation, setEditingCancellation] = useState<Cancellation | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ events: EventWithFood[] }>('/api/events');
      setEvents(res.events);
    } catch (e) {
      setError('행사 목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const admin = isAdmin(user?.role);

  async function deleteEvent(e: EventWithFood, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (
      !confirm(
        `[${e.event_name}] 행사를 삭제하시겠습니까?\n식음 메뉴, 업체 연결, 가톨릭대관료, 첨부파일, 행사리뷰가 모두 함께 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`
      )
    )
      return;
    try {
      await api.delete(`/api/events/${e.id}`);
      setEvents((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      alert('삭제 실패 (관리자 권한이 필요합니다)');
      console.error(err);
    }
  }

  const filtered = useMemo(() => {
    return events
      .filter((e) => filterType === 'ALL' || e.event_type === filterType)
      .filter((e) => filterStatus === 'ALL' || e.status === filterStatus)
      .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1));
  }, [events, filterType, filterStatus]);

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
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">행사 목록</h1>
        <div className="flex items-center gap-2">
          <ExcelButtons
            filename={`행사목록_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="행사 목록"
            columns={EVENT_COLUMNS}
            rows={events}
            onImportRows={async (rows) => {
              let ok = 0;
              let failed = 0;
              for (const r of rows) {
                try {
                  const payload = { ...r, food_items: [] };
                  const res = await api.post<{ event: Event; food_items: [] }>(
                    '/api/events',
                    payload
                  );
                  setEvents((prev) => [{ ...res.event, food_items: [] }, ...prev]);
                  ok++;
                } catch (e) {
                  console.error('import row failed', r, e);
                  failed++;
                }
              }
              return { ok, failed };
            }}
          />
          {canCreateEvent(user?.role) && (
            <button
              onClick={() => {
                setEditing(null);
                setEditingLinks([]);
                setEditingInvoice(null);
                setEditingCancellation(null);
                setModalOpen(true);
              }}
              className="btn-primary"
            >
              + 행사 등록
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-3 mb-4 flex items-center gap-3 text-xs">
        <select
          className="input !py-1 !text-xs !w-auto"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as typeof filterType)}
        >
          <option value="ALL">전체 구분</option>
          <option value="MICE">MICE</option>
          <option value="WEDDING">WEDDING</option>
        </select>
        <select
          className="input !py-1 !text-xs !w-auto"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
        >
          <option value="ALL">전체 상태</option>
          <option value="INQ">INQ</option>
          <option value="TEN">TEN</option>
          <option value="DEF">DEF</option>
          <option value="LOS">LOS</option>
        </select>
        <span className="ml-auto text-gray-500">총 {filtered.length}건</span>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <Th>구분</Th>
                <Th>상태</Th>
                <Th>이용시간</Th>
                <Th>사용홀</Th>
                <Th>시작일시</Th>
                <Th>종료일시</Th>
                <Th>행사명</Th>
                <Th>좌석</Th>
                <Th>GTD<br /><span className="text-[10px] font-normal text-gray-400">계약/최종</span></Th>
                <Th>EXP<br /><span className="text-[10px] font-normal text-gray-400">계약/최종</span></Th>
                <Th>메뉴</Th>
                {admin && <Th></Th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={admin ? 12 : 11} className="text-center text-gray-400 py-8">
                    불러오는 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={admin ? 12 : 11} className="text-center text-gray-400 py-8">
                    등록된 행사가 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((e) => (
                  <tr
                    key={e.id}
                    onClick={async () => {
                      setEditing(e);
                      setModalOpen(true);
                      try {
                        const r = await api.get<{
                          customer_links: EventCustomerLink[];
                          invoice: Invoice | null;
                          cancellation: Cancellation | null;
                        }>(`/api/events/${e.id}`);
                        setEditingLinks(r.customer_links || []);
                        setEditingInvoice(r.invoice);
                        setEditingCancellation(r.cancellation);
                      } catch (err) {
                        console.error(err);
                        setEditingLinks([]);
                        setEditingInvoice(null);
                        setEditingCancellation(null);
                      }
                    }}
                    className="border-t hover:bg-blue-50 cursor-pointer"
                  >
                    <Td>{e.event_type}</Td>
                    <Td>
                      <StatusBadge value={e.status} variant={e.status} />
                    </Td>
                    <Td>{e.usage_type || '-'}</Td>
                    <Td>{e.halls.join(' / ') || '-'}</Td>
                    <Td>{fmt(e.start_datetime)}</Td>
                    <Td>{fmt(e.end_datetime)}</Td>
                    <Td className="font-medium text-gray-900">{e.event_name}</Td>
                    <Td>{e.seats ?? '-'}</Td>
                    <Td className="text-xs">
                      {e.food_gtd_contract ?? '-'}
                      <span className="text-gray-400"> / </span>
                      <span className="font-semibold">{e.food_gtd_final ?? '-'}</span>
                    </Td>
                    <Td className="text-xs">
                      {e.food_exp_contract ?? '-'}
                      <span className="text-gray-400"> / </span>
                      <span className="font-semibold">{e.food_exp_final ?? '-'}</span>
                    </Td>
                    <Td className="text-xs text-gray-500 max-w-[18rem] truncate">
                      {e.food_items.map((f) => f.menu_name).join(', ') || '-'}
                    </Td>
                    {admin && (
                      <Td>
                        <button
                          onClick={(ev) => deleteEvent(e, ev)}
                          className="text-xs text-red-600 hover:underline"
                          title="관리자 전용 — 행사 삭제"
                        >
                          삭제
                        </button>
                      </Td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EventFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialEvent={editing}
        initialFoodItems={editing?.food_items || []}
        initialCustomerLinks={editingLinks}
        initialInvoice={editingInvoice}
        initialCancellation={editingCancellation}
        initialDate={null}
        allowedTypes={allowedTypes.length ? allowedTypes : ['MICE']}
        otherEvents={events as Event[]}
        onSaved={(saved) => {
          setEvents((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx === -1) return [saved, ...prev];
            const next = prev.slice();
            next[idx] = saved;
            return next;
          });
        }}
        onDeleted={(eventId) => setEvents((prev) => prev.filter((p) => p.id !== eventId))}
      />
    </div>
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

function fmt(s: string): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
