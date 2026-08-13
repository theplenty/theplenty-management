// 세일즈 중심 MICE / WEDDING 대시보드 섹션 — 유입 → 팔로업 → 전환 추적.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDateW, fmtDateTimeW } from '../lib/dateFmt';
import {
  type ActiveUserOption,
  type MiceCustomer,
  type WeddingCustomer,
} from '../types';
import {
  computeMiceChannelMetrics,
  computeWeddingMetrics,
  customRange,
  type DateRange,
  filterMiceForDrill,
  filterWeddingForDrill,
  findStaleIncalls,
  findRecentOutcalls,
  flattenMiceInquiries,
  computeManagerConversionRates,
  findScheduledConsultations,
  findCancelledConsultations,
  findStaleWedding,
  type InquiryWithCustomer,
  type MiceStatusGroup,
  computeMiceMonthlyTable,
  computeWeddingMonthlyTable,
  thisMonthRange,
  thisWeekRange,
  todayRange,
  type WeddingStatusGroup,
} from '../lib/salesDashboardStats';
import Modal from './Modal';

type Period = 'today' | 'week' | 'month' | 'custom';

// 담당자 드롭다운에 표시할 역할 (영업 담당자만)
const MANAGER_ROLES = new Set<ActiveUserOption['role']>([
  'admin',
  'sales_mice',
  'sales_wedding',
]);

interface Props {
  miceCustomers: MiceCustomer[];
  weddingCustomers: WeddingCustomer[];
  activeUsers: ActiveUserOption[];
}

type MiceDrill = {
  open: true;
  kind: 'mice';
  title: string;
  items: InquiryWithCustomer[];
};
type WeddingDrill = {
  open: true;
  kind: 'wedding';
  title: string;
  items: WeddingCustomer[];
};
type DrillState = { open: false } | MiceDrill | WeddingDrill;

