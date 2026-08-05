import { weekdayKoOf } from '../lib/dateFmt';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { canCreateEvent, isAdmin } from '../auth/permissions';
import { useAuth } from '../auth/AuthContext';
import {
  EVENT_STATUS_OPTIONS,
  STATUS_HEX,
  isCancelledStatus,
  type Cancellation,
  type Event,
  type EventCustomerLink,
  type EventStatus,
  type EventWithFood,
  type CustomerType,
  type FoodItem,
  type Invoice,
} from '../types';
import { StatusBadge } from '../components/Field';
import ExcelButtons from '../components/ExcelButtons';
import EventFormModal from '../components/EventFormModal';
import TableColumnMenu from '../components/TableColumnMenu';
import Pagination, { usePaginated } from '../components/Pagination';
import { useTableControls, compareSortValues } from '../lib/useTableControls';
import { fuzzyMatch } from '../lib/koreanSearch';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import type { ColumnDef } from '../lib/excel';

// 테이블 컬럼 정의 — render는 행 렌더링, sortValue는 정렬 키.
interface EventCol {
  key: string;
  label: string;
  render: (e: EventWithFood) => React.ReactNode;
  sortValue?: (e: EventWithFood) => string | number | null;
}

function sumOf(
  e: EventWithFood,
  field: 'gtd_contract' | 'gtd_final' | 'exp_contract' | 'exp_final'
): number | null {
  let sum = 0;
  let any = false;
  for (const it of e.food_items) {
    const v = it[field];
    if (v != null) {
      sum += v;
      any = true;
    }
  }
  if (any) return sum;
  const legacy = (e as unknown as Record<string, number | null>)[`food_${field}`];
  return legacy ?? null;
}

const EVENT_TABLE_COLUMNS: EventCol[] = [
  {
    key: 'event_type',
    label: '구분',
    render: (e) => e.event_type,
    sortValue: (e) => e.event_type,
  },
  {
    key: 'status',
    label: '상태',
    render: (e) => <StatusBadge value={e.status} variant={e.status} />,
    sortValue: (e) => e.status,
  },
  {
    key: 'usage_type',
    label: '이용시간',
    render: (e) => e.usage_type || '-',
    sortValue: (e) => e.usage_type || '',
  },
  {
    key: 'halls',
    label: '사용홀',
    render: (e) => e.halls.join(' / ') || '-',
    sortValue: (e) => e.halls.join(' / '),
  },
  {
    key: 'start_datetime',
    label: '시작일시',
    render: (e) => fmt(e.start_datetime),
    sortValue: (e) => e.start_datetime,
  },
  {
    key: 'end_datetime',
    label: '종료일시',
    render: (e) => fmt(e.end_datetime),
    sortValue: (e) => e.end_datetime,
  },
  {
    key: 'event_name',
    label: '행사명',
    render: (e) => (
      <span className="font-medium text-gray-900">
        {e.event_name}
        {isRecentlyUpdated(e.updated_at) && <NewBadge />}
      </span>
    ),
    sortValue: (e) => e.event_name,
  },
  {
    key: 'seats',
    label: '좌석',
    render: (e) => e.seats ?? '-',
    sortValue: (e) => e.seats,
  },
  {
    key: 'gtd',
    label: 'GTD (계약/최종)',
    render: (e) => (
      <span className="text-xs">
        {sumOrDash(e, 'gtd_contract')}
        <span className="text-gray-400"> / </span>
        <span className="font-semibold">{sumOrDash(e, 'gtd_final')}</span>
      </span>
    ),
    sortValue: (e) => sumOf(e, 'gtd_contract'),
  },
  {
    key: 'exp',
    label: 'EXP (계약/최종)',
    render: (e) => (
      <span className="text-xs">
        {sumOrDash(e, 'exp_contract')}
        <span className="text-gray-400"> / </span>
        <span className="font-semibold">{sumOrDash(e, 'exp_final')}</span>
      </span>
    ),
    sortValue: (e) => sumOf(e, 'exp_contract'),
  },
  {
    key: 'menu',
    label: '메뉴',
    render: (e) => (
      <span className="block max-w-[18rem] truncate text-xs text-gray-500">
        {e.food_items.map((f) => f.menu_name).join(', ') || '-'}
      </span>
    ),
    sortValue: (e) => e.food_items.map((f) => f.menu_name).join(', '),
  },
  // 최근수정 — 'NEW' 배지가 붙는 기준. 기본 정렬키. 기본 숨김 (컬럼 설정에서 표시 가능).
  {
    key: 'updated_at',
    label: '최근수정',
    render: (e) => fmt(e.updated_at || e.created_at),
    sortValue: (e) => e.updated_at || e.created_at || '',
  },
];

