// 웨딩 예식후보별 마진계산기 + 견적서 모달.
// 참조 HTML(PLENTY_웨딩_견적빌더_마진계산기.html)을 React/TS로 포팅.
// 기준값(CFG)은 서버 settings에서 로드, admin만 편집. 일반 직원은 계산기 뷰어.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
  type WeddingCalcSettings, type CalcInputs, type CourseKey, type FlowerGrade,
  DEFAULT_WEDDING_CALC, defaultInputs, computeMargin, won, pctText, TIER_HEX,
  flowerName, TIME_OPTIONS, summaryText, findPreset, seasonFor, periodFor,
} from '../lib/weddingCalc';
import { buildQuoteHtml, QUOTE_CSS, openQuotePrint } from '../lib/weddingQuote';
import type { WeddingEventInquiry } from '../types';

interface Props {
  inquiry: WeddingEventInquiry;
  idx: number;
  groom: string;
  bride: string;
  canEditSettings: boolean;  // admin: 기준값 편집
  canSave: boolean;          // 웨딩 write 권한: 예식후보에 저장. false면 뷰어.
  onClose: () => void;
  onSaved: (updated: WeddingEventInquiry) => void;
}

type Tab = 'builder' | 'quote' | 'admin';

// 쉼표 숫자 입력 (Admin용)
function NumInput({ value, onChange, w }: { value: number; onChange: (v: number) => void; w?: string }) {
  const [txt, setTxt] = useState(value.toLocaleString('ko-KR'));
  useEffect(() => { setTxt(value.toLocaleString('ko-KR')); }, [value]);
  return (
    <input
      type="text" inputMode="numeric" value={txt}
      style={{ width: w }}
      className="border border-gray-300 rounded px-1.5 py-1 text-xs text-right tabular-nums"
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { const n = parseFloat(txt.replace(/[^0-9.\-]/g, '')) || 0; onChange(n); }}
    />
  );
}

