import { useEffect, useMemo, useState } from 'react';
import { weekdayKoOf } from '../lib/dateFmt';
import { api } from '../lib/api';
import { fuzzyMatch, buildSearchEntry, fuzzyMatchEntry, type SearchEntry } from '../lib/koreanSearch';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useAuth } from '../auth/AuthContext';
import { canWriteMice } from '../auth/permissions';
import { useActiveUsers } from '../lib/useActiveUsers';
import { nanoid } from '../lib/clientId';
import {
  MICE_CATEGORIES,
  MICE_INQUIRY_STATUS_DESC,
  MICE_INQUIRY_STATUS_OPTIONS,
  type MiceCategory,
  type MiceContact,
  type MiceCustomer,
  type MiceInquiry,
  type MiceInquiryStatus,
} from '../types';
import Modal from '../components/Modal';
import SimilarOrgWarning from '../components/SimilarOrgWarning';
import LinkedEventsSection from '../components/LinkedEventsSection';
import { Field, StatusBadge } from '../components/Field';
import ExcelButtons from '../components/ExcelButtons';
import ChangeLogPanel from '../components/ChangeLogPanel';
import TableColumnMenu from '../components/TableColumnMenu';
import Pagination, { usePaginated } from '../components/Pagination';
import { useTableControls, compareSortValues } from '../lib/useTableControls';
import {
  buildMiceFlatRows,
  groupMiceFlatRows,
  MICE_FLAT_COLUMNS,
  type MiceFlatRow,
} from '../lib/customerColumns';
import {
  CALL_TABS,
  CALL_CHECKS,
  trackedInquiryOf,
  callbackDateOf,
  daysLeft,
  isOpenStatus,
  overdueCount,
} from '../lib/callTracker';
import { CallbackCell, CheckCell } from '../components/CallTrackerCells';

// 테이블 컬럼 정의 — 키, 라벨, 셀 렌더링, 정렬값.
interface MiceCol {
  key: string;
  label: string;
  render: (c: MiceCustomer) => React.ReactNode;
  sortValue?: (c: MiceCustomer) => string | number | null;
  tdClassName?: string;
}

function lastInquiryOf(c: MiceCustomer): MiceInquiry | undefined {
  return c.inquiries[c.inquiries.length - 1];
}
function lastContactsLabel(c: MiceCustomer): string {
  const last = lastInquiryOf(c);
  const cts = last?.contacts || [];
  if (!cts.length) return '';
  return cts.map((ct) => ct.name || '(이름없음)').join(', ');
}

