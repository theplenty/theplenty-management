// 통계 분석 (로드맵 A8) — 사용자 정의 피벗 + 다년 추이 + 전환 퍼널.
//
// "원하는 주제를 직접 골라 끄는 통계" 가 요구사항이라 화면을 주제별로 고정하지 않았다.
// 사용자는 [무엇을 볼지(데이터셋)] · [세로축] · [가로축] · [무엇을 셀지(측정값)] 네 개만 고르면 된다.
// 다년 비교(3년 추이)는 별도 화면이 아니라 '가로축 = 연도' 인 조합이라, 프리셋으로 한 번에 잡아준다.
//
// 집계는 전부 서버(/api/stats)에서 한다 — 화면은 그리기만.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { exportToXlsx } from '../lib/excel';
import { todayKst } from '../lib/dateFmt';

// ── 서버 응답 타입 ─────────────────────────────────────────────────────────
interface FieldMeta {
  key: string;
  label: string;
  group: string;
  multi: boolean;
}
interface MeasureMeta {
  key: string;
  label: string;
  unit: 'count' | 'money' | 'number' | 'percent';
}
interface DatasetMeta {
  id: string;
  label: string;
  hint: string;
  fields: FieldMeta[];
  measures: MeasureMeta[];
}
interface PivotResult {
  dataset: string;
  row_field: string;
  col_field: string | null;
  measure: string;
  measure_label: string;
  unit: string;
  row_labels: string[];
  col_labels: string[];
  cells: (number | null)[][];
  row_totals: (number | null)[];
  col_totals: (number | null)[];
  grand_total: number | null;
  source_count: number;
  warnings: string[];
}
interface FunnelStage {
  key: string;
  label: string;
  count: number;
  rate_from_start: number;
  rate_from_prev: number;
}
interface FunnelResult {
  type: 'MICE' | 'WEDDING';
  total: number;
  stages: FunnelStage[];
}

// ── 프리셋 — 자주 볼 조합을 클릭 한 번으로 ─────────────────────────────────
interface Preset {
  name: string;
  desc: string;
  dataset: string;
  row: string;
  col: string;
  measure: string;
}
const PRESETS: Preset[] = [
  { name: '연도별 매출 (다년 비교)', desc: '연도 × 구분 · 실매출', dataset: 'events', row: 'year', col: 'event_type', measure: 'sales_total' },
  { name: '월별 매출 추이 (3년)', desc: '월 × 연도 · 실매출', dataset: 'events', row: 'month', col: 'year', measure: 'sales_total' },
  { name: '담당자별 실적', desc: '담당자 × 연도 · 실매출', dataset: 'events', row: 'manager', col: 'year', measure: 'sales_total' },
  { name: '홀 가동 현황', desc: '홀 × 연도 · 행사 건수', dataset: 'events', row: 'hall', col: 'year', measure: 'count' },
  { name: '요일별 행사 분포', desc: '요일 × 구분 · 행사 건수', dataset: 'events', row: 'weekday', col: 'event_type', measure: 'count' },
  { name: '인콜/아웃콜 전환율', desc: '유입채널 × 연도 · 전환율', dataset: 'mice', row: 'channel', col: 'year', measure: 'conversion' },
  { name: '웨딩 유입경로별 전환율', desc: '유입경로 × 연도 · 전환율', dataset: 'wedding', row: 'source', col: 'year', measure: 'conversion' },
  { name: '좌석 규모별 단가', desc: '좌석 규모 × 구분 · 건당 평균 매출', dataset: 'events', row: 'seats_bucket', col: 'event_type', measure: 'sales_avg' },
  { name: '누구에게 얼마나 깎아줬나', desc: '고객유형 × 식대 할인율 · 견적 건수', dataset: 'quotes', row: 'customer_type', col: 'discount', measure: 'count' },
  { name: '견적 1인당 단가', desc: '보증인원 규모 × 예식 시간대 · 1인당 견적금액', dataset: 'quotes', row: 'guest_bucket', col: 'slot', measure: 'per_guest' },
];