export default function WeddingMarginModal({ inquiry, idx, groom, bride, canEditSettings, canSave, onClose, onSaved }: Props) {
  const [cfg, setCfg] = useState<WeddingCalcSettings | null>(null);
  const [inputs, setInputs] = useState<CalcInputs | null>(null);
  const [tab, setTab] = useState<Tab>('builder');
  const [saving, setSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');

  // ── settings 로드 후 입력 초기화 ──────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      let loaded = DEFAULT_WEDDING_CALC;
      try {
        const res = await api.get<{ setting: { value: WeddingCalcSettings } }>('/api/settings/wedding-calc');
        if (res.setting?.value) loaded = res.setting.value;
      } catch { /* 폴백: DEFAULT */ }
      if (!alive) return;
      // 구버전 설정 호환 — preset/등급기준이 없으면 기본값으로 보강
      loaded = {
        ...loaded,
        presets: (loaded.presets && loaded.presets.length) ? loaded.presets : DEFAULT_WEDDING_CALC.presets,
        tierTeamlead: loaded.tierTeamlead ?? DEFAULT_WEDDING_CALC.tierTeamlead,
        tierExecFloor: loaded.tierExecFloor ?? DEFAULT_WEDDING_CALC.tierExecFloor,
      };
      setCfg(loaded);
      // 프리필: 저장된 calc_payload 우선, 없으면 고객/예식후보에서
      let init: CalcInputs;
      if (inquiry.calc_payload) {
        try {
          const saved = JSON.parse(inquiry.calc_payload) as Partial<CalcInputs>;
          init = defaultInputs(loaded, saved);
          // 배열 길이를 현재 cfg에 맞춰 보정
          init.opt = loaded.optItems.map((_, i) => saved.opt?.[i] ?? false);
          init.otherOn = loaded.otherItems.map((it, i) => saved.otherOn?.[i] ?? !it.off);
          init.otherSvc = loaded.otherItems.map((it, i) => saved.otherSvc?.[i] ?? !!it.svc);
          init.otherQty = loaded.otherItems.map((it, i) => saved.otherQty?.[i] ?? it.qty ?? 1);
        } catch {
          init = defaultInputs(loaded, prefillFromInquiry());
        }
      } else {
        init = defaultInputs(loaded, prefillFromInquiry());
      }
      setInputs(init);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function prefillFromInquiry(): Partial<CalcInputs> {
    return {
      groom, bride,
      wdate: inquiry.wedding_datetime ? inquiry.wedding_datetime.slice(0, 10) : '',
      guests: inquiry.guaranteed_guest_count ?? 250,
    };
  }

  const result = useMemo(() => (cfg && inputs ? computeMargin(inputs, cfg) : null), [cfg, inputs]);

  function setInp(patch: Partial<CalcInputs>) { setInputs((p) => (p ? { ...p, ...patch } : p)); }

  // 슬롯(예식일/고객유형/타임) 변경 시 → 해당 기본값(preset)의 할인%를 자동 적용.
  // preset이 없으면 고객유형의 기본 할인% 사용.
  function applyWithPreset(patch: Partial<CalcInputs>) {
    setInputs((prev) => {
      if (!prev || !cfg) return prev;
      const next = { ...prev, ...patch };
      const preset = findPreset(next, cfg);
      if (preset) next.mealDiscount = preset.discount;
      else if (patch.ctype !== undefined) next.mealDiscount = cfg.ctypes[next.ctype]?.mealDisc ?? next.mealDiscount;
      return next;
    });
  }

  // 고객유형 선택 → 식대할인%(preset 우선)·플라워 업그레이드 자동 적용
  function applyCustomerType(i: number) {
    if (!cfg) return;
    const c = cfg.ctypes[i];
    if (!c) return;
    applyWithPreset({ ctype: i, flowerUp: c.flowerUp, flowerBill: 'basic', flowerGive: c.flowerUp ? 'lux' : 'basic' });
  }
  function applyUpgrade(on: boolean) {
    setInp({ flowerUp: on, flowerBill: 'basic', flowerGive: on ? 'lux' : 'basic' });
  }

  // ── 저장 (예식후보에 결과 반영) ────────────────────────────────────────────
  async function handleSave() {
    if (!inputs || !result) return;
    setSaving(true);
    try {
      const updated: WeddingEventInquiry = {
        ...inquiry,
        estimate_amount: won(result.A),
        estimate_detail: summaryText(inputs, result),
        calc_payload: JSON.stringify(inputs),
      };
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  // ── 기준값 저장 (admin) ────────────────────────────────────────────────────
  async function saveCfg() {
    if (!cfg) return;
    setCfgMsg('저장 중…');
    try {
      await api.put('/api/settings/wedding-calc', { value: cfg });
      setCfgMsg('저장됨 ✓ (전 직원 공유)');
    } catch (e) {
      setCfgMsg('저장 실패: ' + (e as Error).message);
    }
  }
  async function resetCfg() {
    if (!confirm('기본값으로 초기화할까요? (저장 시 전 직원에 반영)')) return;
    setCfg(JSON.parse(JSON.stringify(DEFAULT_WEDDING_CALC)));
    setCfgMsg('기본값 로드됨 — 저장해야 반영');
  }

  if (!cfg || !inputs || !result) {
    return (
      <Overlay onClose={onClose}>
        <div className="p-10 text-center text-gray-500 text-sm">기준값 불러오는 중…</div>
      </Overlay>
    );
  }

  const tg = TIER_HEX[result.tierInfo.color];

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b sticky top-0 bg-white z-10">
        <div className="font-semibold text-sm">🧮 마진계산기 · 예식후보 #{idx + 1} <span className="text-gray-400 font-normal">{groom} & {bride}</span></div>
        <div className="flex items-center gap-1.5">
          {(['builder', 'quote'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-xs px-2.5 py-1 rounded font-medium ${tab === t ? 'bg-[#5b4a3a] text-white' : 'border border-gray-300 text-gray-500'}`}>
              {t === 'builder' ? '🧮 계산기' : '📄 견적서'}
            </button>
          ))}
          {canEditSettings && (
            <button onClick={() => setTab('admin')}
              className={`text-xs px-2.5 py-1 rounded font-medium ${tab === 'admin' ? 'bg-[#5b4a3a] text-white' : 'border border-gray-300 text-gray-500'}`}>
              ⚙ 기준값
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg px-1.5">✕</button>
        </div>
      </div>

      {/* ── 계산기 ── */}
      {tab === 'builder' && (
        <div className="p-4 grid md:grid-cols-2 gap-3">
          {/* 좌: 입력 */}
          <div className="space-y-3">
            <Section title="① 행사 정보">
              <div className="grid grid-cols-2 gap-2">
                <Field label="신랑"><input className="cin" value={inputs.groom} onChange={(e) => setInp({ groom: e.target.value })} /></Field>
                <Field label="신부"><input className="cin" value={inputs.bride} onChange={(e) => setInp({ bride: e.target.value })} /></Field>
                <Field label="예식일"><input type="date" className="cin" value={inputs.wdate} onChange={(e) => applyWithPreset({ wdate: e.target.value })} /></Field>
                <Field label="보증인원"><input type="number" className="cin" value={inputs.guests} onChange={(e) => setInp({ guests: Number(e.target.value) })} /></Field>
                <Field label="고객 유형">
                  <select className="cin" value={inputs.ctype} onChange={(e) => applyCustomerType(Number(e.target.value))}>
                    {cfg.ctypes.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="타임">
                  <select className="cin" value={inputs.time} onChange={(e) => applyWithPreset({ time: e.target.value })}>
                    {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="가격 적용기간"><input className="cin bg-gray-100" disabled value={result.pr.label} /></Field>
              </div>
            </Section>

            <Section title="② FOOD & BEVERAGE">
              <div className="grid grid-cols-3 gap-2">
                <Field label="코스">
                  <select className="cin" value={inputs.course} onChange={(e) => setInp({ course: e.target.value as CourseKey })}>
                    <option value="A">A Course</option><option value="B">B Course</option><option value="C">C Course</option>
                  </select>
                </Field>
                <Field label="코스 단가(1인·정가)"><input className="cin bg-gray-100" disabled value={won(result.listMeal) + ' 원'} /></Field>
                <Field label={`식대 할인율 (${inputs.mealDiscount}%)`}>
                  <input type="range" min={0} max={30} step={0.5} value={inputs.mealDiscount} onChange={(e) => setInp({ mealDiscount: Number(e.target.value) })} className="w-full accent-[#5b4a3a]" />
                </Field>
              </div>
            </Section>

            <Section title="③ FLOWER">
              <div className="grid grid-cols-2 gap-2">
                <Field label="청구 등급(고객 결제)">
                  <select className="cin" value={inputs.flowerBill} onChange={(e) => setInp({ flowerBill: e.target.value as FlowerGrade })}>
                    <option value="basic">Basic</option><option value="lux">Luxury</option><option value="grand">Grand</option>
                  </select>
                </Field>
                <Field label="제공 등급(실제 제공)">
                  <select className="cin" value={inputs.flowerGive} onChange={(e) => setInp({ flowerGive: e.target.value as FlowerGrade })}>
                    <option value="basic">Basic</option><option value="lux">Luxury</option><option value="grand">Grand</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-1.5 mt-2 text-xs text-[#5b4a3a] font-medium cursor-pointer">
                <input type="checkbox" checked={inputs.flowerUp} onChange={(e) => applyUpgrade(e.target.checked)} />
                🎁 플라워 무료 업그레이드 (청구 Basic · 제공 Luxury)
              </label>
              {result.flowerBenefit > 0 && (
                <div className="mt-2 text-[11px] bg-[#fff7e8] border-l-2 border-[#b8860b] rounded px-2 py-1.5">
                  🎁 무료 업그레이드({flowerName(inputs.flowerBill)}→{flowerName(inputs.flowerGive)}) — 고객 체감 <b>+{won(result.flowerBenefit)}</b> / 회사 실비용 <b>+{won(result.flowerBenefit * cfg.cost.flowerCostR / 100)}</b> · 대관 현금할인 대비 <b className="text-[#1f9d5b]">{won(result.flowerBenefit * (1 - cfg.cost.flowerCostR / 100))} 유리</b>
                </div>
              )}
            </Section>

            <Section title="④ RENTAL & DIRECTION (패키지) + 옵션">
              <div className="text-[11px] text-gray-500">패키지 정상가 <b className="line-through">{won(cfg.rentList)}</b> → 특별가 <b className="text-[#c0392b]">{won(cfg.rentSpecial)}</b> (혜택 {won(result.rentBenefit)}) · 전 고객 묶음 제공</div>
              <div className="mt-2 space-y-1">
                <div className="text-[11px] text-gray-400">추가 옵션 (별도 청구 · 무료 아님)</div>
                {cfg.optItems.map((it, i) => (
                  <label key={i} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={inputs.opt[i]} onChange={(e) => { const opt = [...inputs.opt]; opt[i] = e.target.checked; setInp({ opt }); }} />
                    {it.n} <span className="text-gray-400">({won(it.p)})</span>
                  </label>
                ))}
              </div>
            </Section>

            <Section title="⑤ OTHERS / SPECIAL GIFT (체크=제공, SVC=무상)">
              {cfg.otherItems.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <input type="checkbox" checked={inputs.otherOn[i]} onChange={(e) => { const a = [...inputs.otherOn]; a[i] = e.target.checked; setInp({ otherOn: a }); }} />
                  <span className="flex-1">{it.n} <span className="text-gray-400">{it.qtyMode ? `(${won(it.p)}×수량)` : `(${won(it.p)})`}</span></span>
                  {it.qtyMode && (
                    <input type="number" className="w-14 border border-gray-300 rounded px-1 py-0.5 text-xs text-right" value={inputs.otherQty[i]}
                      onChange={(e) => { const a = [...inputs.otherQty]; a[i] = Number(e.target.value); setInp({ otherQty: a }); }} />
                  )}
                  <label className="flex items-center gap-0.5 text-[10.5px]">
                    <input type="checkbox" checked={inputs.otherSvc[i]} onChange={(e) => { const a = [...inputs.otherSvc]; a[i] = e.target.checked; setInp({ otherSvc: a }); }} /> SVC
                  </label>
                </div>
              ))}
            </Section>
          </div>

          {/* 우: 결과 */}
          <div className="space-y-3">
            <Section title="⑥ 마진 결과">
              <div className="rounded-lg py-2 text-center font-extrabold text-[15px]" style={{ background: tg.bg, color: tg.fg }}>{result.tierInfo.t}</div>
              {(() => {
                const teamFloor = inputs.time.includes('토') && inputs.time.includes('점심')
                  ? (cfg.tierTeamlead?.lunchSat ?? 50) : (cfg.tierTeamlead?.other ?? 44);
                const exec = cfg.tierExecFloor ?? 38;
                return (
                  <div className="flex text-[10px] rounded overflow-hidden border border-gray-200 my-2">
                    <div className="flex-1 text-center py-0.5 text-white" style={{ background: '#c0392b' }}>거절&lt;{exec}%</div>
                    <div className="flex-1 text-center py-0.5 text-white" style={{ background: '#d2691e' }}>대표 {exec}~{teamFloor}%</div>
                    <div className="flex-1 text-center py-0.5 text-white" style={{ background: '#b8860b' }}>팀장 {teamFloor}~{result.autoMargin}%</div>
                    <div className="flex-1 text-center py-0.5 text-white" style={{ background: '#1f9d5b' }}>자율 ≥{result.autoMargin}%</div>
                  </div>
                );
              })()}
              {/* 이 슬롯 기본값(표준) */}
              {result.preset ? (
                <div className="text-[11px] bg-[#eef5ff] border border-[#cfe0f5] rounded px-2 py-1.5 mb-2">
                  <span className="font-semibold text-[#2b6cb0]">📌 이 슬롯 표준값</span> ·
                  표준할인 <b>{result.preset.discount}%</b> · 정가 <b>{won(result.preset.coursePrice)}</b> ·
                  연출비 <b>{won(result.preset.director)}</b> · 플라워 <b>{won(result.preset.flower)}</b> ·
                  와인 <b>{result.preset.wine}</b> · 리셉션 <b>{result.preset.reception ? 'Y' : 'N'}</b> ·
                  표준마진 <b className="text-[#1f9d5b]">{result.preset.marginRate}%</b>
                </div>
              ) : (
                <div className="text-[11px] bg-gray-50 border border-gray-200 rounded px-2 py-1.5 mb-2 text-gray-400">
                  이 슬롯의 기본값 없음 — 예식일·고객유형·요일·타임을 확인하세요. (자율 기준 {result.autoMargin}% 폴백)
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Kpi lab="고객 최종견적(A)" val={won(result.A)} />
                <Kpi lab="총 혜택" val={won(result.totalBenefit)} valColor="#c0392b" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Kpi lab={`시트 마진율 (자율 ${result.autoMargin}%)`} val={pctText(result.fut.sheet)} hi />
                <Kpi lab="실제(올해)" val={pctText(result.now.real)} />
                <Kpi lab="실제(행사시점)" val={pctText(result.fut.real)} />
              </div>
              <div className="mt-2 text-[11px] bg-[#fff7e8] border-l-2 border-[#b8860b] rounded px-2 py-1.5">
                {result.headroom > 0
                  ? <>자율({result.autoMargin}%)까지 추가 할인여력: <b>{won(result.headroom)}원</b> · 할인 1원=수익 1원 감소</>
                  : <b className="text-[#c0392b]">이미 자율 기준 아래 — 승인 필요</b>}
              </div>
            </Section>

            <Section title="⑦ 원가 상승 예측(행사시점)">
              <Field label={`인건비 상승률 (+${inputs.laborInf}%)`}>
                <input type="range" min={0} max={15} step={0.5} value={inputs.laborInf} onChange={(e) => setInp({ laborInf: Number(e.target.value) })} className="w-full accent-[#5b4a3a]" />
              </Field>
              <Field label={`식자재 상승률 (+${inputs.foodInf}%)`}>
                <input type="range" min={0} max={15} step={0.5} value={inputs.foodInf} onChange={(e) => setInp({ foodInf: Number(e.target.value) })} className="w-full accent-[#5b4a3a]" />
              </Field>
              <div className="text-[11px] text-gray-400 mt-1">웨딩은 1년 전 계약 → 행사시점(상승 반영) 마진으로 등급 판정.</div>
            </Section>

            <Section title="⑧ 원가 분해">
              <table className="w-full text-[11.5px]">
                <tbody>
                  <Row l={`식대 (${inputs.course}코스 ${won(result.effMeal)}×${result.guests})`} r={won(result.mealRev)} />
                  <Row l="플라워(청구) / 렌탈패키지 / 옵션·기타" r={won(result.flowerRev + result.rentRev + result.optLines.reduce((s, it) => s + it.p, 0) + result.otherLines.filter((o) => !o.svc).reduce((s, o) => s + o.p, 0))} />
                  <Row l="A 고객견적" r={won(result.A)} bold />
                  <Row l="식대원가(행사시점) / 외부인건비" r={'-' + won(result.fut.food + result.fut.ext)} />
                  <Row l="플라워원가(제공) / 고정경비" r={'-' + won(result.fut.flowerCost + cfg.cost.fixed)} />
                  <Row l="C 시트수익" r={`${won(result.fut.C)} (${pctText(result.fut.sheet)})`} bold />
                  <Row l="-내부인건비 / -공통경비" r={'-' + won((result.fut.intB + result.fut.comB) * result.A)} />
                  <Row l="실제 영업이익(행사시점)" r={`${won(result.fut.realWon)} (${pctText(result.fut.real)})`} bold color={result.fut.realWon >= 0 ? '#1f9d5b' : '#c0392b'} />
                </tbody>
              </table>
            </Section>

            <button onClick={() => setTab('quote')} className="w-full bg-[#5b4a3a] text-white rounded-lg py-2 text-sm font-semibold">📄 고객 견적서 만들기</button>
          </div>
        </div>
      )}

      {/* ── 견적서 ── */}
      {tab === 'quote' && (
        <div className="p-4">
          <style>{QUOTE_CSS}</style>
          <div className="max-w-[840px] mx-auto mb-3 flex gap-2">
            <button onClick={() => openQuotePrint(inputs, cfg, result)} className="flex-1 bg-[#5b4a3a] text-white rounded-lg py-2 text-sm font-semibold">🖨 인쇄 / PDF 저장</button>
            <button onClick={() => setTab('builder')} className="px-4 rounded-lg border border-gray-300 text-gray-600 text-sm">← 계산기</button>
          </div>
          <div className="qbox" dangerouslySetInnerHTML={{ __html: buildQuoteHtml(inputs, cfg, result) }} />
        </div>
      )}

      {/* ── Admin (기준값) ── */}
      {tab === 'admin' && canEditSettings && (
        <AdminEditor cfg={cfg} setCfg={setCfg} onSave={saveCfg} onReset={resetCfg} msg={cfgMsg} />
      )}

      {/* 하단 저장 바 (계산기/견적서 탭) */}
      {tab !== 'admin' && (
        <div className="sticky bottom-0 bg-white border-t px-4 py-2.5 flex items-center justify-end gap-2">
          <span className="text-xs text-gray-400 mr-auto">
            {canSave ? `저장 시 예식후보 #${idx + 1}에 견적금액·요약이 반영됩니다.` : '뷰어 모드 — 계산만 가능 (저장 권한 없음)'}
          </span>
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-600">닫기</button>
          {canSave && (
            <button onClick={handleSave} disabled={saving} className="text-sm px-4 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">{saving ? '저장 중…' : '예식후보에 저장'}</button>
          )}
        </div>
      )}

      <style>{`.cin{width:100%;padding:6px 8px;border:1px solid #e4ded3;border-radius:6px;font-size:13px}`}</style>
    </Overlay>
  );
}

// ── 공통 UI ──────────────────────────────────────────────────────────────────
function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-3" onClick={onClose}>
      <div className="bg-[#f4f1ec] rounded-xl shadow-xl w-full max-w-5xl my-4" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e4ded3] rounded-xl p-3">
      <h3 className="text-[13px] text-[#5b4a3a] font-semibold border-b border-[#e4ded3] pb-1.5 mb-2.5">{title}</h3>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-[11.5px] text-gray-500 mb-1">{label}</label>{children}</div>;
}
function Kpi({ lab, val, valColor, hi }: { lab: string; val: string; valColor?: string; hi?: boolean }) {
  return (
    <div className="rounded-lg p-2 border border-[#e4ded3]" style={{ background: hi ? '#f3ede2' : '#efe9df' }}>
      <div className="text-[10.5px] text-gray-500">{lab}</div>
      <div className="text-[18px] font-extrabold" style={{ color: valColor }}>{val}</div>
    </div>
  );
}
function Row({ l, r, bold, color }: { l: string; r: string; bold?: boolean; color?: string }) {
  return (
    <tr className="border-b border-[#e4ded3]">
      <td className={`py-1 ${bold ? 'font-bold' : ''}`}>{l}</td>
      <td className={`py-1 text-right tabular-nums ${bold ? 'font-bold' : ''}`} style={{ color }}>{r}</td>
    </tr>
  );
}

// ── Admin 편집기 ─────────────────────────────────────────────────────────────
function AdminEditor({ cfg, setCfg, onSave, onReset, msg }: {
  cfg: WeddingCalcSettings; setCfg: (c: WeddingCalcSettings) => void;
  onSave: () => void; onReset: () => void; msg: string;
}) {
  const up = (patch: Partial<WeddingCalcSettings>) => setCfg({ ...cfg, ...patch });
  const N = (v: number, on: (n: number) => void) => <NumInput value={v} onChange={on} w="92px" />;
  const T = (v: string, on: (s: string) => void, w?: string) => (
    <input value={v} onChange={(e) => on(e.target.value)} style={{ width: w }} className="border border-gray-300 rounded px-1.5 py-1 text-xs" />
  );

  return (
    <div className="p-4 space-y-3">
      {/* 가격표 */}
      <Section title="⚙ 가격표 (예식일 기준 자동 적용 · VAT 포함)">
        {cfg.price.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1.5 flex-wrap text-[10px] text-gray-500">
            이후 {T(p.from, (v) => { const a = [...cfg.price]; a[i] = { ...p, from: v }; up({ price: a }); }, '92px')}
            A {N(p.A, (v) => { const a = [...cfg.price]; a[i] = { ...p, A: v }; up({ price: a }); })}
            B {N(p.B, (v) => { const a = [...cfg.price]; a[i] = { ...p, B: v }; up({ price: a }); })}
            C {N(p.C, (v) => { const a = [...cfg.price]; a[i] = { ...p, C: v }; up({ price: a }); })}
            F.B {N(p.fB, (v) => { const a = [...cfg.price]; a[i] = { ...p, fB: v }; up({ price: a }); })}
            F.L {N(p.fL, (v) => { const a = [...cfg.price]; a[i] = { ...p, fL: v }; up({ price: a }); })}
            F.G {N(p.fG, (v) => { const a = [...cfg.price]; a[i] = { ...p, fG: v }; up({ price: a }); })}
            <button onClick={() => up({ price: cfg.price.filter((_, j) => j !== i) })} className="text-[#c0392b] bg-[#fbe9e7] border border-[#f0b7ae] rounded px-1.5">×</button>
          </div>
        ))}
        <button onClick={() => up({ price: [...cfg.price, { label: '', from: '2099-01-01', A: 0, B: 0, C: 0, fB: 0, fL: 0, fG: 0 }] })} className="text-xs border border-[#5b4a3a] text-[#5b4a3a] rounded px-2 py-1">+ 기간 추가</button>
      </Section>

      {/* 렌탈 */}
      <Section title="⚙ RENTAL & DIRECTION 패키지">
        <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-2">
          패키지 정상가 {N(cfg.rentList, (v) => up({ rentList: v }))} 특별가(제공) {N(cfg.rentSpecial, (v) => up({ rentSpecial: v }))}
        </div>
        {cfg.rentItems.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1">
            {T(it.n, (v) => { const a = [...cfg.rentItems]; a[i] = { ...it, n: v }; up({ rentItems: a }); }, '150px')}
            {T(it.rmk, (v) => { const a = [...cfg.rentItems]; a[i] = { ...it, rmk: v }; up({ rentItems: a }); }, '320px')}
            <button onClick={() => up({ rentItems: cfg.rentItems.filter((_, j) => j !== i) })} className="text-[#c0392b] bg-[#fbe9e7] border border-[#f0b7ae] rounded px-1.5">×</button>
          </div>
        ))}
        <button onClick={() => up({ rentItems: [...cfg.rentItems, { n: '새 항목', rmk: '' }] })} className="text-xs border border-[#5b4a3a] text-[#5b4a3a] rounded px-2 py-1">+ 세부항목</button>
      </Section>

      {/* 옵션 */}
      <Section title="⚙ 옵션 항목 (별도 청구)">
        {cfg.optItems.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1">
            {T(it.n, (v) => { const a = [...cfg.optItems]; a[i] = { ...it, n: v }; up({ optItems: a }); }, '120px')}
            {N(it.p, (v) => { const a = [...cfg.optItems]; a[i] = { ...it, p: v }; up({ optItems: a }); })}
            {T(it.rmk, (v) => { const a = [...cfg.optItems]; a[i] = { ...it, rmk: v }; up({ optItems: a }); }, '240px')}
            <span className="text-[10px] text-gray-400">보증≥</span>{N(it.minG, (v) => { const a = [...cfg.optItems]; a[i] = { ...it, minG: v }; up({ optItems: a }); })}
            <button onClick={() => up({ optItems: cfg.optItems.filter((_, j) => j !== i) })} className="text-[#c0392b] bg-[#fbe9e7] border border-[#f0b7ae] rounded px-1.5">×</button>
          </div>
        ))}
        <button onClick={() => up({ optItems: [...cfg.optItems, { n: '새 옵션', p: 0, rmk: '', minG: 0 }] })} className="text-xs border border-[#5b4a3a] text-[#5b4a3a] rounded px-2 py-1">+ 옵션</button>
      </Section>

      {/* 고객유형 */}
      <Section title="⚙ 고객유형별 할인 기준">
        {cfg.ctypes.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1 text-[10px] text-gray-500">
            {T(c.name, (v) => { const a = [...cfg.ctypes]; a[i] = { ...c, name: v }; up({ ctypes: a }); }, '120px')}
            식대할인% {N(c.mealDisc, (v) => { const a = [...cfg.ctypes]; a[i] = { ...c, mealDisc: v }; up({ ctypes: a }); })}
            <select value={c.flowerUp ? '1' : '0'} onChange={(e) => { const a = [...cfg.ctypes]; a[i] = { ...c, flowerUp: e.target.value === '1' }; up({ ctypes: a }); }} className="border border-gray-300 rounded px-1 py-1 text-xs">
              <option value="1">플라워 업그레이드 적용</option><option value="0">미적용</option>
            </select>
            <button onClick={() => up({ ctypes: cfg.ctypes.filter((_, j) => j !== i) })} className="text-[#c0392b] bg-[#fbe9e7] border border-[#f0b7ae] rounded px-1.5">×</button>
          </div>
        ))}
        <button onClick={() => up({ ctypes: [...cfg.ctypes, { name: '새 유형', mealDisc: 0, flowerUp: false }] })} className="text-xs border border-[#5b4a3a] text-[#5b4a3a] rounded px-2 py-1">+ 유형</button>
      </Section>

      {/* OTHERS */}
      <Section title="⚙ OTHERS / SPECIAL GIFT">
        {cfg.otherItems.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1">
            {T(it.n, (v) => { const a = [...cfg.otherItems]; a[i] = { ...it, n: v }; up({ otherItems: a }); }, '150px')}
            {N(it.p, (v) => { const a = [...cfg.otherItems]; a[i] = { ...it, p: v }; up({ otherItems: a }); })}
            {T(it.rmk, (v) => { const a = [...cfg.otherItems]; a[i] = { ...it, rmk: v }; up({ otherItems: a }); }, '220px')}
            <select value={it.svc ? '1' : '0'} onChange={(e) => { const a = [...cfg.otherItems]; a[i] = { ...it, svc: e.target.value === '1' }; up({ otherItems: a }); }} className="border border-gray-300 rounded px-1 py-1 text-xs">
              <option value="1">SVC기본</option><option value="0">유상</option>
            </select>
            <button onClick={() => up({ otherItems: cfg.otherItems.filter((_, j) => j !== i) })} className="text-[#c0392b] bg-[#fbe9e7] border border-[#f0b7ae] rounded px-1.5">×</button>
          </div>
        ))}
        <button onClick={() => up({ otherItems: [...cfg.otherItems, { n: '새 항목', p: 0, rmk: '', svc: true }] })} className="text-xs border border-[#5b4a3a] text-[#5b4a3a] rounded px-2 py-1">+ 항목</button>
      </Section>

      {/* 원가 */}
      <Section title="⚙ 원가 가정 / 배부율">
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500">
          A식대원가/인 {N(cfg.cost.foodA, (v) => up({ cost: { ...cfg.cost, foodA: v } }))}
          B {N(cfg.cost.foodB, (v) => up({ cost: { ...cfg.cost, foodB: v } }))}
          C {N(cfg.cost.foodC, (v) => up({ cost: { ...cfg.cost, foodC: v } }))}
          외부인건비/인 {N(cfg.cost.extPP, (v) => up({ cost: { ...cfg.cost, extPP: v } }))}
          고정경비 {N(cfg.cost.fixed, (v) => up({ cost: { ...cfg.cost, fixed: v } }))}
          플라워원가율% {N(cfg.cost.flowerCostR, (v) => up({ cost: { ...cfg.cost, flowerCostR: v } }))}
          내부인건비배부% {N(cfg.cost.intBurden, (v) => up({ cost: { ...cfg.cost, intBurden: v } }))}
          공통경비배부% {N(cfg.cost.comBurden, (v) => up({ cost: { ...cfg.cost, comBurden: v } }))}
        </div>
      </Section>

      <div className="flex items-center gap-2">
        <button onClick={onSave} className="bg-[#5b4a3a] text-white rounded-lg px-4 py-2 text-sm font-semibold">💾 기준값 저장 (전 직원 공유)</button>
        <button onClick={onReset} className="border border-[#5b4a3a] text-[#5b4a3a] rounded-lg px-3 py-2 text-sm">기본값 초기화</button>
        <span className="text-xs text-gray-500">{msg}</span>
      </div>
    </div>
  );
}
