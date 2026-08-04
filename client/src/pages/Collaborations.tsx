// 협업요청서 대시보드 — 리스트 + 필터 + 통계.
// 행을 펼치면 CollaborationDetailCard 로 회신/결정까지 그 자리에서 처리.

import { weekdayKoOf } from '../lib/dateFmt';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  COLLAB_TEAM_LABEL,
  type CollabDecision,
  type CollabStatus,
  type CollabTeam,
  type CollaborationRequest,
} from '../types';
import {
  autoMargin,
  countdown,
  listCollaborations,
  statusBadgeClass,
  sumAddedCost,
  collabEventName,
} from '../lib/collaboration';
import CollaborationDetailCard from '../components/CollaborationDetailCard';

type StatusFilter = 'ALL' | CollabStatus;
type TeamFilter = 'ALL' | CollabTeam;
type DecisionFilter = 'ALL' | CollabDecision | 'none';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtMoney(n: number | null): string {
  return n == null ? '-' : n.toLocaleString('ko-KR');
}

export default function Collaborations() {
  const [requests, setRequests] = useState<CollaborationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [team, setTeam] = useState<TeamFilter>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [decision, setDecision] = useState<DecisionFilter>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRequests(await listCollaborations());
    } catch (e) {
      setError('협업요청서를 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (fromDate && r.created_at.slice(0, 10) < fromDate) return false;
      if (toDate && r.created_at.slice(0, 10) > toDate) return false;
      if (team !== 'ALL' && !r.target_teams.includes(team)) return false;
      if (status !== 'ALL' && r.status !== status) return false;
      if (decision !== 'ALL') {
        if (decision === 'none' && r.decision) return false;
        if (decision !== 'none' && r.decision !== decision) return false;
      }
      return true;
    });
  }, [requests, fromDate, toDate, team, status, decision]);

  const stats = useMemo(() => computeStats(filtered), [filtered]);

  function upsert(updated: CollaborationRequest) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }
  function removeOne(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold">🤝 협업요청서</h1>
        <button onClick={load} className="btn-secondary">
          새로고침
        </button>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 mb-4">
        <StatCard label="총 요청" value={`${stats.total}건`} />
        <StatCard label="회신 대기" value={`${stats.awaiting}건`} accent={stats.awaiting > 0 ? 'amber' : undefined} />
        <StatCard label="수용률" value={stats.acceptRate == null ? '-' : `${stats.acceptRate.toFixed(0)}%`} accent="green" />
        <StatCard label="평균 회신시간" value={stats.avgReplyHours == null ? '-' : `${stats.avgReplyHours.toFixed(1)}h`} />
        <StatCard label="진행 결정 비율" value={stats.proceedRate == null ? '-' : `${stats.proceedRate.toFixed(0)}%`} accent="green" />
      </div>

      {stats.monthly.length > 0 && (
        <div className="bg-white border rounded-lg p-3 mb-4">
          <div className="text-xs font-semibold text-gray-600 mb-2">월별 협업 건수</div>
          <div className="flex flex-wrap gap-2">
            {stats.monthly.map((m) => (
              <div key={m.ym} className="text-center border rounded px-2.5 py-1.5 bg-gray-50">
                <div className="text-[11px] text-gray-500">{m.ym}</div>
                <div className="text-sm font-bold tabular-nums">{m.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="bg-white border rounded-lg p-3 mb-4 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-gray-500 font-semibold">기간(작성):</span>
        <input type="date" className="input !py-1 !text-xs !w-auto" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <span className="text-gray-400">~</span>
        <input type="date" className="input !py-1 !text-xs !w-auto" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <select className="input !py-1 !text-xs !w-auto" value={team} onChange={(e) => setTeam(e.target.value as TeamFilter)}>
          <option value="ALL">전체 팀</option>
          <option value="kitchen">주방</option>
          <option value="banquet">연회</option>
        </select>
        <select className="input !py-1 !text-xs !w-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="ALL">전체 상태</option>
          <option value="회신대기">회신 대기</option>
          <option value="회신완료">회신 완료</option>
          <option value="진행">진행</option>
          <option value="조건부진행">조건부 진행</option>
          <option value="진행안함">진행 안 함</option>
        </select>
        <select className="input !py-1 !text-xs !w-auto" value={decision} onChange={(e) => setDecision(e.target.value as DecisionFilter)}>
          <option value="ALL">전체 결정</option>
          <option value="none">미결정</option>
          <option value="진행">진행</option>
          <option value="조건부진행">조건부 진행</option>
          <option value="진행안함">진행 안 함</option>
        </select>
        <span className="ml-auto text-gray-500">총 {filtered.length}건</span>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-8 text-center">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-12 text-center bg-white border rounded-lg">
          조건에 맞는 협업요청서가 없습니다.
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <Th>요청일시</Th>
                <Th>고객사/행사명</Th>
                <Th>작성자</Th>
                <Th>대상팀</Th>
                <Th>상태</Th>
                <Th right>예상매출</Th>
                <Th right>추가COST</Th>
                <Th right>마진</Th>
                <Th>회신 남은시간</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const cost = sumAddedCost(r);
                const margin = r.decided_margin != null ? r.decided_margin : autoMargin(r);
                const cd = r.status === '회신대기' ? countdown(r.reply_due_at) : null;
                const isOpen = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-t hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(isOpen ? null : r.id)}
                    >
                      <td className="px-3 py-2 text-xs text-gray-600">{fmtDateTime(r.created_at)}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{collabEventName(r)}</td>
                      <td className="px-3 py-2 text-gray-700">{r.created_by_name}</td>
                      <td className="px-3 py-2 text-xs">{r.target_teams.map((t) => COLLAB_TEAM_LABEL[t]).join('+')}</td>
                      <td className="px-3 py-2">
                        <span className={`badge border text-[11px] ${statusBadgeClass(r.status)}`}>{r.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.expected_revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{cost ? fmtMoney(cost) : '-'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(margin)}</td>
                      <td className="px-3 py-2 text-xs">
                        {cd ? (
                          <span className={cd.urgent ? 'text-red-600 font-semibold' : 'text-gray-500'}>
                            {cd.expired ? cd.label : `${cd.label} 남음`}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={9} className="px-3 py-3 bg-gray-50/60">
                          <CollaborationDetailCard
                            request={r}
                            onChange={upsert}
                            onDeleted={removeOne}
                            defaultExpanded
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface Stats {
  total: number;
  awaiting: number;
  acceptRate: number | null;
  avgReplyHours: number | null;
  proceedRate: number | null;
  monthly: { ym: string; count: number }[];
}

function computeStats(list: CollaborationRequest[]): Stats {
  let acceptable = 0;
  let totalReplies = 0;
  let replyMsSum = 0;
  let replyCount = 0;
  let decided = 0;
  let proceed = 0;
  const monthlyMap = new Map<string, number>();

  for (const r of list) {
    monthlyMap.set(r.created_at.slice(0, 7), (monthlyMap.get(r.created_at.slice(0, 7)) || 0) + 1);
    for (const rep of r.replies) {
      if (!rep.result) continue;
      totalReplies += 1;
      if (rep.result === '가능' || rep.result === '조건부 가능') acceptable += 1;
      if (rep.replied_at) {
        const ms = new Date(rep.replied_at).getTime() - new Date(r.created_at).getTime();
        if (ms >= 0) {
          replyMsSum += ms;
          replyCount += 1;
        }
      }
    }
    if (r.decision) {
      decided += 1;
      if (r.decision === '진행' || r.decision === '조건부진행') proceed += 1;
    }
  }

  return {
    total: list.length,
    awaiting: list.filter((r) => r.status === '회신대기').length,
    acceptRate: totalReplies > 0 ? (acceptable / totalReplies) * 100 : null,
    avgReplyHours: replyCount > 0 ? replyMsSum / replyCount / 3_600_000 : null,
    proceedRate: decided > 0 ? (proceed / decided) * 100 : null,
    monthly: Array.from(monthlyMap.entries())
      .map(([ym, count]) => ({ ym, count }))
      .sort((a, b) => (a.ym < b.ym ? -1 : 1)),
  };
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'green' | 'amber';
}) {
  const cls =
    accent === 'green'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
      : accent === 'amber'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : 'bg-white border-gray-200 text-gray-800';
  return (
    <div className={`border rounded-lg p-2.5 ${cls}`}>
      <div className="text-[11px] opacity-80 mb-1">{label}</div>
      <div className="text-lg md:text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-semibold border-b ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
