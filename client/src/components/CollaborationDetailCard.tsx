// 협업요청서 1건의 상세 카드 — 작성 정보 + 팀별 회신 + 최종 결정.
// 역할에 따라 회신 폼(주방/연회) / 결정 폼(세일즈) 을 인라인으로 노출.
// 행사 모달 탭과 대시보드 양쪽에서 재사용.

import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  canDecideCollaboration,
  canDeleteCollaboration,
  collabReplyTeam,
} from '../auth/permissions';
import {
  autoMargin,
  countdown,
  decideCollaboration,
  deleteCollaboration,
  marginPct,
  replyCollaboration,
  replyOf,
  resultBadgeClass,
  statusBadgeClass,
  sumAddedCost,
} from '../lib/collaboration';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  COLLAB_TEAM_LABEL,
  type CollabDecision,
  type CollabReplyResult,
  type CollabTeam,
  type CollaborationRequest,
} from '../types';

interface Props {
  request: CollaborationRequest;
  onChange: (updated: CollaborationRequest) => void;
  onDeleted?: (id: string) => void;
  defaultExpanded?: boolean;
}

function fmtMoney(n: number | null): string {
  return n == null ? '-' : `${n.toLocaleString('ko-KR')}원`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CollaborationDetailCard({
  request,
  onChange,
  onDeleted,
  defaultExpanded = false,
}: Props) {
  const { user } = useAuth();
  const role = user?.role;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cr = request;
  const cd = cr.status === '회신대기' ? countdown(cr.reply_due_at) : null;

  const myReplyTeam = collabReplyTeam(role); // 'kitchen' | 'banquet' | null(=admin/기타)
  const canDecide = canDecideCollaboration(role) && cr.status === '회신완료';

  async function handleDelete() {
    if (!confirm(`[${cr.customer_event_name}] 협업요청서를 삭제하시겠습니까? (복구 불가)`)) return;
    try {
      await deleteCollaboration(cr.id);
      onDeleted?.(cr.id);
    } catch {
      alert('삭제 실패');
    }
  }

  return (
    <div className="border rounded-lg bg-white">
      {/* 헤더 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-3 flex items-center gap-2 flex-wrap"
      >
        <span className={`badge border text-[11px] ${statusBadgeClass(cr.status)}`}>{cr.status}</span>
        <span className="font-semibold text-gray-900 truncate flex-1 min-w-[8rem]">
          {cr.customer_event_name}
        </span>
        <span className="text-[11px] text-gray-500">
          대상 {cr.target_teams.map((t) => COLLAB_TEAM_LABEL[t]).join('+')}
        </span>
        {cd && (
          <span
            className={
              'text-[11px] font-semibold ' + (cd.urgent ? 'text-red-600' : 'text-gray-500')
            }
          >
            ⏱ {cd.expired ? cd.label : `${cd.label} 남음`}
          </span>
        )}
        <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 text-sm">
          {/* 작성 정보 */}
          <div className="rounded-md bg-gray-50 border p-3 space-y-1.5">
            <div className="text-[11px] text-gray-500">
              작성자 {cr.created_by_name} · {fmtDateTime(cr.created_at)}
            </div>
            <Row label="행사 예정일" value={cr.event_date || '-'} />
            <Row label="고객 요청 사항" value={cr.customer_request} />
            <div>
              <span className="text-[11px] text-gray-500">표준 대비 다른 부분</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {cr.deviations.length === 0 && <span className="text-gray-400 text-xs">-</span>}
                {cr.deviations.map((d) => (
                  <span key={d} className="badge bg-indigo-50 text-indigo-700 text-[11px]">
                    {d}
                    {d === '기타' && cr.deviation_other ? `: ${cr.deviation_other}` : ''}
                  </span>
                ))}
              </div>
            </div>
            <Row
              label="예상 매출"
              value={`${fmtMoney(cr.expected_revenue)}${cr.expected_revenue_memo ? ` · ${cr.expected_revenue_memo}` : ''}`}
            />
            {cr.sales_comment && <Row label="세일즈 의견" value={cr.sales_comment} />}
          </div>

          {/* 팀별 회신 */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-gray-600">팀별 회신</div>
            {cr.target_teams.map((team) => {
              const r = replyOf(cr, team);
              const canReplyHere =
                cr.status !== '진행' &&
                cr.status !== '진행안함' &&
                (role === 'admin' || myReplyTeam === team);
              return (
                <div key={team} className="border rounded-md p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-800">{COLLAB_TEAM_LABEL[team]}팀</span>
                    {r?.result ? (
                      <span className={`badge text-[11px] ${resultBadgeClass(r.result)}`}>
                        {r.result}
                      </span>
                    ) : (
                      <span className="badge bg-amber-100 text-amber-800 text-[11px]">회신 대기</span>
                    )}
                  </div>
                  {r?.result && (
                    <div className="text-xs text-gray-600 space-y-0.5">
                      <div>추가 COST: {fmtMoney(r.added_cost)}{r.added_cost_memo ? ` · ${r.added_cost_memo}` : ''}</div>
                      {r.condition_or_reject_reason && (
                        <div>사유: {r.condition_or_reject_reason}</div>
                      )}
                      {r.alternative && <div>대안: {r.alternative}</div>}
                      <div className="text-[11px] text-gray-400">
                        {r.replied_by_name} · {fmtDateTime(r.replied_at)}
                      </div>
                    </div>
                  )}
                  {canReplyHere && (
                    <ReplyForm
                      team={team}
                      existing={r}
                      onSubmit={async (body) => {
                        const updated = await replyCollaboration(cr.id, body);
                        onChange(updated);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* 최종 결정 */}
          <div className="border rounded-md p-2.5">
            <div className="text-[11px] font-semibold text-gray-600 mb-1">최종 결정</div>
            {cr.decision ? (
              <div className="text-xs text-gray-700 space-y-0.5">
                <div>
                  <span className={`badge text-[11px] ${statusBadgeClass(cr.decision)}`}>
                    {cr.decision}
                  </span>
                </div>
                <div>
                  마진 추정: {fmtMoney(cr.decided_margin)}
                  {(() => {
                    const p = marginPct(cr.expected_revenue, cr.decided_margin);
                    return p != null ? ` (${p.toFixed(1)}%)` : '';
                  })()}
                </div>
                {cr.decision_comment && <div>코멘트: {cr.decision_comment}</div>}
                <div className="text-[11px] text-gray-400">
                  {cr.decided_by_name} · {fmtDateTime(cr.decided_at)}
                </div>
              </div>
            ) : canDecide ? (
              <DecisionForm
                expectedRevenue={cr.expected_revenue}
                addedCostSum={sumAddedCost(cr)}
                suggestedMargin={autoMargin(cr)}
                onSubmit={async (body) => {
                  const updated = await decideCollaboration(cr.id, body);
                  onChange(updated);
                }}
              />
            ) : (
              <div className="text-xs text-gray-400">
                {cr.status === '회신대기' ? '모든 팀 회신 후 결정 가능합니다.' : '결정 권한이 없습니다.'}
              </div>
            )}
          </div>

          {canDeleteCollaboration(role, user?.id === cr.created_by_id) && (
            <div className="text-right">
              <button
                onClick={handleDelete}
                className="text-xs text-red-600 hover:underline"
                title="대표 또는 상신한 담당자 본인만 삭제할 수 있습니다"
              >
                삭제
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 shrink-0 w-24">{label}</span>
      <span className="text-gray-800 whitespace-pre-wrap break-words">{value}</span>
    </div>
  );
}

// 숫자(원) + 메모 병기 한 줄 입력
function MoneyMemoRow({
  amount,
  memo,
  onAmount,
  onMemo,
  amountPlaceholder = '0',
  memoPlaceholder = '메모 (선택)',
}: {
  amount: string;
  memo: string;
  onAmount: (s: string) => void;
  onMemo: (s: string) => void;
  amountPlaceholder?: string;
  memoPlaceholder?: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <input
          className="input !py-1 !w-32 text-right tabular-nums"
          inputMode="numeric"
          value={amount}
          placeholder={amountPlaceholder}
          onChange={(e) => onAmount(formatKoreanCommas(e.target.value))}
        />
        <span className="text-xs text-gray-500">원</span>
      </div>
      <input
        className="input !py-1 flex-1 min-w-[10rem] text-xs"
        value={memo}
        placeholder={memoPlaceholder}
        onChange={(e) => onMemo(e.target.value)}
      />
    </div>
  );
}

const REPLY_RESULTS: CollabReplyResult[] = ['가능', '조건부 가능', '불가'];

function ReplyForm({
  team,
  existing,
  onSubmit,
}: {
  team: CollabTeam;
  existing?: { result: CollabReplyResult | null; added_cost: number | null; added_cost_memo: string; condition_or_reject_reason: string; alternative: string } | undefined;
  onSubmit: (body: {
    team: CollabTeam;
    result: CollabReplyResult;
    added_cost: number | null;
    added_cost_memo: string;
    condition_or_reject_reason: string;
    alternative: string;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<CollabReplyResult | ''>(existing?.result || '');
  const [cost, setCost] = useState(
    existing?.added_cost != null ? formatKoreanCommas(String(existing.added_cost)) : ''
  );
  const [costMemo, setCostMemo] = useState(existing?.added_cost_memo || '');
  const [reason, setReason] = useState(existing?.condition_or_reject_reason || '');
  const [alt, setAlt] = useState(existing?.alternative || '');
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-secondary !py-1 text-xs mt-2"
      >
        {existing?.result ? '회신 수정' : '회신하기'}
      </button>
    );
  }

  const needReason = result === '조건부 가능' || result === '불가';

  async function submit() {
    if (!result) {
      alert('수용 가능 여부를 선택하세요.');
      return;
    }
    if (needReason && !reason.trim()) {
      alert('조건부 가능/불가 시 사유는 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        team,
        result,
        added_cost: cost ? Number(cost.replace(/[^\d]/g, '')) : null,
        added_cost_memo: costMemo,
        condition_or_reject_reason: reason,
        alternative: alt,
      });
      setOpen(false);
    } catch {
      alert('회신 저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 bg-gray-50 border rounded p-2">
      <div className="flex gap-1.5 flex-wrap">
        {REPLY_RESULTS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResult(r)}
            className={
              'px-2.5 py-1 rounded border text-xs ' +
              (result === r
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white border-gray-300 hover:bg-gray-100')
            }
          >
            {r}
          </button>
        ))}
      </div>
      <div>
        <div className="text-[11px] text-gray-500 mb-1">추가 COST 예상</div>
        <MoneyMemoRow
          amount={cost}
          memo={costMemo}
          onAmount={setCost}
          onMemo={setCostMemo}
          memoPlaceholder="예) 식자재/인건비 등 항목 구분"
        />
      </div>
      {needReason && (
        <textarea
          className="input !py-1 text-xs w-full"
          placeholder="조건부/불가 사유 (필수, 최대 200자)"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <textarea
        className="input !py-1 text-xs w-full"
        placeholder='대안 제안 (선택) — "안됩니다"보다 방법을 먼저'
        maxLength={200}
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary !py-1 text-xs">
          취소
        </button>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary !py-1 text-xs">
          {saving ? '저장중...' : '회신 제출'}
        </button>
      </div>
    </div>
  );
}

const DECISIONS: CollabDecision[] = ['진행', '조건부진행', '진행안함'];

function DecisionForm({
  expectedRevenue,
  addedCostSum,
  suggestedMargin,
  onSubmit,
}: {
  expectedRevenue: number | null;
  addedCostSum: number;
  suggestedMargin: number | null;
  onSubmit: (body: {
    decision: CollabDecision;
    decided_margin: number | null;
    decision_comment: string;
  }) => Promise<void>;
}) {
  const [decision, setDecision] = useState<CollabDecision | ''>('');
  const [margin, setMargin] = useState(
    suggestedMargin != null ? formatKoreanCommas(String(suggestedMargin)) : ''
  );
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const marginNum = margin ? Number(margin.replace(/[^\d-]/g, '')) : null;
  const pct = marginPct(expectedRevenue, marginNum);

  async function submit() {
    if (!decision) {
      alert('최종 결정을 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ decision, decided_margin: marginNum, decision_comment: comment });
    } catch {
      alert('결정 저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecision(d)}
            className={
              'px-2.5 py-1 rounded border text-xs ' +
              (decision === d
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white border-gray-300 hover:bg-gray-100')
            }
          >
            {d}
          </button>
        ))}
      </div>
      <div className="text-[11px] text-gray-500">
        예상매출 {expectedRevenue?.toLocaleString('ko-KR') ?? '-'}원 − 추가COST{' '}
        {addedCostSum.toLocaleString('ko-KR')}원 = 자동 마진{' '}
        {suggestedMargin?.toLocaleString('ko-KR') ?? '-'}원
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-500">마진 추정</span>
        <div className="flex items-center gap-1">
          <input
            className="input !py-1 !w-32 text-right tabular-nums"
            inputMode="numeric"
            value={margin}
            onChange={(e) => setMargin(formatKoreanCommas(e.target.value))}
          />
          <span className="text-xs text-gray-500">원</span>
        </div>
        {pct != null && <span className="text-xs text-gray-600">({pct.toFixed(1)}%)</span>}
      </div>
      <textarea
        className="input !py-1 text-xs w-full"
        placeholder="결정 사유 / 코멘트 (선택, 최대 200자)"
        maxLength={200}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <div className="flex justify-end">
        <button type="button" onClick={submit} disabled={saving} className="btn-primary !py-1 text-xs">
          {saving ? '저장중...' : '최종 결정 저장'}
        </button>
      </div>
    </div>
  );
}
