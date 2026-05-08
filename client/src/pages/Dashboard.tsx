import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { isAdmin } from '../auth/permissions';
import { formatKoreanCommas } from '../lib/numberFormat';
import {
  buildTargetTable,
  filterMiceInflows,
  filterWeddingInflows,
  miceInflowSummary,
  thisMonthBound,
  thisWeekBound,
  todayBound,
  weddingConsultationByMonth,
  weddingConsultationByYear,
  weddingInflowSummary,
  weddingSourceBreakdown,
  weddingYearlyTotals,
  type MiceInflowRow,
  type ReviewLite,
  type TargetRow,
  type WeddingInflowRow,
} from '../lib/dashboardStats';
import {
  type EventWithFood,
  type MiceCustomer,
  type MiceInquiryStatus,
  type SalesTarget,
  type WeddingCustomer,
  type WeddingProgressStatus,
} from '../types';
import InflowListModal from '../components/InflowListModal';

// 큰 금액을 짧게 표기 (1.5억, 8,500만 등)
function fmtMoney(n: number): string {
  if (!n) return '0';
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억';
  if (abs >= 10_000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만';
  return n.toLocaleString('ko-KR');
}

function fmtNum(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtPct(p: number | null): string {
  return p == null ? '-' : `${p}%`;
}

const MICE_STATUS_COLOR: Record<string, string> = {
  INQ: '#9ca3af',
  TEN: '#facc15',
  DEF: '#22c55e',
  LOS: '#ef4444',
  단순문의: '#d1d5db',
};

const WEDDING_STATUS_COLOR: Record<string, string> = {
  INQ: '#9ca3af',
  TEN: '#facc15',
  DEF: '#22c55e',
  LOS: '#ef4444',
};

interface InflowFilter {
  open: boolean;
  mode: 'MICE' | 'WEDDING';
  title: string;
  miceRows?: MiceInflowRow[];
  weddingRows?: WeddingInflowRow[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);

  const [mice, setMice] = useState<MiceCustomer[]>([]);
  const [wedding, setWedding] = useState<WeddingCustomer[]>([]);
  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [reviews, setReviews] = useState<ReviewLite[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());

  const [inflow, setInflow] = useState<InflowFilter>({
    open: false,
    mode: 'MICE',
    title: '',
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [miceRes, weddingRes, evRes, revRes, tgtRes] = await Promise.all([
        api.get<{ customers: MiceCustomer[] }>('/api/customers/mice').catch(() => ({ customers: [] })),
        api.get<{ customers: WeddingCustomer[] }>('/api/customers/wedding').catch(() => ({
          customers: [],
        })),
        api.get<{ events: EventWithFood[] }>('/api/events'),
        api.get<{ reviews: ReviewLite[] }>('/api/event-reviews/_all').catch(() => ({ reviews: [] })),
        api.get<{ targets: SalesTarget[] }>('/api/sales-targets').catch(() => ({ targets: [] })),
      ]);
      setMice(miceRes.customers);
      setWedding(weddingRes.customers);
      setEvents(evRes.events);
      setReviews(revRes.reviews);
      setTargets(tgtRes.targets);
    } catch (e) {
      setError('대시보드 데이터를 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // ===== Section 1 / 2 — 신규 유입 =====
  const miceSummary = useMemo(() => miceInflowSummary(mice), [mice]);
  const weddingSummary = useMemo(() => weddingInflowSummary(wedding), [wedding]);

  // ===== Section 3 — 유입경로 =====
  const yearlyTotals = useMemo(() => weddingYearlyTotals(wedding), [wedding]);
  const sourceBreakdown = useMemo(
    () => weddingSourceBreakdown(wedding, year, false),
    [wedding, year]
  );
  const sourceDetailBreakdown = useMemo(
    () => weddingSourceBreakdown(wedding, year, true),
    [wedding, year]
  );

  // ===== Section 4 — 상담 현황 =====
  const consultationMonthly = useMemo(
    () => weddingConsultationByMonth(wedding, year),
    [wedding, year]
  );
  const consultationYearly = useMemo(() => weddingConsultationByYear(wedding), [wedding]);

  // ===== Section 5 — 매출 목표 =====
  const targetTable = useMemo(
    () => buildTargetTable(events, reviews, targets, year),
    [events, reviews, targets, year]
  );

  // 카드 클릭 → 모달 열기
  function openMiceInflow(opts: {
    title: string;
    bound: { start: number; end: number };
    status?: MiceInquiryStatus;
  }) {
    setInflow({
      open: true,
      mode: 'MICE',
      title: opts.title,
      miceRows: filterMiceInflows(mice, opts.bound, opts.status),
    });
  }
  function openWeddingInflow(opts: {
    title: string;
    bound: { start: number; end: number };
    status?: WeddingProgressStatus;
  }) {
    setInflow({
      open: true,
      mode: 'WEDDING',
      title: opts.title,
      weddingRows: filterWeddingInflows(wedding, opts.bound, opts.status),
    });
  }

  // 영업 목표 셀 변경 — admin only
  async function updateTargetCell(
    month: number,
    field: keyof SalesTarget,
    value: number | null
  ) {
    if (!admin) return;
    try {
      const res = await api.put<{ target: SalesTarget }>(
        `/api/sales-targets/${year}/${month}`,
        { [field]: value }
      );
      setTargets((prev) => {
        const idx = prev.findIndex((t) => t.year === year && t.month === month);
        if (idx === -1) return [...prev, res.target];
        const next = prev.slice();
        next[idx] = res.target;
        return next;
      });
    } catch (e) {
      alert('목표 저장 실패');
      console.error(e);
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">대시보드</h1>
        <div className="text-sm text-gray-400 py-12 text-center bg-white border rounded-lg">
          불러오는 중...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">대시보드</h1>
        <div className="flex items-center gap-2">
          <select
            className="input !py-1 !text-sm !w-auto"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[year - 2, year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <button onClick={load} className="btn-secondary !py-1.5 text-xs">
            새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      {/* ===== Section 1: MICE 신규 유입 현황 ===== */}
      <Section title="1. MICE 신규 유입 현황" subtitle="통화일자 또는 생성일시 기준">
        {miceSummary.today === 0 && (
          <div className="rounded-md p-3 mb-4 bg-red-50 border border-red-200 text-sm text-red-800">
            ⚠️ 오늘 MICE 신규유입이 <strong>0건</strong>입니다. 영업 활동을 점검해주세요.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <ClickableKpi
            label="오늘 신규유입"
            value={miceSummary.today}
            unit="건"
            highlight={miceSummary.today === 0 ? 'danger' : undefined}
            onClick={() =>
              openMiceInflow({ title: '오늘 MICE 신규유입', bound: todayBound() })
            }
          />
          <ClickableKpi
            label="이번 주 신규유입"
            value={miceSummary.thisWeek}
            unit="건"
            onClick={() =>
              openMiceInflow({ title: '이번 주 MICE 신규유입', bound: thisWeekBound() })
            }
          />
          <ClickableKpi
            label="이번 달 신규유입"
            value={miceSummary.thisMonth}
            unit="건"
            onClick={() =>
              openMiceInflow({ title: '이번 달 MICE 신규유입', bound: thisMonthBound() })
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <Card title="주간 상태별 카운트">
            <div className="grid grid-cols-5 gap-2">
              {(['INQ', 'TEN', 'DEF', 'LOS', '단순문의'] as MiceInquiryStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    openMiceInflow({
                      title: `이번 주 MICE 신규유입 — ${s}`,
                      bound: thisWeekBound(),
                      status: s,
                    })
                  }
                  className="p-2 rounded border bg-white hover:bg-gray-50 text-center"
                >
                  <div className="text-xs text-gray-500">{s}</div>
                  <div className="text-lg font-bold tabular-nums" style={{ color: MICE_STATUS_COLOR[s] }}>
                    {miceSummary.weekCounts[s]}
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card title="월간 상태별 카운트">
            <div className="grid grid-cols-5 gap-2">
              {(['INQ', 'TEN', 'DEF', 'LOS', '단순문의'] as MiceInquiryStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    openMiceInflow({
                      title: `이번 달 MICE 신규유입 — ${s}`,
                      bound: thisMonthBound(),
                      status: s,
                    })
                  }
                  className="p-2 rounded border bg-white hover:bg-gray-50 text-center"
                >
                  <div className="text-xs text-gray-500">{s}</div>
                  <div className="text-lg font-bold tabular-nums" style={{ color: MICE_STATUS_COLOR[s] }}>
                    {miceSummary.monthCounts[s]}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <RateCard label="월간 DEF 전환율" value={miceSummary.monthDefRate} color="text-green-700" />
          <RateCard label="월간 LOS 전환율" value={miceSummary.monthLosRate} color="text-red-700" />
          <RateCard label="월간 단순문의 비율" value={miceSummary.monthSimpleRate} color="text-gray-700" />
        </div>
      </Section>

      {/* ===== Section 2: WEDDING 신규 유입 현황 ===== */}
      <Section title="2. WEDDING 신규 유입 현황" subtitle="신규문의일자 기준">
        {weddingSummary.today === 0 && (
          <div className="rounded-md p-3 mb-4 bg-red-50 border border-red-200 text-sm text-red-800">
            ⚠️ 오늘 WEDDING 신규유입이 <strong>0건</strong>입니다.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <ClickableKpi
            label="오늘 신규유입"
            value={weddingSummary.today}
            unit="건"
            highlight={weddingSummary.today === 0 ? 'danger' : undefined}
            onClick={() =>
              openWeddingInflow({ title: '오늘 WEDDING 신규유입', bound: todayBound() })
            }
          />
          <ClickableKpi
            label="이번 주 신규유입"
            value={weddingSummary.thisWeek}
            unit="건"
            onClick={() =>
              openWeddingInflow({ title: '이번 주 WEDDING 신규유입', bound: thisWeekBound() })
            }
          />
          <ClickableKpi
            label="이번 달 신규유입"
            value={weddingSummary.thisMonth}
            unit="건"
            onClick={() =>
              openWeddingInflow({ title: '이번 달 WEDDING 신규유입', bound: thisMonthBound() })
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <Card title="주간 진행단계 (INQ/TEN/DEF/LOS)">
            <div className="grid grid-cols-4 gap-2">
              {(['INQ', 'TEN', 'DEF', 'LOS'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    openWeddingInflow({
                      title: `이번 주 WEDDING — ${s}`,
                      bound: thisWeekBound(),
                      status: s,
                    })
                  }
                  className="p-2 rounded border bg-white hover:bg-gray-50 text-center"
                >
                  <div className="text-xs text-gray-500">{s}</div>
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{ color: WEDDING_STATUS_COLOR[s] }}
                  >
                    {weddingSummary.weekCounts[s]}
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card title="월간 진행단계 (INQ/TEN/DEF/LOS)">
            <div className="grid grid-cols-4 gap-2">
              {(['INQ', 'TEN', 'DEF', 'LOS'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() =>
                    openWeddingInflow({
                      title: `이번 달 WEDDING — ${s}`,
                      bound: thisMonthBound(),
                      status: s,
                    })
                  }
                  className="p-2 rounded border bg-white hover:bg-gray-50 text-center"
                >
                  <div className="text-xs text-gray-500">{s}</div>
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{ color: WEDDING_STATUS_COLOR[s] }}
                  >
                    {weddingSummary.monthCounts[s]}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <RateCard
            label="월간 DEF 전환율"
            value={weddingSummary.monthDefRate}
            color="text-green-700"
          />
          <RateCard label="월간 LOS 전환율" value={weddingSummary.monthLosRate} color="text-red-700" />
        </div>
      </Section>

      {/* ===== Section 3: WEDDING 유입경로 현황 ===== */}
      <Section
        title="3. WEDDING 유입경로 현황"
        subtitle={`${year}년 신규문의 기준 · 유입경로별 DEF 전환 분석`}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <Card title="연도별 전체 신규문의">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="text-left pb-1">연도</th>
                  <th className="text-right pb-1">건수</th>
                </tr>
              </thead>
              <tbody>
                {yearlyTotals.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="text-center text-gray-400 py-4">데이터 없음</td>
                  </tr>
                ) : (
                  yearlyTotals.map((r) => (
                    <tr key={r.year} className="border-t">
                      <td className="py-1.5">{r.year}년</td>
                      <td className="py-1.5 text-right tabular-nums">{r.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          <Card title={`${year}년 유입경로별 (DEF 전환)`} className="md:col-span-2">
            <SourceTable rows={sourceBreakdown} />
          </Card>
        </div>

        <Card title={`${year}년 유입 세부경로 (마케팅 채널)`} className="mb-4">
          <SourceTable rows={sourceDetailBreakdown} />
        </Card>

        {sourceBreakdown.length > 0 && (
          <Card title={`${year}년 유입경로별 차트`}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={sourceBreakdown}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="#f1f5f9" />
                <XAxis dataKey="source" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="total" name="전체" fill="#94a3b8" />
                <Bar dataKey="def_count" name="DEF 전환" fill="#22c55e" />
                <Bar dataKey="los_count" name="LOS" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Section>

      {/* ===== Section 4: WEDDING 상담 현황 ===== */}
      <Section title="4. WEDDING 상담 현황" subtitle="희망상담일자 기준 · 상담 → DEF 전환율">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <Card title="연도별 상담 → DEF 전환">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="text-left pb-1">연도</th>
                  <th className="text-right pb-1">상담</th>
                  <th className="text-right pb-1">DEF</th>
                  <th className="text-right pb-1">전환율</th>
                </tr>
              </thead>
              <tbody>
                {consultationYearly.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-gray-400 py-4">데이터 없음</td>
                  </tr>
                ) : (
                  consultationYearly.map((r) => (
                    <tr key={r.year} className="border-t">
                      <td className="py-1.5">{r.year}년</td>
                      <td className="py-1.5 text-right tabular-nums">{r.consultation_count}</td>
                      <td className="py-1.5 text-right tabular-nums text-green-700">{r.def_count}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {fmtPct(r.conversion_rate)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>

          <Card title={`${year}년 월별 상담 → DEF 전환`} className="md:col-span-2">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={consultationMonthly.map((r) => ({
                  ...r,
                  monthLabel: `${r.month}월`,
                }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="#f1f5f9" />
                <XAxis dataKey="monthLabel" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Legend />
                <Bar dataKey="consultation_count" name="상담" fill="#3b82f6" />
                <Bar dataKey="def_count" name="DEF" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card title={`${year}년 월별 상담/DEF/전환율`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-700 text-xs">
                <tr>
                  <th className="px-2 py-1 text-left">월</th>
                  {consultationMonthly.map((r) => (
                    <th key={r.month} className="px-2 py-1 text-right">
                      {r.month}월
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="px-2 py-1 font-medium">상담</td>
                  {consultationMonthly.map((r) => (
                    <td key={r.month} className="px-2 py-1 text-right tabular-nums">
                      {r.consultation_count}
                    </td>
                  ))}
                </tr>
                <tr className="border-t">
                  <td className="px-2 py-1 font-medium">DEF</td>
                  {consultationMonthly.map((r) => (
                    <td key={r.month} className="px-2 py-1 text-right tabular-nums text-green-700">
                      {r.def_count}
                    </td>
                  ))}
                </tr>
                <tr className="border-t">
                  <td className="px-2 py-1 font-medium">전환율</td>
                  {consultationMonthly.map((r) => (
                    <td key={r.month} className="px-2 py-1 text-right tabular-nums">
                      {fmtPct(r.conversion_rate)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {/* ===== Section 5: SALES 통합 목표 매출 달성 ===== */}
      <Section
        title="5. SALES 통합 목표 매출 달성 현황"
        subtitle={`${year}년 · ${admin ? 'Forecasting 셀을 직접 입력 가능' : '관리자만 Forecasting 수정 가능'}`}
      >
        <TargetTable
          year={year}
          months={targetTable.months}
          quarters={targetTable.quarters}
          total={targetTable.total}
          editable={admin}
          onUpdate={updateTargetCell}
        />
      </Section>

      <InflowListModal
        open={inflow.open}
        onClose={() => setInflow((p) => ({ ...p, open: false }))}
        mode={inflow.mode}
        title={inflow.title}
        miceRows={inflow.miceRows}
        weddingRows={inflow.weddingRows}
      />
    </div>
  );
}

// ============================================================
// 보조 컴포넌트
// ============================================================

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3 border-b pb-2">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border rounded-lg shadow-sm ${className || ''}`}>
      <div className="px-4 py-2 border-b text-sm font-semibold text-gray-700">{title}</div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function ClickableKpi({
  label,
  value,
  unit,
  highlight,
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: 'danger';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-lg p-4 text-left transition border ' +
        (highlight === 'danger'
          ? 'bg-red-50 border-red-300 text-red-900 hover:bg-red-100'
          : 'bg-white border-gray-200 hover:border-blue-400 hover:bg-blue-50')
      }
    >
      <div className="text-xs opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">
        {fmtNum(value)}
        <span className="text-sm font-normal opacity-70 ml-1">{unit}</span>
      </div>
      <div className="text-[11px] opacity-60 mt-0.5">클릭 → 리스트 보기</div>
    </button>
  );
}

function RateCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-1 ${color}`}>{fmtPct(value)}</div>
    </div>
  );
}

function SourceTable({
  rows,
}: {
  rows: Array<{
    source: string;
    total: number;
    def_count: number;
    los_count: number;
    def_rate: number | null;
    los_rate: number | null;
  }>;
}) {
  if (rows.length === 0) {
    return <div className="text-xs text-gray-400 py-3 text-center">데이터 없음</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-gray-500">
        <tr>
          <th className="text-left pb-1">유입경로</th>
          <th className="text-right pb-1">전체</th>
          <th className="text-right pb-1">DEF</th>
          <th className="text-right pb-1">DEF율</th>
          <th className="text-right pb-1">LOS</th>
          <th className="text-right pb-1">LOS율</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.source} className="border-t">
            <td className="py-1.5">{r.source}</td>
            <td className="py-1.5 text-right tabular-nums">{r.total}</td>
            <td className="py-1.5 text-right tabular-nums text-green-700">{r.def_count}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtPct(r.def_rate)}</td>
            <td className="py-1.5 text-right tabular-nums text-red-700">{r.los_count}</td>
            <td className="py-1.5 text-right tabular-nums">{fmtPct(r.los_rate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================
// 매출 목표 표 — Section 5
// ============================================================

interface TargetTableProps {
  year: number;
  months: TargetRow[];
  quarters: TargetRow[];
  total: TargetRow;
  editable: boolean;
  onUpdate: (month: number, field: keyof SalesTarget, value: number | null) => void;
}

function TargetTable({ year, months, quarters, total, editable, onUpdate }: TargetTableProps) {
  const [tab, setTab] = useState<'count' | 'revenue'>('revenue');

  function rowLabel(monthVal: number): string {
    if (monthVal >= 101 && monthVal <= 104) return `${monthVal - 100}분기`;
    if (monthVal === 999) return `${year} 합계`;
    return `${monthVal}월`;
  }

  function renderCell(
    row: TargetRow,
    field: keyof TargetRow,
    targetField: keyof SalesTarget | null,
    isMoney: boolean,
    readOnly: boolean
  ) {
    const value = row[field] as number | null;
    const display = value == null ? '-' : isMoney ? fmtMoney(value) : fmtNum(value);
    const isAggregate = row.month >= 101;
    if (readOnly || isAggregate || !editable || !targetField) {
      return (
        <span className={readOnly ? 'text-gray-700' : 'text-gray-500'}>{display}</span>
      );
    }
    return (
      <EditableNumberCell
        value={value}
        isMoney={isMoney}
        onCommit={(v) => onUpdate(row.month, targetField, v)}
      />
    );
  }

  // 행사건수 테이블 / 매출액 테이블 두 개 — 탭으로 전환
  return (
    <div>
      <div className="flex border-b mb-3">
        <button
          type="button"
          onClick={() => setTab('count')}
          className={
            'px-4 py-1.5 text-sm font-medium border-b-2 -mb-px ' +
            (tab === 'count'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-600 hover:text-gray-900')
          }
        >
          행사건수 목표/실적
        </button>
        <button
          type="button"
          onClick={() => setTab('revenue')}
          className={
            'px-4 py-1.5 text-sm font-medium border-b-2 -mb-px ' +
            (tab === 'revenue'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-gray-600 hover:text-gray-900')
          }
        >
          매출액 Forecasting / Actual / 달성률
        </button>
      </div>

      <div className="overflow-x-auto">
        {tab === 'count' ? (
          <table className="w-full text-sm border">
            <thead className="bg-gray-50 text-xs text-gray-700">
              <tr>
                <th rowSpan={2} className="border px-2 py-1 text-left">기간</th>
                <th colSpan={2} className="border px-2 py-1 bg-pink-50">Wedding 행사건수</th>
                <th colSpan={2} className="border px-2 py-1 bg-blue-50">MICE 행사건수</th>
                <th colSpan={2} className="border px-2 py-1 bg-emerald-50">Total 행사건수</th>
              </tr>
              <tr>
                <th className="border px-2 py-1 bg-pink-50">Actual</th>
                <th className="border px-2 py-1 bg-pink-50">Forecast</th>
                <th className="border px-2 py-1 bg-blue-50">Actual</th>
                <th className="border px-2 py-1 bg-blue-50">Forecast</th>
                <th className="border px-2 py-1 bg-emerald-50">Actual</th>
                <th className="border px-2 py-1 bg-emerald-50">Forecast</th>
              </tr>
            </thead>
            <tbody>
              {months.map((r) => (
                <CountRow key={r.month} row={r} label={rowLabel(r.month)} renderCell={renderCell} />
              ))}
              {quarters.map((r) => (
                <CountRow
                  key={r.month}
                  row={r}
                  label={rowLabel(r.month)}
                  renderCell={renderCell}
                  bold
                />
              ))}
              <CountRow row={total} label={rowLabel(total.month)} renderCell={renderCell} bold highlight />
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm border whitespace-nowrap">
            <thead className="bg-gray-50 text-xs text-gray-700">
              <tr>
                <th rowSpan={2} className="border px-2 py-1 text-left">기간</th>
                <th colSpan={2} className="border px-2 py-1 bg-pink-50">Wedding 매출</th>
                <th colSpan={2} className="border px-2 py-1 bg-blue-50">MICE 매출</th>
                <th colSpan={3} className="border px-2 py-1 bg-emerald-50">Total 매출</th>
              </tr>
              <tr>
                <th className="border px-2 py-1 bg-pink-50">Forecast</th>
                <th className="border px-2 py-1 bg-pink-50">Actual</th>
                <th className="border px-2 py-1 bg-blue-50">Forecast</th>
                <th className="border px-2 py-1 bg-blue-50">Actual</th>
                <th className="border px-2 py-1 bg-emerald-50">Forecast</th>
                <th className="border px-2 py-1 bg-emerald-50">Actual</th>
                <th className="border px-2 py-1 bg-emerald-50">달성률</th>
              </tr>
            </thead>
            <tbody>
              {months.map((r) => (
                <RevenueRow
                  key={r.month}
                  row={r}
                  label={rowLabel(r.month)}
                  renderCell={renderCell}
                />
              ))}
              {quarters.map((r) => (
                <RevenueRow
                  key={r.month}
                  row={r}
                  label={rowLabel(r.month)}
                  renderCell={renderCell}
                  bold
                />
              ))}
              <RevenueRow
                row={total}
                label={rowLabel(total.month)}
                renderCell={renderCell}
                bold
                highlight
              />
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  row: TargetRow;
  label: string;
  renderCell: (
    row: TargetRow,
    field: keyof TargetRow,
    targetField: keyof SalesTarget | null,
    isMoney: boolean,
    readOnly: boolean
  ) => React.ReactNode;
  bold?: boolean;
  highlight?: boolean;
}

function CountRow({ row, label, renderCell, bold, highlight }: RowProps) {
  const cls =
    'border-t' +
    (highlight ? ' bg-emerald-50 font-bold' : bold ? ' bg-gray-50 font-semibold' : '');
  return (
    <tr className={cls}>
      <td className="border px-2 py-1">{label}</td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'wedding_actual', null, false, true)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'wedding_forecast', 'wedding_event_count_forecast', false, false)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'mice_actual', null, false, true)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'mice_forecast', 'mice_event_count_forecast', false, false)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'total_actual', null, false, true)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'total_forecast', 'total_event_count_forecast', false, false)}
      </td>
    </tr>
  );
}

function RevenueRow({ row, label, renderCell, bold, highlight }: RowProps) {
  const cls =
    'border-t' +
    (highlight ? ' bg-emerald-50 font-bold' : bold ? ' bg-gray-50 font-semibold' : '');
  return (
    <tr className={cls}>
      <td className="border px-2 py-1">{label}</td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'wedding_revenue_forecast', 'wedding_revenue_forecast', true, false)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'wedding_revenue_actual', null, true, true)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'mice_revenue_forecast', 'mice_revenue_forecast', true, false)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'mice_revenue_actual', null, true, true)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'total_revenue_forecast', 'total_revenue_forecast', true, false)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">
        {renderCell(row, 'total_revenue_actual', null, true, true)}
      </td>
      <td className="border px-2 py-1 text-right tabular-nums">{fmtPct(row.total_revenue_achievement)}</td>
    </tr>
  );
}

// 인라인 숫자 셀 — blur 또는 Enter 시 commit
function EditableNumberCell({
  value,
  isMoney,
  onCommit,
}: {
  value: number | null;
  isMoney: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string>(
    value == null ? '' : isMoney ? formatKoreanCommas(String(value)) : String(value)
  );

  // value prop이 외부에서 바뀌면 동기화
  useEffect(() => {
    setDraft(value == null ? '' : isMoney ? formatKoreanCommas(String(value)) : String(value));
  }, [value, isMoney]);

  function commit() {
    const digits = draft.replace(/[^\d]/g, '');
    const num = digits ? Number(digits) : null;
    if (num !== value) onCommit(num);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft}
      placeholder="-"
      onChange={(e) => {
        const formatted = isMoney ? formatKoreanCommas(e.target.value) : e.target.value.replace(/[^\d]/g, '');
        setDraft(formatted);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="w-full text-right bg-transparent border-b border-dashed border-gray-300 focus:border-blue-500 focus:outline-none text-sm tabular-nums"
    />
  );
}