// 엑셀 셀 → 문자열 (richText·숫자·날짜 무엇이든 안전하게 trim)
function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return String(v).trim();
}

// 숫자 셀 파싱 (빈값/비숫자는 null)
function parseNumOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(asText(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 한 행사의 메뉴들에서 특정 필드를 합산 — 합산 결과가 없으면 옛 데이터의 이벤트 단위 값 fallback.
function sumFoodField(
  row: { food_items?: { gtd_contract?: number | null; exp_contract?: number | null; gtd_final?: number | null; exp_final?: number | null }[] },
  field: 'gtd_contract' | 'exp_contract' | 'gtd_final' | 'exp_final',
  fallback: number | null
): number | '' {
  let sum = 0;
  let any = false;
  for (const it of row.food_items || []) {
    const v = it[field];
    if (v != null) {
      sum += v;
      any = true;
    }
  }
  if (any) return sum;
  return fallback != null ? fallback : '';
}

// "Korean lunch box, Coffee Break" 같은 콤마 구분 요약 텍스트를 실제 메뉴명 배열로 파싱.
// 메뉴 마스터 도입 이후: 화이트리스트 제거 — 비어있지 않은 모든 항목을 menu_name으로 채택.
function parseFoodItemsSummary(v: unknown): Partial<FoodItem>[] {
  if (v == null) return [];
  const s = String(v).trim();
  if (!s) return [];
  // 콤마(,), 슬래시(/), 세미콜론(;), 전각 콤마(、) 모두 구분자로 허용
  const parts = s.split(/[,/;、]/).map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => ({ menu_name: p }));
}

// 엑셀에 사람이 손으로 입력한 다양한 datetime 형식을 ISO local 형태로 정규화.
//   "2026-05-12 10:00"  → "2026-05-12T10:00"
//   "2026/05/12 10:00"  → "2026-05-12T10:00"
//   "2026.05.12"        → "2026-05-12"
//   "2026-05-12"        → 그대로
// 시간이 없으면 날짜만 반환 (서버·display 모두 둘 다 허용).
function normalizeDateTime(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  // 한글 슬래시/점 구분자를 -로 통일
  s = s.replace(/[./]/g, '-');
  // "YYYY-M-D" → "YYYY-MM-DD" (한 자리 월·일을 0-pad)
  s = s.replace(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/,
    (_m, y, mo, d, rest) =>
      `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}${rest}`
  );
  // 날짜와 시간 사이 공백 → T
  s = s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/, '$1T$2');
  // 한 자리 시간 0-pad
  s = s.replace(/T(\d):(\d{2})/, 'T0$1:$2');
  return s;
}

