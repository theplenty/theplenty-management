// 세일즈 중심 MICE / WEDDING 대시보드 섹션 — 유입 → 팔로업 → 전환 추적.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type MiceCustomer,
  type WeddingCustomer,
} from '../types';
import {
  computeMiceChannelMetrics,
  computeWeddingMetrics,
  customRange,
  type DateRange,
  findStaleIncalls,
  findRecentOutcalls,
  flattenMiceInquiries,
  computeManagerConversionRates,
  findScheduledConsultations,
  findCancelledConsultations,
  findStaleWedding,
  thisMonthRange,
  thisWeekRange,
  todayRange,
} from '../lib/salesDashboardStats';

type Period = 'today' | 'week' | 'month' | 'custom';

interface Props {
  miceCustomers: MiceCustomer[];
  weddingCustomers: WeddingCustomer[];
  activeUsers: Array<{ id: string; name: string }>;
}

export default function SalesDashboard({
  miceCustomers,
  weddingCustomers,
  activeUsers,
}: Props) {
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [managerId, setManagerId] = useState<string>('');

  const range = useMemo<DateRange | null>(() => {
    if (period === 'today') return todayRange();
    if (period === 'week') return thisWeekRange();
    if (period === 'month') return thisMonthRange();
    if (period === 'custom' && customFrom && customTo) return customRange(customFrom, customTo);
    return null;
  }, [period, customFrom, customTo]);

  // 주간/월간 KPI 는 항상 표시 (기간 필터와 별개)
  const week = useMemo(() => thisWeekRange(), []);
  const month = useMemo(() => thisMonthRange(), []);

  const miceFlat = useMemo(() => flattenMiceInquiries(miceCustomers), [miceCustomers]);

  // 주간/월간 채널별 카운트 — 항상 고정 (필터 무관)
  const miceWeekIncall = computeMiceChannelMetrics(miceFlat, 'INCALL', week, null);
  const miceWeekOutcall = computeMiceChannelMetrics(miceFlat, 'OUTCALL', week, null);
  const miceMonthIncall = computeMiceChannelMetrics(miceFlat, 'INCALL', month, null);
  const miceMonthOutcall = computeMiceChannelMetrics(miceFlat, 'OUTCALL', month, null);

  // 필터 적용 전환율 (관리자 + 기간 모두 반영)
  const miceFilteredIncall = useMemo(
    () => computeMiceChannelMetrics(miceFlat, 'INCALL', range, managerId || null),
    [miceFlat, range, managerId]
  );
  const miceFilteredOutcall = useMemo(
    () => computeMiceChannelMetrics(miceFlat, 'OUTCALL', range, managerId || null),
    [miceFlat, range, managerId]
  );

  // 미처리 인콜 리스트 — 전체 데이터 기준 (기간 무관, 누적된 방치 건)
  const stale3 = useMemo(() => findStaleIncalls(miceFlat, 3), [miceFlat]);
  const stale7 = useMemo(() => findStaleIncalls(miceFlat, 7), [miceFlat]);
  const recentOutcalls = useMemo(() => findRecentOutcalls(miceFlat, 10), [miceFlat]);
  const managerStats = useMemo(() => computeManagerConversionRates(miceFlat, null), [miceFlat]);

  // 웨딩
  const wedWeek = computeWeddingMetrics(weddingCustomers, week, null);
  const wedMonth = computeWeddingMetrics(weddingCustomers, month, null);
  const wedFiltered = useMemo(
    () => computeWeddingMetrics(weddingCustomers, range, managerId || null),
    [weddingCustomers, range, managerId]
  );
  const scheduled = useMemo(() => findScheduledConsultations(weddingCustomers), [weddingCustomers]);
  const cancelled = useMemo(() => findCancelledConsultations(weddingCustomers), [weddingCustomers]);
  const staleWed = useMemo(() => findStaleWedding(weddingCustomers, 14), [weddingCustomers]);

  return (
    <div className="space-y-6">
      {/* ===== 공통 필터 ===== */}
      <FilterBar
        period={period}
        onPeriodChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        managerId={managerId}
        onManagerChange={setManagerId}
        activeUsers={activeUsers}
      />

      {/* ========== MICE 세일즈 대시보드 ========== */}
      <section className="bg-white border rounded-lg p-4 md:p-6">
        <header className="flex items-baseline gap-3 mb-4 flex-wrap">
          <span className="text-xs text-gray-400 font-mono">01 / MICE</span>
          <h2 className="text-lg md:text-xl font-bold text-gray-900">MICE 세일즈</h2>
          <span className="text-xs text-gray-500">유입 → 팔로업 → INQ/DEF/LOS 전환</span>
        </header>

        {/* 상단 KPI 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
          <KpiCard label="금주 인콜" value={miceWeekIncall.total} accent="blue" />
          <KpiCard label="금주 아웃콜" value={miceWeekOutcall.total} accent="purple" />
          <KpiCard label="월간 인콜" value={miceMonthIncall.total} accent="blue" />
          <KpiCard label="월간 아웃콜" value={miceMonthOutcall.total} accent="purple" />
          <KpiCard
            label="미처리 인콜 (3일+)"
            value={stale3.length}
            accent={stale3.length > 0 ? 'red' : 'gray'}
            sub={stale7.length > 0 ? `7일+ ${stale7.length}건` : undefined}
          />
          <KpiCard
            label={`인콜 전환율${range ? '' : ' (전체)'}`}
            value={`${miceFilteredIncall.conversionRate.toFixed(1)}%`}
            sub={`${miceFilteredIncall.total}건 중 ${miceFilteredIncall.inq + miceFilteredIncall.def + miceFilteredIncall.los}건 전환`}
            accent="green"
          />
          <KpiCard
            label={`아웃콜 전환율${range ? '' : ' (전체)'}`}
            value={`${miceFilteredOutcall.conversionRate.toFixed(1)}%`}
            sub={`${miceFilteredOutcall.total}건 중 ${miceFilteredOutcall.inq + miceFilteredOutcall.def + miceFilteredOutcall.los}건 전환`}
            accent="green"
          />
        </div>

        {/* 퍼널 차트 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          <FunnelCard
            title="인콜 (📞) → 전환 흐름"
            total={miceFilteredIncall.total}
            stages={[
              { label: '미처리', value: miceFilteredIncall.unprocessed, color: 'bg-gray-300' },
              { label: 'INQ', value: miceFilteredIncall.inq, color: 'bg-blue-500' },
              { label: 'DEF', value: miceFilteredIncall.def, color: 'bg-emerald-500' },
              { label: 'LOS', value: miceFilteredIncall.los, color: 'bg-red-500' },
            ]}
          />
          <FunnelCard
            title="아웃콜 (📤) → 전환 흐름"
            total={miceFilteredOutcall.total}
            stages={[
              { label: '미처리', value: miceFilteredOutcall.unprocessed, color: 'bg-gray-300' },
              { label: 'INQ', value: miceFilteredOutcall.inq, color: 'bg-blue-500' },
              { label: 'DEF', value: miceFilteredOutcall.def, color: 'bg-emerald-500' },
              { label: 'LOS', value: miceFilteredOutcall.los, color: 'bg-red-500' },
            ]}
          />
        </div>

        {/* 리스트 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          <StaleIncallsCard items={stale3} />
          <RecentOutcallsCard items={recentOutcalls} />
        </div>

        {/* 담당자별 전환율 */}
        {managerStats.length > 0 && (
          <ManagerStatsCard items={managerStats} />
        )}
      </section>

      {/* ========== WEDDING 세일즈 대시보드 ========== */}
      <section className="bg-white border rounded-lg p-4 md:p-6">
        <header className="flex items-baseline gap-3 mb-4 flex-wrap">
          <span className="text-xs text-gray-400 font-mono">02 / WEDDING</span>
          <h2 className="text-lg md:text-xl font-bold text-gray-900">WEDDING 세일즈</h2>
          <span className="text-xs text-gray-500">인콜 → 상담 → INQ/DEF/LOS 전환</span>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
          <KpiCard label="금주 신규 인콜" value={wedWeek.totalInflow} accent="blue" />
          <KpiCard label="월간 신규 인콜" value={wedMonth.totalInflow} accent="blue" />
          <KpiCard label="상담 예약" value={wedFiltered.consultBooked} accent="purple" />
          <KpiCard label="상담 취소" value={wedFiltered.consultCancelled} accent="red" />
          <KpiCard
            label="상담 전환율"
            value={`${wedFiltered.consultConversionRate.toFixed(1)}%`}
            sub={`인콜 ${wedFiltered.totalInflow}건 기준`}
            accent="green"
          />
          <KpiCard label="DEF" value={wedFiltered.def} accent="emerald" />
          <KpiCard label="LOS" value={wedFiltered.los} accent="red" />
          <KpiCard
            label="장기 미전환"
            value={staleWed.length}
            accent={staleWed.length > 0 ? 'red' : 'gray'}
            sub="14일+ 신규문의/상담"
          />
        </div>

        <FunnelCard
          title="WEDDING 인콜 → 전환 흐름"
          total={wedFiltered.totalInflow}
          stages={[
            { label: '신규문의 방치', value: wedFiltered.newOnly, color: 'bg-gray-300' },
            { label: '상담', value: wedFiltered.consultBooked, color: 'bg-purple-500' },
            { label: '상담취소', value: wedFiltered.consultCancelled, color: 'bg-amber-400' },
            { label: 'INQ', value: wedFiltered.inq, color: 'bg-blue-500' },
            { label: 'DEF', value: wedFiltered.def, color: 'bg-emerald-500' },
            { label: 'LOS', value: wedFiltered.los, color: 'bg-red-500' },
          ]}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
          <ScheduledConsultsCard items={scheduled} />
          <CancelledConsultsCard items={cancelled} />
          <StaleWeddingCard items={staleWed} />
        </div>
      </section>
    </div>
  );
}