export default function SalesDashboard({
  miceCustomers,
  weddingCustomers,
  activeUsers,
}: Props) {
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [managerId, setManagerId] = useState<string>('');
  const [drill, setDrill] = useState<DrillState>({ open: false });

  // 영업 담당자만 (admin/sales_mice/sales_wedding) — 담당자 드롭다운에 표시
  const salesManagers = useMemo(
    () => activeUsers.filter((u) => MANAGER_ROLES.has(u.role)),
    [activeUsers]
  );

  const range = useMemo<DateRange | null>(() => {
    if (period === 'today') return todayRange();
    if (period === 'week') return thisWeekRange();
    if (period === 'month') return thisMonthRange();
    if (period === 'custom' && customFrom && customTo) return customRange(customFrom, customTo);
    return null;
  }, [period, customFrom, customTo]);

  const periodLabel =
    period === 'today'
      ? '오늘'
      : period === 'week'
        ? '금주'
        : period === 'month'
          ? '금월'
          : customFrom && customTo
            ? `${customFrom}~${customTo}`
            : '기간';

  const miceFlat = useMemo(() => flattenMiceInquiries(miceCustomers), [miceCustomers]);

  // 필터 적용 — 채널별 메트릭 (기간 + 담당자 반영)
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

  // 웨딩 — 기간 + 담당자 반영
  const wedFiltered = useMemo(
    () => computeWeddingMetrics(weddingCustomers, range, managerId || null),
    [weddingCustomers, range, managerId]
  );
  // 상담 예정 / 장기 미전환 — 신규문의일자(inquiry_date) 기준 기간 필터 반영
  const scheduled = useMemo(
    () => findScheduledConsultations(weddingCustomers, range),
    [weddingCustomers, range]
  );
  const cancelled = useMemo(() => findCancelledConsultations(weddingCustomers), [weddingCustomers]);
  const staleWed = useMemo(
    () => findStaleWedding(weddingCustomers, 14, range),
    [weddingCustomers, range]
  );

  // ===== 드릴다운 열기 헬퍼 =====
  function openMiceDrill(
    channel: 'INCALL' | 'OUTCALL' | null,
    statusGroup: MiceStatusGroup,
    title: string
  ) {
    const items = filterMiceForDrill(miceFlat, channel, statusGroup, range, managerId || null);
    setDrill({ open: true, kind: 'mice', title, items });
  }
  function openWeddingDrill(statusGroup: WeddingStatusGroup, title: string) {
    const items = filterWeddingForDrill(weddingCustomers, statusGroup, range, managerId || null);
    setDrill({ open: true, kind: 'wedding', title, items });
  }
  function openMiceStaleDrill() {
    setDrill({
      open: true,
      kind: 'mice',
      title: '미처리 인콜 (3일+ 누적, 기간 무관)',
      items: stale3,
    });
  }
  function openWeddingStaleDrill() {
    setDrill({
      open: true,
      kind: 'wedding',
      title: `장기 미전환 (14일+, ${periodLabel} 신규문의 기준)`,
      items: staleWed.map((s) => s.customer),
    });
  }

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
        activeUsers={salesManagers}
      />

      {/* ========== MICE 세일즈 대시보드 ========== */}
      <section className="bg-white border rounded-lg p-4 md:p-6">
        <header className="flex items-baseline gap-3 mb-4 flex-wrap">
          <span className="text-xs text-gray-400 font-mono">01 / MICE</span>
          <h2 className="text-lg md:text-xl font-bold text-gray-900">MICE 세일즈</h2>
          <span className="text-xs text-gray-500">
            유입 → 팔로업 → INQ/DEF/LOS 전환 · 숫자 클릭 시 리스트
          </span>
        </header>

        {/* 상단 KPI 카드 — 기간 필터 반영 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
          <KpiCard
            label={`${periodLabel} 인콜`}
            value={miceFilteredIncall.total}
            accent="blue"
            onClick={() => openMiceDrill('INCALL', 'all', `${periodLabel} MICE 인콜 (${miceFilteredIncall.total}건)`)}
          />
          <KpiCard
            label={`${periodLabel} 아웃콜`}
            value={miceFilteredOutcall.total}
            accent="purple"
            onClick={() => openMiceDrill('OUTCALL', 'all', `${periodLabel} MICE 아웃콜 (${miceFilteredOutcall.total}건)`)}
          />
          <KpiCard
            label="미처리 인콜 (3일+)"
            value={stale3.length}
            accent={stale3.length > 0 ? 'red' : 'gray'}
            sub={stale7.length > 0 ? `7일+ ${stale7.length}건` : '누적 기준'}
            onClick={openMiceStaleDrill}
          />
          <KpiCard
            label={`인콜 전환율 (${periodLabel})`}
            value={`${miceFilteredIncall.conversionRate.toFixed(1)}%`}
            sub={`${miceFilteredIncall.total}건 중 ${miceFilteredIncall.inq + miceFilteredIncall.def + miceFilteredIncall.los}건 전환`}
            accent="green"
            onClick={() =>
              openMiceDrill('INCALL', 'converted', `${periodLabel} 인콜 전환 건 (INQ/DEF/LOS)`)
            }
          />
          <KpiCard
            label={`아웃콜 전환율 (${periodLabel})`}
            value={`${miceFilteredOutcall.conversionRate.toFixed(1)}%`}
            sub={`${miceFilteredOutcall.total}건 중 ${miceFilteredOutcall.inq + miceFilteredOutcall.def + miceFilteredOutcall.los}건 전환`}
            accent="green"
            onClick={() =>
              openMiceDrill('OUTCALL', 'converted', `${periodLabel} 아웃콜 전환 건 (INQ/DEF/LOS)`)
            }
          />
        </div>

        {/* 퍼널 차트 — 각 단계 클릭 시 리스트 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          <FunnelCard
            title="인콜 (📞) → 전환 흐름"
            total={miceFilteredIncall.total}
            stages={[
              {
                label: '미처리',
                value: miceFilteredIncall.unprocessed,
                color: 'bg-gray-300',
                onClick: () =>
                  openMiceDrill('INCALL', 'unprocessed', `${periodLabel} 인콜 — 미처리 (단순문의)`),
              },
              {
                label: 'INQ',
                value: miceFilteredIncall.inq,
                color: 'bg-blue-500',
                onClick: () => openMiceDrill('INCALL', 'inq', `${periodLabel} 인콜 — INQ/TEN`),
              },
              {
                label: 'DEF',
                value: miceFilteredIncall.def,
                color: 'bg-emerald-500',
                onClick: () => openMiceDrill('INCALL', 'def', `${periodLabel} 인콜 — DEF`),
              },
              {
                label: 'LOS',
                value: miceFilteredIncall.los,
                color: 'bg-red-500',
                onClick: () => openMiceDrill('INCALL', 'los', `${periodLabel} 인콜 — LOS`),
              },
            ]}
          />
          <FunnelCard
            title="아웃콜 (📤) → 전환 흐름"
            total={miceFilteredOutcall.total}
            stages={[
              {
                label: '미처리',
                value: miceFilteredOutcall.unprocessed,
                color: 'bg-gray-300',
                onClick: () =>
                  openMiceDrill('OUTCALL', 'unprocessed', `${periodLabel} 아웃콜 — 미처리`),
              },
              {
                label: 'INQ',
                value: miceFilteredOutcall.inq,
                color: 'bg-blue-500',
                onClick: () => openMiceDrill('OUTCALL', 'inq', `${periodLabel} 아웃콜 — INQ/TEN`),
              },
              {
                label: 'DEF',
                value: miceFilteredOutcall.def,
                color: 'bg-emerald-500',
                onClick: () => openMiceDrill('OUTCALL', 'def', `${periodLabel} 아웃콜 — DEF`),
              },
              {
                label: 'LOS',
                value: miceFilteredOutcall.los,
                color: 'bg-red-500',
                onClick: () => openMiceDrill('OUTCALL', 'los', `${periodLabel} 아웃콜 — LOS`),
              },
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
          <KpiCard
            label={`${periodLabel} 신규 인콜`}
            value={wedFiltered.totalInflow}
            accent="blue"
            onClick={() =>
              openWeddingDrill('all', `${periodLabel} WEDDING 신규 인콜 (${wedFiltered.totalInflow}건)`)
            }
          />
          <KpiCard
            label="상담 예약"
            value={wedFiltered.consultBooked}
            accent="purple"
            onClick={() =>
              openWeddingDrill('consult', `${periodLabel} WEDDING 상담 예약 (${wedFiltered.consultBooked}건)`)
            }
          />
          <KpiCard
            label="상담 취소"
            value={wedFiltered.consultCancelled}
            accent="red"
            onClick={() =>
              openWeddingDrill('consultCancelled', `${periodLabel} WEDDING 상담 취소 (${wedFiltered.consultCancelled}건)`)
            }
          />
          <KpiCard
            label="상담 전환율"
            value={`${wedFiltered.consultConversionRate.toFixed(1)}%`}
            sub={`인콜 ${wedFiltered.totalInflow}건 기준`}
            accent="green"
            onClick={() =>
              openWeddingDrill(
                'advancedPastConsult',
                `${periodLabel} WEDDING 상담 이상 전환 (상담+INQ+DEF+LOS)`
              )
            }
          />
          <KpiCard
            label="상담→DEF 전환율"
            value={`${wedFiltered.consultToDefRate.toFixed(1)}%`}
            sub={`상담 ${wedFiltered.advancedPastConsult}건 중 ${wedFiltered.def}건 확정`}
            accent="emerald"
            onClick={() =>
              openWeddingDrill('def', `${periodLabel} WEDDING DEF 확정 (${wedFiltered.def}건)`)
            }
          />
          <KpiCard
            label="DEF"
            value={wedFiltered.def}
            accent="emerald"
            onClick={() => openWeddingDrill('def', `${periodLabel} WEDDING DEF (${wedFiltered.def}건)`)}
          />
          <KpiCard
            label="LOS"
            value={wedFiltered.los}
            accent="red"
            onClick={() => openWeddingDrill('los', `${periodLabel} WEDDING LOS (${wedFiltered.los}건)`)}
          />
          <KpiCard
            label="장기 미전환"
            value={staleWed.length}
            accent={staleWed.length > 0 ? 'red' : 'gray'}
            sub={`14일+ 신규문의/상담 · ${periodLabel} 기준`}
            onClick={openWeddingStaleDrill}
          />
        </div>

        <FunnelCard
          title="WEDDING 인콜 → 전환 흐름"
          total={wedFiltered.totalInflow}
          stages={[
            {
              label: '신규문의 방치',
              value: wedFiltered.newOnly,
              color: 'bg-gray-300',
              onClick: () =>
                openWeddingDrill('newOnly', `${periodLabel} WEDDING — 신규문의 방치`),
            },
            {
              label: '상담',
              value: wedFiltered.consultBooked,
              color: 'bg-purple-500',
              onClick: () => openWeddingDrill('consult', `${periodLabel} WEDDING — 상담`),
            },
            {
              label: '상담취소',
              value: wedFiltered.consultCancelled,
              color: 'bg-amber-400',
              onClick: () =>
                openWeddingDrill('consultCancelled', `${periodLabel} WEDDING — 상담취소`),
            },
            {
              label: 'INQ',
              value: wedFiltered.inq,
              color: 'bg-blue-500',
              onClick: () => openWeddingDrill('inq', `${periodLabel} WEDDING — INQ/TEN`),
            },
            {
              label: 'DEF',
              value: wedFiltered.def,
              color: 'bg-emerald-500',
              onClick: () => openWeddingDrill('def', `${periodLabel} WEDDING — DEF`),
            },
            {
              label: 'LOS',
              value: wedFiltered.los,
              color: 'bg-red-500',
              onClick: () => openWeddingDrill('los', `${periodLabel} WEDDING — LOS`),
            },
          ]}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-5">
          <ScheduledConsultsCard items={scheduled} periodLabel={periodLabel} />
          <CancelledConsultsCard items={cancelled} />
          <StaleWeddingCard items={staleWed} periodLabel={periodLabel} />
        </div>
      </section>

      {/* ===== 월별 세일즈 표 — MICE · WEDDING 나란히 (연도 공유) ===== */}
      <MonthlySalesTables miceCustomers={miceCustomers} weddingCustomers={weddingCustomers} />

      {/* ===== 드릴다운 모달 ===== */}
      <DrillDownModal drill={drill} onClose={() => setDrill({ open: false })} />
    </div>
  );
}