// ── 표시 헬퍼 ──────────────────────────────────────────────────────────────
function fmt(v: number | null, unit: string): string {
  if (v === null) return '–';
  if (unit === 'money') return Math.round(v).toLocaleString('ko-KR');
  if (unit === 'percent') return `${v.toFixed(1)}%`;
  if (unit === 'count') return Math.round(v).toLocaleString('ko-KR');
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/** 값 크기에 비례한 배경색 — 표에서 큰 값이 바로 눈에 띄게 */
function heatStyle(v: number | null, max: number): React.CSSProperties {
  if (v === null || max <= 0 || v <= 0) return {};
  const t = Math.min(1, v / max);
  return { backgroundColor: `rgba(37, 99, 235, ${(t * 0.18).toFixed(3)})` };
}

const todayStr = todayKst;

export default function Stats() {
  const [meta, setMeta] = useState<DatasetMeta[]>([]);
  const [dataset, setDataset] = useState('events');
  const [rowField, setRowField] = useState('year');
  const [colField, setColField] = useState('event_type');
  const [measure, setMeasure] = useState('sales_total');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [result, setResult] = useState<PivotResult | null>(null);
  const [funnels, setFunnels] = useState<FunnelResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ds = useMemo(() => meta.find((m) => m.id === dataset), [meta, dataset]);

  // 축을 group 별로 묶어 <optgroup> 으로 그린다 (기간/행사/사람/…)
  const fieldGroups = useMemo(() => {
    const g = new Map<string, FieldMeta[]>();
    for (const f of ds?.fields || []) {
      if (!g.has(f.group)) g.set(f.group, []);
      g.get(f.group)!.push(f);
    }
    return [...g.entries()];
  }, [ds]);

  useEffect(() => {
    api
      .get<{ datasets: DatasetMeta[] }>('/api/stats/meta')
      .then((r) => setMeta(r.datasets))
      .catch((e) => setError((e as Error).message));
  }, []);

  // 데이터셋을 바꾸면 이전 축이 존재하지 않을 수 있어 첫 번째 값으로 되돌린다.
  useEffect(() => {
    if (!ds) return;
    if (!ds.fields.some((f) => f.key === rowField)) setRowField(ds.fields[0]?.key || '');
    if (colField && !ds.fields.some((f) => f.key === colField)) setColField('');
    if (!ds.measures.some((m) => m.key === measure)) setMeasure(ds.measures[0]?.key || '');
  }, [ds, rowField, colField, measure]);

  const run = useCallback(async () => {
    if (!rowField || !measure) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<PivotResult>('/api/stats/pivot', {
        dataset,
        row_field: rowField,
        col_field: colField || null,
        measure,
        date_from: from || null,
        date_to: to || null,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [dataset, rowField, colField, measure, from, to]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    Promise.all([
      api.get<FunnelResult>(`/api/stats/funnel?type=MICE&${qs}`),
      api.get<FunnelResult>(`/api/stats/funnel?type=WEDDING&${qs}`),
    ])
      .then(setFunnels)
      .catch(() => setFunnels([]));
  }, [from, to]);

  function applyPreset(p: Preset) {
    setDataset(p.dataset);
    setRowField(p.row);
    setColField(p.col);
    setMeasure(p.measure);
  }

  const maxCell = useMemo(() => {
    if (!result) return 0;
    let m = 0;
    for (const row of result.cells) for (const v of row) if (v !== null && v > m) m = v;
    return m;
  }, [result]);

  async function download() {
    if (!result) return;
    const colHeads = result.col_labels.length ? result.col_labels : ['값'];
    const columns = [
      { key: '_row', header: rowLabelOf(result.row_field), width: 24 },
      ...colHeads.map((c) => ({ key: c, header: c, width: 16 })),
      { key: '_total', header: '합계', width: 16 },
    ];
    const rows = result.row_labels.map((rl, i) => {
      const o: Record<string, unknown> = { _row: rl, _total: result.row_totals[i] };
      colHeads.forEach((c, j) => (o[c] = result.cells[i][j]));
      return o;
    });
    const totalRow: Record<string, unknown> = { _row: '총계', _total: result.grand_total };
    colHeads.forEach((c, j) => (totalRow[c] = result.col_totals[j]));
    rows.push(totalRow);

    await exportToXlsx({
      filename: `통계_${result.measure_label}_${todayStr()}.xlsx`,
      sheetName: result.measure_label.slice(0, 30),
      rows,
      columns,
    });
  }

  function rowLabelOf(key: string): string {
    return ds?.fields.find((f) => f.key === key)?.label || key;
  }

  const colHeads = result?.col_labels.length ? result.col_labels : ['값'];

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">📊 통계 분석</h1>
        <p className="text-sm text-gray-500 mt-1">
          보고 싶은 축을 직접 골라 집계합니다. 가로축을 <b>연도</b>로 두면 다년 비교가 됩니다.
        </p>
      </header>

      {/* 프리셋 */}
      <section className="mb-4">
        <div className="text-xs font-semibold text-gray-500 mb-2">자주 보는 조합</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const on = p.dataset === dataset && p.row === rowField && p.col === colField && p.measure === measure;
            return (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                title={p.desc}
                className={`text-sm px-3 py-1.5 rounded-full border transition ${
                  on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-gray-50 border-gray-300'
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      </section>

      {/* 축 선택 */}
      <section className="bg-white border rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Selector label="무엇을 볼까요" value={dataset} onChange={setDataset}>
            {meta.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Selector>

          <Selector label="세로축 (행)" value={rowField} onChange={setRowField}>
            {fieldGroups.map(([g, fs]) => (
              <optgroup key={g} label={g}>
                {fs.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Selector>

          <Selector label="가로축 (열) — 선택" value={colField} onChange={setColField}>
            <option value="">없음 (한 줄로 집계)</option>
            {fieldGroups.map(([g, fs]) => (
              <optgroup key={g} label={g}>
                {fs
                  .filter((f) => f.key !== rowField)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Selector>

          <Selector label="무엇을 셀까요 (값)" value={measure} onChange={setMeasure}>
            {(ds?.measures || []).map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Selector>
        </div>

        <div className="flex flex-wrap items-end gap-3 mt-3 pt-3 border-t">
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">기간 시작</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-gray-500 mb-1">기간 끝</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded px-2 py-1" />
          </label>
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }} className="text-sm text-gray-500 underline pb-1">
              기간 해제
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={download}
            disabled={!result}
            className="text-sm px-3 py-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            📥 엑셀로 받기
          </button>
        </div>
        {ds && <p className="text-xs text-gray-400 mt-2">{ds.hint}</p>}
      </section>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">{error}</div>}

      {/* 피벗 표 */}
      <section className="bg-white border rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b flex flex-wrap items-baseline gap-2">
          <h2 className="font-semibold">
            {rowLabelOf(rowField)}
            {colField ? ` × ${rowLabelOf(colField)}` : ''} — {result?.measure_label || ''}
          </h2>
          {result && (
            <span className="text-xs text-gray-500">
              대상 {result.source_count.toLocaleString('ko-KR')}건 · {result.row_labels.length}행
            </span>
          )}
          {loading && <span className="text-xs text-blue-600">계산 중…</span>}
        </div>

        {result?.warnings.map((w) => (
          <div key={w} className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs">
            ⚠ {w}
          </div>
        ))}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left px-3 py-2 border-b sticky left-0 bg-gray-50 z-10">{rowLabelOf(rowField)}</th>
                {colHeads.map((c) => (
                  <th key={c} className="text-right px-3 py-2 border-b whitespace-nowrap">
                    {c}
                  </th>
                ))}
                <th className="text-right px-3 py-2 border-b bg-gray-100 font-bold">합계</th>
              </tr>
            </thead>
            <tbody>
              {result?.row_labels.map((rl, i) => (
                <tr key={rl} className="hover:bg-blue-50/40">
                  <td className="px-3 py-1.5 border-b sticky left-0 bg-white z-10">{rl}</td>
                  {colHeads.map((c, j) => (
                    <td
                      key={c}
                      className="text-right px-3 py-1.5 border-b tabular-nums"
                      style={heatStyle(result.cells[i][j], maxCell)}
                    >
                      {fmt(result.cells[i][j], result.unit)}
                    </td>
                  ))}
                  <td className="text-right px-3 py-1.5 border-b bg-gray-50 font-semibold tabular-nums">
                    {fmt(result.row_totals[i], result.unit)}
                  </td>
                </tr>
              ))}
              {!result?.row_labels.length && !loading && (
                <tr>
                  <td colSpan={colHeads.length + 2} className="px-3 py-8 text-center text-gray-400">
                    조건에 맞는 데이터가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
            {!!result?.row_labels.length && (
              <tfoot>
                <tr className="bg-gray-100 font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-gray-100 z-10">총계</td>
                  {colHeads.map((c, j) => (
                    <td key={c} className="text-right px-3 py-2 tabular-nums">
                      {fmt(result.col_totals[j], result.unit)}
                    </td>
                  ))}
                  <td className="text-right px-3 py-2 tabular-nums">{fmt(result.grand_total, result.unit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {result?.unit === 'percent' && (
          <p className="px-4 py-2 text-xs text-gray-500 border-t">
            비율은 각 칸의 모집단으로 다시 계산합니다 — 칸 값을 더해도 합계가 되지 않습니다.
          </p>
        )}
      </section>

      {/* 전환 퍼널 */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {funnels.map((f) => (
          <div key={f.type} className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold mb-1">{f.type === 'MICE' ? 'MICE 전환 퍼널' : '웨딩 전환 퍼널'}</h2>
            <p className="text-xs text-gray-500 mb-3">문의 {f.total.toLocaleString('ko-KR')}건 기준 · 현재 상태 스냅샷</p>
            <div className="space-y-2">
              {f.stages.map((s) => (
                <div key={s.key}>
                  <div className="flex justify-between text-sm mb-0.5">
                    <span>{s.label}</span>
                    <span className="tabular-nums">
                      <b>{s.count.toLocaleString('ko-KR')}</b>
                      <span className="text-gray-400"> · {s.rate_from_start.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded"
                      style={{ width: `${Math.max(0.5, s.rate_from_start)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Selector({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm block">
      <span className="block text-xs text-gray-500 mb-1">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border rounded px-2 py-1.5 bg-white">
        {children}
      </select>
    </label>
  );
}