// 행사 목록 엑셀 컬럼 — food_items는 요약 텍스트로
const EVENT_COLUMNS: ColumnDef<EventWithFood>[] = [
  // upsert 매칭 키 — 빈 값으로 import 시 신규 추가, 값이 있으면 그 행사 갱신.
  { header: '행사 ID', key: 'id', width: 14 },
  {
    header: '구분',
    key: 'event_type',
    width: 10,
    // MICE / WEDDING 외 값은 MICE로 fallback. 대소문자·공백·한글 변형 처리.
    parse: (v) => {
      const s = asText(v).toUpperCase();
      if (s === 'WEDDING' || s.startsWith('WED') || s === '웨딩') return 'WEDDING';
      return 'MICE';
    },
  },
  {
    header: '상태',
    key: 'status',
    width: 10,
    // INQ/DEF/LOS/상담취소/미팅/미팅취소/시식 만 허용. TEN/기타값은 INQ 로 fallback.
    parse: (v) => {
      const s = asText(v).trim();
      const upper = s.toUpperCase();
      if (upper === 'DEF' || upper === 'LOS') return upper;
      if (s === '상담취소' || s === '미팅' || s === '미팅취소' || s === '시식') return s;
      return 'INQ';
    },
  },
  {
    header: '이용시간',
    key: 'usage_type',
    width: 10,
    // AD/AH/HA/HH만 허용. 빈 값·다른 값은 null.
    parse: (v) => {
      const s = asText(v).toUpperCase();
      return s === 'AD' || s === 'AH' || s === 'HA' || s === 'HH' ? s : null;
    },
  },
  {
    header: '사용홀',
    key: 'halls',
    width: 24,
    format: (v) => (Array.isArray(v) ? v.join(' / ') : ''),
    parse: (v) => (typeof v === 'string' ? [...new Set(v.split(/\s*\/\s*/).filter(Boolean))] : []),
  },
  {
    header: '시작일시',
    key: 'start_datetime',
    width: 18,
    // 엑셀 datetime은 lib/excel.ts에서 YYYY-MM-DDTHH:mm로 변환되어 들어옴.
    // 텍스트로 손입력한 경우(공백 구분자, /, . 등) 정규화. 빈 값은 null.
    parse: (v) => {
      const s = normalizeDateTime(asText(v));
      return s || null;
    },
  },
  {
    header: '종료일시',
    key: 'end_datetime',
    width: 18,
    parse: (v) => {
      const s = normalizeDateTime(asText(v));
      return s || null;
    },
  },
  { header: '행사명', key: 'event_name', width: 32 },
  {
    header: '좌석수',
    key: 'seats',
    width: 10,
    parse: (v) => {
      if (v == null || v === '') return null;
      const n = Number(asText(v).replace(/[^\d-]/g, ''));
      return Number.isFinite(n) ? n : null;
    },
  },
  // 이벤트 단위 GTD/EXP 컬럼 — Excel에는 보이지만 import 시 첫 메뉴 행으로 합쳐짐.
  // export 시 메뉴 행 합계로 채워짐 (옛 데이터는 이벤트 단위 값 fallback).
  {
    header: '식음 GTD (계약)',
    key: 'food_gtd_contract',
    width: 12,
    format: (val, row) => sumFoodField(row, 'gtd_contract', val as number | null),
    parse: (v) => parseNumOrNull(v),
  },
  {
    header: '식음 EXP (계약)',
    key: 'food_exp_contract',
    width: 12,
    format: (val, row) => sumFoodField(row, 'exp_contract', val as number | null),
    parse: (v) => parseNumOrNull(v),
  },
  {
    header: '식음 GTD (최종)',
    key: 'food_gtd_final',
    width: 12,
    format: (val, row) => sumFoodField(row, 'gtd_final', val as number | null),
    parse: (v) => parseNumOrNull(v),
  },
  {
    header: '식음 EXP (최종)',
    key: 'food_exp_final',
    width: 12,
    format: (val, row) => sumFoodField(row, 'exp_final', val as number | null),
    parse: (v) => parseNumOrNull(v),
  },
  {
    header: '식음 메뉴 요약',
    key: 'food_items',
    width: 36,
    format: (v) =>
      Array.isArray(v)
        ? (v as { menu_name: string }[]).map((f) => f.menu_name).join(', ')
        : '',
    // 콤마 구분 메뉴명 → 실제 food_items 배열로 변환. GTD/EXP는 onImportRows에서 첫 메뉴에 분배.
    parse: parseFoodItemsSummary,
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
  const [filterYear, setFilterYear] = useState<'ALL' | number>('ALL');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);

  // 컬럼 표시/숨김 + 정렬 — localStorage에 페이지별로 보존
  const tc = useTableControls({
    storageKey: 'events_table',
    // 최근수정 컬럼은 기본 숨김 — 정렬키로만 사용. 사용자가 컬럼 설정에서 표시 가능.
    defaultHidden: ['updated_at'],
    // 첫 방문 시 'NEW' 배지가 붙는 시간순(최근 수정 내림차순)으로 자동 정렬.
    defaultSort: { key: 'updated_at', dir: 'desc' },
  });
  const visibleColumns = useMemo(
    () => EVENT_TABLE_COLUMNS.filter((col) => !tc.isHidden(col.key)),
    [tc]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EventWithFood | null>(null);
  const [editingLinks, setEditingLinks] = useState<EventCustomerLink[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingCancellation, setEditingCancellation] = useState<Cancellation | null>(null);
  const navigate = useNavigate();

  // 더블클릭 = 전용 워크스페이스 페이지로. 단일 클릭(모달)은 빠른 수정용으로 유지.
  function openWorkspace(eventId: string) {
    setModalOpen(false);
    navigate(`/events/${eventId}`);
  }

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

  // 전역 검색에서 ?focus=<id> 로 진입 시 해당 행사 모달 자동 오픈.
  useEffect(() => {
    if (!events.length) return;
    const params = new URLSearchParams(window.location.search);
    const focusId = params.get('focus');
    if (!focusId) return;
    const target = events.find((e) => e.id === focusId);
    if (!target) return;
    setEditing(target);
    setModalOpen(true);
    api
      .get<{
        customer_links: EventCustomerLink[];
        invoice: Invoice | null;
        cancellation: Cancellation | null;
      }>(`/api/events/${target.id}`)
      .then((r) => {
        setEditingLinks(r.customer_links || []);
        setEditingInvoice(r.invoice);
        setEditingCancellation(r.cancellation);
      })
      .catch((e) => console.error('[Events focus] fetch detail 실패', e));
    history.replaceState(null, '', window.location.pathname);
  }, [events]);

  const admin = isAdmin(user?.role);
  // 새 권한 정책: 삭제는 작성 권한자(admin + sales)만. 뷰어(banquet/kitchen/h_kitchen) 제외.
  const canDelete = canCreateEvent(user?.role);

  async function deleteEvent(e: EventWithFood, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (
      !confirm(
        `[${e.event_name}] 행사를 휴지통으로 이동합니다.\n식음 메뉴, 업체 연결, INVOICE, 첨부파일, 행사리뷰는 그대로 보존되며 복구 시 모두 함께 돌아옵니다.\n관리자가 /admin/trash 에서 복구하거나 영구 삭제할 수 있습니다.\n계속하시겠습니까?`
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

  const [clearing, setClearing] = useState(false);

  async function clearAllEvents() {
    const total = events.length;
    if (total === 0) {
      alert('삭제할 행사가 없습니다.');
      return;
    }
    if (
      !confirm(
        `⚠️ 행사 전체 ${total}건을 삭제합니다.\n\n` +
          `함께 삭제되는 데이터:\n` +
          `· 식음 메뉴 항목\n· 업체 연결\n· INVOICE\n· 첨부파일 메타데이터\n· 취소 정보\n· 행사 리뷰\n\n` +
          `보존되는 데이터:\n` +
          `· 고객정보 (MICE/WEDDING)\n· 사용자\n· 캘린더 공유 링크\n· 매출 목표\n\n` +
          `이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`
      )
    ) {
      return;
    }
    const confirmText = prompt(
      `정말 진행하려면 "전체삭제"를 입력하세요 (대소문자·공백 포함 정확히):`
    );
    if (confirmText !== '전체삭제') {
      alert('취소되었습니다.');
      return;
    }
    setClearing(true);
    try {
      const res = await api.post<{ ok: boolean; deleted: number }>(
        '/api/events/_clear-all'
      );
      setEvents([]);
      alert(`행사 ${res.deleted}건이 삭제되었습니다.`);
    } catch (err) {
      alert('일괄 삭제 실패 (관리자 권한이 필요합니다).');
      console.error(err);
    } finally {
      setClearing(false);
    }
  }

  // 필터/검색 우선 적용 (정렬 키와 무관). 기본 정렬은 시작일시 오름차순.
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim();
    return events
      .filter((e) => filterType === 'ALL' || e.event_type === filterType)
      .filter((e) => filterStatus === 'ALL' || e.status === filterStatus)
      .filter((e) => {
        if (filterYear === 'ALL') return true;
        const y = new Date(e.start_datetime).getFullYear();
        return y === filterYear;
      })
      .filter((e) => {
        if (!q) return true;
        // 행사명·사용홀·구분·상태·메뉴 텍스트에서 부분일치 (초성/숫자 fuzzy 지원)
        if (fuzzyMatch(e.event_name, q)) return true;
        if (fuzzyMatch(e.halls.join(' / '), q)) return true;
        if (fuzzyMatch(e.event_type, q)) return true;
        if (fuzzyMatch(e.status, q)) return true;
        if (fuzzyMatch(e.food_items.map((f) => f.menu_name).join(', '), q)) return true;
        return false;
      });
  }, [events, filterType, filterStatus, filterYear, debouncedQuery]);

  // 검색·필터 통과 후 사용자가 선택한 컬럼으로 정렬
  // (선택 없으면 최근 수정/등록 순 — 가장 최근에 손댄 행사가 최상단)
  const sortedFiltered = useMemo(() => {
    if (!tc.sort.key) {
      return [...filtered].sort((a, b) => {
        const ka = a.updated_at || a.created_at;
        const kb = b.updated_at || b.created_at;
        return ka < kb ? 1 : ka > kb ? -1 : 0;
      });
    }
    const col = EVENT_TABLE_COLUMNS.find((c) => c.key === tc.sort.key);
    if (!col?.sortValue) return filtered;
    return [...filtered].sort((a, b) =>
      compareSortValues(col.sortValue!(a), col.sortValue!(b), tc.sort.dir)
    );
  }, [filtered, tc.sort]);

  // 페이지네이션 — 기본 40개씩 (40/60/80/100 선택 가능). 검색/필터/정렬 변경 시 page 0 으로 리셋.
  const { page, setPage, pageItems, pageSize, setPageSize } = usePaginated(sortedFiltered, [
    debouncedQuery,
    filterType,
    filterStatus,
    filterYear,
    tc.sort.key,
    tc.sort.dir,
  ]);

  // 필터 드롭다운용 사용 가능한 연도 목록 — 행사 데이터에서 추출 (내림차순)
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    for (const e of events) {
      const y = new Date(e.start_datetime).getFullYear();
      if (Number.isFinite(y)) ys.add(y);
    }
    return [...ys].sort((a, b) => b - a);
  }, [events]);

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
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold">행사 목록</h1>
          <span className="text-sm text-gray-500">
            전체{' '}
            <span className="font-semibold text-gray-900">
              {events.length.toLocaleString()}
            </span>
            건
            {sortedFiltered.length !== events.length && (
              <>
                {' '}· 표시{' '}
                <span className="font-semibold text-gray-900">
                  {sortedFiltered.length.toLocaleString()}
                </span>
                건
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TableColumnMenu
            columns={EVENT_TABLE_COLUMNS}
            hidden={tc.hidden}
            onToggle={tc.toggleHidden}
            onReset={() => tc.setHiddenAll([])}
          />
          <ExcelButtons
            filename={`행사목록_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="행사 목록"
            columns={EVENT_COLUMNS}
            rows={events}
            onImportRows={async (rows, dryRun) => {
              // 각 행에서 이벤트 단위 GTD/EXP가 들어있고 메뉴 행이 있으면 → 첫 메뉴 행에 분배
              // (단일 소스: 메뉴 행. 이벤트 단위 필드는 null로 비움.)
              const prepared = rows.map((r) => {
                const foodItems: Partial<FoodItem>[] = Array.isArray(
                  (r as { food_items?: unknown }).food_items
                )
                  ? [...((r as { food_items: Partial<FoodItem>[] }).food_items)]
                  : [];
                const rr = r as Record<string, unknown>;
                if (foodItems.length > 0) {
                  const first = { ...foodItems[0] };
                  if (rr.food_gtd_contract != null && first.gtd_contract == null) {
                    first.gtd_contract = rr.food_gtd_contract as number;
                  }
                  if (rr.food_exp_contract != null && first.exp_contract == null) {
                    first.exp_contract = rr.food_exp_contract as number;
                  }
                  if (rr.food_gtd_final != null && first.gtd_final == null) {
                    first.gtd_final = rr.food_gtd_final as number;
                  }
                  if (rr.food_exp_final != null && first.exp_final == null) {
                    first.exp_final = rr.food_exp_final as number;
                  }
                  foodItems[0] = first;
                }
                return {
                  ...r,
                  food_items: foodItems,
                  food_gtd_contract: null,
                  food_exp_contract: null,
                  food_gtd_final: null,
                  food_exp_final: null,
                };
              });
              const res = await api.post<{
                ok: number;
                failed: number;
                added: number;
                updated: number;
                errors: Array<{ row?: number; key?: string; reason: string }>;
              }>('/api/events/_bulk-upsert', { rows: prepared, dryRun });
              if (!dryRun) {
                const refreshed = await api.get<{ events: EventWithFood[] }>('/api/events');
                setEvents(refreshed.events);
              }
              return res;
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
          {admin && (
            <button
              onClick={clearAllEvents}
              disabled={clearing || events.length === 0}
              className="btn-danger !py-1.5 text-xs"
              title="관리자 전용 — 모든 행사를 일괄 삭제"
            >
              {clearing ? '삭제 중...' : `🗑 행사 전체 삭제 (${events.length}건)`}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-lg p-3 mb-4 flex items-center gap-2 text-xs flex-wrap">
        <input
          type="text"
          className="input !py-1 !text-xs flex-1 min-w-[200px]"
          placeholder="검색: 행사명 / 사용홀 / 메뉴 / 구분·상태 (초성도 가능)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
          {EVENT_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input !py-1 !text-xs !w-auto"
          value={filterYear === 'ALL' ? 'ALL' : String(filterYear)}
          onChange={(e) =>
            setFilterYear(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
          }
        >
          <option value="ALL">전체 연도</option>
          {availableYears.map((y) => (
            <option key={y} value={String(y)}>
              {y}년
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {/* 모바일 카드 뷰 — md 미만 */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="text-center text-gray-400 py-8 bg-white border rounded-lg">불러오는 중...</div>
        ) : sortedFiltered.length === 0 ? (
          <div className="text-center text-gray-400 py-8 bg-white border rounded-lg">
            {query ? '검색 결과가 없습니다.' : '등록된 행사가 없습니다.'}
          </div>
        ) : (
          pageItems.map((e, i) => {
            const halls = e.halls.join(' / ');
            const startFmt = fmtRange(e.start_datetime, e.end_datetime);
            const foodSummary = (e.food_items || []).map((f) => f.menu_name).join(', ');
            const rowNo = page * pageSize + i + 1;
            return (
              <div
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
                onDoubleClick={() => openWorkspace(e.id)}
                className="bg-white border rounded-lg p-3 shadow-sm active:bg-blue-50 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-semibold text-gray-900 truncate">
                    <span className="text-gray-400 font-normal mr-1.5">#{rowNo}</span>
                    {e.event_name || '(이름 없음)'}
                    {isRecentlyUpdated(e.updated_at) && <NewBadge />}
                  </span>
                  <span
                    className="badge shrink-0 text-white"
                    style={{ background: STATUS_HEX[e.status] }}
                  >
                    {e.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-2 gap-y-0.5 mb-1">
                  <span>{e.event_type}</span>
                  {halls && (
                    <>
                      <span>·</span>
                      <span className="truncate">{halls}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-gray-700">{startFmt}</div>
                {e.assigned_manager_name && (
                  <div className="text-xs text-gray-500 truncate">담당 {e.assigned_manager_name}</div>
                )}
                {foodSummary && (
                  <div className="text-xs text-gray-400 truncate mt-0.5">{foodSummary}</div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 데스크탑 테이블 — md 이상 */}
      <div className="hidden md:block bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto [&_th]:whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-right px-2 py-2 font-semibold border-b w-12 text-gray-400">#</th>
                {visibleColumns.map((col) => {
                  const sortable = !!col.sortValue;
                  const active = tc.sort.key === col.key;
                  const arrow = !active ? '' : tc.sort.dir === 'asc' ? ' ▲' : ' ▼';
                  return (
                    <th
                      key={col.key}
                      onClick={() => sortable && tc.toggleSort(col.key)}
                      className={
                        'text-left px-3 py-2 font-semibold border-b select-none ' +
                        (sortable ? 'cursor-pointer hover:bg-gray-100' : '')
                      }
                      title={sortable ? '클릭하여 정렬' : undefined}
                    >
                      {col.label}
                      <span className={active ? 'text-blue-600' : 'text-gray-300'}>{arrow}</span>
                    </th>
                  );
                })}
                {canDelete && <th className="text-left px-3 py-2 font-semibold border-b w-12" />}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1 + (canDelete ? 1 : 0)}
                    className="text-center text-gray-400 py-8"
                  >
                    불러오는 중...
                  </td>
                </tr>
              ) : sortedFiltered.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1 + (canDelete ? 1 : 0)}
                    className="text-center text-gray-400 py-8"
                  >
                    {query ? '검색 결과가 없습니다.' : '등록된 행사가 없습니다.'}
                  </td>
                </tr>
              ) : (
                pageItems.map((e, i) => (
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
                    onDoubleClick={() => openWorkspace(e.id)}
                    title="클릭: 빠른 수정 · 더블클릭: 전용 화면에서 열기"
                    className="border-t hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-2 py-2 text-right text-xs text-gray-400 tabular-nums">
                      {page * pageSize + i + 1}
                    </td>
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-3 py-2">
                        {col.render(e)}
                      </td>
                    ))}
                    {canDelete && (
                      <td className="px-3 py-2">
                        <button
                          onClick={(ev) => deleteEvent(e, ev)}
                          className="text-xs text-red-600 hover:underline"
                          title="휴지통으로 이동 (복구 가능)"
                        >
                          삭제
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        total={sortedFiltered.length}
        page={page}
        onChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />

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
          // 신규/수정 모두 saved 의 updated_at 이 최신이므로 기본 정렬(updated_at desc)이
          // 자동으로 최상단으로 올려준다.
          setEvents((prev) => {
            const idx = prev.findIndex((p) => p.id === saved.id);
            if (idx === -1) return [saved, ...prev];
            const next = prev.slice();
            next[idx] = saved;
            return next;
          });
        }}
        onDeleted={(eventId) => setEvents((prev) => prev.filter((p) => p.id !== eventId))}
        onOpenFullscreen={editing ? () => openWorkspace(editing.id) : undefined}
      />
    </div>
  );
}

// 메뉴 행별 GTD/EXP 합계 — 합계가 없으면 옛 데이터의 이벤트 단위 값 fallback.
function sumOrDash(
  event: EventWithFood,
  field: 'gtd_contract' | 'gtd_final' | 'exp_contract' | 'exp_final'
): string {
  let sum = 0;
  let hasAny = false;
  for (const it of event.food_items) {
    const v = it[field];
    if (v != null) {
      sum += v;
      hasAny = true;
    }
  }
  if (hasAny) return sum.toLocaleString('ko-KR');
  // 옛 데이터: 이벤트 단위 필드 (food_gtd_contract 등)에 값이 있을 수 있음
  const legacy = (event as unknown as Record<string, number | null>)[`food_${field}`];
  return legacy != null ? legacy.toLocaleString('ko-KR') : '-';
}

function fmt(s: string): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 수정·등록 시점이 최근 24시간 이내면 New 표시.
function isRecentlyUpdated(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

function NewBadge() {
  return (
    <span className="ml-1 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold bg-red-500 text-white align-middle">
      NEW
    </span>
  );
}

// 모바일 카드용 — 같은 날 행사는 "MM-DD HH:MM ~ HH:MM", 다른 날은 풀 표기
function fmtRange(start: string, end: string): string {
  if (!start) return '-';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (isNaN(s.getTime())) return start;
  const pad = (n: number) => String(n).padStart(2, '0');
  const sStr = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())} (${weekdayKoOf(s)}) ${pad(s.getHours())}:${pad(s.getMinutes())}`;
  if (!e || isNaN(e.getTime())) return sStr;
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const eStr = sameDay
    ? `${pad(e.getHours())}:${pad(e.getMinutes())}`
    : `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())} (${weekdayKoOf(e)}) ${pad(e.getHours())}:${pad(e.getMinutes())}`;
  return `${sStr} ~ ${eStr}`;
}