// ===== 공통 컴포넌트 =====

function FilterBar({
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  managerId,
  onManagerChange,
  activeUsers,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (s: string) => void;
  onCustomToChange: (s: string) => void;
  managerId: string;
  onManagerChange: (s: string) => void;
  activeUsers: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="bg-white border rounded-lg p-3 flex items-center gap-3 flex-wrap text-xs">
      <span className="text-gray-500 font-semibold">기간:</span>
      {(['today', 'week', 'month', 'custom'] as Period[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPeriodChange(p)}
          className={
            'px-2 py-1 rounded border ' +
            (period === p
              ? 'bg-gray-900 text-white border-gray-900'
              : 'bg-white border-gray-300 hover:bg-gray-50')
          }
        >
          {p === 'today' ? '오늘' : p === 'week' ? '금주' : p === 'month' ? '금월' : '직접 선택'}
        </button>
      ))}
      {period === 'custom' && (
        <>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFromChange(e.target.value)}
            className="input !py-1 !text-xs !w-auto"
          />
          <span className="text-gray-400">~</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomToChange(e.target.value)}
            className="input !py-1 !text-xs !w-auto"
          />
        </>
      )}
      <span className="text-gray-500 font-semibold ml-2">담당자:</span>
      <select
        value={managerId}
        onChange={(e) => onManagerChange(e.target.value)}
        className="input !py-1 !text-xs !w-auto"
      >
        <option value="">전체</option>
        {activeUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </div>
  );
}

