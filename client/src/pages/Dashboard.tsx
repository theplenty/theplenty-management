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
import { BeverageAlertBanner, BeverageRevenueCard } from '../components/BeverageWidgets';
import { useActiveUsers } from '../lib/useActiveUsers';
import SalesDashboard from '../components/SalesDashboard';
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
  weddingKeywordBreakdown,
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

// ============================================================
// NVIDIA 디자인 토큰 — 본 페이지에만 적용 (다른 페이지 영향 없음)
// ============================================================
const NV = {
  primary: '#76b900',
  primaryDark: '#5a8d00',
  canvas: '#ffffff',
  surfaceSoft: '#f7f7f7',
  surfaceDark: '#000000',
  surfaceElevated: '#1a1a1a',
  hairline: '#cccccc',
  hairlineStrong: '#5e5e5e',
  ink: '#000000',
  body: '#1a1a1a',
  mute: '#757575',
  stone: '#898989',
  ash: '#a7a7a7',
  onDark: '#ffffff',
  onDarkMute: 'rgba(255,255,255,0.7)',
  error: '#e52020',
  warning: '#df6500',
  warningBright: '#ef9100',
  successDeep: '#3f8500',
};

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

// 상태별 색상 — 기능적 시그널(빨강/노랑/초록)은 유지하되 NVIDIA 팔레트로 정렬
const MICE_STATUS_COLOR: Record<string, string> = {
  문의: NV.ash,
  DEF: NV.primary,
  LOS: NV.error,
};

