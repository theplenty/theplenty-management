import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fuzzyMatch, matchesAnyField } from '../lib/koreanSearch';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useAuth } from '../auth/AuthContext';
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
import { Field, StatusBadge } from '../components/Field';
import ExcelButtons from '../components/ExcelButtons';
import ChangeLogPanel from '../components/ChangeLogPanel';
import {
  buildMiceFlatRows,
  groupMiceFlatRows,
  MICE_FLAT_COLUMNS,
  type MiceFlatRow,
} from '../lib/customerColumns';

type FormState = Omit<MiceCustomer, 'id' | 'created_at' | 'updated_at' | 'customer_type'>;

function emptyContact(): MiceContact {
  return { id: nanoid(), name: '', email: '', phone: '' };
}

function emptyInquiry(authorId: string, authorName: string): MiceInquiry {
  return {
    id: nanoid(),
    progress_status: 'INQ',
    contacts: [emptyContact()],
    call_date: null,
    inquiry_event_date_text: '',
    event_memo: '',
    created_by_id: authorId,
    created_by_name: authorName,
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

  const [items, setItems] = useState<MiceCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [showSuggest, setShowSuggest] = useState(false);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(authorId, authorName));
  const [saving, setSaving] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);

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
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return items;
    return items.filter((c) => {
      const flat: Record<string, unknown> = {
        organization_name: c.organization_name,
        official_phone: c.official_phone,
        official_email: c.official_email,
        memo: c.memo,
        _inq:
          c.inquiries
            .map((i) => {
              const contactsText = i.contacts
                .map((ct) => `${ct.name} ${ct.email} ${ct.phone}`)
                .join(' ');
              return `${i.progress_status} ${contactsText} ${i.inquiry_event_date_text}`;
            })
            .join(' ') || '',
      };
      return matchesAnyField(
        flat,
        ['organization_name', 'official_phone', 'official_email', 'memo', '_inq'],
        debouncedQuery
      );
    });
  }, [items, debouncedQuery]);

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
    } catch (e) {
      alert('저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: MiceCustomer) {
    if (!confirm(`[${c.organization_name}] 고객을 삭제하시겠습니까? (관리자만 가능)`)) return;
    try {
      await api.delete(`/api/customers/mice/${c.id}`);
      setItems((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      alert('삭제 실패 (관리자 권한이 필요합니다)');
      console.error(e);
    }
  }

  const flatRows = useMemo(() => buildMiceFlatRows(items), [items]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">MICE 고객정보</h1>
        <div className="flex items-center gap-2">
          <ExcelButtons
            filename={`MICE_고객정보_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="MICE 고객정보"
            columns={MICE_FLAT_COLUMNS}
            rows={flatRows}
            onImportRows={async (rows) => {
              const grouped = groupMiceFlatRows(rows as MiceFlatRow[], authorId, authorName);
              let ok = 0;
              let failed = 0;
              for (const c of grouped) {
                try {
                  const res = await api.post<{ customer: MiceCustomer }>(
                    '/api/customers/mice',
                    c
                  );
                  setItems((prev) => [res.customer, ...prev]);
                  ok++;
                } catch (e) {
                  console.error('import failed', c, e);
                  failed++;
                }
              }
              return { ok, failed };
            }}
          />
          <button onClick={openNew} className="btn-primary">
            + 신규 등록
          </button>
        </div>
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

      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <Th>구분</Th>
                <Th>업체명</Th>
                <Th>공식연락처</Th>
                <Th>공식이메일</Th>
                <Th>홈페이지/블로그</Th>
                <Th>문의건수</Th>
                <Th>최근 진행상황</Th>
                <Th>최근 담당자</Th>
                <Th>최종 수정</Th>
                <Th>메모</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="text-center text-gray-400 py-8">
                    불러오는 중...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center text-gray-400 py-8">
                    {query ? '검색 결과가 없습니다.' : '등록된 고객이 없습니다.'}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const last = c.inquiries[c.inquiries.length - 1];
                  const lastContacts = last?.contacts || [];
                  const lastContactsLabel = lastContacts.length
                    ? lastContacts.map((ct) => ct.name || '(이름없음)').join(', ')
                    : '-';
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openEdit(c)}
                      className="border-t hover:bg-blue-50 cursor-pointer"
                    >
                      <Td>{c.mice_category}</Td>
                      <Td className="font-medium text-gray-900">{c.organization_name}</Td>
                      <Td>{c.official_phone || '-'}</Td>
                      <Td className="text-gray-600">{c.official_email || '-'}</Td>
                      <Td className="max-w-[12rem] truncate" title={c.official_website}>
                        {c.official_website || '-'}
                      </Td>
                      <Td className="text-center">{c.inquiries.length}</Td>
                      <Td>
                        {last ? (
                          <StatusBadge value={last.progress_status} variant={last.progress_status} />
                        ) : (
                          '-'
                        )}
                      </Td>
                      <Td className="max-w-[10rem] truncate" title={lastContactsLabel}>
                        {lastContactsLabel}
                      </Td>
                      <Td className="text-xs text-gray-500">
                        {c.last_modified_by_name ? (
                          <>
                            {c.last_modified_by_name}
                            <br />
                            <span className="text-gray-400">
                              {c.last_modified_at &&
                                new Date(c.last_modified_at).toLocaleString('ko-KR', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                            </span>
                          </>
                        ) : (
                          '-'
                        )}
                      </Td>
                      <Td className="max-w-[14rem] truncate" title={c.memo}>
                        {c.memo || '-'}
                      </Td>
                      <Td onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => remove(c)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          삭제
                        </button>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-3">
        총 {filtered.length}건 표시 / 전체 {items.length}건
      </div>

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
              {dupMatches.length > 0 && (
                <div className="mt-1.5 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs">
                  <div className="font-medium text-yellow-900 mb-1">
                    ⚠️ 비슷한 업체가 이미 등록되어 있습니다 (중복 등록 방지):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dupMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          // 현재 편집 중이면 변경사항이 사라질 수 있어 확인
                          if (editingId || form.organization_name) {
                            if (
                              !confirm(
                                `[${c.organization_name}] 기존 고객으로 이동합니다.\n현재 입력한 내용은 사라집니다. 계속하시겠습니까?`
                              )
                            )
                              return;
                          }
                          openEdit(c);
                        }}
                        className="px-2 py-0.5 rounded border border-yellow-400 bg-white text-yellow-900 hover:bg-yellow-100 transition"
                      >
                        {c.organization_name}{' '}
                        <span className="text-yellow-700">({c.mice_category})</span>
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-yellow-700 mt-1">
                    같은 업체면 위에서 클릭해 기존 레코드에 문의를 추가하시고, 다른 업체라면 그대로 입력 진행하세요.
                  </div>
                </div>
              )}
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
                  <Field label="행사관련메모" className="md:col-span-2">
                    <input
                      className="input"
                      value={inq.event_memo}
                      onChange={(e) => updateInquiry(inq.id, { event_memo: e.target.value })}
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
