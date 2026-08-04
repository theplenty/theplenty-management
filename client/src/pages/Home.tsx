// 역할별 홈 (세일즈 + 관리자) — 로그인 후 첫 화면.
//  - 세일즈 월간 현황: 담당자별 퍼널 (웨딩: 상담→가예약(INQ)→계약완료(DEF) / MICE: 가예약→계약완료) · 팀 전체
//  - 다가오는 행사 (D-day)
//  - 처리할 일: 협업요청 회신/결정 (lib/collaboration 재사용)
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  ROLE_LABEL,
  type Event,
  type EventStatus,
  type FoodItem,
  type MiceCustomer,
  type WeddingCustomer,
} from '../types';
import { canSeeCollaboration, isSales } from '../auth/permissions';
import {
  listCollaborations,
  computeAttention,
  countdown,
  type CollabAttention,
  collabEventName,
} from '../lib/collaboration';
import Dashboard from './Dashboard';

type EventRow = Event & { food_items?: FoodItem[] };

const EXCLUDED: EventStatus[] = ['LOS', '상담취소', '미팅취소'];
const STATUS_CHIP: Partial<Record<EventStatus, string>> = {
  DEF: 'bg-emerald-100 text-emerald-700',
  INQ: 'bg-sky-100 text-sky-700',
  미팅: 'bg-indigo-100 text-indigo-700',
  시식: 'bg-amber-100 text-amber-700',
};
const WD = ['일', '월', '화', '수', '목', '금', '토'];

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayDiff(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - startOfToday()) / 86_400_000);
}
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ddayLabel(days: number): { text: string; cls: string } {
  if (days === 0) return { text: 'D-DAY', cls: 'bg-red-600 text-white' };
  if (days <= 3) return { text: `D-${days}`, cls: 'bg-orange-500 text-white' };
  if (days <= 7) return { text: `D-${days}`, cls: 'bg-amber-400 text-amber-900' };
  return { text: `D-${days}`, cls: 'bg-gray-200 text-gray-700' };
}

function inMonth(iso: string | null | undefined, monthStart: Date, monthEnd: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && t >= monthStart.getTime() && t < monthEnd.getTime();
}
function pct(num: number, den: number): string {
  if (den <= 0) return '–';
  return `${Math.round((num / den) * 100)}%`;
}

// ===== 세일즈 월간 현황 (담당자별 퍼널) =====
// 매핑: 상담=progress '상담' 이상 도달, 가예약=INQ 이상 도달, 계약완료=DEF. (TEN 폐기 → 가예약은 INQ)
// 누적(도달) 기준이라 상담≥가예약≥계약완료. LOS(잃음)는 퍼널에서 제외.
// 기준 월: 웨딩=신규문의일(inquiry_date)/생성일, MICE=문의 생성일.
interface WedFunnelRow { name: string; consult: number; inq: number; def: number; }
interface MiceFunnelRow { name: string; inq: number; def: number; }

function computeWeddingFunnel(customers: WeddingCustomer[], monthStart: Date, monthEnd: Date): WedFunnelRow[] {
  const m = new Map<string, WedFunnelRow>();
  for (const c of customers) {
    if (c.deleted_at) continue;
    if (!inMonth(c.inquiry_date || c.created_at, monthStart, monthEnd)) continue;
    const name = c.event_inquiries[0]?.assigned_manager_name?.trim() || '미지정';
    const s = c.progress_status;
    const row = m.get(name) || { name, consult: 0, inq: 0, def: 0 };
    if (s === '상담' || s === 'INQ' || s === 'DEF') row.consult += 1; // 상담 도달
    if (s === 'INQ' || s === 'DEF') row.inq += 1;                     // 가예약(INQ) 도달
    if (s === 'DEF') row.def += 1;                                    // 계약완료
    m.set(name, row);
  }
  return [...m.values()].filter((r) => r.consult > 0).sort((a, b) => b.consult - a.consult);
}