const MICE_COLUMNS: MiceCol[] = [
  {
    key: 'mice_category',
    label: '구분',
    render: (c) => c.mice_category,
    sortValue: (c) => c.mice_category,
  },
  {
    key: 'organization_name',
    label: '업체명',
    render: (c) => <span className="font-medium text-gray-900">{c.organization_name}</span>,
    sortValue: (c) => c.organization_name,
  },
  {
    key: 'official_phone',
    label: '공식연락처',
    render: (c) => c.official_phone || '-',
    sortValue: (c) => c.official_phone,
  },
  {
    key: 'official_email',
    label: '공식이메일',
    render: (c) => <span className="text-gray-600">{c.official_email || '-'}</span>,
    sortValue: (c) => c.official_email,
  },
  {
    key: 'official_website',
    label: '홈페이지/블로그',
    render: (c) => (
      <span className="block max-w-[12rem] truncate" title={c.official_website}>
        {c.official_website || '-'}
      </span>
    ),
    sortValue: (c) => c.official_website,
  },
  {
    key: 'inquiries_count',
    label: '문의건수',
    render: (c) => <span className="block text-center">{c.inquiries.length}</span>,
    sortValue: (c) => c.inquiries.length,
  },
  {
    key: 'last_progress',
    label: '최근 진행상황',
    render: (c) => {
      const last = lastInquiryOf(c);
      return last ? (
        <StatusBadge value={last.progress_status} variant={last.progress_status} />
      ) : (
        '-'
      );
    },
    sortValue: (c) => lastInquiryOf(c)?.progress_status || '',
  },
  {
    key: 'last_contacts',
    label: '최근 담당자',
    render: (c) => {
      const label = lastContactsLabel(c) || '-';
      return (
        <span className="block max-w-[10rem] truncate" title={label}>
          {label}
        </span>
      );
    },
    sortValue: (c) => lastContactsLabel(c),
  },
  {
    key: 'last_modified',
    label: '최종 수정',
    render: (c) => (
      <span className="text-xs text-gray-500">
        {c.last_modified_by_name ? (
          <>
            {c.last_modified_by_name}
            <br />
            <span className="text-gray-400">
              {c.last_modified_at &&
                `${new Date(c.last_modified_at).toLocaleString('ko-KR', {
                  month: '2-digit',
                  day: '2-digit',
                })} (${weekdayKoOf(new Date(c.last_modified_at))}) ${new Date(c.last_modified_at).toLocaleString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
            </span>
          </>
        ) : (
          '-'
        )}
      </span>
    ),
    sortValue: (c) => c.last_modified_at || '',
  },
  {
    key: 'memo',
    label: '메모',
    render: (c) => (
      <span className="block max-w-[14rem] truncate" title={c.memo}>
        {c.memo || '-'}
      </span>
    ),
    sortValue: (c) => c.memo,
  },
];

type FormState = Omit<MiceCustomer, 'id' | 'created_at' | 'updated_at' | 'customer_type'>;

function emptyContact(): MiceContact {
  return { id: nanoid(), name: '', email: '', phone: '' };
}

function emptyInquiry(authorId: string, authorName: string): MiceInquiry {
  return {
    id: nanoid(),
    progress_status: 'INQ',
    inquiry_channel: 'INCALL', // 신규 문의 기본값 — 사용자가 OUTCALL 로 변경 가능
    contacts: [emptyContact()],
    call_date: null,
    inquiry_event_date_text: '',
    created_by_id: authorId,
    created_by_name: authorName,
    // 신규 문의의 담당자 기본값 = 작성자 (사용자가 드롭다운에서 바꿀 수 있음)
    assigned_manager_id: authorId,
    assigned_manager_name: authorName,
    created_at: new Date().toISOString(),
  };
}

function emptyForm(authorId: string, authorName: string): FormState {
  return {
    mice_category: '기업',
    organization_name: '',
    official_phone: '',
    official_email: '',
    official_website: '',
    inquiries: [emptyInquiry(authorId, authorName)],
    memo: '',
  };
}

export default function MiceCustomers() {
  const { user } = useAuth();
  const authorName = user?.name || '';
  const authorId = user?.id || '';
  const activeUsers = useActiveUsers();
  // MICE 담당자 드롭다운 — 기업세일즈 + 관리자만 노출
  const miceManagerOptions = useMemo(
    () => activeUsers.filter((u) => u.role === 'sales_mice' || u.role === 'admin'),
    [activeUsers]
  );

  const [items, setItems] = useState<MiceCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [showSuggest, setShowSuggest] = useState(false);
  // 고객별 행사 개최 횟수
  const [eventCounts, setEventCounts] = useState<
    Record<string, { total: number; held: number }>
  >({});

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(authorId, authorName));
  const [saving, setSaving] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);
  // 콜 트래커 — 별도 사이트로 쓰던 문의 트래커를 이 화면 안으로 접어 넣었다.
  const [callTab, setCallTab] = useState('all');
  const [trackSaving, setTrackSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ customers: MiceCustomer[] }>('/api/customers/mice');
      setItems(res.customers);
    } catch (e) {
      setError('목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
    // 행사 개최 횟수 — 별도 fetch.
    try {
      const cres = await api.get<{
        counts: Record<string, { total: number; held: number }>;
      }>('/api/customers/_event-counts');
      setEventCounts(cres.counts || {});
    } catch (e) {
      console.error('event counts fetch 실패:', e);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // 전역 검색에서 ?focus=<id> 로 진입 시 해당 고객 모달 자동 오픈.
  useEffect(() => {
    if (!items.length) return;
    const params = new URLSearchParams(window.location.search);
    const focusId = params.get('focus');
    if (!focusId) return;
    const target = items.find((c) => c.id === focusId);
    if (target) {
      openEdit(target);
      history.replaceState(null, '', window.location.pathname);
    }
  }, [items]);

  // items 가 바뀔 때만 검색 인덱스를 재계산. 키 입력마다는 includes() 만 돌도록.
  const searchIndex = useMemo(() => {
    const map = new Map<string, SearchEntry>();
    for (const c of items) {
      const parts: Array<string | null | undefined> = [
        c.organization_name,
        c.official_phone,
        c.official_email,
        c.memo,
      ];
      for (const i of c.inquiries) {
        parts.push(i.progress_status, i.inquiry_event_date_text);
        for (const ct of i.contacts) {
          parts.push(ct.name, ct.email, ct.phone);
        }
      }
      map.set(c.id, buildSearchEntry(parts));
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    let list = items;
    if (debouncedQuery.trim()) {
      list = list.filter((c) => {
        const e = searchIndex.get(c.id);
        return e ? fuzzyMatchEntry(e, debouncedQuery) : false;
      });
    }
    // 상태 탭 — 트래커에서 쓰던 문의/보류/확정/취소 구조 그대로
    const tabStatus = CALL_TABS.find((t) => t.key === callTab)?.status ?? null;
    if (tabStatus) {
      list = list.filter((c) => trackedInquiryOf(c)?.progress_status === tabStatus);
    }
    return list;
  }, [items, debouncedQuery, searchIndex, callTab]);

  const tabCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of CALL_TABS) {
      m.set(t.key, t.status ? items.filter((c) => trackedInquiryOf(c)?.progress_status === t.status).length : items.length);
    }
    return m;
  }, [items]);

  const overdue = useMemo(() => overdueCount(items), [items]);

  /**
   * 목록에서 콜백 날짜·체크를 바로 바꾼다.
   * 문의는 고객 문서 안의 배열이라 고객을 통째로 PATCH 한다.
   * 서버가 자동 확정(견적서·회신·계약금 3개 → DEF)을 걸 수 있어 응답으로 상태를 되받는다.
   */
  async function patchTracked(c: MiceCustomer, patch: Partial<MiceInquiry>) {
    const q = trackedInquiryOf(c);
    if (!q || !canWriteMice(user?.role)) return;
    setTrackSaving(c.id);
    const nextInquiries = c.inquiries.map((x) => (x.id === q.id ? { ...x, ...patch } : x));
    // 화면 먼저 반영 — 체크가 느리면 두 번 누르게 된다
    setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, inquiries: nextInquiries } : x)));
    try {
      const res = await api.patch<{ customer: MiceCustomer }>(`/api/customers/mice/${c.id}`, {
        inquiries: nextInquiries,
      });
      setItems((prev) => prev.map((x) => (x.id === c.id ? res.customer : x)));
    } catch (e) {
      setError((e as Error).message);
      void load();
    } finally {
      setTrackSaving(null);
    }
  }

  const suggestions = useMemo(
    () => (debouncedQuery.trim() ? filtered.slice(0, 6) : []),
    [filtered, debouncedQuery]
  );

  // 폼 안 업체명 입력 → 중복 후보 (초성 + 부분일치, 편집중인 본인 제외)
  const dupMatches = useMemo(() => {
    const q = form.organization_name.trim();
    if (!q) return [];
    return items
      .filter((c) => c.id !== editingId)
      .filter((c) => fuzzyMatch(c.organization_name, q))
      .slice(0, 5);
  }, [items, form.organization_name, editingId]);

  function openNew() {
    setEditingId(null);
    setForm(emptyForm(authorId, authorName));
    setOpen(true);
  }

  function openEdit(c: MiceCustomer) {
    setEditingId(c.id);
    setForm({
      mice_category: c.mice_category,
      organization_name: c.organization_name,
      official_phone: c.official_phone,
      official_email: c.official_email,
      official_website: c.official_website,
      inquiries: c.inquiries.length
        ? c.inquiries.map((i) => ({ ...i }))
        : [emptyInquiry(authorId, authorName)],
      memo: c.memo,
    });
    setOpen(true);
  }

  function addInquiry() {
    setForm((p) => ({ ...p, inquiries: [...p.inquiries, emptyInquiry(authorId, authorName)] }));
  }
  function removeInquiry(id: string) {
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.length > 1 ? p.inquiries.filter((i) => i.id !== id) : p.inquiries,
    }));
  }
  function updateInquiry(id: string, patch: Partial<MiceInquiry>) {
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }

  function addContact(inquiryId: string) {
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.map((i) =>
        i.id === inquiryId ? { ...i, contacts: [...i.contacts, emptyContact()] } : i
      ),
    }));
  }
  function removeContact(inquiryId: string, contactId: string) {
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.map((i) =>
        i.id === inquiryId
          ? {
              ...i,
              contacts:
                i.contacts.length > 1
                  ? i.contacts.filter((c) => c.id !== contactId)
                  : i.contacts,
            }
          : i
      ),
    }));
  }
  function updateContact(inquiryId: string, contactId: string, patch: Partial<MiceContact>) {
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.map((i) =>
        i.id === inquiryId
          ? {
              ...i,
              contacts: i.contacts.map((c) => (c.id === contactId ? { ...c, ...patch } : c)),
            }
          : i
      ),
    }));
  }

  async function save() {
    if (!form.organization_name.trim()) {
      alert('업체명은 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const res = await api.patch<{ customer: MiceCustomer }>(
          `/api/customers/mice/${editingId}`,
          form
        );
        setItems((prev) => prev.map((x) => (x.id === editingId ? res.customer : x)));
        setLogRefresh((n) => n + 1);
      } else {
        const res = await api.post<{ customer: MiceCustomer }>('/api/customers/mice', form);
        setItems((prev) => [res.customer, ...prev]);
        setEditingId(res.customer.id); // 등록 직후 수정 모드로 전환되어 로그 패널이 보이도록
        setLogRefresh((n) => n + 1);
      }
      alert('저장되었습니다.');
    } catch (e) {
      alert('저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: MiceCustomer) {
    if (
      !confirm(
        `[${c.organization_name}] 고객을 휴지통으로 이동합니다.\n관리자가 /admin/trash 에서 복구하거나 영구 삭제할 수 있습니다.\n계속하시겠습니까?`
      )
    )
      return;
    try {
      await api.delete(`/api/customers/mice/${c.id}`);
      setItems((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      alert('삭제 실패');
      console.error(e);
    }
  }

  const flatRows = useMemo(() => buildMiceFlatRows(items), [items]);

  // 컬럼 표시/숨김 + 정렬 — localStorage에 페이지별로 보존.
  const tc = useTableControls({ storageKey: 'mice_customers_table' });
  // 'event_count' 컬럼은 eventCounts state에 의존하므로 런타임에 합성.
  const allColumns = useMemo<MiceCol[]>(() => {
    const eventCountCol: MiceCol = {
      key: 'event_count',
      label: '행사 개최',
      render: (c) => {
        const x = eventCounts[c.id];
        if (!x) return <span className="text-gray-300">-</span>;
        return (
          <span className="text-xs">
            <span className="font-semibold text-gray-900">{x.held}</span>
            <span className="text-gray-400">/{x.total}</span>
          </span>
        );
      },
      sortValue: (c) => eventCounts[c.id]?.held ?? 0,
    };
    // 콜 트래커 컬럼 — 목록에서 바로 편집. 열 설정 메뉴에서 끌 수 있다.
    const readOnly = !canWriteMice(user?.role);
    const callbackCol: MiceCol = {
      key: 'callback',
      label: '콜백',
      render: (c) => {
        const q = trackedInquiryOf(c);
        if (!q) return <span className="text-gray-300">-</span>;
        // 보류는 '언제 다시 전화할지', 나머지는 '언제까지 회신 받을지'
        const field = q.progress_status === 'INQ' ? 'callback_at' : 'callback_due';
        return (
          <CallbackCell
            value={callbackDateOf(q)}
            disabled={readOnly || trackSaving === c.id}
            onChange={(v) => patchTracked(c, { [field]: v })}
          />
        );
      },
      // 기한 없는 건은 뒤로 — 급한 것부터 보이게
      sortValue: (c) => callbackDateOf(trackedInquiryOf(c)) || '9999-12-31',
    };
    const checkCols: MiceCol[] = CALL_CHECKS.map((chk) => ({
      key: `chk_${String(chk.key)}`,
      label: chk.label,
      render: (c) => {
        const q = trackedInquiryOf(c);
        if (!q) return <span className="block text-center text-gray-300">-</span>;
        return (
          <CheckCell
            checked={!!q[chk.key]}
            disabled={readOnly || trackSaving === c.id}
            onChange={(v) => patchTracked(c, { [chk.key]: v })}
          />
        );
      },
      sortValue: (c) => (trackedInquiryOf(c)?.[chk.key] ? 1 : 0),
    }));
    return [...MICE_COLUMNS, callbackCol, ...checkCols, eventCountCol];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventCounts, user?.role, trackSaving, items]);

  const visibleColumns = useMemo(
    () => allColumns.filter((col) => !tc.isHidden(col.key)),
    [allColumns, tc]
  );
  const sortedFiltered = useMemo(() => {
    if (!tc.sort.key) return filtered;
    const col = allColumns.find((c) => c.key === tc.sort.key);
    if (!col?.sortValue) return filtered;
    return [...filtered].sort((a, b) => compareSortValues(col.sortValue!(a), col.sortValue!(b), tc.sort.dir));
  }, [filtered, tc.sort, allColumns]);

  // 페이지네이션 — 기본 40개씩 (40/60/80/100 선택 가능)
  const { page, setPage, pageItems, pageSize, setPageSize } = usePaginated(sortedFiltered, [
    debouncedQuery,
    tc.sort.key,
    tc.sort.dir,
    callTab,
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold">MICE 고객정보</h1>
          <span className="text-sm text-gray-500">
            전체 <span className="font-semibold text-gray-900">{items.length.toLocaleString()}</span>건
            {filtered.length !== items.length && (
              <> · 표시 <span className="font-semibold text-gray-900">{filtered.length.toLocaleString()}</span>건</>
            )}
          </span>
          {overdue > 0 && (
            <button
              onClick={() => setCallTab('all')}
              className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200"
              title="콜백 기한이 지난 고객"
            >
              콜백 기한 지남 {overdue}건
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TableColumnMenu
            columns={allColumns}
            hidden={tc.hidden}
            onToggle={tc.toggleHidden}
            onReset={() => tc.setHiddenAll([])}
          />
          <ExcelButtons
            filename={`MICE_고객정보_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="MICE 고객정보"
            importLabel="MICE 고객"
            columns={MICE_FLAT_COLUMNS}
            rows={flatRows}
            onImportRows={async (rows, dryRun) => {
              const grouped = groupMiceFlatRows(rows as MiceFlatRow[], authorId, authorName);
              const res = await api.post<{
                ok: number;
                failed: number;
                added: number;
                updated: number;
                errors: Array<{ row?: number; key?: string; reason: string }>;
              }>('/api/customers/mice/_bulk-upsert', { rows: grouped, dryRun });
              if (!dryRun) {
                // 실제 반영 후 목록 새로고침 (서버 상태가 truth)
                const refreshed = await api.get<{ customers: MiceCustomer[] }>(
                  '/api/customers/mice'
                );
                setItems(refreshed.customers);
              }
              return res;
            }}
          />
          {canWriteMice(user?.role) && (
            <button onClick={openNew} className="btn-primary">
              + 신규 등록
            </button>
          )}
        </div>
      </div>

      {/* 콜 트래커 상태 탭 — 별도 사이트로 쓰던 문의 트래커 구조를 그대로 가져왔다.
          쓰던 분들이 화면 바뀌었다고 헤매지 않도록 이름과 순서를 유지한다. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CALL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setCallTab(t.key)}
            className={`text-sm px-3 py-1.5 rounded-full border transition ${
              callTab === t.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white hover:bg-gray-50 border-gray-300'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${callTab === t.key ? 'text-blue-100' : 'text-gray-400'}`}>
              {(tabCounts.get(t.key) ?? 0).toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggest(true);
          }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          className="input"
          placeholder="검색: 업체명 / 연락처(끝 4자리만 입력 가능) / 이메일 / 담당자 / 진행상황 / 메모  (초성 'ㅇ'만 입력해도 매칭)"
        />
        {showSuggest && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 mt-1 bg-white border rounded-md shadow-lg z-10 max-h-72 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  openEdit(s);
                  setShowSuggest(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b last:border-b-0"
              >
                <div className="text-sm font-medium text-gray-900">{s.organization_name}</div>
                <div className="text-xs text-gray-500">
                  {s.mice_category} · 문의 {s.inquiries.length}건 ·{' '}
                  {s.inquiries.map((i) => i.progress_status).join(', ')}
                </div>
              </button>
            ))}
          </div>
        )}
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
            {query ? '검색 결과가 없습니다.' : '등록된 고객이 없습니다.'}
          </div>
        ) : (
          pageItems.map((c, i) => {
            const last = lastInquiryOf(c);
            const contacts = lastContactsLabel(c);
            const rowNo = page * pageSize + i + 1;
            return (
              <div
                key={c.id}
                onClick={() => openEdit(c)}
                className="bg-white border rounded-lg p-3 shadow-sm active:bg-blue-50 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-semibold text-gray-900 truncate">
                    <span className="text-gray-400 font-normal mr-1.5">#{rowNo}</span>
                    {c.organization_name || '(이름 없음)'}
                  </span>
                  <span className="badge bg-gray-100 text-gray-700 shrink-0">{c.mice_category}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap mb-1">
                  <span>문의 {c.inquiries.length}건</span>
                  {last && (
                    <>
                      <span>·</span>
                      <StatusBadge value={last.progress_status} variant={last.progress_status} />
                    </>
                  )}
                </div>
                {c.official_phone && (
                  <div className="text-xs text-gray-600 truncate">📞 {c.official_phone}</div>
                )}
                {contacts && (
                  <div className="text-xs text-gray-600 truncate">담당 {contacts}</div>
                )}
                {c.memo && (
                  <div className="text-xs text-gray-400 truncate mt-1">{c.memo}</div>
                )}
                <div className="flex justify-end mt-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(c);
                    }}
                    className="text-xs text-red-600"
                  >
                    삭제
                  </button>
                </div>
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
                <th className="text-left px-3 py-2 font-semibold border-b w-12" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleColumns.length + 2} className="text-center text-gray-400 py-8">
                    불러오는 중...
                  </td>
                </tr>
              ) : sortedFiltered.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length + 2} className="text-center text-gray-400 py-8">
                    {query ? '검색 결과가 없습니다.' : '등록된 고객이 없습니다.'}
                  </td>
                </tr>
              ) : (
                pageItems.map((c, i) => (
                  <tr
                    key={c.id}
                    onClick={() => openEdit(c)}
                    className="border-t hover:bg-blue-50 cursor-pointer"
                  >
                    <td className="px-2 py-2 text-right text-xs text-gray-400 tabular-nums">
                      {page * pageSize + i + 1}
                    </td>
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={`px-3 py-2 ${col.tdClassName || ''}`}>
                        {col.render(c)}
                      </td>
                    ))}
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {canWriteMice(user?.role) && (
                        <button
                          onClick={() => remove(c)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          삭제
                        </button>
                      )}
                    </td>
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'MICE 고객 수정' : 'MICE 고객 신규 등록'}
        widthClass="max-w-5xl"
        footer={
          <>
            <button onClick={() => setOpen(false)} className="btn-secondary">
              닫기
            </button>
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? '저장중...' : '저장'}
            </button>
          </>
        }
      >
        {/* (1) 업체정보 */}
        <Section title="(1) 업체정보">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="구분" required>
              <select
                className="input"
                value={form.mice_category}
                onChange={(e) =>
                  setForm({ ...form, mice_category: e.target.value as MiceCategory })
                }
              >
                {MICE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="업체명" required>
              <input
                className="input"
                value={form.organization_name}
                onChange={(e) => setForm({ ...form, organization_name: e.target.value })}
              />
              {/* 서버 사이드 정규화 + Levenshtein 기반 유사 업체 경고
                  (이비인후과학회 vs 이빈후과학회 같은 오타·공백 변형도 잡음) */}
              <SimilarOrgWarning
                name={form.organization_name}
                editingId={editingId}
                onPickExisting={(id) => {
                  const target = items.find((c) => c.id === id);
                  if (!target) return;
                  if (editingId || form.organization_name) {
                    if (
                      !confirm(
                        `[${target.organization_name}] 기존 고객으로 이동합니다.\n현재 입력한 내용은 사라집니다. 계속하시겠습니까?`
                      )
                    )
                      return;
                  }
                  openEdit(target);
                }}
              />
            </Field>
            <Field label="공식연락처">
              <input
                className="input"
                value={form.official_phone}
                placeholder="02-0000-0000"
                onChange={(e) => setForm({ ...form, official_phone: e.target.value })}
              />
            </Field>
            <Field label="공식이메일">
              <input
                className="input"
                type="email"
                value={form.official_email}
                onChange={(e) => setForm({ ...form, official_email: e.target.value })}
              />
            </Field>
            <Field label="공식홈페이지 / 블로그" className="md:col-span-2">
              <input
                className="input"
                value={form.official_website}
                placeholder="https://..."
                onChange={(e) => setForm({ ...form, official_website: e.target.value })}
              />
            </Field>
          </div>
        </Section>

        {/* (2) 문의세부정보 */}
        <Section
          title="(2) 문의세부정보"
          right={
            <button
              type="button"
              onClick={addInquiry}
              className="text-xs text-blue-600 hover:underline"
            >
              + 문의 추가
            </button>
          }
        >
          <div className="space-y-3">
            {form.inquiries.map((inq, idx) => (
              <div key={inq.id} className="border rounded-md p-3 bg-gray-50/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-600">문의 #{idx + 1}</div>
                  {form.inquiries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeInquiry(inq.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      이 문의 삭제
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="유입 채널" required>
                    <div className="flex gap-3 mt-1 text-sm">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`channel-${inq.id}`}
                          value="INCALL"
                          checked={inq.inquiry_channel === 'INCALL'}
                          onChange={() =>
                            updateInquiry(inq.id, { inquiry_channel: 'INCALL' })
                          }
                        />
                        <span>📞 인콜 <span className="text-xs text-gray-500">(고객 문의)</span></span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`channel-${inq.id}`}
                          value="OUTCALL"
                          checked={inq.inquiry_channel === 'OUTCALL'}
                          onChange={() =>
                            updateInquiry(inq.id, { inquiry_channel: 'OUTCALL' })
                          }
                        />
                        <span>📤 아웃콜 <span className="text-xs text-gray-500">(영업 제안)</span></span>
                      </label>
                    </div>
                  </Field>
                  <Field label="진행상황" required>
                    <select
                      className="input"
                      value={inq.progress_status}
                      onChange={(e) =>
                        updateInquiry(inq.id, {
                          progress_status: e.target.value as MiceInquiryStatus,
                        })
                      }
                    >
                      {MICE_INQUIRY_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {MICE_INQUIRY_STATUS_DESC[s]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="작성자">
                    <select
                      className="input"
                      value={inq.created_by_id || ''}
                      onChange={(e) => {
                        const u = activeUsers.find((x) => x.id === e.target.value);
                        if (u) {
                          updateInquiry(inq.id, {
                            created_by_id: u.id,
                            created_by_name: u.name,
                          });
                        }
                      }}
                    >
                      {/* 현재 등록된 사용자가 active 목록에 없을 수도 있으니 fallback option 추가 */}
                      {!activeUsers.find((x) => x.id === inq.created_by_id) &&
                        inq.created_by_name && (
                          <option value={inq.created_by_id || ''}>
                            {inq.created_by_name}
                          </option>
                        )}
                      {activeUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="담당자">
                    <select
                      className="input"
                      value={inq.assigned_manager_id || ''}
                      onChange={(e) => {
                        const id = e.target.value;
                        if (!id) {
                          updateInquiry(inq.id, {
                            assigned_manager_id: '',
                            assigned_manager_name: '',
                          });
                          return;
                        }
                        const u = miceManagerOptions.find((x) => x.id === id);
                        if (u) {
                          updateInquiry(inq.id, {
                            assigned_manager_id: u.id,
                            assigned_manager_name: u.name,
                          });
                        }
                      }}
                    >
                      <option value="">선택...</option>
                      {/* 현재 담당자가 목록에 없으면 fallback 옵션 유지 */}
                      {inq.assigned_manager_id &&
                        !miceManagerOptions.find((x) => x.id === inq.assigned_manager_id) &&
                        inq.assigned_manager_name && (
                          <option value={inq.assigned_manager_id}>
                            {inq.assigned_manager_name} (현재)
                          </option>
                        )}
                      {miceManagerOptions.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="통화일자">
                    <input
                      type="date"
                      className="input"
                      value={inq.call_date || ''}
                      onChange={(e) =>
                        updateInquiry(inq.id, { call_date: e.target.value || null })
                      }
                    />
                  </Field>
                  <Field label="문의 행사일">
                    <input
                      className="input"
                      value={inq.inquiry_event_date_text}
                      placeholder="2026-06-20 또는 미정"
                      onChange={(e) =>
                        updateInquiry(inq.id, { inquiry_event_date_text: e.target.value })
                      }
                    />
                  </Field>
                </div>

                {/* 담당자 sub-list */}
                <div className="mt-3 pl-3 border-l-2 border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                      담당자 {inq.contacts.length > 0 && `(${inq.contacts.length}명)`}
                    </div>
                    <button
                      type="button"
                      onClick={() => addContact(inq.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      + 담당자 추가
                    </button>
                  </div>
                  <div className="space-y-2">
                    {inq.contacts.map((ct, cIdx) => (
                      <div
                        key={ct.id}
                        className="bg-white border rounded-md p-2 grid grid-cols-1 md:grid-cols-12 gap-2 items-end"
                      >
                        <div className="md:col-span-1 flex items-center text-xs text-gray-500 pt-3">
                          #{cIdx + 1}
                        </div>
                        <div className="md:col-span-3">
                          <label className="text-[11px] uppercase tracking-wide text-gray-500">
                            이름
                          </label>
                          <input
                            className="input !py-1.5 !text-sm"
                            value={ct.name}
                            onChange={(e) =>
                              updateContact(inq.id, ct.id, { name: e.target.value })
                            }
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="text-[11px] uppercase tracking-wide text-gray-500">
                            연락처
                          </label>
                          <input
                            className="input !py-1.5 !text-sm"
                            value={ct.phone}
                            placeholder="010-0000-0000"
                            onChange={(e) =>
                              updateContact(inq.id, ct.id, { phone: e.target.value })
                            }
                          />
                        </div>
                        <div className="md:col-span-4">
                          <label className="text-[11px] uppercase tracking-wide text-gray-500">
                            이메일
                          </label>
                          <input
                            className="input !py-1.5 !text-sm"
                            type="email"
                            value={ct.email}
                            onChange={(e) =>
                              updateContact(inq.id, ct.id, { email: e.target.value })
                            }
                          />
                        </div>
                        <div className="md:col-span-1 flex justify-end pb-2">
                          {inq.contacts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeContact(inq.id, ct.id)}
                              className="text-xs text-red-500 hover:underline"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* (3) 메모 */}
        <Section title="(3) 메모">
          <textarea
            className="input min-h-[110px]"
            value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
        </Section>

        {/* 플렌티에서 진행한 행사 — 수정 모달에서도 보이도록 (프로필 페이지와 동일 데이터) */}
        {editingId && (
          <Section title="플렌티에서 진행한 행사">
            <LinkedEventsSection
              customerType="mice"
              customerId={editingId}
              showProfileLink
            />
          </Section>
        )}

        {/* 수정 이력 */}
        <ChangeLogPanel
          entityType="mice_customer"
          entityId={editingId}
          refreshKey={logRefresh}
        />
      </Modal>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2 border-b pb-1 flex items-center justify-between">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}
