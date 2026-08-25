import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  INVOICE_ISSUE_STATUS_OPTIONS,
  INVOICE_TYPE_OPTIONS,
  MICE_INQUIRY_STATUS_DESC,
  MICE_INQUIRY_STATUS_OPTIONS,
  miceStatusLabel,
  normalizeMiceStatus,
  type MiceCategory,
  type MiceContact,
  type MiceCustomer,
  type MiceInquiry,
  type MiceInquiryStatus,
} from '../types';
import Modal from '../components/Modal';
import InquiryEventLinkModal from '../components/InquiryEventLinkModal';
import AutoExpandTextarea from '../components/AutoExpandTextarea';
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
  callbackView,
  needsCall,
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

// 대표 문의는 trackedInquiryOf 한 곳에서만 정한다.
// 예전에 이 파일의 '마지막 칸' 과 callTracker 의 '날짜 최신' 두 기준이 따로 놀아서
// 배지는 취소인데 확정 탭에 잡히는 어긋남이 실제로 있었다 — 별칭만 남긴다.
const lastInquiryOf = trackedInquiryOf;
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
        <StatusBadge value={miceStatusLabel(last.progress_status)} variant={last.progress_status} />
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
  {
    // 건별 통화 메모 — 고객 전반 메모와 다르다. 트래커에서 팀이 가장 많이 보던 칸.
    key: 'inquiry_note',
    label: '통화 메모',
    render: (c) => {
      const note = trackedInquiryOf(c)?.note || '';
      return (
        <span className="block max-w-[18rem] truncate text-gray-600" title={note}>
          {note || '-'}
        </span>
      );
    },
    sortValue: (c) => trackedInquiryOf(c)?.note || '',
  },
];

type FormState = Omit<MiceCustomer, 'id' | 'created_at' | 'updated_at' | 'customer_type'>;

function emptyContact(): MiceContact {
  return { id: nanoid(), name: '', email: '', phone: '' };
}

