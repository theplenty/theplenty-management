import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { matchesAnyField } from '../lib/koreanSearch';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useAuth } from '../auth/AuthContext';
import { useActiveUsers } from '../lib/useActiveUsers';
import { nanoid } from '../lib/clientId';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  WEDDING_PROGRESS_OPTIONS,
  WEDDING_SOURCE_DETAIL_OPTIONS,
  WEDDING_SOURCE_OPTIONS,
  type WeddingCustomer,
  type WeddingEventInquiry,
  type WeddingProgressStatus,
  type WeddingSource,
  type WeddingSourceDetail,
} from '../types';
import Modal from '../components/Modal';
import { Field, StatusBadge } from '../components/Field';
import ExcelButtons from '../components/ExcelButtons';
import ChangeLogPanel from '../components/ChangeLogPanel';
import {
  buildWeddingFlatRows,
  groupWeddingFlatRows,
  WEDDING_FLAT_COLUMNS,
  type WeddingFlatRow,
} from '../lib/customerColumns';

type FormState = Omit<WeddingCustomer, 'id' | 'created_at' | 'updated_at' | 'customer_type'>;

// 날짜+시간 문자열 처리 — "2026-05-04" (date-only) / "2026-05-04T14:30" (date+time) 둘 다 허용
function splitDateTime(s: string | null): { date: string; time: string } {
  if (!s) return { date: '', time: '' };
  const idx = s.indexOf('T');
  if (idx === -1) return { date: s, time: '' };
  return { date: s.slice(0, idx), time: s.slice(idx + 1, idx + 6) };
}
function joinDateTime(date: string, time: string): string | null {
  if (!date) return null;
  if (!time) return date;
  return `${date}T${time}`;
}
function fmtDateOrDateTime(s: string | null | undefined): string {
  if (!s) return '-';
  if (!s.includes('T')) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyEventInquiry(authorId: string, authorName: string): WeddingEventInquiry {
  return {
    id: nanoid(),
    wedding_datetime: null,
    guaranteed_guest_count: null,
    estimate_amount: '',
    estimate_detail: '',
    visit_consultation_comment: '',
    assigned_manager_id: authorId,
    assigned_manager_name: authorName,
    created_at: new Date().toISOString(),
  };
}

function emptyForm(authorId: string, authorName: string): FormState {
  return {
    wedding_event_name: '',
    progress_status: '신규문의',
    inquiry_date: null,
    desired_consultation_date: null,
    first_inform_comment: '',
    groom_name: '',
    groom_phone: '',
    groom_email: '',
    bride_name: '',
    bride_phone: '',
    bride_email: '',
    competing_venues: '',
    desired_budget: '',
    source: '',
    source_detail: '',
    event_inquiries: [emptyEventInquiry(authorId, authorName)],
    memo: '',
  };
}

export default function WeddingCustomers() {
  const { user } = useAuth();
  const authorName = user?.name || '';
  const authorId = user?.id || '';
  const activeUsers = useActiveUsers();

  const [items, setItems] = useState<WeddingCustomer[]>([]);
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
      const res = await api.get<{ customers: WeddingCustomer[] }>('/api/customers/wedding');
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

  // 캘린더에서 상담 클릭 시 #consult-<id> 해시로 진입 → 해당 고객 모달 자동 오픈
  useEffect(() => {
    if (!items.length) return;
    const hash = window.location.hash;
    const m = hash.match(/^#consult-(.+)$/);
    if (!m) return;
    const target = items.find((c) => c.id === m[1]);
    if (target) {
      openEdit(target);
      // 같은 해시로 재진입해도 다시 열리도록 hash 정리
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [items]);

  const filtered = useMemo(() => {
    if (!debouncedQuery.trim()) return items;
    return items.filter((c) =>
      matchesAnyField(
        c as unknown as Record<string, unknown>,
        [
          'wedding_event_name',
          'groom_name',
          'bride_name',
          'groom_phone',
          'bride_phone',
          'groom_email',
          'bride_email',
          'progress_status',
          'source',
        ],
        debouncedQuery
      )
    );
  }, [items, debouncedQuery]);

  const suggestions = useMemo(
    () => (debouncedQuery.trim() ? filtered.slice(0, 6) : []),
    [filtered, debouncedQuery]
  );

  function openNew() {
    setEditingId(null);
    setForm(emptyForm(authorId, authorName));
    setOpen(true);
  }
  function openEdit(c: WeddingCustomer) {
    setEditingId(c.id);
    setForm({
      wedding_event_name: c.wedding_event_name,
      progress_status: c.progress_status,
      inquiry_date: c.inquiry_date,
      desired_consultation_date: c.desired_consultation_date,
      first_inform_comment: c.first_inform_comment,
      groom_name: c.groom_name,
      groom_phone: c.groom_phone,
      groom_email: c.groom_email,
      bride_name: c.bride_name,
      bride_phone: c.bride_phone,
      bride_email: c.bride_email,
      competing_venues: c.competing_venues,
      desired_budget: c.desired_budget,
      source: c.source,
      source_detail: c.source_detail,
      event_inquiries: c.event_inquiries.length
        ? c.event_inquiries.map((i) => ({ ...i }))
        : [emptyEventInquiry(authorId, authorName)],
      memo: c.memo,
    });
    setOpen(true);
  }

  function addInquiry() {
    setForm((p) => ({
      ...p,
      event_inquiries: [...p.event_inquiries, emptyEventInquiry(authorId, authorName)],
    }));
  }
  function removeInquiry(id: string) {
    setForm((p) => ({
      ...p,
      event_inquiries:
        p.event_inquiries.length > 1
          ? p.event_inquiries.filter((i) => i.id !== id)
          : p.event_inquiries,
    }));
  }
  function updateInquiry(id: string, patch: Partial<WeddingEventInquiry>) {
    setForm((p) => ({
      ...p,
      event_inquiries: p.event_inquiries.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }

  async function save() {
    if (!form.wedding_event_name.trim()) {
      alert('행사명은 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const res = await api.patch<{ customer: WeddingCustomer }>(
          `/api/customers/wedding/${editingId}`,
          form
        );
        setItems((prev) => prev.map((x) => (x.id === editingId ? res.customer : x)));
        setLogRefresh((n) => n + 1);
      } else {
        const res = await api.post<{ customer: WeddingCustomer }>(
          '/api/customers/wedding',
          form
        );
        setItems((prev) => [res.customer, ...prev]);
        setEditingId(res.customer.id);
        setLogRefresh((n) => n + 1);
      }
    } catch (e) {
      alert('저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: WeddingCustomer) {
    if (!confirm(`[${c.wedding_event_name}] 고객을 삭제하시겠습니까? (관리자만 가능)`)) return;
    try {
      await api.delete(`/api/customers/wedding/${c.id}`);
      setItems((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      alert('삭제 실패 (관리자 권한이 필요합니다)');
      console.error(e);
    }
  }

  const flatRows = useMemo(() => buildWeddingFlatRows(items), [items]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">WEDDING 고객정보</h1>
        <div className="flex items-center gap-2">
          <ExcelButtons
            filename={`WEDDING_고객정보_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="WEDDING 고객정보"
            columns={WEDDING_FLAT_COLUMNS}
            rows={flatRows}
            onImportRows={async (rows) => {
              const grouped = groupWeddingFlatRows(rows as WeddingFlatRow[], authorId, authorName);
              let ok = 0;
              let failed = 0;
              for (const c of grouped) {
                try {
                  const res = await api.post<{ customer: WeddingCustomer }>(
                    '/api/customers/wedding',
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
          placeholder="검색: 행사명 / 신랑·신부 이름 / 전화번호(끝 4자리만 입력 가능) / 이메일 / 진행단계 (초성도 가능)"
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
                <div className="text-sm font-medium text-gray-900">{s.wedding_event_name}</div>
                <div className="text-xs text-gray-500">
                  {s.groom_name} ♥ {s.bride_name} · 단계 {s.progress_status} · 후보일정{' '}
                  {s.event_inquiries.length}건
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
                <Th>행사명</Th>
                <Th>진행단계</Th>
                <Th>신규문의일자</Th>
                <Th>희망상담일자</Th>
                <Th>신랑</Th>
                <Th>신부</Th>
                <Th>유입경로</Th>
                <Th>희망예산</Th>
                <Th>예식 후보 일정</Th>
                <Th>최종 수정</Th>
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
                filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openEdit(c)}
                    className="border-t hover:bg-pink-50 cursor-pointer"
                  >
                    <Td className="font-medium text-gray-900">{c.wedding_event_name}</Td>
                    <Td>
                      <StatusBadge value={c.progress_status} variant={c.progress_status} />
                    </Td>
                    <Td>{fmtDateOrDateTime(c.inquiry_date)}</Td>
                    <Td>{fmtDateOrDateTime(c.desired_consultation_date)}</Td>
                    <Td>
                      {c.groom_name || '-'}
                      {c.groom_phone && (
                        <span className="ml-1 text-xs text-gray-500">{c.groom_phone}</span>
                      )}
                    </Td>
                    <Td>
                      {c.bride_name || '-'}
                      {c.bride_phone && (
                        <span className="ml-1 text-xs text-gray-500">{c.bride_phone}</span>
                      )}
                    </Td>
                    <Td>
                      {c.source || '-'}
                      {c.source_detail && (
                        <span className="ml-1 text-xs text-gray-500">/ {c.source_detail}</span>
                      )}
                    </Td>
                    <Td>{c.desired_budget || '-'}</Td>
                    <Td>
                      <span className="text-xs">
                        {c.event_inquiries
                          .map((i) =>
                            i.wedding_datetime
                              ? new Date(i.wedding_datetime).toLocaleString('ko-KR', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '미정'
                          )
                          .join(' / ') || '-'}
                      </span>
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
                    <Td onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => remove(c)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        삭제
                      </button>
                    </Td>
                  </tr>
                ))
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
        title={editingId ? 'WEDDING 고객 수정' : 'WEDDING 고객 신규 등록'}
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
        {/* (1) 고객기본정보 */}
        <Section title="(1) 고객기본정보">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="행사명" required className="md:col-span-2">
              <input
                className="input"
                value={form.wedding_event_name}
                placeholder="예: 김민수 ♥ 박지영 결혼식"
                onChange={(e) => setForm({ ...form, wedding_event_name: e.target.value })}
              />
            </Field>
            <Field label="진행단계" required>
              <select
                className="input"
                value={form.progress_status}
                onChange={(e) =>
                  setForm({ ...form, progress_status: e.target.value as WeddingProgressStatus })
                }
              >
                {WEDDING_PROGRESS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="신규문의일자" hint="시간은 선택 입력 (비워두면 날짜만 저장됨)">
              {(() => {
                const { date, time } = splitDateTime(form.inquiry_date);
                return (
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="input"
                      value={date}
                      onChange={(e) =>
                        setForm({ ...form, inquiry_date: joinDateTime(e.target.value, time) })
                      }
                    />
                    <input
                      type="time"
                      className="input !w-32"
                      value={time}
                      onChange={(e) =>
                        setForm({ ...form, inquiry_date: joinDateTime(date, e.target.value) })
                      }
                    />
                  </div>
                );
              })()}
            </Field>
            <Field
              label="희망상담일자"
              hint="시간은 선택 입력 (비워두면 날짜만 저장됨) · 해당일자에 지정하면 캘린더에 자동표시됨. 상담취소 시 일자도 삭제 필요."
            >
              {(() => {
                const { date, time } = splitDateTime(form.desired_consultation_date);
                return (
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="input"
                      value={date}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          desired_consultation_date: joinDateTime(e.target.value, time),
                        })
                      }
                    />
                    <input
                      type="time"
                      className="input !w-32"
                      value={time}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          desired_consultation_date: joinDateTime(date, e.target.value),
                        })
                      }
                    />
                  </div>
                );
              })()}
            </Field>
            <Field label="유입경로">
              <select
                className="input"
                value={form.source}
                onChange={(e) =>
                  setForm({ ...form, source: e.target.value as WeddingSource | '' })
                }
              >
                <option value="">선택 안 함</option>
                {WEDDING_SOURCE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="유입 세부경로 (마케팅 수치)">
              <select
                className="input"
                value={form.source_detail}
                onChange={(e) =>
                  setForm({
                    ...form,
                    source_detail: e.target.value as WeddingSourceDetail | '',
                  })
                }
              >
                <option value="">선택 안 함</option>
                {WEDDING_SOURCE_DETAIL_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="비교웨딩홀">
              <input
                className="input"
                value={form.competing_venues}
                placeholder="아펠가모 / 그랜드인터컨"
                onChange={(e) => setForm({ ...form, competing_venues: e.target.value })}
              />
            </Field>
            <Field label="희망예산">
              <input
                className="input"
                value={form.desired_budget}
                placeholder="예: 7,000만원"
                onChange={(e) => setForm({ ...form, desired_budget: e.target.value })}
              />
            </Field>
            <Field label="최초 인폼 코멘트" className="md:col-span-2">
              <textarea
                className="input min-h-[70px]"
                value={form.first_inform_comment}
                onChange={(e) => setForm({ ...form, first_inform_comment: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="border rounded-md p-3 bg-blue-50/40">
              <div className="text-sm font-semibold text-blue-700 mb-2">신랑</div>
              <div className="space-y-3">
                <Field label="이름">
                  <input
                    className="input"
                    value={form.groom_name}
                    onChange={(e) => setForm({ ...form, groom_name: e.target.value })}
                  />
                </Field>
                <Field label="휴대폰">
                  <input
                    className="input"
                    value={form.groom_phone}
                    onChange={(e) => setForm({ ...form, groom_phone: e.target.value })}
                  />
                </Field>
                <Field label="이메일">
                  <input
                    className="input"
                    type="email"
                    value={form.groom_email}
                    onChange={(e) => setForm({ ...form, groom_email: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <div className="border rounded-md p-3 bg-pink-50/40">
              <div className="text-sm font-semibold text-pink-700 mb-2">신부</div>
              <div className="space-y-3">
                <Field label="이름">
                  <input
                    className="input"
                    value={form.bride_name}
                    onChange={(e) => setForm({ ...form, bride_name: e.target.value })}
                  />
                </Field>
                <Field label="휴대폰">
                  <input
                    className="input"
                    value={form.bride_phone}
                    onChange={(e) => setForm({ ...form, bride_phone: e.target.value })}
                  />
                </Field>
                <Field label="이메일">
                  <input
                    className="input"
                    type="email"
                    value={form.bride_email}
                    onChange={(e) => setForm({ ...form, bride_email: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          </div>
        </Section>

        {/* (2) 문의세부정보 */}
        <Section
          title="(2) 문의세부정보 (예식 후보 일정)"
          right={
            <button
              type="button"
              onClick={addInquiry}
              className="text-xs text-blue-600 hover:underline"
            >
              + 일정 추가
            </button>
          }
        >
          <div className="space-y-3">
            {form.event_inquiries.map((inq, idx) => (
              <div key={inq.id} className="border rounded-md p-3 bg-gray-50/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-gray-600">예식 후보 #{idx + 1}</div>
                  {form.event_inquiries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeInquiry(inq.id)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="예식날짜 및 시간">
                    <input
                      type="datetime-local"
                      className="input"
                      value={inq.wedding_datetime || ''}
                      onChange={(e) =>
                        updateInquiry(inq.id, { wedding_datetime: e.target.value || null })
                      }
                    />
                  </Field>
                  <Field label="담당지배인">
                    <select
                      className="input"
                      value={inq.assigned_manager_id || ''}
                      onChange={(e) => {
                        const u = activeUsers.find((x) => x.id === e.target.value);
                        if (u) {
                          updateInquiry(inq.id, {
                            assigned_manager_id: u.id,
                            assigned_manager_name: u.name,
                          });
                        }
                      }}
                    >
                      {!activeUsers.find((x) => x.id === inq.assigned_manager_id) &&
                        inq.assigned_manager_name && (
                          <option value={inq.assigned_manager_id || ''}>
                            {inq.assigned_manager_name}
                          </option>
                        )}
                      {activeUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="예식 보증인원">
                    <input
                      type="number"
                      className="input"
                      value={inq.guaranteed_guest_count ?? ''}
                      onChange={(e) =>
                        updateInquiry(inq.id, {
                          guaranteed_guest_count: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </Field>
                  <Field label="견적비용 (원)">
                    <input
                      className="input text-right tabular-nums"
                      value={inq.estimate_amount}
                      placeholder="0"
                      inputMode="numeric"
                      onChange={(e) =>
                        updateInquiry(inq.id, {
                          estimate_amount: formatKoreanCommas(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="견적 세부 (메모형태)" className="md:col-span-2">
                    <textarea
                      className="input min-h-[60px]"
                      value={inq.estimate_detail}
                      placeholder="식사 메뉴 / 옵션 / 답례품 등"
                      onChange={(e) => updateInquiry(inq.id, { estimate_detail: e.target.value })}
                    />
                  </Field>
                  <Field label="방문 상담일 코멘트" className="md:col-span-2">
                    <textarea
                      className="input min-h-[60px]"
                      value={inq.visit_consultation_comment}
                      onChange={(e) =>
                        updateInquiry(inq.id, { visit_consultation_comment: e.target.value })
                      }
                    />
                  </Field>
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

        <ChangeLogPanel
          entityType="wedding_customer"
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
