// 관리자 전용 — 웨딩 마진계산기 '기본값' 관리.
// 기본값(preset) 매트릭스 + 등급 기준 + 원가 가정을 서버 settings에 저장 (전 직원 공유).

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  type WeddingCalcSettings, type WCPreset, type WCSeason,
  DEFAULT_WEDDING_CALC,
} from '../lib/weddingCalc';

const SEASONS: WCSeason[] = ['워크인', '임직원', '비수기'];

// 쉼표 숫자 입력
function Num({ value, onChange, w = '88px' }: { value: number; onChange: (v: number) => void; w?: string }) {
  const [t, setT] = useState(value.toLocaleString('ko-KR'));
  useEffect(() => { setT(value.toLocaleString('ko-KR')); }, [value]);
  return (
    <input value={t} inputMode="numeric" style={{ width: w }}
      className="border border-gray-300 rounded px-1.5 py-1 text-xs text-right tabular-nums"
      onChange={(e) => setT(e.target.value)}
      onBlur={() => onChange(parseFloat(t.replace(/[^0-9.\-]/g, '')) || 0)} />
  );
}

export default function AdminWeddingCalc() {
  const [cfg, setCfg] = useState<WeddingCalcSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ setting: { value: WeddingCalcSettings } }>('/api/settings/wedding-calc')
      .then((r) => {
        const v = r.setting?.value ?? DEFAULT_WEDDING_CALC;
        setCfg({
          ...v,
          presets: (v.presets && v.presets.length) ? v.presets : DEFAULT_WEDDING_CALC.presets,
          tierTeamlead: v.tierTeamlead ?? DEFAULT_WEDDING_CALC.tierTeamlead,
          tierExecFloor: v.tierExecFloor ?? DEFAULT_WEDDING_CALC.tierExecFloor,
        });
      })
      .catch(() => setCfg(JSON.parse(JSON.stringify(DEFAULT_WEDDING_CALC))));
  }, []);

  if (!cfg) return <div className="p-6 text-sm text-gray-500">불러오는 중…</div>;

  const presets = cfg.presets ?? [];
  const up = (patch: Partial<WeddingCalcSettings>) => setCfg({ ...cfg, ...patch });
  const setPreset = (i: number, patch: Partial<WCPreset>) => {
    const a = [...presets]; a[i] = { ...a[i], ...patch }; up({ presets: a });
  };

  async function save() {
    setSaving(true); setMsg('저장 중…');
    try {
      await api.put('/api/settings/wedding-calc', { value: cfg });
      setMsg('저장됨 ✓ (전 직원에 반영)');
    } catch (e) {
      setMsg('저장 실패: ' + (e as Error).message);
    } finally { setSaving(false); }
  }
  function reset() {
    if (!confirm('기본값을 공장초기값으로 되돌릴까요? (저장해야 반영)')) return;
    setCfg(JSON.parse(JSON.stringify(DEFAULT_WEDDING_CALC)));
    setMsg('공장초기값 로드됨 — 저장 필요');
  }

  return (
    <div className="p-4 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">⚙ 웨딩 마진계산기 — 기본값 관리</h1>
          <p className="text-sm text-gray-500">관리자 전용. 여기서 저장한 기준값은 전 직원의 마진계산기에 즉시 반영됩니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{msg}</span>
          <button onClick={reset} className="text-sm border border-gray-300 text-gray-600 rounded px-3 py-1.5">공장초기화</button>
          <button onClick={save} disabled={saving} className="text-sm bg-[#5b4a3a] text-white rounded px-4 py-1.5 disabled:opacity-50">💾 저장</button>
        </div>
      </div>

      {/* 등급 기준 */}
      <section className="bg-white border rounded-lg p-3">
        <h2 className="text-sm font-semibold text-[#5b4a3a] mb-2">등급 기준 (시트마진율 %)</h2>
        <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600">
          <span>자율(직원재량) = <b>각 슬롯의 표준 마진율</b> (아래 표의 '마진율%')</span>
          <span className="text-gray-300">|</span>
          <label className="flex items-center gap-1">팀장 — 토요일 점심
            <Num value={cfg.tierTeamlead?.lunchSat ?? 50} onChange={(v) => up({ tierTeamlead: { lunchSat: v, other: cfg.tierTeamlead?.other ?? 44 } })} w="56px" />%</label>
          <label className="flex items-center gap-1">팀장 — 그 외
            <Num value={cfg.tierTeamlead?.other ?? 44} onChange={(v) => up({ tierTeamlead: { lunchSat: cfg.tierTeamlead?.lunchSat ?? 50, other: v } })} w="56px" />%</label>
          <label className="flex items-center gap-1">대표 floor
            <Num value={cfg.tierExecFloor ?? 38} onChange={(v) => up({ tierExecFloor: v })} w="56px" />%</label>
          <span className="text-gray-400">(이 미만 = 거절)</span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">판정: 시트마진 ≥ 자율 → 자율 / ≥ 팀장 → 팀장 / ≥ 대표 → 대표 / 그 미만 → 거절 (위에서부터)</p>
      </section>

      {/* 원가 가정 */}
      <section className="bg-white border rounded-lg p-3">
        <h2 className="text-sm font-semibold text-[#5b4a3a] mb-2">원가 가정 / 배부율</h2>
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-600">
          <label className="flex items-center gap-1">A식대원가/인 <Num value={cfg.cost.foodA} onChange={(v) => up({ cost: { ...cfg.cost, foodA: v } })} /></label>
          <label className="flex items-center gap-1">B <Num value={cfg.cost.foodB} onChange={(v) => up({ cost: { ...cfg.cost, foodB: v } })} /></label>
          <label className="flex items-center gap-1">C <Num value={cfg.cost.foodC} onChange={(v) => up({ cost: { ...cfg.cost, foodC: v } })} /></label>
          <label className="flex items-center gap-1">외부인건비/인 <Num value={cfg.cost.extPP} onChange={(v) => up({ cost: { ...cfg.cost, extPP: v } })} /></label>
          <label className="flex items-center gap-1">고정경비 <Num value={cfg.cost.fixed} onChange={(v) => up({ cost: { ...cfg.cost, fixed: v } })} /></label>
          <label className="flex items-center gap-1">플라워원가율% <Num value={cfg.cost.flowerCostR} onChange={(v) => up({ cost: { ...cfg.cost, flowerCostR: v } })} w="56px" /></label>
          <label className="flex items-center gap-1">내부인건비배부% <Num value={cfg.cost.intBurden} onChange={(v) => up({ cost: { ...cfg.cost, intBurden: v } })} w="56px" /></label>
          <label className="flex items-center gap-1">공통경비배부% <Num value={cfg.cost.comBurden} onChange={(v) => up({ cost: { ...cfg.cost, comBurden: v } })} w="56px" /></label>
        </div>
      </section>

      {/* 기본값 매트릭스 */}
      <section className="bg-white border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[#5b4a3a]">기본값 매트릭스 (예식일·시즌·요일·타임 → 표준값)</h2>
          <button
            onClick={() => up({ presets: [...presets, { period: '~26.8', season: '워크인', day: '토', time: '점심', discount: 0, coursePrice: 0, director: 0, flower: 0, wine: 0, reception: true, fixed: 0, marginRate: 0 }] })}
            className="text-xs border border-[#5b4a3a] text-[#5b4a3a] rounded px-2 py-1">+ 행 추가</button>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse" style={{ minWidth: '1080px' }}>
            <thead>
              <tr className="bg-slate-100 text-gray-600">
                {['구간1', '시즌', '요일', '타임', '할인%', '정가', '연출비', '플라워', '와인', '리셉션', '고정경비', '마진율%', ''].map((h) => (
                  <th key={h} className="border border-gray-300 px-1.5 py-1 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {presets.map((p, i) => (
                <tr key={i} className="hover:bg-yellow-50/50">
                  <td className="border border-gray-300 px-1 py-0.5">
                    <input value={p.period} onChange={(e) => setPreset(i, { period: e.target.value })} className="border border-gray-200 rounded px-1 py-0.5 text-xs w-16" />
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5">
                    <select value={p.season} onChange={(e) => setPreset(i, { season: e.target.value as WCSeason })} className="border border-gray-200 rounded px-1 py-0.5 text-xs">
                      {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5">
                    <select value={p.day} onChange={(e) => setPreset(i, { day: e.target.value as '토' | '일' })} className="border border-gray-200 rounded px-1 py-0.5 text-xs">
                      <option value="토">토</option><option value="일">일</option>
                    </select>
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5">
                    <select value={p.time} onChange={(e) => setPreset(i, { time: e.target.value as '점심' | '저녁' })} className="border border-gray-200 rounded px-1 py-0.5 text-xs">
                      <option value="점심">점심</option><option value="저녁">저녁</option>
                    </select>
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.discount} onChange={(v) => setPreset(i, { discount: v })} w="48px" /></td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.coursePrice} onChange={(v) => setPreset(i, { coursePrice: v })} /></td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.director} onChange={(v) => setPreset(i, { director: v })} /></td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.flower} onChange={(v) => setPreset(i, { flower: v })} /></td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.wine} onChange={(v) => setPreset(i, { wine: v })} w="44px" /></td>
                  <td className="border border-gray-300 px-1 py-0.5 text-center">
                    <input type="checkbox" checked={p.reception} onChange={(e) => setPreset(i, { reception: e.target.checked })} />
                  </td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.fixed} onChange={(v) => setPreset(i, { fixed: v })} /></td>
                  <td className="border border-gray-300 px-1 py-0.5"><Num value={p.marginRate} onChange={(v) => setPreset(i, { marginRate: v })} w="48px" /></td>
                  <td className="border border-gray-300 px-1 py-0.5 text-center">
                    <button onClick={() => up({ presets: presets.filter((_, j) => j !== i) })} className="text-red-500 hover:text-red-700">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          · 시즌 판정: 예식 월이 1·2·7·8월 = 비수기 / 그 외 성수기(고객유형으로 워크인·임직원 분기) ·
          요일·타임은 계산기의 '타임' 선택에서 결정 · 연출비/플라워/와인/리셉션은 참고값(견적빌더가 패키지로 별도 계산).
        </p>
      </section>
    </div>
  );
}