type Accent = 'blue' | 'purple' | 'green' | 'red' | 'gray' | 'emerald';
const ACCENT_BG: Record<Accent, string> = {
  blue: 'bg-blue-50 text-blue-900 border-blue-200',
  purple: 'bg-purple-50 text-purple-900 border-purple-200',
  green: 'bg-green-50 text-green-900 border-green-200',
  red: 'bg-red-50 text-red-900 border-red-200',
  gray: 'bg-gray-50 text-gray-700 border-gray-200',
  emerald: 'bg-emerald-50 text-emerald-900 border-emerald-200',
};

function KpiCard({
  label,
  value,
  sub,
  accent = 'gray',
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div className={`border rounded-lg p-2.5 md:p-3 ${ACCENT_BG[accent]}`}>
      <div className="text-[11px] md:text-xs opacity-80 mb-1 truncate">{label}</div>
      <div className="text-xl md:text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] md:text-[11px] opacity-70 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function FunnelCard({
  title,
  total,
  stages,
}: {
  title: string;
  total: number;
  stages: Array<{ label: string; value: number; color: string }>;
}) {
  const max = Math.max(total, 1);
  return (
    <div className="border rounded-lg p-3 bg-gray-50/50">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">총 {total}건</span>
      </div>
      {total === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">기간 내 해당 채널의 유입이 없습니다.</div>
      ) : (
        <ul className="space-y-1.5">
          {stages.map((s) => {
            const pct = total > 0 ? (s.value / max) * 100 : 0;
            const sharePct = total > 0 ? (s.value / total) * 100 : 0;
            return (
              <li key={s.label} className="text-xs">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="w-20 text-gray-700 shrink-0">{s.label}</span>
                  <div className="flex-1 bg-white border rounded overflow-hidden h-5">
                    <div
                      className={`h-full ${s.color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-24 text-right tabular-nums text-gray-700 shrink-0">
                    {s.value}건 ({sharePct.toFixed(1)}%)
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StaleIncallsCard({ items }: { items: Array<{ inquiry: import('../types').MiceInquiry; customer: import('../types').MiceCustomer; ageDays: number }> }) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-red-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">
        🚨 미처리 인콜 ({items.length}건)
      </h3>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">미처리 인콜이 없습니다. 👍</div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.slice(0, 20).map((it) => (
            <li key={it.inquiry.id}>
              <button
                type="button"
                onClick={() => navigate(`/customer/mice/${it.customer.id}`)}
                className="w-full text-left p-2 rounded border bg-white hover:bg-red-50 text-xs"
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-semibold text-gray-900 truncate">
                    {it.customer.organization_name}
                  </span>
                  <span
                    className={
                      'badge text-[10px] shrink-0 ' +
                      (it.ageDays >= 7 ? 'bg-red-200 text-red-900' : 'bg-amber-200 text-amber-900')
                    }
                  >
                    {it.ageDays}일 경과
                  </span>
                </div>
                <div className="text-gray-500 truncate">
                  {it.inquiry.contacts[0]?.name || '담당자 미지정'} · {it.inquiry.assigned_manager_name || '담당 미지정'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentOutcallsCard({ items }: { items: Array<{ inquiry: import('../types').MiceInquiry; customer: import('../types').MiceCustomer }> }) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-purple-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">📤 최근 아웃콜 ({items.length}건)</h3>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">최근 아웃콜이 없습니다.</div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.map((it) => (
            <li key={it.inquiry.id}>
              <button
                type="button"
                onClick={() => navigate(`/customer/mice/${it.customer.id}`)}
                className="w-full text-left p-2 rounded border bg-white hover:bg-purple-50 text-xs"
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-semibold text-gray-900 truncate">
                    {it.customer.organization_name}
                  </span>
                  <span className="badge bg-gray-100 text-gray-700 text-[10px] shrink-0">
                    {it.inquiry.progress_status}
                  </span>
                </div>
                <div className="text-gray-500 truncate">
                  {it.inquiry.created_at.slice(0, 10)} · {it.inquiry.assigned_manager_name || '담당 미지정'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ManagerStatsCard({
  items,
}: {
  items: Array<{ id: string; name: string; total: number; converted: number; rate: number }>;
}) {
  return (
    <div className="border rounded-lg p-3">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">담당자별 전환율 (MICE 전체)</h3>
      <ul className="space-y-1.5">
        {items.map((m) => (
          <li key={m.id} className="grid grid-cols-12 gap-2 text-xs items-center">
            <span className="col-span-3 font-medium text-gray-900 truncate">{m.name}</span>
            <span className="col-span-2 text-gray-500 tabular-nums">{m.total}건</span>
            <div className="col-span-5 bg-gray-100 rounded h-3 overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${m.rate}%` }}
              />
            </div>
            <span className="col-span-2 text-right tabular-nums">
              {m.rate.toFixed(1)}% ({m.converted})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScheduledConsultsCard({ items }: { items: WeddingCustomer[] }) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-purple-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">📅 상담 예정 ({items.length}건)</h3>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">예정된 상담이 없습니다.</div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.slice(0, 15).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => navigate(`/customer/wedding/${c.id}`)}
                className="w-full text-left p-2 rounded border bg-white hover:bg-purple-50 text-xs"
              >
                <div className="font-semibold text-gray-900 truncate">{c.wedding_event_name || '(이름 없음)'}</div>
                <div className="text-gray-500 truncate">
                  {c.desired_consultation_date?.slice(0, 16).replace('T', ' ') || '날짜 미정'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CancelledConsultsCard({ items }: { items: WeddingCustomer[] }) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-amber-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">❌ 상담 취소 ({items.length}건)</h3>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">취소된 상담이 없습니다.</div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.slice(0, 15).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => navigate(`/customer/wedding/${c.id}`)}
                className="w-full text-left p-2 rounded border bg-white hover:bg-amber-50 text-xs"
              >
                <div className="font-semibold text-gray-900 truncate">{c.wedding_event_name || '(이름 없음)'}</div>
                <div className="text-gray-500 truncate">최종 수정 {c.updated_at.slice(0, 10)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaleWeddingCard({ items }: { items: Array<{ customer: WeddingCustomer; ageDays: number }> }) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-red-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">⏰ 장기 미전환 ({items.length}건)</h3>
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">장기 미전환 건이 없습니다. 👍</div>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.slice(0, 15).map((it) => (
            <li key={it.customer.id}>
              <button
                type="button"
                onClick={() => navigate(`/customer/wedding/${it.customer.id}`)}
                className="w-full text-left p-2 rounded border bg-white hover:bg-red-50 text-xs"
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-semibold text-gray-900 truncate">
                    {it.customer.wedding_event_name || '(이름 없음)'}
                  </span>
                  <span className="badge bg-red-200 text-red-900 text-[10px] shrink-0">
                    {it.ageDays}일 경과
                  </span>
                </div>
                <div className="text-gray-500 truncate">
                  {it.customer.progress_status} · {it.customer.inquiry_date?.slice(0, 10) || '문의일 미정'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
