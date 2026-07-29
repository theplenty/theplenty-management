import { weekdayKoOf } from '../lib/dateFmt';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { canWriteReview } from '../auth/permissions';
import EventFormModal from '../components/EventFormModal';
import ExcelButtons from '../components/ExcelButtons';
import { useTableControls, compareSortValues } from '../lib/useTableControls';
import {
  type Event,
  type EventCustomerLink,
  type EventReview,
  type EventWithFood,
  type FoodItem,
  type Invoice,
  type Cancellation,
  type CustomerType,
} from '../types';
import type { ColumnDef } from '../lib/excel';

interface EligibleEvent extends Event {
  has_review: boolean;
}

// 엑셀 행: 행사 식별 정보 + 리뷰 필드 평탄화.
// event_id는 import 시 매칭 키이므로 첫 번째 컬럼에 둠 — 사용자는 보통 행 추가 시 그대로 둠.
interface ReviewFlatRow {
  event_id: string;
  event_name: string;
  event_type: string;
  end_datetime: string;
  banquet_manager: string;
  actual_meal_count: number | null;
  paid_meal_count: number | null;
  additional_sales: string;
  system_issues: string;
  event_special_notes: string;
  flower_issues: string;
  next_event_feedback: string;
  general_comment: string;
  final_revenue: number | null;
}

function parseNumOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[^\d.-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const REVIEW_COLUMNS: ColumnDef<ReviewFlatRow>[] = [
  { header: '행사 ID', key: 'event_id', width: 14 }, // 매칭 키 — 수정 금지
  { header: '행사명', key: 'event_name', width: 32 }, // 읽기 전용 표시
  { header: '구분', key: 'event_type', width: 10 },
  { header: '종료일시', key: 'end_datetime', width: 18 },
  { header: '행사담당자', key: 'banquet_manager', width: 14 },
  { header: '실제 식사 인원', key: 'actual_meal_count', width: 12, parse: parseNumOrNull },
  { header: '결제 식사 인원', key: 'paid_meal_count', width: 12, parse: parseNumOrNull },
  { header: '추가 판매 항목/매출', key: 'additional_sales', width: 30 },
  { header: '시스템 이슈', key: 'system_issues', width: 30 },
  { header: '행사 중 특이사항', key: 'event_special_notes', width: 30 },
  { header: '플라워 이슈', key: 'flower_issues', width: 30 },
  { header: '다음 행사 피드백', key: 'next_event_feedback', width: 30 },
  { header: '종합 코멘트', key: 'general_comment', width: 40 },
  { header: '최종 매출액', key: 'final_revenue', width: 14, parse: parseNumOrNull },
];

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 테이블 헤더 클릭 정렬용 — key별 sortValue 매핑. has_review 는 boolean → number 로 변환.
const REVIEW_SORTERS: Record<string, ((e: EligibleEvent) => string | number) | undefined> = {
  event_type: (e) => e.event_type,
  event_name: (e) => e.event_name,
  start_datetime: (e) => e.start_datetime,
  end_datetime: (e) => e.end_datetime,
  halls: (e) => e.halls.join(' / '),
  has_review: (e) => (e.has_review ? 1 : 0),
};

interface ReviewHeader {
  key: string;
  label: string;
}
const REVIEW_HEADERS: ReviewHeader[] = [
  { key: 'event_type', label: '구분' },
  { key: 'event_name', label: '행사명' },
  { key: 'start_datetime', label: '시작일시' },
  { key: 'end_datetime', label: '종료일시' },
  { key: 'halls', label: '사용홀' },
  { key: 'has_review', label: '리뷰 상태' },
];

export default function Reviews() {
  const { user } = useAuth();
  const writable = canWriteReview(user?.role);

  const [list, setList] = useState<EligibleEvent[]>([]);
  const [reviews, setReviews] = useState<EventReview[]>([]);
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
      const [eligibleRes, reviewsRes] = await Promise.all([
        api.get<{ events: EligibleEvent[] }>('/api/event-reviews/eligible'),
        api.get<{ reviews: EventReview[] }>('/api/event-reviews/_all').catch(() => ({
          reviews: [],
        })),
      ]);
      setList(eligibleRes.events);
      setReviews(reviewsRes.reviews);
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

  // 컬럼 클릭 정렬 — 기본은 종료일시 내림차순 (최근 종료 행사가 위에).
  const tc = useTableControls({
    storageKey: 'reviews_table',
    defaultSort: { key: 'end_datetime', dir: 'desc' },
  });

  const filtered = useMemo(() => {
    const base = list.filter((e) => {
      if (filter === 'WAITING') return !e.has_review;
      if (filter === 'WRITTEN') return e.has_review;
      return true;
    });
    const sortFn = REVIEW_SORTERS[tc.sort.key || ''];
    if (!sortFn) {
      // 기본 정렬 fallback — 종료일시 desc
      return [...base].sort((a, b) => (a.end_datetime < b.end_datetime ? 1 : -1));
    }
    return [...base].sort((a, b) => compareSortValues(sortFn(a), sortFn(b), tc.sort.dir));
  }, [list, filter, tc.sort]);

  async function openEvent(e: EligibleEvent) {
    console.log('[리뷰] 행사 열기 시도', { id: e.id, name: e.event_name, status: e.status });
    try {
      const res = await api.get<{
        event: Event;
        food_items: FoodItem[];
        customer_links: EventCustomerLink[];
        invoice: Invoice | null;
        cancellation: Cancellation | null;
      }>(`/api/events/${e.id}`);
      console.log('[리뷰] 행사 데이터 OK', {
        id: res.event?.id,
        food_items_count: res.food_items?.length,
        invoice: !!res.invoice,
        cancellation: !!res.cancellation,
      });
      // 데이터 raw 덤프 — 어느 필드가 React #31 을 유발하는지 식별용
      console.log('[리뷰] 데이터 raw', JSON.parse(JSON.stringify(res)));
      if (!res.event) {
        alert('서버에서 행사 데이터를 받지 못했습니다. 행사 ID: ' + e.id);
        return;
      }
      setEditing({ ...res.event, food_items: res.food_items || [] });
      setEditingLinks(res.customer_links || []);
      setEditingInvoice(res.invoice);
      setEditingCancellation(res.cancellation);
      setModalOpen(true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      console.error('[리뷰] 행사 데이터 fetch 실패', { id: e.id, status, err });
      if (status === 404) {
        alert(
          `행사를 찾을 수 없습니다 (ID: ${e.id}).\n휴지통(/admin/trash)에 있거나 영구 삭제된 행사일 수 있습니다.`
        );
      } else if (status === 403) {
        alert('이 행사를 볼 권한이 없습니다.');
      } else {
        alert(`행사 정보를 불러오지 못했습니다.\n오류: HTTP ${status || '알 수 없음'}`);
      }
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

  // 엑셀 export용 평탄화 — 리뷰 작성 대상 행사 모두를 한 행씩. 리뷰가 있으면 값 채움, 없으면 빈 값.
  const flatRows = useMemo<ReviewFlatRow[]>(() => {
    const reviewByEventId = new Map(reviews.map((r) => [r.event_id, r]));
    return list.map((e) => {
      const r = reviewByEventId.get(e.id);
      return {
        event_id: e.id,
        event_name: e.event_name,
        event_type: e.event_type,
        end_datetime: e.end_datetime,
        banquet_manager: r?.banquet_manager || '',
        actual_meal_count: r?.actual_meal_count ?? null,
        paid_meal_count: r?.paid_meal_count ?? null,
        additional_sales: r?.additional_sales || '',
        system_issues: r?.system_issues || '',
        event_special_notes: r?.event_special_notes || '',
        flower_issues: r?.flower_issues || '',
        next_event_feedback: r?.next_event_feedback || '',
        general_comment: r?.general_comment || '',
        final_revenue: r?.final_revenue ?? null,
      };
    });
  }, [list, reviews]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold">연회팀 행사리뷰</h1>
          {!writable && <span className="badge bg-gray-100 text-gray-600">조회 전용</span>}
        </div>
        {writable && (
          <ExcelButtons
            filename={`행사리뷰_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="행사 리뷰"
            importLabel="행사 리뷰"
            columns={REVIEW_COLUMNS}
            rows={flatRows}
            onImportRows={async (rows, dryRun) => {
              const payload = rows.map((r) => {
                const x = r as Partial<ReviewFlatRow>;
                return {
                  event_id: x.event_id || '',
                  banquet_manager: x.banquet_manager,
                  actual_meal_count: x.actual_meal_count,
                  paid_meal_count: x.paid_meal_count,
                  additional_sales: x.additional_sales,
                  system_issues: x.system_issues,
                  event_special_notes: x.event_special_notes,
                  flower_issues: x.flower_issues,
                  next_event_feedback: x.next_event_feedback,
                  general_comment: x.general_comment,
                  final_revenue: x.final_revenue,
                };
              });
              const res = await api.post<{
                ok: number;
                failed: number;
                added: number;
                updated: number;
                errors: Array<{ row?: number; key?: string; reason: string }>;
              }>('/api/event-reviews/_bulk-upsert', { rows: payload, dryRun });
              if (!dryRun) await load();
              return res;
            }}
          />
        )}
      </div>

      <p className="text-sm text-gray-500 mb-4">
        DEF 상태 + 행사 당일(자정 이후)부터 표시됩니다 (시작 시각 무관, 종료 전에도 작성 가능). 행사를 클릭하면 행사리뷰
        탭에서 작성·확인할 수 있습니다.
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
              <th className="text-right px-2 py-2 font-semibold w-12 text-gray-400">#</th>
              {REVIEW_HEADERS.map((h) => {
                const active = tc.sort.key === h.key;
                const arrow = !active ? '' : tc.sort.dir === 'asc' ? ' ▲' : ' ▼';
                return (
                  <th
                    key={h.key}
                    onClick={() => tc.toggleSort(h.key)}
                    className="text-left px-3 py-2 font-semibold select-none cursor-pointer hover:bg-gray-100"
                    title="클릭하여 정렬"
                  >
                    {h.label}
                    <span className={active ? 'text-blue-600' : 'text-gray-300'}>{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-8">
                  불러오는 중...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-8">
                  대상 행사가 없습니다. (DEF 상태 + 행사 당일부터 표시)
                </td>
              </tr>
            ) : (
              filtered.map((e, i) => (
                <tr
                  key={e.id}
                  onClick={() => openEvent(e)}
                  className="border-t hover:bg-blue-50 cursor-pointer"
                >
                  <td className="px-2 py-2 text-right text-xs text-gray-400 tabular-nums">
                    {i + 1}
                  </td>
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
        // 이 페이지에서 행을 클릭한 경우 항상 '행사리뷰' 탭으로 진입.
        initialTab="review"
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
