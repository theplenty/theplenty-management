// 주류(베버리지) 대시보드 위젯 — ② 월별 주류매출 카드 + ③ 주류없는 달 조기경보.
// 주류는 마진 ~90%인데 월별 변동이 큼 → 추적·경보.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { EventWithFood } from '../types';

interface BeverageSettings { revenue: Record<string, number>; alertThreshold: number; }

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ── 주류 소비 행사 판별 ──────────────────────────────────────────────────────
// 웨딩 = 주류 소비. MICE = 만찬/리셉션/디너 키워드 또는 저녁(17시~) 시간대.
// 낮 도시락·오찬은 주류 無.
const DINNER_RE = /만찬|리셉션|디너|dinner|reception|gala|갈라|연회|송년|망년|밤|저녁|night/i;
export function isBeverageEvent(ev: { event_type: string; event_name: string; status: string; start_datetime: string }): boolean {
  if (ev.status !== 'DEF') return false; // 확정 행사만
  if (ev.event_type === 'WEDDING') return true;
  if (DINNER_RE.test(ev.event_name || '')) return true;
  const hh = ev.start_datetime ? Number(ev.start_datetime.slice(11, 13)) : 0;
  return hh >= 17; // 저녁 시간대
}

function loadBeverage(): Promise<BeverageSettings> {
  return api.get<{ setting: { value: BeverageSettings } }>('/api/settings/beverage')
    .then((r) => ({
      revenue: r.setting?.value?.revenue ?? {},
      alertThreshold: r.setting?.value?.alertThreshold ?? 2,
    }))
    .catch(() => ({ revenue: {}, alertThreshold: 2 }));
}

// ── ③ 조기경보 배너 ─────────────────────────────────────────────────────────
export function BeverageAlertBanner({ events }: { events: EventWithFood[] }) {
  const [threshold, setThreshold] = useState(2);
  useEffect(() => { loadBeverage().then((s) => setThreshold(s.alertThreshold)); }, []);

  const thisYm = ym(new Date());
  const bevCount = useMemo(
    () => events.filter((e) => (e.start_datetime || '').slice(0, 7) === thisYm && isBeverageEvent(e)).length,
    [events, thisYm]
  );

  if (bevCount >= threshold) return null;
  return (
    <div className="px-4 py-3 rounded-md flex items-start gap-3"
      style={{ background: '#fff7e8', border: '1px solid #e6b800', color: '#7a5b00' }}>
      <span className="text-lg leading-none">⚠</span>
      <div className="text-sm">
        <b>이번 달 주류 소비 행사 {bevCount}건</b> (임계치 {threshold}건 미만) — 베버리지 매출 공백 위험.
        주류는 마진 ~90%라 빠지면 영업이익이 급락합니다. <b>저녁 행사 유치 또는 주류 패키지 영업</b>이 필요합니다.
      </div>
    </div>
  );
}

// ── ② 월별 주류매출 카드 ────────────────────────────────────────────────────
export function BeverageRevenueCard({ events, canEdit }: { events: EventWithFood[]; canEdit: boolean }) {
  const [bev, setBev] = useState<BeverageSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadBeverage().then((s) => { setBev(s); setDraft(s.revenue); }); }, []);

  // 최근 12개월 키
  const months = useMemo(() => {
    const arr: string[] = [];
    const d = new Date(); d.setDate(1);
    for (let i = 11; i >= 0; i--) { const m = new Date(d); m.setMonth(d.getMonth() - i); arr.push(ym(m)); }
    return arr;
  }, []);

  if (!bev) return null;
  const rev = editing ? draft : bev.revenue;
  const max = Math.max(1, ...months.map((m) => rev[m] || 0));
  const thisYm = ym(new Date());
  const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  const prevYm = ym(prev);
  const cur = rev[thisYm] || 0;
  const pre = rev[prevYm] || 0;
  const delta = cur - pre;
  const deltaPct = pre > 0 ? (delta / pre) * 100 : null;

  // 당월 주류 행사 건수 (attach rate용)
  const bevCount = events.filter((e) => (e.start_datetime || '').slice(0, 7) === thisYm && isBeverageEvent(e)).length;
  const attach = bevCount > 0 ? cur / bevCount : null;

  async function save() {
    setSaving(true);
    try {
      const value = { revenue: draft, alertThreshold: bev!.alertThreshold };
      await api.put('/api/settings/beverage', { value });
      setBev(value); setEditing(false);
    } catch (e) { alert('저장 실패: ' + (e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm">🍷 월별 주류매출 <span className="text-gray-400 font-normal">(매출관리 파일 기준)</span></h3>
          <p className="text-xs text-gray-400">와인·소주·맥주·소프트드링크 합 · 마진 ~90% 고마진 항목</p>
        </div>
        {canEdit && (editing
          ? <div className="flex gap-1.5">
              <button onClick={() => { setEditing(false); setDraft(bev.revenue); }} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600">취소</button>
              <button onClick={save} disabled={saving} className="text-xs px-3 py-1 rounded bg-[#5b4a3a] text-white disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
            </div>
          : <button onClick={() => setEditing(true)} className="text-xs px-2.5 py-1 rounded border border-[#5b4a3a] text-[#5b4a3a]">월별 입력/수정</button>)}
      </div>

      {/* 당월 + 전월대비 */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="bg-gray-50 rounded p-2">
          <div className="text-[11px] text-gray-400">당월 ({thisYm.slice(5)}월)</div>
          <div className="text-lg font-bold">{won(cur)}원</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-[11px] text-gray-400">전월 대비</div>
          <div className={`text-lg font-bold ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {delta >= 0 ? '▲' : '▼'} {won(Math.abs(delta))}{deltaPct != null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(0)}%)` : ''}
          </div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="text-[11px] text-gray-400">행사당 주류매출 (당월)</div>
          <div className="text-lg font-bold">{attach != null ? won(attach) + '원' : '—'}<span className="text-[11px] text-gray-400 font-normal"> /{bevCount}건</span></div>
        </div>
      </div>

      {/* 막대그래프 */}
      <div className="flex items-end gap-1.5 h-32 border-b border-gray-200 pb-0">
        {months.map((m) => {
          const v = rev[m] || 0;
          const h = (v / max) * 100;
          const isCur = m === thisYm;
          return (
            <div key={m} className="flex-1 flex flex-col items-center justify-end h-full" title={`${m}: ${won(v)}원`}>
              <div className="w-full rounded-t transition-all" style={{ height: `${h}%`, minHeight: v > 0 ? 2 : 0, background: isCur ? '#5b4a3a' : '#c9b9a6' }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {months.map((m) => <div key={m} className={`flex-1 text-center text-[9px] ${m === thisYm ? 'text-[#5b4a3a] font-bold' : 'text-gray-400'}`}>{m.slice(5)}</div>)}
      </div>

      {/* 편집 모드 — 월별 입력 */}
      {editing && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {months.map((m) => (
            <label key={m} className="text-[11px] text-gray-500">
              {m}
              <input type="text" inputMode="numeric"
                value={(draft[m] ?? 0).toLocaleString('ko-KR')}
                onChange={(e) => setDraft((p) => ({ ...p, [m]: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 }))}
                className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs text-right tabular-nums" />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