function emptyInquiry(authorId: string, authorName: string): MiceInquiry {
  return {
    id: nanoid(),
    progress_status: '문의',
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
  // 행사 연결 모달 — 어느 문의를 연결 중인지 (S2)
  const [linkFor, setLinkFor] = useState<{ inquiry: MiceInquiry; no: number } | null>(null);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);
  // 콜 트래커 — 별도 사이트로 쓰던 문의 트래커를 이 화면 안으로 접어 넣었다.
  const [callTab, setCallTab] = useState('all');
  // 기한 지남 배지를 눌렀을 때 그 건들만 추려 보는 필터
  const [overdueOnly, setOverdueOnly] = useState(false);
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
    // 상태 탭 — 판정은 CALL_TABS 의 match 한 곳에서.
    // '문의' 탭은 상태가 아니라 팔로업 여부(콜백이 살아 있는가)로 거른다.
    const tab = CALL_TABS.find((t) => t.key === callTab);
    if (tab && tab.key !== 'all') {
      list = list.filter((c) => tab.match(trackedInquiryOf(c)));
    }
    if (overdueOnly) {
      list = list.filter((c) => callbackView(trackedInquiryOf(c)).state === 'overdue');
    }
    return list;
  }, [items, debouncedQuery, searchIndex, callTab, overdueOnly]);

  const tabCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of CALL_TABS) {
      m.set(
        t.key,
        t.key === 'all' ? items.length : items.filter((c) => t.match(trackedInquiryOf(c))).length
      );
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
      // 문의가 없으면 없는 그대로 연다. 빈 카드를 만들어 보여주면
      // 오늘 날짜의 '문의' 가 자동 입력된 것처럼 보인다 — DB 에 없는 걸 그리면 안 된다.
      inquiries: c.inquiries.map((i) => ({ ...i })),
      memo: c.memo,
    });
    setOpen(true);
  }

  function addInquiry() {
    setForm((p) => ({ ...p, inquiries: [...p.inquiries, emptyInquiry(authorId, authorName)] }));
  }
  function removeInquiry(id: string) {
    // 마지막 한 건도 지울 수 있다 — 홍보메일 기록용 고객은 문의 0건이 정상 상태다.
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.filter((i) => i.id !== id),
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
  /** 이 고객의 다른 문의들에서 쓰던 담당자 목록 (이름·연락처·이메일 중복 제거) — 문의마다 다시 치지 않게 */
  function knownContacts(exceptInquiryId: string): MiceContact[] {
    const seen = new Map<string, MiceContact>();
    for (const i of form.inquiries) {
      for (const c of i.contacts) {
        if (!c.name.trim() && !c.phone.trim() && !c.email.trim()) continue;
        const key = `${c.name.trim()}|${c.phone.trim()}|${c.email.trim()}`;
        if (!seen.has(key)) seen.set(key, c);
      }
    }
    // 현재 문의에 이미 있는 사람은 제외
    const cur = form.inquiries.find((i) => i.id === exceptInquiryId);
    const curKeys = new Set(
      (cur?.contacts || []).map((c) => `${c.name.trim()}|${c.phone.trim()}|${c.email.trim()}`)
    );
    return [...seen.entries()].filter(([k]) => !curKeys.has(k)).map(([, c]) => c);
  }
  function copyContact(inquiryId: string, src: MiceContact) {
    setForm((p) => ({
      ...p,
      inquiries: p.inquiries.map((i) => {
        if (i.id !== inquiryId) return i;
        // 빈 칸 하나만 있으면 거기에 채우고, 아니면 새 줄로
        const blankIdx = i.contacts.findIndex((c) => !c.name.trim() && !c.phone.trim() && !c.email.trim());
        const copied = { ...emptyContact(), name: src.name, phone: src.phone, email: src.email };
        const contacts = blankIdx >= 0
          ? i.contacts.map((c, idx) => (idx === blankIdx ? copied : c))
          : [...i.contacts, copied];
        return { ...i, contacts };
      }),
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
        // 목록에서 고친 날짜는 '언제까지 회신 받을지' 기한으로 넣는다
        const field = 'callback_due' as const;
        return (
          <CallbackCell
            value={callbackDateOf(q)}
            view={callbackView(q)}
            disabled={readOnly || trackSaving === c.id}
            onChange={(v) => patchTracked(c, { [field]: v })}
            onToggleDone={(done) => {
              // 닫을 때만 되묻는다 — 목록에서 한 번에 사라져 잘못 눌러도 알아채기 어렵다.
              // 다시 여는 건(↩) 되돌리는 동작이라 그대로 진행.
              if (
                done &&
                !confirm(
                  `[${c.organization_name}]\n이 건은 더 이상 콜백하지 않는 것으로 표시합니다.\n` +
                    `콜백 목록과 홈 화면에서 빠집니다. 계속할까요?\n\n` +
                    `(되돌리려면 같은 자리의 ↩ 를 누르시면 됩니다)`
                )
              ) {
                return;
              }
              patchTracked(c, { callback_done_at: done ? new Date().toISOString() : null });
            }}
          />
        );
      },
      // 급한 것부터. 끝난 건(확정·취소·완료)과 기한 없는 건은 날짜와 무관하게 뒤로 민다.
      sortValue: (c) => {
        const v = callbackView(trackedInquiryOf(c));
        return needsCall(v.state) ? v.due : `9999${v.due || ''}`;
      },
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
    overdueOnly,
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
          {(overdue > 0 || overdueOnly) && (
            <button
              onClick={() => {
                setCallTab('all');
                setOverdueOnly((v) => !v);
              }}
              className={`text-xs px-2 py-1 rounded-full border ${
                overdueOnly
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              }`}
              title="확정·취소로 끝난 건과 완료 표시한 건은 빠진 숫자입니다"
            >
              콜백 기한 지남 {overdue}건{overdueOnly ? ' · 해제' : ''}
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
            title={t.tip}
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
                      <StatusBadge value={miceStatusLabel(last.progress_status)} variant={last.progress_status} />
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
            {form.inquiries.length === 0 && (
              <div className="border border-dashed rounded-md px-4 py-6 text-center text-sm text-gray-400">
                등록된 문의가 없습니다 — 연락처만 보관 중인 고객입니다.
                <br />
                실제 문의 전화가 오면 위의 <b className="text-gray-600">+ 문의 추가</b> 로 기록하세요.
              </div>
            )}
            {form.inquiries.map((inq, idx) => (
              <div key={inq.id} className="border rounded-md p-3 bg-gray-50/40">
                <div className="flex items-center justify-between mb-2">
                  {/* 언제 들어온 문의인지 헤더에 박아둔다 — 이 화면은 통화 이력 모음이라
                      '몇 년도 문의였나' 가 먼저 보여야 읽힌다 */}
                  <div className="text-xs font-semibold text-gray-600">
                    문의 #{idx + 1}
                    <span className="ml-2 font-normal text-gray-400">
                      {(inq.call_date || inq.created_at || '').slice(0, 10) || '날짜 미상'}
                    </span>
                    <span
                      className={`ml-2 badge ${
                        inq.progress_status === 'DEF'
                          ? 'bg-green-200 text-green-900'
                          : inq.progress_status === 'LOS'
                            ? 'bg-red-200 text-red-900'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {miceStatusLabel(inq.progress_status)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeInquiry(inq.id)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    이 문의 삭제
                  </button>
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

                {/* 이 문의가 어디까지 갔는지 — 문의 건마다 따로 잡힌다.
                    진행상황은 '어떻게 끝났나' 만 말하므로, 진행도는 이 네 개가 답한다. */}
                <div className="mt-3 pl-3 border-l-2 border-emerald-200">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
                    이 문의의 진행
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-2">
                    {CALL_CHECKS.map((chk) => (
                      <label
                        key={String(chk.key)}
                        className="flex items-center gap-1.5 text-sm cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4"
                          checked={!!inq[chk.key]}
                          onChange={(e) =>
                            updateInquiry(inq.id, { [chk.key]: e.target.checked })
                          }
                        />
                        <span>{chk.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 계약금 = 가톨릭대 대관료 — 입금·계산서의 원본. 저장하면 연결된 행사 매출탭으로 미러. (S2) */}
                <div className="mt-3 pl-3 border-l-2 border-amber-300">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
                    계약금 · 입금 (= 가톨릭대관료)
                  </div>
                  <div className="flex flex-wrap items-end gap-3 mb-2">
                    <label className="text-xs text-gray-600">
                      계약금
                      <input
                        type="number"
                        className="input mt-1 w-40"
                        placeholder="0"
                        value={inq.deposit_amount ?? ''}
                        onChange={(e) =>
                          updateInquiry(inq.id, {
                            deposit_amount: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <div className="flex items-center gap-2 pb-1">
                      <button
                        type="button"
                        className="btn-xs"
                        disabled={!editingId}
                        title={editingId ? '이 문의가 성사된 행사를 연결' : '고객을 먼저 저장하면 연결할 수 있습니다'}
                        onClick={() => setLinkFor({ inquiry: inq, no: idx + 1 })}
                      >
                        {inq.linked_event_id ? '🔗 연결된 행사 보기' : '🔗 행사 연결'}
                      </button>
                      {inq.linked_event_id ? (
                        <Link
                          to={`/calendar?event=${inq.linked_event_id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          캘린더에서 열기
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">행사 미연결</span>
                      )}
                      {inq.revenue_pushed_at ? (
                        <span className="badge bg-emerald-100 text-emerald-800">
                          매출 반영 {Number(inq.revenue_pushed_amount || 0).toLocaleString()}원
                        </span>
                      ) : inq.linked_event_id &&
                        inq.progress_status === 'DEF' &&
                        inq.deposit_paid &&
                        Number(inq.deposit_amount) > 0 ? (
                        <span className="badge bg-amber-100 text-amber-800">저장하면 매출 반영</span>
                      ) : null}
                    </div>
                  </div>


                  <div className="flex flex-wrap items-end gap-3 mb-2">
                    <label className="text-xs text-gray-600">
                      입금자명
                      <input
                        className="input mt-1 w-32"
                        value={inq.deposit_depositor || ''}
                        onChange={(e) => updateInquiry(inq.id, { deposit_depositor: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      입금일자
                      <input
                        type="date"
                        className="input mt-1"
                        value={inq.deposit_date || ''}
                        onChange={(e) => updateInquiry(inq.id, { deposit_date: e.target.value || null })}
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      계산서 발행
                      <select
                        className="input mt-1"
                        value={inq.invoice_type || ''}
                        onChange={(e) => updateInquiry(inq.id, { invoice_type: e.target.value })}
                      >
                        {INVOICE_TYPE_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o || '선택 안 함'}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">
                      발행상태
                      <select
                        className="input mt-1"
                        value={inq.invoice_issue_status || ''}
                        onChange={(e) => updateInquiry(inq.id, { invoice_issue_status: e.target.value })}
                      >
                        {INVOICE_ISSUE_STATUS_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o || '선택 안 함'}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">
                      세금계산서 발행일자
                      <input
                        type="date"
                        className="input mt-1"
                        value={inq.tax_invoice_issue_date || ''}
                        onChange={(e) => updateInquiry(inq.id, { tax_invoice_issue_date: e.target.value || null })}
                      />
                    </label>
                  </div>
                </div>

                {/* 콜백 — 팔로업 일정만 모아둔 구역 */}
                <div className="mt-3 pl-3 border-l-2 border-violet-300">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
                    콜백
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="콜백 예정일">
                      <input
                        type="date"
                        className="input"
                        // 옛 '재통화 예정일'이 남아 있으면 그 값을 보여주고, 저장 시 이 칸으로 합쳐진다
                        value={inq.callback_at || inq.callback_due || ''}
                        onChange={(e) =>
                          updateInquiry(inq.id, {
                            callback_due: e.target.value || null,
                            callback_at: null,
                          })
                        }
                      />
                    </Field>
                  </div>
                  {/* 콜백 종료 — 목록의 ✓ 와 같은 동작. 여기서는 행이 사라지지 않고
                      되돌리기 버튼이 바로 옆에 보이므로 확인창 없이 글자 버튼으로 둔다. */}
                  {(() => {
                    const cv = callbackView(inq);
                    if (cv.state === 'none') return null;
                    return (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-[11px] text-gray-500">콜백 상태</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${cv.cls}`}>
                          {cv.label}
                        </span>
                        {(needsCall(cv.state) || cv.state === 'done') && (
                          <button
                            type="button"
                            onClick={() =>
                              updateInquiry(inq.id, {
                                callback_done_at:
                                  cv.state === 'done' ? null : new Date().toISOString(),
                              })
                            }
                            className="text-xs px-2 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50"
                          >
                            {cv.state === 'done' ? '↩ 콜백 다시 열기' : '✓ 콜백 완료로 표시'}
                          </button>
                        )}
                        {cv.state === 'closed' && (
                          <span className="text-[11px] text-gray-400">
                            확정·취소된 건이라 콜백 대상에서 자동으로 빠집니다
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* 통화 메모 — 이 문의 건의 대화 기록 */}
                <div className="mt-3 pl-3 border-l-2 border-gray-300">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
                    통화 메모
                  </div>
                  <AutoExpandTextarea
                    className="input"
                    minRows={2}
                    value={inq.note || ''}
                    placeholder="이 문의 건의 통화·협상 내용 (업체 전반 메모는 아래 '메모' 칸)"
                    onChange={(e) => updateInquiry(inq.id, { note: e.target.value })}
                  />
                </div>

                {/* 담당자 sub-list */}
                <div className="mt-3 pl-3 border-l-2 border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">
                      담당자 {inq.contacts.length > 0 && `(${inq.contacts.length}명)`}
                    </div>
                    <div className="flex items-center gap-3">
                      {knownContacts(inq.id).length > 0 && (
                        <select
                          className="input text-xs py-0.5"
                          style={{ width: 190 }}
                          value=""
                          title="이 고객의 다른 문의에서 쓰던 담당자를 그대로 가져옵니다"
                          onChange={(e) => {
                            const k = knownContacts(inq.id)[Number(e.target.value)];
                            if (k) copyContact(inq.id, k);
                          }}
                        >
                          <option value="">기존 담당자 불러오기…</option>
                          {knownContacts(inq.id).map((c, ki) => (
                            <option key={ki} value={ki}>
                              {[c.name || '(이름없음)', c.phone, c.email].filter(Boolean).join(' · ').slice(0, 40)}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => addContact(inq.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        + 담당자 추가
                      </button>
                    </div>
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
          <AutoExpandTextarea
            className="input"
            minRows={3}
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

      {linkMsg && (
        <div className="fixed top-4 right-4 z-[60] bg-emerald-700 text-white text-sm px-4 py-2 rounded shadow-lg">
          {linkMsg}
        </div>
      )}

      {/* 문의 ↔ 행사 연결 (S2) — 연결 후 링크 필드만 폼에 동기화한다.
          저장 안 된 수정을 덮지 않고, 다음 저장이 링크를 지우지도 않게. */}
      {linkFor && editingId && (
        <InquiryEventLinkModal
          customerId={editingId}
          customerName={form.organization_name}
          inquiry={linkFor.inquiry}
          inquiryNo={linkFor.no}
          onClose={() => setLinkFor(null)}
          onLinked={(msg, customer) => {
            const fresh = (customer.inquiries || []).find((q) => q.id === linkFor.inquiry.id);
            updateInquiry(linkFor.inquiry.id, {
              linked_event_id: fresh?.linked_event_id ?? null,
              linked_at: fresh?.linked_at ?? null,
              linked_by_name: fresh?.linked_by_name ?? '',
              revenue_pushed_at: fresh?.revenue_pushed_at ?? null,
              revenue_pushed_amount: fresh?.revenue_pushed_amount ?? null,
            });
            void load();
            setLinkMsg(msg);
            setTimeout(() => setLinkMsg(null), 5000);
          }}
        />
      )}
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
