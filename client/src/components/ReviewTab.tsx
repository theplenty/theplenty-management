import { weekdayKoOf, insertWeekday } from '../lib/dateFmt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Field } from './Field';
import AutoExpandTextarea from './AutoExpandTextarea';
import { formatKoreanCommas } from '../lib/numberFormat';
import { useActiveUsers } from '../lib/useActiveUsers';
import { type EventFile } from '../types';

interface Review {
  id: string;
  event_id: string;
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
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  eventId: string | null;
  canWrite: boolean;
  eventStartDatetime?: string;
  eventStatus: string;
}

type Draft = Omit<Review, 'id' | 'event_id' | 'created_by' | 'created_at' | 'updated_at'>;

/** 기본정보 식음 메뉴 중 코스·도시락 — 리뷰에 그대로 끌고 와 메뉴별 실제 식사 인원을 받는다 */
interface MealLine {
  id: string;
  menu_name: string;
  gtd_contract: number | null;
  gtd_final: number | null;
  actual_count: number | null;
}

function emptyDraft(): Draft {
  return {
    banquet_manager: '',
    actual_meal_count: null,
    paid_meal_count: null,
    additional_sales: '',
    system_issues: '',
    event_special_notes: '',
    flower_issues: '',
    next_event_feedback: '',
    general_comment: '',
    final_revenue: null,
  };
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReviewTab({ eventId, canWrite, eventStartDatetime, eventStatus }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mealLines, setMealLines] = useState<MealLine[]>([]);
  // 메뉴가 2개 이상일 때 메뉴별 실제 인원 (식사 메뉴 id → 인원). 1개면 리뷰의 실제 식사 인원 칸 하나를 쓴다.
  const [mealActuals, setMealActuals] = useState<Record<string, number | null>>({});

  // 행사담당자 드롭다운 — 연회팀(banquet) 권한 사용자만 노출.
  // 관리자도 함께 노출(연회팀 겸직 가능). 기존 값이 목록에 없으면 fallback 옵션으로 표시.
  const activeUsers = useActiveUsers();
  const banquetOptions = useMemo(
    () => activeUsers.filter((u) => u.role === 'banquet' || u.role === 'admin'),
    [activeUsers]
  );

  // 최종 INVOICE 첨부파일 — review와 별개로 fetch
  const [finalInvoices, setFinalInvoices] = useState<EventFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadFinalInvoices() {
    if (!eventId) return;
    try {
      const res = await api.get<{ files: EventFile[] }>(`/api/events/${eventId}/files`);
      setFinalInvoices(res.files.filter((f) => f.file_type === 'final_invoice'));
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (!eventId) {
      setReview(null);
      setEditing(false);
      setFinalInvoices([]);
      return;
    }
    setLoading(true);
    api
      .get<{ review: Review | null; meal_lines?: MealLine[] }>(`/api/event-reviews/${eventId}`)
      .then((res) => {
        setReview(res.review);
        const lines = res.meal_lines || [];
        setMealLines(lines);
        setMealActuals(Object.fromEntries(lines.map((l) => [l.id, l.actual_count])));
        if (res.review) {
          const { id: _i, event_id: _e, created_by: _c, created_at: _ca, updated_at: _u, ...rest } =
            res.review;
          void _i;
          void _e;
          void _c;
          void _ca;
          void _u;
          setDraft(rest);
        } else {
          setDraft(emptyDraft());
        }
        setEditing(false);
      })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
    loadFinalInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!eventId) {
    return (
      <div className="border rounded-md p-6 text-center bg-gray-50/50">
        <div className="text-sm text-gray-600">
          행사를 먼저 저장한 뒤 리뷰를 작성할 수 있습니다.
        </div>
      </div>
    );
  }

  // 행사 당일(자정 이후)이면 작성 가능 — 실제 시작 시각은 무관.
  const started = eventStartDatetime
    ? (() => {
        const evDate = eventStartDatetime.slice(0, 10); // YYYY-MM-DD
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        return todayStr >= evDate;
      })()
    : false;
  const eligibleToWrite = canWrite && eventStatus === 'DEF' && started;

  async function save() {
    if (!eventId) return;
    setSaving(true);
    try {
      const multi = mealLines.length >= 2;
      const res = await api.put<{ review: Review }>(`/api/event-reviews/${eventId}`, {
        ...draft,
        // 메뉴 2개 이상: 메뉴별 인원을 보내면 서버가 합계를 실제 식사 인원으로 맞춘다
        ...(multi ? { meal_actuals: mealActuals, actual_meal_count: undefined } : {}),
      });
      setReview(res.review);
      if (multi) setMealLines((ls) => ls.map((l) => ({ ...l, actual_count: mealActuals[l.id] ?? null })));
      setEditing(false);
      alert('저장되었습니다.');
    } catch (e) {
      alert('저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft({ ...draft, [key]: value });
  }

  // 최종매출액 쉼표 처리
  const revenueStr =
    draft.final_revenue != null ? formatKoreanCommas(String(draft.final_revenue)) : '';
  function onRevenueChange(s: string) {
    const formatted = formatKoreanCommas(s);
    const digits = formatted.replace(/[^\d]/g, '');
    set('final_revenue', digits ? Number(digits) : null);
  }

  async function handleUploadInvoice(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    if (file.size > 25 * 1024 * 1024) {
      alert('25MB 이하 파일만 업로드 가능합니다.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('file_type', 'final_invoice');
      const res = await fetch(`/api/events/${eventId}/files`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { file: EventFile };
      setFinalInvoices((p) => [data.file, ...p]);
    } catch (err) {
      alert('업로드 실패');
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function deleteInvoice(f: EventFile) {
    if (!confirm(`[${f.file_name}] 최종 INVOICE를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/events/${f.event_id}/files/${f.id}`);
      setFinalInvoices((p) => p.filter((x) => x.id !== f.id));
    } catch (e) {
      alert('삭제 실패');
      console.error(e);
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-400 py-4">불러오는 중...</div>;
  }

  // 작성 권한 없음 + 리뷰 없음
  if (!review && !canWrite) {
    return (
      <div className="border rounded-md p-6 text-center bg-gray-50/50">
        <div className="text-sm text-gray-600">아직 작성된 리뷰가 없습니다.</div>
      </div>
    );
  }

  const showForm = editing || !review;

  // 리뷰 읽기 전용 뷰
  if (!showForm && review) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs text-gray-500">
            작성: {fmt(review.created_at)} · 최종 수정: {fmt(review.updated_at)}
          </div>
          {canWrite && (
            <button onClick={() => setEditing(true)} className="btn-secondary !py-1 text-xs">
              수정
            </button>
          )}
        </div>
        <ReadOnlyView review={review} mealLines={mealLines} />
        <FinalInvoiceSection
          files={finalInvoices}
          canWrite={canWrite}
          uploading={uploading}
          onUpload={handleUploadInvoice}
          onDelete={deleteInvoice}
          fileInputRef={fileInputRef}
          finalRevenue={review.final_revenue}
        />
      </div>
    );
  }

  // 리뷰 작성 폼 (조건 미달)
  if (!review && !eligibleToWrite) {
    return (
      <div className="border rounded-md p-6 text-center bg-yellow-50 border-yellow-200">
        <div className="text-sm text-yellow-800">
          행사리뷰는 <strong>DEF 상태 + 행사 당일(자정 이후)</strong>부터 작성할 수 있습니다.
        </div>
        <div className="text-xs text-yellow-700 mt-2">
          현재 상태: {eventStatus}
          {eventStartDatetime && ` · 행사일: ${insertWeekday(eventStartDatetime.slice(0, 10))}`}
        </div>
      </div>
    );
  }

  // 작성/수정 폼
  return (
    <div>
      <div className="text-sm text-gray-600 mb-4">
        연회팀 행사리뷰 — 행사 종료 후 운영 결과와 피드백을 기록합니다.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="행사담당자" hint="권한이 '연회팀'인 사용자 중 선택">
          <select
            className="input"
            value={draft.banquet_manager}
            onChange={(e) => set('banquet_manager', e.target.value)}
          >
            <option value="">선택...</option>
            {/* 현재 값이 목록에 없으면 fallback (옛 데이터·삭제된 사용자 호환) */}
            {draft.banquet_manager &&
              !banquetOptions.some((u) => u.name === draft.banquet_manager) && (
                <option value={draft.banquet_manager}>{draft.banquet_manager} (목록 외)</option>
              )}
            {banquetOptions.map((u) => (
              <option key={u.id} value={u.name}>
                {u.name}
                {u.role === 'admin' ? ' (관리자)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <div />
        {mealLines.length > 0 ? (
          <div className="md:col-span-2">
            <MealLinesTable
              lines={mealLines}
              editable
              single={mealLines.length === 1 ? draft.actual_meal_count : undefined}
              onSingle={(v) => set('actual_meal_count', v)}
              actuals={mealActuals}
              onActual={(id, v) => setMealActuals((m) => ({ ...m, [id]: v }))}
            />
          </div>
        ) : (
          <Field label="실제 식사 인원">
            <input
              type="number"
              className="input text-right tabular-nums"
              value={draft.actual_meal_count ?? ''}
              onChange={(e) =>
                set('actual_meal_count', e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </Field>
        )}
        <Field label="결제 식사 인원">
          <input
            type="number"
            className="input text-right tabular-nums"
            value={draft.paid_meal_count ?? ''}
            onChange={(e) =>
              set('paid_meal_count', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </Field>
        <Field label="추가 판매 항목 / 매출" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.additional_sales}
            placeholder="여러 항목은 줄바꿈으로 구분"
            onChange={(e) => set('additional_sales', e.target.value)}
          />
        </Field>
        <Field label="시스템 이슈" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.system_issues}
            onChange={(e) => set('system_issues', e.target.value)}
          />
        </Field>
        <Field label="행사 중 특이사항" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.event_special_notes}
            onChange={(e) => set('event_special_notes', e.target.value)}
          />
        </Field>
        <Field label="플라워 이슈" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.flower_issues}
            onChange={(e) => set('flower_issues', e.target.value)}
          />
        </Field>
        <Field label="다음 행사 준비 시 피드백" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.next_event_feedback}
            onChange={(e) => set('next_event_feedback', e.target.value)}
          />
        </Field>
        <Field label="종합 코멘트" className="md:col-span-2">
          <AutoExpandTextarea
            className="input"
            minRows={2}
            value={draft.general_comment}
            onChange={(e) => set('general_comment', e.target.value)}
          />
        </Field>
      </div>

      {/* 최종 정산 섹션 — 매출 통계 기준값 */}
      <div className="mt-5 border rounded-md p-4 bg-amber-50/50 border-amber-200">
        <div className="text-sm font-semibold text-amber-900 mb-3">
          💰 최종 정산 (월별/연별 매출 통계 기준)
        </div>
        <Field label="최종 매출액 (원)">
          <input
            className="input text-right tabular-nums"
            value={revenueStr}
            placeholder="0"
            inputMode="numeric"
            onChange={(e) => onRevenueChange(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        {review && (
          <button
            onClick={() => {
              const { id: _i, event_id: _e, created_by: _c, created_at: _ca, updated_at: _u, ...rest } =
                review;
              void _i;
              void _e;
              void _c;
              void _ca;
              void _u;
              setDraft(rest);
              setEditing(false);
            }}
            className="btn-secondary text-sm"
          >
            취소
          </button>
        )}
        <button onClick={save} disabled={saving} className="btn-primary text-sm">
          {saving ? '저장중...' : review ? '리뷰 수정' : '리뷰 저장'}
        </button>
      </div>

      {/* 최종 INVOICE 업로드 — 리뷰 저장 후 활성화 */}
      <FinalInvoiceSection
        files={finalInvoices}
        canWrite={canWrite}
        uploading={uploading}
        onUpload={handleUploadInvoice}
        onDelete={deleteInvoice}
        fileInputRef={fileInputRef}
        finalRevenue={draft.final_revenue}
      />
    </div>
  );
}

interface FinalInvoiceSectionProps {
  files: EventFile[];
  canWrite: boolean;
  uploading: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: (f: EventFile) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  finalRevenue: number | null;
}

function FinalInvoiceSection({
  files,
  canWrite,
  uploading,
  onUpload,
  onDelete,
  fileInputRef,
  finalRevenue,
}: FinalInvoiceSectionProps) {
  return (
    <div className="mt-5 border rounded-md p-4 bg-blue-50/40 border-blue-200">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm font-semibold text-blue-900">📄 최종 INVOICE 첨부</div>
        {finalRevenue != null && (
          <div className="text-xs text-blue-800">
            기록된 최종 매출액:{' '}
            <span className="font-semibold tabular-nums">
              {finalRevenue.toLocaleString('ko-KR')}원
            </span>
          </div>
        )}
      </div>
      {canWrite && (
        <div className="mb-3">
          <input
            ref={fileInputRef}
            type="file"
            onChange={onUpload}
            disabled={uploading}
            className="block text-sm file:mr-2 file:px-3 file:py-1 file:rounded file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer hover:file:bg-blue-700 disabled:opacity-50"
          />
          {uploading && <span className="ml-2 text-xs text-gray-500">업로드 중...</span>}
        </div>
      )}
      {files.length === 0 ? (
        <div className="text-xs text-gray-500 italic">업로드된 최종 INVOICE가 없습니다.</div>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between bg-white border rounded p-2 text-sm"
            >
              <a
                href={f.file_url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline truncate"
                title={f.file_name}
              >
                {f.file_name}
              </a>
              <div className="flex items-center gap-3 text-xs text-gray-500 ml-3 shrink-0">
                <span>{fmt(f.uploaded_at)}</span>
                {canWrite && (
                  <button
                    onClick={() => onDelete(f)}
                    className="text-red-600 hover:underline"
                  >
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 식음 메뉴(코스·도시락) 표 — 기본정보의 확정 GTD 옆에 실제 식사 인원을 적는다
function MealLinesTable({
  lines,
  editable,
  single,
  onSingle,
  actuals,
  onActual,
}: {
  lines: MealLine[];
  editable: boolean;
  /** 메뉴가 1개일 때 그 메뉴의 실제 인원 = 리뷰의 실제 식사 인원 */
  single?: number | null;
  onSingle?: (v: number | null) => void;
  actuals: Record<string, number | null>;
  onActual?: (id: string, v: number | null) => void;
}) {
  const isSingle = lines.length === 1;
  const valueOf = (l: MealLine) => (isSingle ? single ?? null : actuals[l.id] ?? null);
  const total = isSingle ? single ?? null : lines.some((l) => actuals[l.id] != null)
    ? lines.reduce((a, l) => a + (actuals[l.id] ?? 0), 0)
    : null;
  const gtdTotal = lines.reduce((a, l) => a + (l.gtd_final ?? l.gtd_contract ?? 0), 0);
  const toNum = (s: string) => (s === '' ? null : Number(s));
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
        식사 인원 — 기본정보 식음 메뉴(코스·도시락) 기준
      </div>
      <table className="w-full text-sm border rounded">
        <thead className="bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="text-left px-3 py-1.5">메뉴</th>
            <th className="text-right px-3 py-1.5 w-32">확정 GTD</th>
            <th className="text-right px-3 py-1.5 w-40">실제 식사 인원</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const gtd = l.gtd_final ?? l.gtd_contract;
            return (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-1.5 font-medium text-gray-800">{l.menu_name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                  {gtd ?? '-'}
                  {l.gtd_final == null && l.gtd_contract != null && (
                    <span className="ml-1 text-[10px] text-gray-400" title="확정 GTD 가 없어 계약 GTD 를 표시">(계약)</span>
                  )}
                </td>
                <td className="px-3 py-1 text-right">
                  {editable ? (
                    <input
                      type="number"
                      min={0}
                      className="input !py-1 text-right tabular-nums !w-28 ml-auto"
                      placeholder="0 = 식사 안 함"
                      value={valueOf(l) ?? ''}
                      onChange={(e) => (isSingle ? onSingle?.(toNum(e.target.value)) : onActual?.(l.id, toNum(e.target.value)))}
                    />
                  ) : (
                    <span className="tabular-nums">{valueOf(l)?.toLocaleString('ko-KR') ?? '-'}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!isSingle && (
            <tr className="border-t bg-gray-50 font-semibold">
              <td className="px-3 py-1.5">합계</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{gtdTotal || '-'}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{total?.toLocaleString('ko-KR') ?? '-'}</td>
            </tr>
          )}
        </tbody>
      </table>
      {editable && !isSingle && (
        <div className="text-[11px] text-gray-400 mt-1">합계가 이 행사의 실제 식사 인원으로 저장됩니다. 메뉴는 기본정보에서 바꿉니다.</div>
      )}
    </div>
  );
}

function ReadOnlyView({ review, mealLines }: { review: Review; mealLines: MealLine[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <Block label="행사담당자" value={review.banquet_manager} />
      <Block
        label="최종 매출액 (원)"
        value={
          review.final_revenue != null
            ? `${review.final_revenue.toLocaleString('ko-KR')}`
            : '-'
        }
      />
      {mealLines.length > 0 ? (
        <div className="md:col-span-2">
          <MealLinesTable
            lines={mealLines}
            editable={false}
            single={mealLines.length === 1 ? review.actual_meal_count : undefined}
            actuals={Object.fromEntries(mealLines.map((l) => [l.id, l.actual_count]))}
          />
        </div>
      ) : (
        <Block label="실제 식사 인원" value={review.actual_meal_count?.toLocaleString('ko-KR') ?? '-'} />
      )}
      <Block label="결제 식사 인원" value={review.paid_meal_count?.toLocaleString('ko-KR') ?? '-'} />
      <Block label="추가 판매 항목 / 매출" value={review.additional_sales} className="md:col-span-2" multiline />
      <Block label="시스템 이슈" value={review.system_issues} className="md:col-span-2" multiline />
      <Block label="행사 중 특이사항" value={review.event_special_notes} className="md:col-span-2" multiline />
      <Block label="플라워 이슈" value={review.flower_issues} className="md:col-span-2" multiline />
      <Block label="다음 행사 준비 시 피드백" value={review.next_event_feedback} className="md:col-span-2" multiline />
      <Block label="종합 코멘트" value={review.general_comment} className="md:col-span-2" multiline />
    </div>
  );
}

function Block({
  label,
  value,
  className,
  multiline,
}: {
  label: string;
  value: string;
  className?: string;
  multiline?: boolean;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div
        className={
          'border rounded p-2 bg-gray-50 text-gray-800 ' +
          (multiline ? 'whitespace-pre-wrap min-h-[60px]' : '')
        }
      >
        {value || '-'}
      </div>
    </div>
  );
}