const WEDDING_STATUS_COLOR: Record<string, string> = {
  INQ: NV.stone,
  DEF: NV.primary,
  LOS: NV.error,
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
  const activeUsers = useActiveUsers();

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

  // 연도 선택지 — 데이터가 있는 가장 이른 연도부터 내년까지 (2027 준비 + 과거 데이터 조회)
  const yearOptions = useMemo(() => {
    const nowY = new Date().getFullYear();
    const minY = yearlyTotals.length
      ? Math.min(yearlyTotals[0].year, nowY - 2)
      : nowY - 2;
    const out: number[] = [];
    for (let y = minY; y <= nowY + 1; y++) out.push(y);
    return out;
  }, [yearlyTotals]);
  const sourceBreakdown = useMemo(
    () => weddingSourceBreakdown(wedding, year, false),
    [wedding, year]
  );
  const sourceDetailBreakdown = useMemo(
    () => weddingSourceBreakdown(wedding, year, true),
    [wedding, year]
  );
  const keywordBreakdown = useMemo(
    () => weddingKeywordBreakdown(wedding, year),
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
      <div style={{ fontFamily: "'Inter', Arial, Helvetica, sans-serif" }}>
        <HeroHeader year={year} setYear={setYear} years={yearOptions} onRefresh={load} />
        <div
          className="mt-12 py-16 text-center"
          style={{
            background: NV.canvas,
            border: `1px solid ${NV.hairline}`,
            borderRadius: 2,
            color: NV.mute,
            fontSize: 14,
          }}
        >
          불러오는 중...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ fontFamily: "'Inter', Arial, Helvetica, sans-serif", color: NV.ink }}
      className="space-y-16"
    >
      <HeroHeader year={year} setYear={setYear} years={yearOptions} onRefresh={load} />

      {error && (
        <div
          className="px-4 py-3 text-sm"
          style={{
            color: NV.error,
            background: '#fef2f2',
            border: `1px solid ${NV.error}`,
            borderRadius: 2,
          }}
        >
          {error}
        </div>
      )}

      {/* ③ 주류없는 달 조기경보 — 상단 배너 */}
      <BeverageAlertBanner events={events} />

      {/* ===== Sections 1+2: 세일즈 중심 대시보드 (유입→전환 추적) ===== */}
      <SalesDashboard
        miceCustomers={mice}
        weddingCustomers={wedding}
        activeUsers={activeUsers}
      />

      {/* ② 월별 주류매출 카드 */}
      <Section eyebrow="03 / Beverage" title="월별 주류매출" subtitle="고마진(~90%) 항목 · 매출관리 파일 기준 · 전월 대비 추적">
        <BeverageRevenueCard events={events} canEdit={admin} />
      </Section>

      {/* ===== Section 1 (LEGACY): MICE 신규 유입 현황 ===== */}
      {false && (
      <>
      {/* ===== Section 1: MICE 신규 유입 현황 ===== */}
      <Section eyebrow="01 / Inflow" title="MICE 신규 유입 현황" subtitle="통화일자 또는 생성일시 기준">
        {miceSummary.today === 0 && <DangerBanner>오늘 MICE 신규유입이 <strong>0건</strong>입니다. 영업 활동을 점검해주세요.</DangerBanner>}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-6">
          <ClickableKpi
            label="오늘 신규유입"
            value={miceSummary.today}
            unit="건"
            highlight={miceSummary.today === 0 ? 'danger' : undefined}
            onClick={() => openMiceInflow({ title: '오늘 MICE 신규유입', bound: todayBound() })}
          />
          <ClickableKpi
            label="이번 주 신규유입"
            value={miceSummary.thisWeek}
            unit="건"
            onClick={() => openMiceInflow({ title: '이번 주 MICE 신규유입', bound: thisWeekBound() })}
          />
          <ClickableKpi
            label="이번 달 신규유입"
            value={miceSummary.thisMonth}
            unit="건"
            onClick={() => openMiceInflow({ title: '이번 달 MICE 신규유입', bound: thisMonthBound() })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <Card title="주간 상태별 카운트">
            <StatusCounterGrid
              statuses={['문의', 'DEF', 'LOS']}
              colorMap={MICE_STATUS_COLOR}
              counts={miceSummary.weekCounts as unknown as Record<string, number>}
              onClick={(s) =>
                openMiceInflow({
                  title: `이번 주 MICE 신규유입 — ${s}`,
                  bound: thisWeekBound(),
                  status: s as MiceInquiryStatus,
                })
              }
            />
          </Card>
          <Card title="월간 상태별 카운트">
            <StatusCounterGrid
              statuses={['문의', 'DEF', 'LOS']}
              colorMap={MICE_STATUS_COLOR}
              counts={miceSummary.monthCounts as unknown as Record<string, number>}
              onClick={(s) =>
                openMiceInflow({
                  title: `이번 달 MICE 신규유입 — ${s}`,
                  bound: thisMonthBound(),
                  status: s as MiceInquiryStatus,
                })
              }
            />
          </Card>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <RateCard label="월간 DEF 전환율" value={miceSummary.monthDefRate} accent={NV.primary} />
          <RateCard label="월간 LOS 전환율" value={miceSummary.monthLosRate} accent={NV.error} />
          <RateCard label="월간 문의 비율" value={miceSummary.monthSimpleRate} accent={NV.mute} />
        </div>
      </Section>

      {/* ===== Section 2: WEDDING 신규 유입 현황 ===== */}
      <Section eyebrow="02 / Inflow" title="WEDDING 신규 유입 현황" subtitle="신규문의일자 기준">
        {weddingSummary.today === 0 && (
          <DangerBanner>오늘 WEDDING 신규유입이 <strong>0건</strong>입니다.</DangerBanner>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-6">
          <ClickableKpi
            label="오늘 신규유입"
            value={weddingSummary.today}
            unit="건"
            highlight={weddingSummary.today === 0 ? 'danger' : undefined}
            onClick={() => openWeddingInflow({ title: '오늘 WEDDING 신규유입', bound: todayBound() })}
          />
          <ClickableKpi
            label="이번 주 신규유입"
            value={weddingSummary.thisWeek}
            unit="건"
            onClick={() => openWeddingInflow({ title: '이번 주 WEDDING 신규유입', bound: thisWeekBound() })}
          />
          <ClickableKpi
            label="이번 달 신규유입"
            value={weddingSummary.thisMonth}
            unit="건"
            onClick={() => openWeddingInflow({ title: '이번 달 WEDDING 신규유입', bound: thisMonthBound() })}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <Card title="주간 진행단계 (INQ/DEF/LOS)">
            <StatusCounterGrid
              statuses={['INQ', 'DEF', 'LOS']}
              colorMap={WEDDING_STATUS_COLOR}
              counts={weddingSummary.weekCounts as unknown as Record<string, number>}
              onClick={(s) =>
                openWeddingInflow({
                  title: `이번 주 WEDDING — ${s}`,
                  bound: thisWeekBound(),
                  status: s as WeddingProgressStatus,
                })
              }
            />
          </Card>
          <Card title="월간 진행단계 (INQ/DEF/LOS)">
            <StatusCounterGrid
              statuses={['INQ', 'DEF', 'LOS']}
              colorMap={WEDDING_STATUS_COLOR}
              counts={weddingSummary.monthCounts as unknown as Record<string, number>}
              onClick={(s) =>
                openWeddingInflow({
                  title: `이번 달 WEDDING — ${s}`,
                  bound: thisMonthBound(),
                  status: s as WeddingProgressStatus,
                })
              }
            />
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <RateCard label="월간 DEF 전환율" value={weddingSummary.monthDefRate} accent={NV.primary} />
          <RateCard label="월간 LOS 전환율" value={weddingSummary.monthLosRate} accent={NV.error} />
        </div>
      </Section>
      </>
      )}

      {/* ===== Section 3: WEDDING 유입경로 현황 ===== */}
      <Section
        eyebrow="03 / Sources"
        title="WEDDING 유입경로 현황"
        subtitle={`${year}년 신규문의 기준 · 유입경로별 DEF 전환 분석`}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card title="연도별 전체 신규문의">
            <SimpleTable
              head={['연도', '건수']}
              rightAlign={[false, true]}
              rows={yearlyTotals.map((r) => [`${r.year}년`, r.total])}
              empty="데이터 없음"
            />
          </Card>

          <Card title={`${year}년 유입경로별 (DEF 전환)`} className="md:col-span-2">
            <SourceTable rows={sourceBreakdown} />
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card title={`${year}년 유입 세부경로 (마케팅 채널)`}>
            <SourceTable rows={sourceDetailBreakdown} />
          </Card>
          <Card title={`${year}년 검색어 유입 현황`}>
            <SourceTable rows={keywordBreakdown} firstColLabel="검색어" />
          </Card>
        </div>

        {sourceBreakdown.length > 0 && (
          <Card title={`${year}년 유입경로별 차트`}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={sourceBreakdown}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke={NV.hairline} strokeDasharray="2 2" />
                <XAxis dataKey="source" fontSize={11} stroke={NV.mute} />
                <YAxis allowDecimals={false} fontSize={11} stroke={NV.mute} />
                <Tooltip
                  contentStyle={{
                    background: NV.canvas,
                    border: `1px solid ${NV.hairline}`,
                    borderRadius: 2,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" name="전체" fill={NV.stone} />
                <Bar dataKey="def_count" name="DEF 전환" fill={NV.primary} />
                <Bar dataKey="los_count" name="LOS" fill={NV.error} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Section>

      {/* ===== Section 4: WEDDING 상담 현황 ===== */}
      <Section eyebrow="04 / Consultations" title="WEDDING 상담 현황" subtitle="희망상담일자 기준 · 상담 → DEF 전환율">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card title="연도별 상담 → DEF 전환">
            <SimpleTable
              head={['연도', '상담', 'DEF', '전환율']}
              rightAlign={[false, true, true, true]}
              rows={consultationYearly.map((r) => [
                `${r.year}년`,
                r.consultation_count,
                <span key="def" style={{ color: NV.primary, fontWeight: 700 }}>{r.def_count}</span>,
                fmtPct(r.conversion_rate),
              ])}
              empty="데이터 없음"
            />
          </Card>

          <Card title={`${year}년 월별 상담 → DEF 전환`} className="md:col-span-2">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={consultationMonthly.map((r) => ({ ...r, monthLabel: `${r.month}월` }))}
                margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke={NV.hairline} strokeDasharray="2 2" />
                <XAxis dataKey="monthLabel" fontSize={11} stroke={NV.mute} />
                <YAxis allowDecimals={false} fontSize={11} stroke={NV.mute} />
                <Tooltip
                  contentStyle={{
                    background: NV.canvas,
                    border: `1px solid ${NV.hairline}`,
                    borderRadius: 2,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="consultation_count" name="상담" fill={NV.stone} />
                <Bar dataKey="def_count" name="DEF" fill={NV.primary} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <Card title={`${year}년 월별 상담/DEF/전환율`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
              <thead style={{ background: NV.surfaceSoft, color: NV.body }}>
                <tr>
                  <th
                    className="px-2 py-1.5 text-left text-xs font-bold uppercase tracking-wider"
                    style={{ borderBottom: `1px solid ${NV.hairline}` }}
                  >
                    월
                  </th>
                  {consultationMonthly.map((r) => (
                    <th
                      key={r.month}
                      className="px-2 py-1.5 text-right text-xs font-bold"
                      style={{ borderBottom: `1px solid ${NV.hairline}` }}
                    >
                      {r.month}월
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${NV.hairline}` }}>
                  <td className="px-2 py-1.5 font-bold">상담</td>
                  {consultationMonthly.map((r) => (
                    <td key={r.month} className="px-2 py-1.5 text-right tabular-nums">
                      {r.consultation_count}
                    </td>
                  ))}
                </tr>
                <tr style={{ borderBottom: `1px solid ${NV.hairline}` }}>
                  <td className="px-2 py-1.5 font-bold">DEF</td>
                  {consultationMonthly.map((r) => (
                    <td
                      key={r.month}
                      className="px-2 py-1.5 text-right tabular-nums font-bold"
                      style={{ color: NV.primary }}
                    >
                      {r.def_count}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-2 py-1.5 font-bold">전환율</td>
                  {consultationMonthly.map((r) => (
                    <td key={r.month} className="px-2 py-1.5 text-right tabular-nums">
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
        eyebrow="05 / Targets"
        title="SALES 통합 목표 매출 달성 현황"
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

// ============================================================
// NVIDIA-style 헤더 (hero chapter): 검정 캔버스 + 우측 그린 CTA + 코너 스퀘어
// ============================================================
function HeroHeader({
  year,
  setYear,
  years,
  onRefresh,
}: {
  year: number;
  setYear: (y: number) => void;
  years: number[];
  onRefresh: () => void;
}) {
  return (
    <div className="relative w-full border border-gray-200 rounded-lg bg-white px-6 py-5">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.144em] mb-2 text-emerald-600">
            Plenty Convention / Dashboard
          </div>
          <h2 className="text-2xl font-bold text-gray-900 leading-tight">📊 대시보드</h2>
          <p className="mt-1 text-sm text-gray-500">
            영업·연회 통합 운영 지표 · 신규 유입 / 상담 전환 / 매출 달성
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="appearance-none px-3 py-1.5 text-sm font-semibold border border-gray-300 rounded bg-white text-gray-800"
          >
            {years.map((y) => (
              <option key={y} value={y} style={{ color: NV.ink }}>
                {y}년
              </option>
            ))}
          </select>
          <button
            onClick={onRefresh}
            className="px-4 py-1.5 text-sm font-semibold rounded bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer border-0"
          >
            새로고침 →
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-6">
        {eyebrow && (
          <div
            className="text-[11px] font-bold uppercase tracking-[0.144em] mb-2"
            style={{ color: NV.primary }}
          >
            {eyebrow}
          </div>
        )}
        <h2 className="font-bold leading-tight" style={{ fontSize: 24, color: NV.ink }}>
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: NV.mute, lineHeight: 1.5 }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Card({
  title,
  children,
  className,
  cornerSquare = true,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  cornerSquare?: boolean;
}) {
  return (
    <div
      className={`relative ${className || ''}`}
      style={{
        background: NV.canvas,
        border: `1px solid ${NV.hairline}`,
        borderRadius: 2,
      }}
    >
      {cornerSquare && (
        <span
          aria-hidden
          className="absolute"
          style={{ width: 12, height: 12, background: NV.primary, top: 0, left: 0 }}
        />
      )}
      <div
        className="px-6 py-3"
        style={{ borderBottom: `1px solid ${NV.hairline}`, color: NV.body }}
      >
        <div className="text-[17px] font-bold leading-tight">{title}</div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function DangerBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-4 py-3 mb-6 text-sm font-bold"
      style={{
        color: NV.error,
        background: '#fef2f2',
        border: `1px solid ${NV.error}`,
        borderRadius: 2,
      }}
    >
      ⚠️ {children}
    </div>
  );
}

// 큰 KPI — 36px 굵은 NVIDIA 그린 숫자, 코너 스퀘어, 하단 ghost-link 화살표
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
  const isDanger = highlight === 'danger';
  return (
    <button
      onClick={onClick}
      className="relative text-left w-full"
      style={{
        background: NV.canvas,
        border: `1px solid ${isDanger ? NV.error : NV.hairline}`,
        borderRadius: 2,
        padding: '24px',
        cursor: 'pointer',
        transition: 'border-color 120ms',
      }}
      onMouseEnter={(e) => {
        if (!isDanger) e.currentTarget.style.borderColor = NV.primary;
      }}
      onMouseLeave={(e) => {
        if (!isDanger) e.currentTarget.style.borderColor = NV.hairline;
      }}
    >
      <span
        aria-hidden
        className="absolute"
        style={{
          width: 12,
          height: 12,
          background: isDanger ? NV.error : NV.primary,
          top: 0,
          left: 0,
        }}
      />
      <div
        className="text-[11px] font-bold uppercase tracking-[0.144em]"
        style={{ color: NV.mute }}
      >
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className="font-bold tabular-nums leading-none"
          style={{ fontSize: 48, color: isDanger ? NV.error : NV.primary }}
        >
          {fmtNum(value)}
        </span>
        <span className="text-base font-normal" style={{ color: NV.mute }}>
          {unit}
        </span>
      </div>
      <div
        className="mt-4 text-[14.4px] font-bold uppercase tracking-[0.144em] inline-flex items-center gap-1.5"
        style={{ color: isDanger ? NV.error : NV.primary }}
      >
        리스트 보기 →
      </div>
    </button>
  );
}

function RateCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent: string;
}) {
  return (
    <div
      className="relative"
      style={{
        background: NV.canvas,
        border: `1px solid ${NV.hairline}`,
        borderRadius: 2,
        padding: '24px',
      }}
    >
      <div
        className="text-[11px] font-bold uppercase tracking-[0.144em]"
        style={{ color: NV.mute }}
      >
        {label}
      </div>
      <div
        className="mt-2 font-bold tabular-nums leading-none"
        style={{ fontSize: 36, color: accent }}
      >
        {fmtPct(value)}
      </div>
    </div>
  );
}

// 상태별 카운터 (INQ/TEN/DEF/LOS/...) — 5분할 또는 4분할 그리드
function StatusCounterGrid({
  statuses,
  colorMap,
  counts,
  onClick,
}: {
  statuses: string[];
  colorMap: Record<string, string>;
  counts: Record<string, number>;
  onClick: (status: string) => void;
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }}
    >
      {statuses.map((s) => (
        <button
          key={s}
          onClick={() => onClick(s)}
          className="text-center"
          style={{
            background: NV.surfaceSoft,
            border: `1px solid ${NV.hairline}`,
            borderRadius: 2,
            padding: '12px 8px',
            cursor: 'pointer',
            transition: 'border-color 120ms',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = NV.ink)}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = NV.hairline)}
        >
          <div
            className="text-[11px] font-bold uppercase tracking-[0.144em]"
            style={{ color: NV.mute }}
          >
            {s}
          </div>
          <div
            className="mt-1 text-2xl font-bold tabular-nums leading-tight"
            style={{ color: colorMap[s] }}
          >
            {counts[s] ?? 0}
          </div>
        </button>
      ))}
    </div>
  );
}

// 간단한 read-only 표 (연도별 합계 등)
function SimpleTable({
  head,
  rows,
  rightAlign,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  rightAlign: boolean[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-xs py-4 text-center" style={{ color: NV.ash }}>
        {empty}
      </div>
    );
  }
  return (
    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              className={
                'pb-2 text-[11px] font-bold uppercase tracking-[0.144em] ' +
                (rightAlign[i] ? 'text-right' : 'text-left')
              }
              style={{ color: NV.mute, borderBottom: `1px solid ${NV.hairline}` }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} style={{ borderBottom: `1px solid ${NV.hairline}` }}>
            {row.map((cell, ci) => (
              <td
                key={ci}
                className={'py-2 tabular-nums ' + (rightAlign[ci] ? 'text-right' : 'text-left')}
                style={{ color: NV.body }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceTable({
  rows,
  firstColLabel = '유입경로',
}: {
  rows: Array<{
    source: string;
    total: number;
    def_count: number;
    los_count: number;
    def_rate: number | null;
    los_rate: number | null;
  }>;
  firstColLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-xs py-4 text-center" style={{ color: NV.ash }}>
        데이터 없음
      </div>
    );
  }
  const head = [firstColLabel, '전체', 'DEF', 'DEF율', 'LOS', 'LOS율'];
  return (
    <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              className={
                'pb-2 text-[11px] font-bold uppercase tracking-[0.144em] ' +
                (i === 0 ? 'text-left' : 'text-right')
              }
              style={{ color: NV.mute, borderBottom: `1px solid ${NV.hairline}` }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.source} style={{ borderBottom: `1px solid ${NV.hairline}` }}>
            <td className="py-2" style={{ color: NV.body }}>
              {r.source}
            </td>
            <td className="py-2 text-right tabular-nums" style={{ color: NV.body }}>
              {r.total}
            </td>
            <td
              className="py-2 text-right tabular-nums font-bold"
              style={{ color: NV.primary }}
            >
              {r.def_count}
            </td>
            <td className="py-2 text-right tabular-nums" style={{ color: NV.body }}>
              {fmtPct(r.def_rate)}
            </td>
            <td className="py-2 text-right tabular-nums" style={{ color: NV.error }}>
              {r.los_count}
            </td>
            <td className="py-2 text-right tabular-nums" style={{ color: NV.body }}>
              {fmtPct(r.los_rate)}
            </td>
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
      <div className="flex gap-2 mb-4">
        <PillTab active={tab === 'count'} onClick={() => setTab('count')}>
          행사건수 목표/실적
        </PillTab>
        <PillTab active={tab === 'revenue'} onClick={() => setTab('revenue')}>
          매출액 Forecasting / Actual / 달성률
        </PillTab>
      </div>

      <div className="overflow-x-auto" style={{ border: `1px solid ${NV.hairline}`, borderRadius: 2 }}>
        {tab === 'count' ? (
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: NV.surfaceSoft }}>
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  기간
                </th>
                <th colSpan={2} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  Wedding 행사건수
                </th>
                <th colSpan={2} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  MICE 행사건수
                </th>
                <th colSpan={2} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  Total 행사건수
                </th>
              </tr>
              <tr>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Actual</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Forecast</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Actual</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Forecast</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Actual</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Forecast</th>
              </tr>
            </thead>
            <tbody>
              {months.map((r) => (
                <CountRow key={r.month} row={r} label={rowLabel(r.month)} renderCell={renderCell} />
              ))}
              {quarters.map((r) => (
                <CountRow key={r.month} row={r} label={rowLabel(r.month)} renderCell={renderCell} bold />
              ))}
              <CountRow row={total} label={rowLabel(total.month)} renderCell={renderCell} bold highlight />
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm whitespace-nowrap" style={{ borderCollapse: 'collapse' }}>
            <thead style={{ background: NV.surfaceSoft }}>
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  기간
                </th>
                <th colSpan={2} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  Wedding 매출
                </th>
                <th colSpan={2} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  MICE 매출
                </th>
                <th colSpan={3} className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider" style={thBorder()}>
                  Total 매출
                </th>
              </tr>
              <tr>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Forecast</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Actual</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Forecast</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Actual</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Forecast</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>Actual</th>
                <th className="px-3 py-2 text-xs font-bold" style={thBorder()}>달성률</th>
              </tr>
            </thead>
            <tbody>
              {months.map((r) => (
                <RevenueRow key={r.month} row={r} label={rowLabel(r.month)} renderCell={renderCell} />
              ))}
              {quarters.map((r) => (
                <RevenueRow key={r.month} row={r} label={rowLabel(r.month)} renderCell={renderCell} bold />
              ))}
              <RevenueRow row={total} label={rowLabel(total.month)} renderCell={renderCell} bold highlight />
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// pill-tab — 비활성: 투명 + 검정, 활성: 검정 배경 + 흰글씨 (NVIDIA inversion)
function PillTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-bold uppercase tracking-[0.144em]"
      style={{
        fontSize: 14.4,
        padding: '10px 18px',
        background: active ? NV.ink : 'transparent',
        color: active ? NV.onDark : NV.ink,
        border: `1px solid ${active ? NV.ink : NV.hairline}`,
        borderRadius: 2,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function thBorder(): React.CSSProperties {
  return { border: `1px solid ${NV.hairline}`, color: NV.body };
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

function rowStyle(bold: boolean, highlight: boolean): React.CSSProperties {
  if (highlight) return { background: NV.ink, color: NV.onDark, fontWeight: 700 };
  if (bold) return { background: NV.surfaceSoft, fontWeight: 700 };
  return {};
}
function tdBorder(highlight: boolean): React.CSSProperties {
  return { border: `1px solid ${highlight ? NV.hairlineStrong : NV.hairline}` };
}

function CountRow({ row, label, renderCell, bold, highlight }: RowProps) {
  const hl = !!highlight;
  const bd = !!bold;
  return (
    <tr style={rowStyle(bd, hl)}>
      <td className="px-3 py-2" style={tdBorder(hl)}>{label}</td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'wedding_actual', null, false, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'wedding_forecast', 'wedding_event_count_forecast', false, false)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'mice_actual', null, false, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'mice_forecast', 'mice_event_count_forecast', false, false)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'total_actual', null, false, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'total_forecast', 'total_event_count_forecast', false, false)}
      </td>
    </tr>
  );
}

function RevenueRow({ row, label, renderCell, bold, highlight }: RowProps) {
  const hl = !!highlight;
  const bd = !!bold;
  return (
    <tr style={rowStyle(bd, hl)}>
      <td className="px-3 py-2" style={tdBorder(hl)}>{label}</td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'wedding_revenue_forecast', 'wedding_revenue_forecast', true, false)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'wedding_revenue_actual', null, true, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'mice_revenue_forecast', 'mice_revenue_forecast', true, false)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'mice_revenue_actual', null, true, true)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'total_revenue_forecast', 'total_revenue_forecast', true, false)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums" style={tdBorder(hl)}>
        {renderCell(row, 'total_revenue_actual', null, true, true)}
      </td>
      <td
        className="px-3 py-2 text-right tabular-nums font-bold"
        style={{ ...tdBorder(hl), color: hl ? NV.primary : NV.body }}
      >
        {fmtPct(row.total_revenue_achievement)}
      </td>
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
      className="w-full text-right bg-transparent text-sm tabular-nums focus:outline-none"
      style={{
        border: `1px dashed ${NV.hairline}`,
        borderRadius: 2,
        padding: '2px 4px',
        color: 'inherit',
      }}
      onFocus={(e) => {
        e.currentTarget.style.border = `2px solid ${NV.primary}`;
      }}
      onBlurCapture={(e) => {
        e.currentTarget.style.border = `1px dashed ${NV.hairline}`;
      }}
    />
  );
}