function computeMiceFunnel(customers: MiceCustomer[], monthStart: Date, monthEnd: Date): MiceFunnelRow[] {
  const m = new Map<string, MiceFunnelRow>();
  for (const c of customers) {
    if (c.deleted_at) continue;
    for (const inq of c.inquiries) {
      if (!inMonth(inq.created_at, monthStart, monthEnd)) continue;
      const name = inq.assigned_manager_name?.trim() || inq.created_by_name?.trim() || '미지정';
      const s = inq.progress_status;
      const row = m.get(name) || { name, inq: 0, def: 0 };
      if (s === 'INQ' || s === 'DEF') row.inq += 1; // 가예약 도달
      if (s === 'DEF') row.def += 1;                 // 계약완료
      m.set(name, row);
    }
  }
  return [...m.values()].filter((r) => r.inq > 0).sort((a, b) => b.inq - a.inq);
}

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const [events, setEvents] = useState<EventRow[]>([]);
  const [weddings, setWeddings] = useState<WeddingCustomer[]>([]);
  const [mices, setMices] = useState<MiceCustomer[]>([]);
  const [attn, setAttn] = useState<CollabAttention>({ total: 0, needMyReply: [], needDecision: [] });
  const [loading, setLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(isSales(role));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [evRes, wedRes, miceRes] = await Promise.all([
          api.get<{ events: EventRow[] }>('/api/events'),
          api.get<{ customers: WeddingCustomer[] }>('/api/customers/wedding'),
          api.get<{ customers: MiceCustomer[] }>('/api/customers/mice'),
        ]);
        if (!cancelled) {
          setEvents(evRes.events || []);
          setWeddings(wedRes.customers || []);
          setMices(miceRes.customers || []);
        }
      } catch (e) {
        console.error('[Home] 데이터 로드 실패', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (canSeeCollaboration(role)) {
        try {
          const reqs = await listCollaborations();
          if (!cancelled) setAttn(computeAttention(reqs, role, user?.id));
        } catch {
          /* 무시 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role, user?.id]);

  const upcoming = useMemo(() => {
    return events
      .filter((e) => !EXCLUDED.includes(e.status))
      .map((e) => ({ e, d: dayDiff(e.start_datetime) }))
      .filter((x): x is { e: EventRow; d: number } => x.d !== null && x.d >= 0)
      .filter((x) => (mineOnly ? x.e.assigned_manager_id === user?.id : true))
      .sort((a, b) => new Date(a.e.start_datetime).getTime() - new Date(b.e.start_datetime).getTime());
  }, [events, mineOnly, user?.id]);

  const thisWeekCount = useMemo(() => upcoming.filter((x) => x.d <= 7).length, [upcoming]);
  const todayCount = useMemo(() => upcoming.filter((x) => x.d === 0).length, [upcoming]);

  // 월 선택
  const [statusMonth, setStatusMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const monthEnd = useMemo(() => {
    const d = new Date(statusMonth);
    d.setMonth(d.getMonth() + 1);
    return d;
  }, [statusMonth]);
  const wedFunnel = useMemo(() => computeWeddingFunnel(weddings, statusMonth, monthEnd), [weddings, statusMonth, monthEnd]);
  const miceFunnel = useMemo(() => computeMiceFunnel(mices, statusMonth, monthEnd), [mices, statusMonth, monthEnd]);
  const wedTotal = useMemo(
    () => wedFunnel.reduce((a, r) => ({ consult: a.consult + r.consult, inq: a.inq + r.inq, def: a.def + r.def }), { consult: 0, inq: 0, def: 0 }),
    [wedFunnel]
  );
  function shiftMonth(delta: number) {
    setStatusMonth((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + delta);
      return d;
    });
  }

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? '좋은 아침입니다' : h < 18 ? '안녕하세요' : '수고 많으십니다';
  })();
  const today = new Date();

  return (
    <div className="space-y-8">
      <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting}, {user?.name}님 👋
        </h1>
        <div className="text-sm text-gray-500 mt-1">
          {today.getFullYear()}년 {today.getMonth() + 1}월 {today.getDate()}일 ({WD[today.getDay()]}) ·{' '}
          {role && ROLE_LABEL[role]}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="오늘 행사" value={todayCount} tone="red" />
        <Stat label="이번 주(7일) 행사" value={thisWeekCount} tone="amber" />
        <Stat
          label="처리할 협업요청"
          value={attn.total}
          tone={attn.total > 0 ? 'blue' : 'gray'}
          onClick={attn.total > 0 ? () => navigate('/collaborations') : undefined}
        />
      </div>

      {/* 세일즈 월간 현황 — 팀 전체 담당자별 퍼널 */}
      <section className="border rounded-lg bg-white mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-bold text-gray-900">
            📊 세일즈 월간 현황 <span className="text-xs font-normal text-gray-400">(팀 전체 · 유입월 기준)</span>
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => shiftMonth(-1)} className="px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" aria-label="이전 달">‹</button>
            <span className="font-medium text-gray-800 w-24 text-center">
              {statusMonth.getFullYear()}년 {statusMonth.getMonth() + 1}월
            </span>
            <button onClick={() => shiftMonth(1)} className="px-2 py-0.5 rounded hover:bg-gray-100 text-gray-600" aria-label="다음 달">›</button>
          </div>
        </div>

        {/* 웨딩 퍼널 */}
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">💍 웨딩 — 상담 → 가예약(INQ) → 계약완료(DEF)</h3>
            {wedTotal.consult > 0 && (
              <div className="text-xs text-gray-500">
                팀 합계: 상담 <b className="text-gray-800">{wedTotal.consult}</b> → 가예약{' '}
                <b className="text-amber-600">{wedTotal.inq}</b> <span className="text-gray-400">({pct(wedTotal.inq, wedTotal.consult)})</span> → 계약완료{' '}
                <b className="text-emerald-600">{wedTotal.def}</b> <span className="text-gray-400">({pct(wedTotal.def, wedTotal.inq)})</span>
              </div>
            )}
          </div>
          {loading ? (
            <div className="text-xs text-gray-400 py-3 text-center">불러오는 중...</div>
          ) : wedFunnel.length === 0 ? (
            <div className="text-xs text-gray-400 py-3 text-center">해당 월 웨딩 상담 건이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-left font-medium py-1 w-28">담당자</th>
                  <th className="text-right font-medium py-1 w-16">상담</th>
                  <th className="text-right font-medium py-1 w-24">가예약(INQ)</th>
                  <th className="text-right font-medium py-1 w-28">계약완료(DEF)</th>
                </tr>
              </thead>
              <tbody>
                {wedFunnel.map((r) => (
                  <tr key={r.name} className="border-t">
                    <td className="py-1.5 text-gray-800 truncate">{r.name}</td>
                    <td className="py-1.5 text-right text-gray-700">{r.consult}건</td>
                    <td className="py-1.5 text-right">
                      <span className="font-medium text-amber-600">{r.inq}건</span>{' '}
                      <span className="text-[11px] text-gray-400">{pct(r.inq, r.consult)}</span>
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="font-medium text-emerald-600">{r.def}건</span>{' '}
                      <span className="text-[11px] text-gray-400">{pct(r.def, r.inq)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* MICE 퍼널 */}
        <div className="px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">🏢 MICE — 가예약(INQ) → 계약완료(DEF)</h3>
          {loading ? (
            <div className="text-xs text-gray-400 py-3 text-center">불러오는 중...</div>
          ) : miceFunnel.length === 0 ? (
            <div className="text-xs text-gray-400 py-3 text-center">해당 월 MICE 가예약 건이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500">
                  <th className="text-left font-medium py-1 w-28">담당자</th>
                  <th className="text-right font-medium py-1 w-24">가예약(INQ)</th>
                  <th className="text-right font-medium py-1 w-28">계약완료(DEF)</th>
                </tr>
              </thead>
              <tbody>
                {miceFunnel.map((r) => (
                  <tr key={r.name} className="border-t">
                    <td className="py-1.5 text-gray-800 truncate">{r.name}</td>
                    <td className="py-1.5 text-right font-medium text-amber-600">{r.inq}건</td>
                    <td className="py-1.5 text-right">
                      <span className="font-medium text-emerald-600">{r.def}건</span>{' '}
                      <span className="text-[11px] text-gray-400">{pct(r.def, r.inq)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 다가오는 행사 */}
        <section className="lg:col-span-2 border rounded-lg bg-white">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h2 className="font-bold text-gray-900">📅 다가오는 행사</h2>
            <div className="flex items-center gap-3">
              {isSales(role) && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                  내 담당만
                </label>
              )}
              <Link to="/calendar" className="text-xs text-blue-600 hover:underline">
                캘린더 →
              </Link>
            </div>
          </div>
          <div className="divide-y">
            {loading ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">불러오는 중...</div>
            ) : upcoming.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                {mineOnly ? '내 담당 ' : ''}다가오는 행사가 없습니다.
              </div>
            ) : (
              upcoming.slice(0, 12).map(({ e, d }) => {
                const dd = ddayLabel(d);
                return (
                  <div key={e.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50">
                    <span className={`shrink-0 w-14 text-center text-[11px] font-bold rounded px-1 py-1 ${dd.cls}`}>
                      {dd.text}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{e.event_type}</span>
                        {STATUS_CHIP[e.status] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_CHIP[e.status]}`}>{e.status}</span>
                        )}
                        <span className="font-medium text-gray-900 truncate">{e.event_name || '(이름 없음)'}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        {fmtWhen(e.start_datetime)}
                        {e.halls.length > 0 && ` · ${e.halls.join(', ')}`}
                        {e.assigned_manager_name && ` · ${e.assigned_manager_name}`}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {upcoming.length > 12 && (
              <div className="px-4 py-2 text-center">
                <Link to="/events" className="text-xs text-blue-600 hover:underline">
                  외 {upcoming.length - 12}건 더 보기 (행사 목록) →
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* 처리할 일 */}
        {canSeeCollaboration(role) && (
          <section className="border rounded-lg bg-white">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-bold text-gray-900">🤝 처리할 일</h2>
              <Link to="/collaborations" className="text-xs text-blue-600 hover:underline">전체 →</Link>
            </div>
            <div className="p-3 space-y-3">
              {attn.total === 0 ? (
                <div className="px-1 py-6 text-center text-gray-400 text-sm">처리할 협업요청이 없습니다 👍</div>
              ) : (
                <>
                  {attn.needMyReply.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-amber-700 mb-1.5">회신 필요 ({attn.needMyReply.length})</div>
                      <div className="space-y-1.5">
                        {attn.needMyReply.map((r) => {
                          const cd = countdown(r.reply_due_at);
                          return (
                            <button key={r.id} onClick={() => navigate('/collaborations')} className="w-full text-left border rounded-md px-2.5 py-2 hover:bg-gray-50">
                              <div className="font-medium text-gray-900 text-sm truncate">{collabEventName(r)}</div>
                              <div className={`text-[11px] ${cd.urgent ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                                {r.created_by_name} 요청 · {cd.expired ? cd.label : `${cd.label} 남음`}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {attn.needDecision.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-blue-700 mb-1.5">결정 필요 ({attn.needDecision.length})</div>
                      <div className="space-y-1.5">
                        {attn.needDecision.map((r) => (
                          <button key={r.id} onClick={() => navigate('/collaborations')} className="w-full text-left border rounded-md px-2.5 py-2 hover:bg-gray-50">
                            <div className="font-medium text-gray-900 text-sm truncate">{collabEventName(r)}</div>
                            <div className="text-[11px] text-gray-500">회신 완료 — 최종 결정 대기</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
      </div>
      </div>

      {/* ── 구분선 + 기존 대시보드 (병합) — 대시보드 자체 헤더가 '대시보드' 라벨 역할 ── */}
      <hr className="border-gray-200" />
      <Dashboard />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone: 'red' | 'amber' | 'blue' | 'gray';
  onClick?: () => void;
}) {
  const toneCls = { red: 'text-red-600', amber: 'text-amber-600', blue: 'text-blue-600', gray: 'text-gray-400' }[tone];
  return (
    <div
      onClick={onClick}
      className={`border rounded-lg bg-white px-4 py-3 ${onClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${toneCls}`}>{value}</div>
    </div>
  );
}