// ===== 드릴다운 모달 =====
function DrillDownModal({
  drill,
  onClose,
}: {
  drill: DrillState;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  if (!drill.open) return null;
  const count = drill.kind === 'mice' ? drill.items.length : drill.items.length;
  return (
    <Modal
      open={drill.open}
      onClose={onClose}
      title={drill.title}
      widthClass="max-w-5xl"
      footer={
        <>
          <span className="text-xs text-gray-500 mr-auto">총 {count}건</span>
          <button onClick={onClose} className="btn-secondary">
            닫기
          </button>
        </>
      }
    >
      {drill.kind === 'mice' ? (
        <MiceDrillTable
          items={drill.items}
          onRowClick={(customerId) => {
            onClose();
            navigate(`/customer/mice/${customerId}`);
          }}
        />
      ) : (
        <WeddingDrillTable
          items={drill.items}
          onRowClick={(customerId) => {
            onClose();
            navigate(`/customer/wedding/${customerId}`);
          }}
        />
      )}
    </Modal>
  );
}

function MiceDrillTable({
  items,
  onRowClick,
}: {
  items: InquiryWithCustomer[];
  onRowClick: (customerId: string) => void;
}) {
  if (items.length === 0) {
    return <div className="text-center text-gray-400 py-8 text-sm">해당 조건의 건이 없습니다.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            <th className="text-left px-3 py-2 font-semibold border-b">업체명</th>
            <th className="text-left px-3 py-2 font-semibold border-b">담당자(우리)</th>
            <th className="text-left px-3 py-2 font-semibold border-b">컨택</th>
            <th className="text-left px-3 py-2 font-semibold border-b">채널</th>
            <th className="text-left px-3 py-2 font-semibold border-b">진행</th>
            <th className="text-left px-3 py-2 font-semibold border-b">통화/생성</th>
            <th className="text-left px-3 py-2 font-semibold border-b">행사일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.inquiry.id}
              onClick={() => onRowClick(it.customer.id)}
              className="border-t hover:bg-blue-50 cursor-pointer"
            >
              <td className="px-3 py-2 font-medium text-gray-900">
                {it.customer.organization_name}
              </td>
              <td className="px-3 py-2 text-gray-700">
                {it.inquiry.assigned_manager_name || '-'}
              </td>
              <td className="px-3 py-2 text-gray-700">
                {it.inquiry.contacts[0]?.name || '-'}
              </td>
              <td className="px-3 py-2">
                <span
                  className={
                    'badge text-[10px] ' +
                    (it.inquiry.inquiry_channel === 'INCALL'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-purple-100 text-purple-800')
                  }
                >
                  {it.inquiry.inquiry_channel === 'INCALL' ? '📞 인콜' : '📤 아웃콜'}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="badge bg-gray-100 text-gray-800 text-[10px]">
                  {it.inquiry.progress_status}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-600">
                {fmtDateW(it.inquiry.call_date || it.inquiry.created_at)}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {it.inquiry.inquiry_event_date_text || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeddingDrillTable({
  items,
  onRowClick,
}: {
  items: WeddingCustomer[];
  onRowClick: (customerId: string) => void;
}) {
  if (items.length === 0) {
    return <div className="text-center text-gray-400 py-8 text-sm">해당 조건의 건이 없습니다.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            <th className="text-left px-3 py-2 font-semibold border-b">행사명</th>
            <th className="text-left px-3 py-2 font-semibold border-b">진행단계</th>
            <th className="text-left px-3 py-2 font-semibold border-b">신랑</th>
            <th className="text-left px-3 py-2 font-semibold border-b">신부</th>
            <th className="text-left px-3 py-2 font-semibold border-b">문의일자</th>
            <th className="text-left px-3 py-2 font-semibold border-b">희망상담</th>
            <th className="text-left px-3 py-2 font-semibold border-b">유입경로</th>
            <th className="text-left px-3 py-2 font-semibold border-b">담당자</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr
              key={c.id}
              onClick={() => onRowClick(c.id)}
              className="border-t hover:bg-purple-50 cursor-pointer"
            >
              <td className="px-3 py-2 font-medium text-gray-900">
                {c.wedding_event_name || '(이름 없음)'}
              </td>
              <td className="px-3 py-2">
                <span className="badge bg-gray-100 text-gray-800 text-[10px]">
                  {c.progress_status}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-700">
                {c.groom_name || '-'}
                {c.groom_phone && <span className="text-xs text-gray-500 block">{c.groom_phone}</span>}
              </td>
              <td className="px-3 py-2 text-gray-700">
                {c.bride_name || '-'}
                {c.bride_phone && <span className="text-xs text-gray-500 block">{c.bride_phone}</span>}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {fmtDateW(c.inquiry_date || c.created_at)}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {c.desired_consultation_date ? fmtDateTimeW(c.desired_consultation_date) : '-'}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {c.source || '-'}
                {c.source_detail && <span className="text-xs text-gray-500 block">{c.source_detail}</span>}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {c.event_inquiries[0]?.assigned_manager_name || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  onClick,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: Accent;
  onClick?: () => void;
}) {
  const cls = `border rounded-lg p-2.5 md:p-3 ${ACCENT_BG[accent]} ${onClick ? 'text-left w-full hover:shadow-md hover:brightness-95 transition cursor-pointer' : ''}`;
  const body = (
    <>
      <div className="text-[11px] md:text-xs opacity-80 mb-1 truncate">{label}</div>
      <div className="text-xl md:text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] md:text-[11px] opacity-70 mt-0.5 truncate">{sub}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} aria-label={`${label} 상세보기`}>
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

function FunnelCard({
  title,
  total,
  stages,
}: {
  title: string;
  total: number;
  stages: Array<{ label: string; value: number; color: string; onClick?: () => void }>;
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
            const disabled = !s.onClick || s.value === 0;
            return (
              <li key={s.label} className="text-xs">
                <button
                  type="button"
                  onClick={s.onClick}
                  disabled={disabled}
                  className={`w-full flex items-center gap-2 mb-0.5 rounded px-1 py-0.5 ${disabled ? '' : 'hover:bg-white cursor-pointer'}`}
                  aria-label={`${s.label} 상세보기`}
                >
                  <span className="w-20 text-gray-700 shrink-0 text-left">{s.label}</span>
                  <div className="flex-1 bg-white border rounded overflow-hidden h-5">
                    <div
                      className={`h-full ${s.color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-24 text-right tabular-nums text-gray-700 shrink-0">
                    {s.value}건 ({sharePct.toFixed(1)}%)
                  </span>
                </button>
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
                  {fmtDateW(it.inquiry.created_at)} · {it.inquiry.assigned_manager_name || '담당 미지정'}
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

function ScheduledConsultsCard({
  items,
  periodLabel,
}: {
  items: WeddingCustomer[];
  periodLabel: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-purple-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
        📅 상담 예정 ({items.length}건)
      </h3>
      <div className="text-[10px] text-gray-500 mb-2">{periodLabel} 신규문의 기준</div>
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
                  {c.desired_consultation_date ? fmtDateTimeW(c.desired_consultation_date) : '날짜 미정'}
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
                <div className="text-gray-500 truncate">최종 수정 {fmtDateW(c.updated_at)}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StaleWeddingCard({
  items,
  periodLabel,
}: {
  items: Array<{ customer: WeddingCustomer; ageDays: number }>;
  periodLabel: string;
}) {
  const navigate = useNavigate();
  return (
    <div className="border rounded-lg p-3 bg-red-50/30">
      <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
        ⏰ 장기 미전환 ({items.length}건)
      </h3>
      <div className="text-[10px] text-gray-500 mb-2">{periodLabel} 신규문의 · 14일+ 방치</div>
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
                  {it.customer.progress_status} · {it.customer.inquiry_date ? fmtDateW(it.customer.inquiry_date) : '문의일 미정'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===== 월별 세일즈 표 — MICE · WEDDING 나란히 =====
// 사장님이 손으로 만들던 두 표의 재현. 행 구성은 원본 그대로(아웃콜만 제외),
// 귀속은 접수월 코호트("그 달 들어온 건이 이후 어디까지 갔나").
// 연도 선택 하나가 두 표를 같이 움직인다 — 따로 움직이면 비교하다 헷갈린다.

interface MonthlyLine<R> {
  label: string;
  get: (r: R) => string;
  strong?: boolean;
}

function MonthlyTable<R extends { month: number }>({
  title,
  lines,
  rows,
  sum,
  note,
}: {
  title: string;
  lines: MonthlyLine<R>[];
  rows: R[];
  sum: R;
  note: string;
}) {
  return (
    <div className="border rounded-lg p-3">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[52rem]">
          <thead>
            <tr className="text-[11px] text-gray-500 border-b">
              <th className="text-left font-medium py-1.5 pr-2 w-44">항목</th>
              {rows.map((r) => (
                <th key={r.month} className="text-right font-medium py-1.5 px-1">
                  {r.month}월
                </th>
              ))}
              <th className="text-right font-semibold py-1.5 pl-2 border-l">합계</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.label} className="border-b last:border-b-0">
                <td className={`py-1.5 pr-2 ${line.strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {line.label}
                </td>
                {rows.map((r) => {
                  const v = line.get(r);
                  const dim = v === '0' || v === '–';
                  return (
                    <td
                      key={r.month}
                      className={`py-1.5 px-1 text-right tabular-nums ${dim ? 'text-gray-300' : line.strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`}
                    >
                      {v}
                    </td>
                  );
                })}
                <td className="py-1.5 pl-2 text-right tabular-nums font-semibold border-l">{line.get(sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">{note}</p>
    </div>
  );
}

const pctOf = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : '–');

function MonthlySalesTables({
  miceCustomers,
  weddingCustomers,
}: {
  miceCustomers: MiceCustomer[];
  weddingCustomers: WeddingCustomer[];
}) {
  const [year, setYear] = useState(() => new Date().getFullYear());

  const miceRows = useMemo(() => computeMiceMonthlyTable(miceCustomers, year), [miceCustomers, year]);
  const miceSum = useMemo(
    () =>
      miceRows.reduce(
        (a, r) => ({
          month: 0,
          received: a.received + r.received,
          quoted: a.quoted + r.quoted,
          contracted: a.contracted + r.contracted,
          notContracted: a.notContracted + r.notContracted,
          holding: a.holding + r.holding,
        }),
        { month: 0, received: 0, quoted: 0, contracted: 0, notContracted: 0, holding: 0 }
      ),
    [miceRows]
  );

  const wedRows = useMemo(() => computeWeddingMonthlyTable(weddingCustomers, year), [weddingCustomers, year]);
  const wedSum = useMemo(
    () =>
      wedRows.reduce(
        (a, r) => ({
          month: 0,
          received: a.received + r.received,
          consulted: a.consulted + r.consulted,
          contracted: a.contracted + r.contracted,
          notContracted: a.notContracted + r.notContracted,
        }),
        { month: 0, received: 0, consulted: 0, contracted: 0, notContracted: 0 }
      ),
    [wedRows]
  );

  type MiceR = (typeof miceRows)[number];
  const MICE_LINES: MonthlyLine<MiceR>[] = [
    { label: '문의 접수 (인콜)', get: (r) => String(r.received), strong: true },
    { label: '견적 발송', get: (r) => String(r.quoted) },
    { label: '견적 발송 후 미계약', get: (r) => String(r.notContracted) },
    { label: '계약 (확정)', get: (r) => String(r.contracted), strong: true },
    { label: '홀딩중 (견적·계약서 발송)', get: (r) => String(r.holding) },
    { label: '견적 발송 후 계약률', get: (r) => pctOf(r.quoted - r.notContracted, r.quoted) },
    { label: '견적 발송 후 미계약률', get: (r) => pctOf(r.notContracted, r.quoted) },
  ];

  type WedR = (typeof wedRows)[number];
  const WED_LINES: MonthlyLine<WedR>[] = [
    { label: '인콜 (신규문의)', get: (r) => String(r.received), strong: true },
    { label: '상담 건수', get: (r) => String(r.consulted) },
    { label: '계약 (확정)', get: (r) => String(r.contracted), strong: true },
    { label: '상담 후 미계약', get: (r) => String(r.notContracted) },
    { label: '인콜 대비 계약률', get: (r) => pctOf(r.contracted, r.received) },
    { label: '인콜 대비 상담률', get: (r) => pctOf(r.consulted, r.received) },
    { label: '상담 건수 대비 계약률', get: (r) => pctOf(r.contracted, r.consulted) },
    { label: '상담 후 미계약률', get: (r) => pctOf(r.notContracted, r.consulted) },
  ];

  return (
    <section className="bg-white border rounded-lg p-4 md:p-6">
      <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-xs text-gray-400 font-mono">03 / MONTHLY</span>
          <h2 className="text-lg md:text-xl font-bold text-gray-900">월별 세일즈 표</h2>
          <span className="text-xs text-gray-500">접수월 기준 — 그 달 들어온 건이 이후 어디까지 갔나</span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => setYear((y) => y - 1)} className="px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" aria-label="이전 연도">‹</button>
          <span className="font-medium text-gray-800 w-14 text-center">{year}년</span>
          <button onClick={() => setYear((y) => y + 1)} className="px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" aria-label="다음 연도">›</button>
        </div>
      </header>
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        <MonthlyTable
          title="🏢 MICE — 문의 → 견적 → 계약"
          lines={MICE_LINES}
          rows={miceRows}
          sum={miceSum}
          note="아웃콜 제외 · 견적/계약 체크 기준. 홀딩중 = 견적·계약서를 보냈지만 아직 확정/취소로 끝나지 않은 건."
        />
        <MonthlyTable
          title="💍 WEDDING — 인콜 → 상담 → 계약"
          lines={WED_LINES}
          rows={wedRows}
          sum={wedSum}
          note="귀속월 = 신규문의일. 상담 건수 = 상담 단계 이상 도달(진행 중·잃음 포함) · 상담 전 이탈(신규문의·상담취소로 남은 건)은 상담에 안 잡힘."
        />
      </div>
    </section>
  );
}
