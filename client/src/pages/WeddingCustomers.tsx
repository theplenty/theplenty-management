import { weekdayKoOf, insertWeekday } from '../lib/dateFmt';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { buildSearchEntry, fuzzyMatchEntry, type SearchEntry } from '../lib/koreanSearch';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { useAuth } from '../auth/AuthContext';
import { canWriteWedding } from '../auth/permissions';
import { useActiveUsers } from '../lib/useActiveUsers';
import { nanoid } from '../lib/clientId';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  WEDDING_PROGRESS_OPTIONS,
  WEDDING_SOURCE_DETAIL_OPTIONS,
  WEDDING_SOURCE_OPTIONS,
  type WeddingCustomer,
  type WeddingEventInquiry,
  type WeddingLandingSummary,
  type WeddingStageInfo,
  type WeddingProgressStatus,
  type WeddingSource,
  type WeddingSourceDetail,
} from '../types';
import Modal from '../components/Modal';
import AutoExpandTextarea from '../components/AutoExpandTextarea';
import WeddingMarginModal from '../components/WeddingMarginModal';
import WeddingLandingTab from '../components/WeddingLandingTab';
import SimilarPhoneWarning from '../components/SimilarPhoneWarning';
import LinkedEventsSection from '../components/LinkedEventsSection';
import { Field, StatusBadge } from '../components/Field';
import ExcelButtons from '../components/ExcelButtons';
import ChangeLogPanel from '../components/ChangeLogPanel';
import TableColumnMenu from '../components/TableColumnMenu';
import Pagination, { usePaginated } from '../components/Pagination';
import { useTableControls, compareSortValues } from '../lib/useTableControls';
import {
  buildWeddingFlatRows,
  groupWeddingFlatRows,
  WEDDING_FLAT_COLUMNS,
  type WeddingFlatRow,
} from '../lib/customerColumns';

interface WedCol {
  key: string;
  label: string;
  render: (c: WeddingCustomer) => React.ReactNode;
  sortValue?: (c: WeddingCustomer) => string | number | null;
  tdClassName?: string;
}

function nextWeddingDatetime(c: WeddingCustomer): string {
  for (const i of c.event_inquiries) {
    if (i.wedding_datetime) return i.wedding_datetime;
  }
  return '';
}

// ===== 랜딩 요약 (목록 표시용) =====
// 랜딩은 행사 캘린더(가블록형)·고객정보(상담형) 두 곳에서 발행되지만 저장소는 하나라,
// 서버가 고객별 대표 랜딩을 목록 응답에 합쳐서 내려준다. 여기서는 상태·D-day 만 그린다.

/** block_until(YYYY-MM-DD)까지 남은 날 수. 오늘이면 0, 지났으면 음수. */
function landingDday(until: string): number | null {
  if (!until) return null;
  const [y, m, d] = until.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t1 = new Date(y, m - 1, d).getTime();
  return Math.round((t1 - t0) / 86400000);
}

const LANDING_MODE_LABEL = { block: '가블록형 (행사 캘린더 발행)', consult: '상담형 (고객정보 발행)' } as const;

function LandingBadge({ s }: { s?: WeddingLandingSummary }) {
  if (!s) return <span className="text-gray-300">-</span>;
  const tip = `${LANDING_MODE_LABEL[s.mode]}${s.block_until ? ` · 종료일 ${s.block_until}` : ''}`;
  if (s.state === 'active') {
    const dd = landingDday(s.block_until);
    const label = dd === null ? '열림' : dd <= 0 ? '열림 D-0 (오늘 마감)' : `열림 D-${dd}`;
    const cls = dd !== null && dd <= 1 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-800';
    return <span className={`badge ${cls}`} title={tip}>{label}</span>;
  }
  if (s.state === 'contracted') return <span className="badge bg-blue-100 text-blue-800" title={tip}>계약완료</span>;
  if (s.state === 'expired') return <span className="badge bg-amber-100 text-amber-800" title={tip}>만료</span>;
  return <span className="badge bg-gray-200 text-gray-600" title={tip}>닫힘</span>;
}

/** 정렬용 — 열림은 D-day 오름차순, 그 뒤로 계약완료 < 만료 < 닫힘 < 미발행 */
function landingSortValue(s?: WeddingLandingSummary): number {
  if (!s) return 99999;
  if (s.state === 'active') return landingDday(s.block_until) ?? 9000;
  if (s.state === 'contracted') return 10000;
  if (s.state === 'expired') return 20000;
  return 30000;
}

// 계약금 필터 — 고객의 예식 후보 중 하나라도 조건을 만족하면 걸린다
type DepositFilterKey = 'ALL' | 'none' | 'pending' | 'paid';
const DEPOSIT_FILTERS: {
  key: DepositFilterKey;
  label: string;
  match: (c: WeddingCustomer) => boolean;
}[] = [
  { key: 'ALL', label: '전체', match: () => true },
  {
    key: 'none',
    label: '미입력',
    match: (c) => !(c.event_inquiries || []).some((q) => Number(q.deposit_amount) > 0),
  },
  {
    key: 'pending',
    label: '입금대기',
    match: (c) =>
      (c.event_inquiries || []).some((q) => Number(q.deposit_amount) > 0 && !q.deposit_paid),
  },
  {
    key: 'paid',
    label: '입금완료',
    match: (c) => (c.event_inquiries || []).some((q) => !!q.deposit_paid),
  },
];

// 홀을 잡았다는 뜻이라 캘린더 행사 없이는 성립하지 않는 단계 (W2)
const REQUIRES_EVENT_STAGES: WeddingProgressStatus[] = ['INQ', 'DEF'];

/** 행사 상태 → 대응하는 고객 진행단계 (없으면 null — 미팅·시식은 딜 단계가 아니다) */
function stageOfEvent(status: string): WeddingProgressStatus | null {
  if (status === 'INQ' || status === 'DEF' || status === 'LOS') return status;
  if (status === '상담취소') return '상담취소';
  return null;
}

type LandingFilterKey = 'ALL' | 'sent' | 'active' | 'contracted' | 'ended';
const LANDING_FILTERS: { key: LandingFilterKey; label: string; match: (s?: WeddingLandingSummary) => boolean }[] = [
  { key: 'ALL', label: '전체', match: () => true },
  { key: 'sent', label: '발행됨', match: (s) => !!s },
  { key: 'active', label: '열림 (D-day)', match: (s) => s?.state === 'active' },
  { key: 'contracted', label: '계약완료', match: (s) => s?.state === 'contracted' },
  { key: 'ended', label: '만료·닫힘', match: (s) => s?.state === 'expired' || s?.state === 'closed' },
];

// 사용자 요청 순서: 번호 / 행사명 / 진행단계 / 신규문의일자 / 희망상담일자 / 예식일자 /
// 유입경로 / 희망예산 / 견적비용 / 담당. ('번호' 열은 테이블에서 별도 # 컬럼으로 렌더 — 여기엔 빠짐)
const WEDDING_COLUMNS: WedCol[] = [
  {
    key: 'wedding_event_name',
    label: '행사명',
    render: (c) => <span className="font-medium text-gray-900">{c.wedding_event_name}</span>,
    sortValue: (c) => c.wedding_event_name,
  },
  {
    key: 'progress_status',
    label: '진행단계',
    render: (c) => <StatusBadge value={c.progress_status} variant={c.progress_status} />,
    sortValue: (c) => c.progress_status,
  },
  {
    key: 'inquiry_date',
    label: '신규문의일자',
    render: (c) => fmtDateOrDateTime(c.inquiry_date),
    sortValue: (c) => c.inquiry_date || '',
  },
  {
    key: 'desired_consultation_date',
    label: '희망상담일자',
    render: (c) => fmtDateOrDateTime(c.desired_consultation_date),
    sortValue: (c) => c.desired_consultation_date || '',
  },
  {
    key: 'event_candidates',
    label: '예식일자',
    render: (c) => (
      <span className="text-xs">
        {c.event_inquiries
          .map((i) =>
            i.wedding_datetime
              ? `${new Date(i.wedding_datetime).toLocaleString('ko-KR', {
                  month: 'numeric',
                  day: 'numeric',
                })} (${weekdayKoOf(new Date(i.wedding_datetime))}) ${new Date(i.wedding_datetime).toLocaleString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : '미정'
          )
          .join(' / ') || '-'}
      </span>
    ),
    sortValue: (c) => nextWeddingDatetime(c),
  },
  {
    key: 'source',
    label: '유입경로',
    render: (c) => (
      <>
        {c.source || '-'}
        {c.source_detail && <span className="ml-1 text-xs text-gray-500">/ {c.source_detail}</span>}
      </>
    ),
    sortValue: (c) => c.source,
  },
  {
    key: 'desired_budget',
    label: '희망예산',
    render: (c) => c.desired_budget || '-',
    sortValue: (c) => c.desired_budget,
  },
  {
    key: 'estimate_amount',
    label: '견적비용',
    render: (c) => (
      <span className="text-xs">
        {c.event_inquiries.map((i) => i.estimate_amount).filter(Boolean).join(' / ') || '-'}
      </span>
    ),
    // 정렬용: 첫 번째 비어있지 않은 견적의 숫자만 추출
    sortValue: (c) => {
      const v = c.event_inquiries.map((i) => i.estimate_amount).find((x) => x);
      if (!v) return 0;
      const n = Number(String(v).replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    },
  },
  {
    key: 'assigned_manager',
    label: '담당',
    render: (c) => (
      <span className="text-xs">
        {c.event_inquiries
          .map((i) => i.assigned_manager_name)
          .filter(Boolean)
          .filter((v, idx, arr) => arr.indexOf(v) === idx)
          .join(' / ') || '-'}
      </span>
    ),
    sortValue: (c) => c.event_inquiries.find((i) => i.assigned_manager_name)?.assigned_manager_name || '',
  },
];

/** 목록이 빈 이유를 그대로 말해준다 — "63건" 칩을 눌렀는데 비면 필터 조합 탓인 경우가 대부분이다. */
function EmptyReason({
  query,
  stageFilter,
  landingFilter,
  depositFilter,
  onReset,
}: {
  query: string;
  stageFilter: 'ALL' | WeddingProgressStatus;
  landingFilter: LandingFilterKey;
  depositFilter: DepositFilterKey;
  onReset: () => void;
}) {
  const parts: string[] = [];
  if (stageFilter !== 'ALL') parts.push(`진행단계 '${stageFilter}'`);
  if (landingFilter !== 'ALL')
    parts.push(`랜딩 '${LANDING_FILTERS.find((f) => f.key === landingFilter)?.label}'`);
  if (depositFilter !== 'ALL')
    parts.push(`계약금 '${DEPOSIT_FILTERS.find((f) => f.key === depositFilter)?.label}'`);
  if (!parts.length && !query.trim()) return <>등록된 고객이 없습니다.</>;
  if (!parts.length) return <>검색 결과가 없습니다.</>;
  return (
    <div className="space-y-1.5">
      <div>
        {parts.join(' + ')}
        {query.trim() ? ` + 검색어 '${query.trim()}'` : ''} 에 해당하는 고객이 없습니다.
      </div>
      {parts.length > 1 && (
        <div className="text-xs text-gray-400">
          두 조건을 동시에 만족하는 고객이 없습니다. 한쪽 칩을 &lsquo;전체&rsquo;로 바꿔보세요.
        </div>
      )}
      <button onClick={onReset} className="text-xs text-blue-600 hover:underline">
        필터 초기화
      </button>
    </div>
  );
}

// ===== 계약금 (= 가톨릭대관료) =====
// 웨딩은 계약금 = 가톨릭대 대관료 = 154만원 정액 (운영 34건 전부 동일). MICE 와 같은 구조로,
// **여기(예식 후보)가 원본**이고 행사 매출탭은 읽기 전용 거울이다.
// 입금 확인을 켜면 진행단계와 연결 행사가 함께 DEF 로 올라간다 — 그래야 고객 랜딩이
// '계약완료 감사' 화면으로 바뀌고 캘린더도 확정으로 보인다.

export const WEDDING_GATEWAY_FEE = 1540000;

interface CandidateEvent {
  id: string;
  event_name: string;
  status: string;
  start_datetime: string;
  halls: string[];
  gateway_fee: number | null;
}

/** 이 후보에 계약금 기록이 하나라도 있나 */
function hasDepositData(inq: WeddingEventInquiry): boolean {
  return !!inq.deposit_amount || !!inq.deposit_paid || !!inq.deposit_depositor || !!inq.deposit_date;
}

/** 계약금 블록을 띄울지 — INQ 부터 등장, DEF 이후에도 계속. 기록이 있으면 어느 단계든 보여준다. */
function showDepositSection(stage: WeddingProgressStatus, inqs: WeddingEventInquiry[]): boolean {
  return stage === 'INQ' || stage === 'DEF' || inqs.some(hasDepositData);
}

/**
 * 계약이 성사된 예식 후보 고르기 — 웨딩 고객은 홀딩도 계약도 **1건뿐**이라
 * 계약금은 후보 하나에만 붙는다 (후보마다 칸이 뜨면 낭비이자 오입력 위험).
 *  ① 이미 계약금 기록이 있는 후보 ② 행사 날짜와 같은 후보 ③ 후보가 1개면 그것
 * 셋 다 아니면 null → 화면에서 "어느 후보로 계약했는지" 한 번 고르게 한다.
 * (실사례: 견적 4종을 뽑느라 후보가 4개인데 홀딩 행사는 1건)
 */
function pickContractInquiry(
  inqs: WeddingEventInquiry[],
  eventDate: string
): WeddingEventInquiry | null {
  const withData = inqs.filter(hasDepositData);
  if (withData.length) return withData[0];
  if (eventDate) {
    const sameDay = inqs.filter((q) => (q.wedding_datetime || '').slice(0, 10) === eventDate);
    if (sameDay.length === 1) return sameDay[0];
  }
  return inqs.length === 1 ? inqs[0] : null;
}

function WeddingDepositBlock({
  inqs,
  inq,
  stage,
  events,
  resolvedId,
  onChange,
  onPickEvent,
  onPickInquiry,
}: {
  /** 이 고객의 예식 후보 전체 — 어느 후보로 계약했는지 고르는 드롭다운에 쓴다 */
  inqs: WeddingEventInquiry[];
  /** 계약이 성사된 후보 (미지정이면 null) */
  inq: WeddingEventInquiry | null;
  stage: WeddingProgressStatus;
  events: CandidateEvent[];
  resolvedId: string | null;
  onChange: (patch: Partial<WeddingEventInquiry>) => void;
  onPickEvent: (eventId: string) => void;
  onPickInquiry: (inquiryId: string) => void;
}) {
  const targetId = inq?.linked_event_id || resolvedId;
  const target = events.find((e) => e.id === targetId) || null;
  const amount = Number(inq?.deposit_amount) || 0;
  const candDay = (inq?.wedding_datetime || '').slice(0, 10);
  const dateMismatch =
    !!target && !!candDay && (target.start_datetime || '').slice(0, 10) !== candDay;

  function togglePaid(next: boolean) {
    if (next) {
      const willPromote = stage !== 'DEF' || (target && target.status !== 'DEF');
      if (willPromote) {
        const lines = ['입금 확인으로 표시합니다.', ''];
        if (stage !== 'DEF') lines.push(`· 진행단계 ${stage} → DEF`);
        if (target && target.status !== 'DEF')
          lines.push(`· 행사 [${target.event_name || '이름없음'}] 상태 ${target.status} → DEF`);
        lines.push('· 계약금·입금 정보가 행사 매출탭(가톨릭대관료)으로 반영됩니다.');
        if (target) lines.push('· 고객 랜딩이 계약완료 화면으로 바뀝니다.');
        lines.push('', '계속할까요? (저장을 눌러야 최종 반영됩니다)');
        if (!window.confirm(lines.join('\n'))) return;
      }
    }
    onChange({ deposit_paid: next });
  }

  // 후보가 여럿이라 계약 건을 특정 못한 경우 — 고르기 전에는 계약금 칸을 열지 않는다
  const needPick = !inq && inqs.length > 1;

  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
          계약 · 계약금 (= 가톨릭대관료)
        </div>
        {/* 계약된 예식일 — 웨딩은 1건만 계약하므로 후보 중 하나를 지정한다 */}
        {inqs.length > 1 && (
          <label className="text-xs text-gray-600 flex items-center gap-1.5">
            계약된 예식일
            <select
              className="input !py-1 !text-xs"
              value={inq?.id || ''}
              onChange={(e) => onPickInquiry(e.target.value)}
            >
              <option value="">선택...</option>
              {inqs.map((q, i) => (
                <option key={q.id} value={q.id}>
                  후보 #{i + 1} ·{' '}
                  {q.wedding_datetime ? q.wedding_datetime.slice(0, 10) : '일시 미정'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {needPick && (
        <div className="text-xs text-amber-800 bg-amber-100/70 rounded px-2.5 py-2">
          예식 후보가 {inqs.length}개인데 어느 날짜로 계약했는지 아직 지정되지 않았습니다.
          {target ? (
            <>
              {' '}
              홀딩된 행사는 <b>{fmtDateOrDateTime(target.start_datetime)}</b> 입니다 — 위에서 해당
              후보를 골라 주세요.
            </>
          ) : (
            ' 위에서 계약된 후보를 골라 주세요.'
          )}
        </div>
      )}

      {!needPick && !inq && (
        <div className="text-xs text-gray-500">예식 후보를 먼저 등록해 주세요.</div>
      )}

      {inq && (
        <>
      {/* 반영 대상 행사 — 후보 날짜로 자동 매칭되며, 안 맞을 때만 직접 고른다 */}
      <div className="text-xs mb-2 rounded border px-2.5 py-1.5 bg-white/70">
        {target ? (
          <span className="text-gray-700">
            반영 대상 행사:{' '}
            <b className="text-gray-900">{target.event_name || '(행사명 없음)'}</b>{' '}
            {fmtDateOrDateTime(target.start_datetime)} · {target.status}
            {inq.linked_event_id
              ? ' (직접 지정됨)'
              : dateMismatch
                ? ''
                : ' (후보 날짜로 자동 연결)'}
            {/* 후보 날짜와 행사 날짜가 다른데도 붙은 경우 — 연결 행사가 하나뿐이라 그렇다.
                후보가 여러 개인 고객에서 엉뚱한 후보에 계약금을 넣는 사고를 막기 위해 경고한다. */}
            {!inq.linked_event_id && dateMismatch && (
              <span className="text-amber-700">
                {' '}
                ⚠ 후보 날짜({inq.wedding_datetime ? inq.wedding_datetime.slice(0, 10) : '미정'})와 다릅니다 —
                연결된 행사가 1건뿐이라 이 행사로 붙었습니다. 맞는지 확인하세요.
              </span>
            )}
          </span>
        ) : (
          <span className="text-amber-700">
            연결된 행사를 찾지 못했습니다 — 아래에서 고르면 계약금이 그 행사 매출로 반영됩니다.
          </span>
        )}
        {events.length > 0 && (
          <select
            className="input !py-1 !text-xs mt-1.5"
            value={inq.linked_event_id || ''}
            onChange={(e) => onPickEvent(e.target.value)}
          >
            <option value="">자동 연결{resolvedId ? '' : ' (매칭 없음)'}</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {fmtDateOrDateTime(e.start_datetime)} · {e.event_name || '(이름없음)'} · {e.status}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="계약금 (원)" hint="웨딩 가톨릭대 대관료는 1,540,000원 정액입니다">
          <div className="flex gap-1.5">
            <input
              className="input text-right tabular-nums"
              value={amount ? amount.toLocaleString() : ''}
              placeholder="1,540,000"
              inputMode="numeric"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^\d]/g, ''));
                onChange({ deposit_amount: n || null });
              }}
            />
            {amount !== WEDDING_GATEWAY_FEE && (
              <button
                type="button"
                className="btn-xs whitespace-nowrap"
                onClick={() => onChange({ deposit_amount: WEDDING_GATEWAY_FEE })}
              >
                154만
              </button>
            )}
          </div>
        </Field>
        <Field label="입금 확인">
          <label className="flex items-center gap-2 text-sm py-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!inq.deposit_paid}
              onChange={(e) => togglePaid(e.target.checked)}
            />
            <span className={inq.deposit_paid ? 'text-emerald-700 font-medium' : 'text-gray-600'}>
              계약금 입금 완료
            </span>
            {inq.deposit_paid && !amount && (
              <span className="text-xs text-amber-700">← 금액을 입력해야 반영됩니다</span>
            )}
          </label>
        </Field>
        <Field label="입금자명">
          <input
            className="input"
            value={inq.deposit_depositor || ''}
            onChange={(e) => onChange({ deposit_depositor: e.target.value })}
          />
        </Field>
        <Field label="입금일자">
          <input
            type="date"
            className="input"
            value={inq.deposit_date || ''}
            onChange={(e) => onChange({ deposit_date: e.target.value || null })}
          />
        </Field>
        <Field label="계산서 발행">
          <select
            className="input"
            value={inq.invoice_type || ''}
            onChange={(e) => onChange({ invoice_type: e.target.value })}
          >
            <option value="">선택...</option>
            <option value="세금계산서">세금계산서</option>
            <option value="현금영수증">현금영수증</option>
          </select>
        </Field>
        <Field label="계산서 발행상태">
          <select
            className="input"
            value={inq.invoice_issue_status || ''}
            onChange={(e) => onChange({ invoice_issue_status: e.target.value })}
          >
            <option value="">선택...</option>
            <option value="가톨릭요청">가톨릭요청</option>
            <option value="발행완료">발행완료</option>
          </select>
        </Field>
      </div>
      {inq.revenue_pushed_at && (
        <div className="text-[11px] text-gray-400 mt-1.5">
          행사 매출 반영됨 · {inq.revenue_pushed_amount?.toLocaleString()}원
        </div>
      )}
        </>
      )}
    </div>
  );
}

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
  if (!s.includes('T')) return insertWeekday(s);
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    search_keyword: '',
    event_inquiries: [emptyEventInquiry(authorId, authorName)],
    memo: '',
  };
}

export default function WeddingCustomers() {
  const { user } = useAuth();
  const authorName = user?.name || '';
  const authorId = user?.id || '';
  const activeUsers = useActiveUsers();
  // 담당지배인 드롭다운 — 웨딩세일즈 + 관리자만 노출
  const weddingManagerOptions = useMemo(
    () => activeUsers.filter((u) => u.role === 'sales_wedding' || u.role === 'admin'),
    [activeUsers]
  );

  const [items, setItems] = useState<WeddingCustomer[]>([]);
  // 고객 id → 대표 랜딩 요약 (가블록형·상담형 통합, 서버가 목록과 함께 내려줌)
  const [landings, setLandings] = useState<Record<string, WeddingLandingSummary>>({});
  // 고객 id → 대표 행사 + 단계 불일치 (W2)
  const [stages, setStages] = useState<Record<string, WeddingStageInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'ALL' | WeddingProgressStatus>('ALL');
  const [landingFilter, setLandingFilter] = useState<LandingFilterKey>('ALL');
  const [depositFilter, setDepositFilter] = useState<DepositFilterKey>('ALL');
  // 고객 단계와 행사 상태가 어긋난 건만 보기 (W2) — 정리 작업용
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 200);
  const [showSuggest, setShowSuggest] = useState(false);
  // 고객별 행사 개최 횟수 — 검색에서 실적 확인용
  const [eventCounts, setEventCounts] = useState<
    Record<string, { total: number; held: number }>
  >({});

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(authorId, authorName));
  const [saving, setSaving] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);
  // 마진계산기 모달 — 열린 예식후보 id (null=닫힘)
  const [calcOpenId, setCalcOpenId] = useState<string | null>(null);
  // 계약금 반영 대상 후보군 — 이 고객에 연결된 웨딩 행사 + 후보별 자동 매칭 결과
  const [candEvents, setCandEvents] = useState<{
    events: CandidateEvent[];
    resolved: Record<string, string | null>;
  }>({ events: [], resolved: {} });
  // 후보가 여러 개일 때 "어느 날짜로 계약했는지" 직원이 고른 값 (자동 인식보다 우선)
  const [pickedContractId, setPickedContractId] = useState<string | null>(null);
  const canEditCalcSettings = user?.role === 'admin';

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{
        customers: WeddingCustomer[];
        landings?: Record<string, WeddingLandingSummary>;
        stages?: Record<string, WeddingStageInfo>;
      }>('/api/customers/wedding');
      setItems(res.customers);
      setLandings(res.landings || {});
      setStages(res.stages || {});
    } catch (e) {
      setError('목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
    // 행사 개최 횟수 — 별도 fetch (실패해도 카운트만 비어 보임).
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

  // 편집 모달을 열면 계약금 반영 대상 행사 목록을 가져온다 (자동 매칭 결과 포함)
  useEffect(() => {
    if (!open || !editingId) {
      setCandEvents({ events: [], resolved: {} });
      setPickedContractId(null);
      return;
    }
    let alive = true;
    api
      .get<{ events: CandidateEvent[]; resolved: Record<string, string | null> }>(
        `/api/customers/wedding/${editingId}/candidate-events`
      )
      .then((r) => {
        if (alive) setCandEvents({ events: r.events || [], resolved: r.resolved || {} });
      })
      .catch((e) => console.error('[wedding] 후보 행사 로드 실패', e));
    return () => {
      alive = false;
    };
  }, [open, editingId]);

  // 캘린더에서 상담 클릭 시 #consult-<id> 해시 + 전역 검색에서 ?focus=<id> 쿼리 둘 다 처리.
  useEffect(() => {
    if (!items.length) return;
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const focusId = params.get('focus');
    const m = hash.match(/^#consult-(.+)$/);
    let targetId: string | null = null;
    if (focusId) targetId = focusId;
    else if (m) targetId = m[1];
    if (!targetId) return;
    const target = items.find((c) => c.id === targetId);
    if (target) {
      openEdit(target);
      // 같은 진입으로 재진입해도 다시 열리도록 hash / query 정리
      history.replaceState(null, '', window.location.pathname);
    }
  }, [items]);

  // items 가 바뀔 때만 검색 인덱스를 재계산. 키 입력마다는 includes() 만 돌도록.
  const searchIndex = useMemo(() => {
    const map = new Map<string, SearchEntry>();
    for (const c of items) {
      const parts: Array<string | null | undefined> = [
        c.wedding_event_name,
        c.groom_name,
        c.bride_name,
        c.groom_phone,
        c.bride_phone,
        c.groom_email,
        c.bride_email,
        c.progress_status,
        c.source,
        c.source_detail,
        c.search_keyword,
        c.competing_venues,
        c.desired_budget,
        c.memo,
      ];
      for (const i of c.event_inquiries) {
        parts.push(
          i.wedding_datetime,
          i.estimate_detail,
          i.visit_consultation_comment,
          i.assigned_manager_name,
        );
      }
      map.set(c.id, buildSearchEntry(parts));
    }
    return map;
  }, [items]);

  const searchBase = useMemo(() => {
    if (!debouncedQuery.trim()) return items;
    return items.filter((c) => {
      const e = searchIndex.get(c.id);
      return e ? fuzzyMatchEntry(e, debouncedQuery) : false;
    });
  }, [items, debouncedQuery, searchIndex]);

  const filtered = useMemo(() => {
    let list = searchBase;
    if (stageFilter !== 'ALL') list = list.filter((c) => c.progress_status === stageFilter);
    if (landingFilter !== 'ALL') {
      const f = LANDING_FILTERS.find((x) => x.key === landingFilter);
      if (f) list = list.filter((c) => f.match(landings[c.id]));
    }
    if (depositFilter !== 'ALL') {
      const f = DEPOSIT_FILTERS.find((x) => x.key === depositFilter);
      if (f) list = list.filter((c) => f.match(c));
    }
    if (mismatchOnly) list = list.filter((c) => stages[c.id]?.mismatch);
    return list;
  }, [searchBase, stageFilter, landingFilter, depositFilter, mismatchOnly, landings, stages]);

  // 칩별 건수 — **상대 필터를 반영한 교차 건수**로 센다.
  // (예: 랜딩 '발행됨' 이 켜져 있으면 진행단계 칩은 "발행됨 안에서 몇 건인지"를 보여준다.
  //  전체 기준으로 세면 '상담취소 63' 을 눌렀는데 목록이 비는 일이 생겨 숫자가 거짓말이 된다.)
  // 자기 자신을 뺀 나머지 필터를 적용한 모수 — 칩 숫자가 "지금 눌렀을 때 나올 건수" 가 된다
  const baseExcept = useCallback(
    (skip: 'stage' | 'landing' | 'deposit') => {
      let list = searchBase;
      if (skip !== 'stage' && stageFilter !== 'ALL')
        list = list.filter((c) => c.progress_status === stageFilter);
      if (skip !== 'landing' && landingFilter !== 'ALL') {
        const f = LANDING_FILTERS.find((x) => x.key === landingFilter);
        if (f) list = list.filter((c) => f.match(landings[c.id]));
      }
      if (skip !== 'deposit' && depositFilter !== 'ALL') {
        const f = DEPOSIT_FILTERS.find((x) => x.key === depositFilter);
        if (f) list = list.filter((c) => f.match(c));
      }
      if (mismatchOnly) list = list.filter((c) => stages[c.id]?.mismatch);
      return list;
    },
    [searchBase, stageFilter, landingFilter, depositFilter, mismatchOnly, landings, stages]
  );

  const stageCounts = useMemo(() => {
    const base = baseExcept('stage');
    const m = new Map<string, number>();
    m.set('ALL', base.length);
    for (const c of base) m.set(c.progress_status, (m.get(c.progress_status) || 0) + 1);
    return m;
  }, [baseExcept]);

  const landingCounts = useMemo(() => {
    const base = baseExcept('landing');
    const m = new Map<LandingFilterKey, number>();
    for (const f of LANDING_FILTERS) {
      m.set(f.key, f.key === 'ALL' ? base.length : base.filter((c) => f.match(landings[c.id])).length);
    }
    return m;
  }, [baseExcept, landings]);

  const depositCounts = useMemo(() => {
    const base = baseExcept('deposit');
    const m = new Map<DepositFilterKey, number>();
    for (const f of DEPOSIT_FILTERS) {
      m.set(f.key, f.key === 'ALL' ? base.length : base.filter((c) => f.match(c)).length);
    }
    return m;
  }, [baseExcept]);

  const filterActive =
    stageFilter !== 'ALL' || landingFilter !== 'ALL' || depositFilter !== 'ALL' || mismatchOnly;
  function resetFilters() {
    setStageFilter('ALL');
    setLandingFilter('ALL');
    setDepositFilter('ALL');
    setMismatchOnly(false);
  }
  const mismatchCount = useMemo(
    () => items.filter((c) => stages[c.id]?.mismatch).length,
    [items, stages]
  );

  const suggestions = useMemo(
    () => (debouncedQuery.trim() ? filtered.slice(0, 6) : []),
    [filtered, debouncedQuery]
  );

  // 검색어 자동완성 후보 — 기존에 입력된 distinct 검색어 (띄어쓰기/대소문자 변형 통합).
  // datalist 로 노출되어 '사'만 쳐도 '사당귀' 같은 기존 값이 보인다 → 표기 일관성 유지.
  const keywordSuggestions = useMemo(() => {
    const byNorm = new Map<string, string>(); // 정규화 키 → 대표 원본
    for (const c of items) {
      const raw = (c.search_keyword || '').trim().replace(/\s+/g, ' ');
      if (!raw) continue;
      const norm = raw.toLowerCase();
      if (!byNorm.has(norm)) byNorm.set(norm, raw);
    }
    return Array.from(byNorm.values()).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [items]);

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
      search_keyword: c.search_keyword || '',
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
        const res = await api.patch<{
          customer: WeddingCustomer;
          pushed?: {
            eventName: string;
            amount: number;
            filled: string[];
            promoted: { customer: boolean; event: boolean };
          }[];
          event_synced?: { eventName: string; from: string; to: string } | null;
        }>(`/api/customers/wedding/${editingId}`, form);
        setItems((prev) => prev.map((x) => (x.id === editingId ? res.customer : x)));
        setForm((f) => ({ ...f, progress_status: res.customer.progress_status }));
        setLogRefresh((n) => n + 1);
        // 계약금이 행사로 반영됐거나 DEF 로 올라갔으면 그대로 알려준다 (조용히 바뀌면 사고)
        const notes: string[] = [];
        if (res.event_synced) {
          notes.push(
            `행사 [${res.event_synced.eventName || '이름없음'}] 상태가 ${res.event_synced.from} → ${res.event_synced.to} 로 함께 바뀌었습니다.`
          );
        }
        for (const r of res.pushed || []) {
          if (r.promoted.customer) notes.push('진행단계가 DEF(확정)로 변경되었습니다.');
          if (r.promoted.event) notes.push(`행사 [${r.eventName || '이름없음'}] 상태가 DEF로 변경되었습니다.`);
          if (r.filled.length)
            notes.push(`행사 매출에 반영: ${r.filled.join(', ')} (${r.amount.toLocaleString()}원)`);
        }
        if (notes.length) {
          alert(['저장되었습니다.', '', ...notes].join('\n'));
          load(); // 행사 상태가 바뀌면 랜딩 상태도 따라 바뀐다 — 목록을 다시 읽는다
          return;
        }
      } else {
        const res = await api.post<{ customer: WeddingCustomer }>(
          '/api/customers/wedding',
          form
        );
        setItems((prev) => [res.customer, ...prev]);
        setEditingId(res.customer.id);
        setLogRefresh((n) => n + 1);
      }
      alert('저장되었습니다.');
    } catch (e) {
      // 서버가 이유를 담아 보낸 경우(행사 없는 가예약·계약 등)는 그대로 보여준다
      const msg = (e as { payload?: { message?: string; error?: string } })?.payload?.message;
      alert(msg || '저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: WeddingCustomer) {
    if (
      !confirm(
        `[${c.wedding_event_name}] 고객을 휴지통으로 이동합니다.\n관리자가 /admin/trash 에서 복구하거나 영구 삭제할 수 있습니다.\n계속하시겠습니까?`
      )
    )
      return;
    try {
      await api.delete(`/api/customers/wedding/${c.id}`);
      setItems((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      alert('삭제 실패');
      console.error(e);
    }
  }

  // 이 고객의 대표 행사 — 살아있는(취소 아닌) 것 우선, 진행단계 연동의 상대편이다
  const liveEvent = useMemo(() => {
    const live = candEvents.events.filter((e) => e.status !== 'LOS' && e.status !== '상담취소');
    const pool = live.length ? live : candEvents.events;
    return [...pool].sort((a, b) => (a.start_datetime < b.start_datetime ? 1 : -1))[0] || null;
  }, [candEvents.events]);

  /** 진행단계 변경 — 행사도 함께 바뀐다는 걸 미리 알린다 (조용히 바뀌면 사고) */
  function changeStage(next: WeddingProgressStatus) {
    if (next === form.progress_status) return;
    if (!liveEvent && REQUIRES_EVENT_STAGES.includes(next)) {
      alert(
        `'${next}' 는 홀을 잡은 상태라 캘린더에 행사가 있어야 합니다.\n먼저 캘린더에서 행사를 만들어 이 고객과 연결해 주세요.`
      );
      return;
    }
    const willChangeEvent = liveEvent && stageOfEvent(liveEvent.status) && stageOfEvent(next) && stageOfEvent(next) !== liveEvent.status;
    if (willChangeEvent) {
      const ok = window.confirm(
        [
          `진행단계를 ${form.progress_status} → ${next} 로 바꿉니다.`,
          '',
          `· 연동된 행사 [${liveEvent!.event_name || '이름없음'}] 상태도 ${liveEvent!.status} → ${stageOfEvent(next)} 로 바뀝니다.`,
          '· 캘린더 표시가 함께 달라집니다.',
          '',
          '계속할까요? (저장을 눌러야 최종 반영됩니다)',
        ].join('\n')
      );
      if (!ok) return;
    }
    setForm((f) => ({ ...f, progress_status: next }));
  }

  // 계약이 성사된 예식 후보 하나 — 직원이 고른 값이 있으면 그것, 없으면 자동 인식
  const contractInquiry = useMemo(() => {
    if (pickedContractId) {
      const found = form.event_inquiries.find((q) => q.id === pickedContractId);
      if (found) return found;
    }
    // 홀딩된 행사(취소 아닌 것)의 날짜를 기준으로 후보를 맞춘다
    const live = candEvents.events.filter((e) => e.status !== 'LOS' && e.status !== '상담취소');
    const eventDate = ((live[0] || candEvents.events[0])?.start_datetime || '').slice(0, 10);
    return pickContractInquiry(form.event_inquiries, eventDate);
  }, [form.event_inquiries, pickedContractId, candEvents.events]);

  const flatRows = useMemo(() => buildWeddingFlatRows(items), [items]);

  const tc = useTableControls({ storageKey: 'wedding_customers_table' });
  // 'event_count' 컬럼은 eventCounts state에 의존하므로 런타임에 합성.
  const allColumns = useMemo<WedCol[]>(() => {
    const eventCountCol: WedCol = {
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
    // 진행단계 컬럼 — 행사와 어긋난 건에 경고 배지를 얹는다 (W2)
    const stageCol: WedCol = {
      key: 'progress_status',
      label: '진행단계',
      render: (c) => {
        const st = stages[c.id];
        return (
          <span className="inline-flex items-center gap-1">
            <StatusBadge value={c.progress_status} variant={c.progress_status} />
            {st?.mismatch && (
              <span
                className={`badge ${st.manual ? 'bg-gray-200 text-gray-600' : 'bg-red-100 text-red-700'}`}
                title={
                  st.manual
                    ? `행사(${st.eventStatus})와 다르게 수동 지정된 건입니다`
                    : `캘린더 행사는 ${st.eventStatus} 입니다 (${st.eventDate}) — ${st.shouldBe} 여야 맞습니다`
                }
              >
                {st.manual ? '수동' : `⚠ 행사 ${st.eventStatus}`}
              </span>
            )}
          </span>
        );
      },
      sortValue: (c) => (stages[c.id]?.mismatch ? `0_${c.progress_status}` : `1_${c.progress_status}`),
    };
    // 랜딩 컬럼 — 발행 여부·상태·닫히는 날(D-day)
    const landingCol: WedCol = {
      key: 'landing',
      label: '랜딩',
      render: (c) => <LandingBadge s={landings[c.id]} />,
      sortValue: (c) => landingSortValue(landings[c.id]),
    };
    return [
      ...WEDDING_COLUMNS.map((col) => (col.key === 'progress_status' ? stageCol : col)),
      landingCol,
      eventCountCol,
    ];
  }, [eventCounts, landings, stages]);

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
    stageFilter,
    landingFilter,
    depositFilter,
    mismatchOnly,
    tc.sort.key,
    tc.sort.dir,
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl md:text-2xl font-bold">WEDDING 고객정보</h1>
          <span className="text-sm text-gray-500">
            전체 <span className="font-semibold text-gray-900">{items.length.toLocaleString()}</span>건
            {filtered.length !== items.length && (
              <> · 표시 <span className="font-semibold text-gray-900">{filtered.length.toLocaleString()}</span>건</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TableColumnMenu
            columns={allColumns}
            hidden={tc.hidden}
            onToggle={tc.toggleHidden}
            onReset={() => tc.setHiddenAll([])}
          />
          <ExcelButtons
            filename={`WEDDING_고객정보_${new Date().toISOString().slice(0, 10)}.xlsx`}
            sheetName="WEDDING 고객정보"
            importLabel="WEDDING 고객"
            columns={WEDDING_FLAT_COLUMNS}
            rows={flatRows}
            onImportRows={async (rows, dryRun) => {
              const grouped = groupWeddingFlatRows(rows as WeddingFlatRow[], authorId, authorName);
              const res = await api.post<{
                ok: number;
                failed: number;
                added: number;
                updated: number;
                errors: Array<{ row?: number; key?: string; reason: string }>;
              }>('/api/customers/wedding/_bulk-upsert', { rows: grouped, dryRun });
              if (!dryRun) {
                const refreshed = await api.get<{
                  customers: WeddingCustomer[];
                  landings?: Record<string, WeddingLandingSummary>;
                  stages?: Record<string, WeddingStageInfo>;
                }>('/api/customers/wedding');
                setItems(refreshed.customers);
                setLandings(refreshed.landings || {});
                setStages(refreshed.stages || {});
              }
              return res;
            }}
          />
          {canWriteWedding(user?.role) && (
            <button onClick={openNew} className="btn-primary">
              + 신규 등록
            </button>
          )}
        </div>
      </div>

      {/* 필터 칩 — 진행단계 / 랜딩(고객 랜딩페이지 발행·상태).
          숫자는 **상대 필터가 걸린 상태의 교차 건수**라, 0 으로 보이면 눌러도 빈 목록이 맞다. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400">진행단계</span>
          {(['ALL', ...WEDDING_PROGRESS_OPTIONS] as ('ALL' | WeddingProgressStatus)[]).map((s) => {
            const n = stageCounts.get(s) || 0;
            const on = stageFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStageFilter(s)}
                title={n === 0 && landingFilter !== 'ALL' ? '현재 랜딩 필터 안에는 해당 건이 없습니다' : undefined}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  on
                    ? 'bg-blue-600 text-white border-blue-600'
                    : n === 0
                      ? 'bg-white border-gray-200 text-gray-300'
                      : 'bg-white hover:bg-gray-50 border-gray-300'
                }`}
              >
                {s === 'ALL' ? '전체' : s}
                <span className={`ml-1 ${on ? 'text-blue-100' : n === 0 ? 'text-gray-300' : 'text-gray-400'}`}>
                  {n.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400" title="가블록형(행사 캘린더)·상담형(고객정보) 랜딩을 합쳐서 봅니다">
            💌 랜딩
          </span>
          {LANDING_FILTERS.map((f) => {
            const n = landingCounts.get(f.key) || 0;
            const on = landingFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setLandingFilter(f.key)}
                title={n === 0 && stageFilter !== 'ALL' ? `${stageFilter} 중에는 해당 건이 없습니다` : undefined}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  on
                    ? 'bg-rose-500 text-white border-rose-500'
                    : n === 0
                      ? 'bg-white border-gray-200 text-gray-300'
                      : 'bg-white hover:bg-gray-50 border-gray-300'
                }`}
              >
                {f.label}
                <span className={`ml-1 ${on ? 'text-rose-100' : n === 0 ? 'text-gray-300' : 'text-gray-400'}`}>
                  {n.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-400" title="예식 후보의 계약금(= 가톨릭대관료) 입력·입금 상태">
            💰 계약금
          </span>
          {DEPOSIT_FILTERS.map((f) => {
            const n = depositCounts.get(f.key) || 0;
            const on = depositFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setDepositFilter(f.key)}
                className={`text-xs px-2.5 py-1 rounded-full border transition ${
                  on
                    ? 'bg-amber-500 text-white border-amber-500'
                    : n === 0
                      ? 'bg-white border-gray-200 text-gray-300'
                      : 'bg-white hover:bg-gray-50 border-gray-300'
                }`}
              >
                {f.label}
                <span className={`ml-1 ${on ? 'text-amber-100' : n === 0 ? 'text-gray-300' : 'text-gray-400'}`}>
                  {n.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
        {mismatchCount > 0 && (
          <button
            onClick={() => setMismatchOnly((v) => !v)}
            title="고객 진행단계와 캘린더 행사 상태가 서로 다른 건 — 확인해서 맞춰주세요"
            className={`text-xs px-2.5 py-1 rounded-full border transition ${
              mismatchOnly
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white hover:bg-red-50 border-red-300 text-red-700'
            }`}
          >
            ⚠ 단계 불일치
            <span className={`ml-1 ${mismatchOnly ? 'text-red-100' : 'text-red-400'}`}>
              {mismatchCount.toLocaleString()}
            </span>
          </button>
        )}
        {filterActive && (
          <button onClick={resetFilters} className="text-xs text-gray-500 hover:text-gray-800 underline">
            필터 초기화
          </button>
        )}
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

      {/* 모바일 카드 뷰 — md 미만 */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="text-center text-gray-400 py-8 bg-white border rounded-lg">불러오는 중...</div>
        ) : sortedFiltered.length === 0 ? (
          <div className="text-center text-gray-400 py-8 bg-white border rounded-lg">
            <EmptyReason
              query={query}
              stageFilter={stageFilter}
              landingFilter={landingFilter}
              depositFilter={depositFilter}
              onReset={resetFilters}
            />
          </div>
        ) : (
          pageItems.map((c, i) => (
            <div
              key={c.id}
              onClick={() => openEdit(c)}
              className="bg-white border rounded-lg p-3 shadow-sm active:bg-blue-50 cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-semibold text-gray-900 truncate">
                  <span className="text-gray-400 font-normal mr-1.5">#{page * pageSize + i + 1}</span>
                  {c.wedding_event_name || '(이름 없음)'}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {landings[c.id] && <LandingBadge s={landings[c.id]} />}
                  <StatusBadge value={c.progress_status} variant={c.progress_status} />
                </span>
              </div>
              <div className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5 mb-1">
                {c.inquiry_date && <span>문의 {fmtDateOrDateTime(c.inquiry_date)}</span>}
                {c.desired_consultation_date && (
                  <span>상담 {fmtDateOrDateTime(c.desired_consultation_date)}</span>
                )}
              </div>
              <div className="text-xs text-gray-700 truncate">
                {c.groom_name || '-'} {c.groom_phone && <span className="text-gray-500">{c.groom_phone}</span>}
                {' / '}
                {c.bride_name || '-'} {c.bride_phone && <span className="text-gray-500">{c.bride_phone}</span>}
              </div>
              {c.source && (
                <div className="text-xs text-gray-500 truncate mt-0.5">
                  유입: {c.source}
                  {c.source_detail && ` / ${c.source_detail}`}
                </div>
              )}
            </div>
          ))
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
                    <EmptyReason
              query={query}
              stageFilter={stageFilter}
              landingFilter={landingFilter}
              depositFilter={depositFilter}
              onReset={resetFilters}
            />
                  </td>
                </tr>
              ) : (
                pageItems.map((c, i) => (
                  <tr
                    key={c.id}
                    onClick={() => openEdit(c)}
                    className="border-t hover:bg-pink-50 cursor-pointer"
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
                      {canWriteWedding(user?.role) && (
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
            <Field
              label="진행단계"
              required
              hint={
                liveEvent
                  ? '🔗 캘린더 행사와 연동됩니다 — 여기서 바꾸면 행사 상태도 함께 바뀝니다'
                  : '가예약(INQ)·확정(DEF)은 캘린더에 행사가 있어야 선택할 수 있습니다'
              }
            >
              <select
                className="input"
                value={form.progress_status}
                onChange={(e) => changeStage(e.target.value as WeddingProgressStatus)}
              >
                {WEDDING_PROGRESS_OPTIONS.map((s) => (
                  <option
                    key={s}
                    value={s}
                    // 행사 없이 가예약·계약은 성립하지 않는다 (W2) — 현재 값은 남겨둔다
                    disabled={!liveEvent && REQUIRES_EVENT_STAGES.includes(s) && form.progress_status !== s}
                  >
                    {s}
                    {!liveEvent && REQUIRES_EVENT_STAGES.includes(s) ? ' (행사 필요)' : ''}
                  </option>
                ))}
              </select>
              {/* 연동된 행사 + 어긋남 안내 */}
              {editingId && candEvents.events.length > 0 && (
                <div className="text-[11px] mt-1">
                  {liveEvent ? (
                    <span className="text-gray-500">
                      연동 행사: {fmtDateOrDateTime(liveEvent.start_datetime)} ·{' '}
                      <b className="text-gray-700">{liveEvent.status}</b>
                      {stageOfEvent(liveEvent.status) &&
                        stageOfEvent(liveEvent.status) !== form.progress_status && (
                          <span className="text-red-600">
                            {' '}
                            ⚠ 단계와 다름 — 저장하면 행사가 {form.progress_status} 로 바뀝니다
                          </span>
                        )}
                    </span>
                  ) : (
                    <span className="text-gray-400">연동할 행사가 없습니다</span>
                  )}
                </div>
              )}
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
            <Field label="검색어" hint="고객 유입 검색어 (자유 입력). '사'만 입력해도 기존 '사당귀' 등이 자동완성됩니다.">
              <input
                className="input"
                list="wedding-keyword-suggestions"
                value={form.search_keyword}
                placeholder="예: 사당귀"
                onChange={(e) => setForm({ ...form, search_keyword: e.target.value })}
              />
              <datalist id="wedding-keyword-suggestions">
                {keywordSuggestions.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </Field>
            <Field label="희망예산">
              <input
                className="input"
                value={form.desired_budget}
                placeholder="예: 7,000만원"
                onChange={(e) => setForm({ ...form, desired_budget: e.target.value })}
              />
            </Field>
            <Field label="비교웨딩홀">
              <input
                className="input"
                value={form.competing_venues}
                placeholder="아펠가모 / 그랜드인터컨"
                onChange={(e) => setForm({ ...form, competing_venues: e.target.value })}
              />
            </Field>
            <Field label="최초 인폼 코멘트" className="md:col-span-2">
              <AutoExpandTextarea
                className="input"
                minRows={2}
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
                  <SimilarPhoneWarning
                    phone={form.groom_phone}
                    party="신랑"
                    editingId={editingId}
                    onPickExisting={(id) => {
                      const target = items.find((c) => c.id === id);
                      if (!target) return;
                      if (!confirm(
                        `[${target.wedding_event_name}] 기존 고객으로 이동합니다.\n현재 입력 내용이 사라집니다. 계속할까요?`
                      )) return;
                      openEdit(target);
                    }}
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
                  <SimilarPhoneWarning
                    phone={form.bride_phone}
                    party="신부"
                    editingId={editingId}
                    onPickExisting={(id) => {
                      const target = items.find((c) => c.id === id);
                      if (!target) return;
                      if (!confirm(
                        `[${target.wedding_event_name}] 기존 고객으로 이동합니다.\n현재 입력 내용이 사라집니다. 계속할까요?`
                      )) return;
                      openEdit(target);
                    }}
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
          {/* 계약 · 계약금 — 고객당 하나. 웨딩은 홀딩도 계약도 1건뿐이라
              후보마다 칸을 띄우면 낭비이고, 엉뚱한 후보에 넣는 사고가 난다. */}
          {showDepositSection(form.progress_status, form.event_inquiries) && (
            <WeddingDepositBlock
              inqs={form.event_inquiries}
              inq={contractInquiry}
              stage={form.progress_status}
              events={candEvents.events}
              resolvedId={contractInquiry ? candEvents.resolved[contractInquiry.id] ?? null : null}
              onChange={(patch) => contractInquiry && updateInquiry(contractInquiry.id, patch)}
              onPickEvent={(eventId) =>
                contractInquiry && updateInquiry(contractInquiry.id, { linked_event_id: eventId || null })
              }
              onPickInquiry={(inquiryId) => {
                // 고른 후보에 계약금 자리를 열어둔다 (금액 0 은 '미입력' 과 같아 부작용 없음)
                if (inquiryId) updateInquiry(inquiryId, { deposit_amount: null, deposit_paid: false });
                setPickedContractId(inquiryId || null);
              }}
            />
          )}
          <div className="space-y-3">
            {form.event_inquiries.map((inq, idx) => (
              <div key={inq.id} className="border rounded-md p-3 bg-gray-50/40">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-600">예식 후보 #{idx + 1}</span>
                    {contractInquiry?.id === inq.id && (
                      <span className="badge bg-amber-100 text-amber-800">✓ 이 날짜로 계약</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setCalcOpenId(inq.id)}
                      className="text-xs px-2 py-0.5 rounded bg-[#5b4a3a] text-white hover:opacity-90"
                      title="웨딩 마진계산기 + 견적서"
                    >
                      🧮 마진계산기
                    </button>
                  </div>
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
                {calcOpenId === inq.id && (
                  <WeddingMarginModal
                    inquiry={{
                      id: inq.id,
                      wedding_datetime: inq.wedding_datetime,
                      guaranteed_guest_count: inq.guaranteed_guest_count,
                      estimate_amount: inq.estimate_amount,
                      estimate_detail: inq.estimate_detail,
                      visit_consultation_comment: inq.visit_consultation_comment,
                      assigned_manager_id: inq.assigned_manager_id,
                      assigned_manager_name: inq.assigned_manager_name,
                      created_at: inq.created_at,
                      calc_payload: inq.calc_payload,
                    }}
                    idx={idx}
                    groom={form.groom_name}
                    bride={form.bride_name}
                    source={form.source}
                    canEditSettings={canEditCalcSettings}
                    canSave
                    onClose={() => setCalcOpenId(null)}
                    onSaved={(u) => {
                      updateInquiry(inq.id, {
                        estimate_amount: u.estimate_amount,
                        estimate_detail: u.estimate_detail,
                        calc_payload: u.calc_payload,
                      });
                      setCalcOpenId(null);
                    }}
                  />
                )}
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
                        const id = e.target.value;
                        if (!id) {
                          updateInquiry(inq.id, {
                            assigned_manager_id: '',
                            assigned_manager_name: '',
                          });
                          return;
                        }
                        const u = weddingManagerOptions.find((x) => x.id === id);
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
                        !weddingManagerOptions.find((x) => x.id === inq.assigned_manager_id) &&
                        inq.assigned_manager_name && (
                          <option value={inq.assigned_manager_id}>
                            {inq.assigned_manager_name} (현재)
                          </option>
                        )}
                      {weddingManagerOptions.map((u) => (
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
                    <AutoExpandTextarea
                      className="input"
                      minRows={2}
                      value={inq.estimate_detail}
                      placeholder="식사 메뉴 / 옵션 / 답례품 등"
                      onChange={(e) => updateInquiry(inq.id, { estimate_detail: e.target.value })}
                    />
                  </Field>
                  <Field label="방문 상담일 코멘트" className="md:col-span-2">
                    <AutoExpandTextarea
                      className="input"
                      minRows={2}
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

        {/* 💌 상담 고객 랜딩 — 가블록(행사) 없이 상담 DB만으로 발행하는 링크 */}
        {editingId && (
          <Section title="💌 고객 랜딩 (상담 후 링크 — 가블록 없이 발행)">
            <WeddingLandingTab
              eventId={null}
              consultCustomerId={editingId}
              startDatetime=""
              customerIds={[editingId]}
              canManage={user?.role === 'admin' || user?.role === 'sales_wedding'}
            />
          </Section>
        )}

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
              customerType="wedding"
              customerId={editingId}
              showProfileLink
            />
          </Section>
        )}

        <ChangeLogPanel
          entityType="wedding_customer"
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
