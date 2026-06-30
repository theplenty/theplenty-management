// 월말 메뉴별 식음 표준원가 — 폐기율 기록 없이 메뉴 단위 표준원가/원가율을 자동 추출.
// 데이터는 서버 /api/menu-cost 에서 집계해서 받는다 (계산 로직 단일 소스).

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { exportToXlsx } from '../lib/excel';

type EvtType = 'MICE' | 'WEDDING';

interface CostRow {
  month: string;
  event_type: EvtType;
  menu_name: string;
  portions: number;
  std_cost_per_portion: number;
  std_cost_sum: number;
  list_price: number | null;
  revenue_sum: number;
  cost_pct: number | null;
  actual_food_cost: number | null;
  variance: number | null;
}

interface CostWarning {
  level: 'warn' | 'error';
  kind: string;
  menu: string;
  event_type: string;
  detail?: string;
  message: string;
}

interface CostResponse {
  year: number | null;
  month: number | null;
  event_type: string;
  rows: CostRow[];
  totals: { std_cost_sum: number; revenue_sum: number; cost_pct: number | null };
  warnings: CostWarning[];
}

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pct = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);

// 목표 원가율(이 값 초과 시 경고색). 식음 원가율 통상 35~40% 선.
const TARGET_COST_PCT = 40;

export default function MenuCost() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | ''>(now.getMonth() + 1);
  const [evtType, setEvtType] = useState<'' | EvtType>('');
  const [data, setData] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const params = new URLSearchParams();
      params.set('year', String(year));
      if (month) params.set('month', String(month));
      if (evtType) params.set('event_type', evtType);
      const res = await api.get<CostResponse>(`/api/menu-cost?${params.toString()}`);
      setData(res);
    } catch (e) {
      setErr((e as Error).message || '조회 실패');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, evtType]);

  const rows = data?.rows ?? [];
  const warnings = data?.warnings ?? [];
  const errorWarnings = warnings.filter((w) => w.level === 'error');
  const warnWarnings = warnings.filter((w) => w.level === 'warn');

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y + 1, y, y - 1, y - 2];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExport() {
    if (!rows.length) return;
    const label = `${year}${month ? `-${String(month).padStart(2, '0')}` : ''}${evtType ? `_${evtType}` : ''}`;
    await exportToXlsx<CostRow>({
      filename: `메뉴별원가_${label}.xlsx`,
      sheetName: '메뉴별 원가',
      rows,
      columns: [
        { header: '월', key: 'month', width: 10 },
        { header: '구분', key: 'event_type', width: 10 },
        { header: '메뉴명', key: 'menu_name', width: 22 },
        { header: '제공인분', key: 'portions', width: 12 },
        { header: '1인분 표준원가', key: 'std_cost_per_portion', width: 16, format: (v) => Math.round(Number(v) || 0) },
        { header: '표준원가 합', key: 'std_cost_sum', width: 16, format: (v) => Math.round(Number(v) || 0) },
        { header: '식음매출', key: 'revenue_sum', width: 16, format: (v) => Math.round(Number(v) || 0) },
        { header: '원가율(%)', key: 'cost_pct', width: 12, format: (v) => (v == null ? '' : Number(v)) },
        { header: '실제식음원가', key: 'actual_food_cost', width: 16, format: (v) => (v == null ? '' : Number(v)) },
        { header: 'Variance', key: 'variance', width: 14, format: (v) => (v == null ? '' : Number(v)) },
      ],
    });
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">🍽️ 메뉴별 원가 (월말 표준원가)</h1>
          <p className="text-sm text-gray-500">폐기율 기록 없이 메뉴 단위 표준 식음원가·원가율을 자동 추출합니다.</p>
        </div>
        <button
          onClick={handleExport}
          disabled={!rows.length}
          className="btn-secondary text-sm py-1.5 px-3 disabled:opacity-40"
        >
          📥 엑셀 추출
        </button>
      </div>

      {/* 필터 */}
      <div className="flex items-end gap-3 flex-wrap bg-white border rounded-lg p-3">
        <div>
          <label className="field-label">연도</label>
          <select className="input !py-1 !text-sm w-24" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">월</label>
          <select className="input !py-1 !text-sm w-28" value={month} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : '')}>
            <option value="">전체</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">구분</label>
          <select className="input !py-1 !text-sm w-28" value={evtType} onChange={(e) => setEvtType(e.target.value as '' | EvtType)}>
            <option value="">전체</option>
            <option value="MICE">MICE</option>
            <option value="WEDDING">WEDDING</option>
          </select>
        </div>
        {loading && <span className="text-xs text-gray-400">불러오는 중…</span>}
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{err}</div>}

      {/* 정합성 경고 */}
      {(errorWarnings.length > 0 || warnWarnings.length > 0) && (
        <details className="bg-amber-50 border border-amber-200 rounded-lg p-3" open={errorWarnings.length > 0}>
          <summary className="text-sm font-medium text-amber-800 cursor-pointer">
            ⚠ 점검 필요 {warnings.length}건
            {errorWarnings.length > 0 && <span className="text-red-600"> (오류 {errorWarnings.length})</span>}
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {errorWarnings.map((w, i) => (
              <li key={`e${i}`} className="text-red-700">🔴 {w.message}</li>
            ))}
            {warnWarnings.map((w, i) => (
              <li key={`w${i}`} className="text-amber-700">🟡 {w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-500">
            * 배치 단위 의심: 소스·육수처럼 대량 조리분을 한 번에 입력한 경우. 메뉴 마스터에서 해당 항목에 batch_yield(배치 인분수)를 입력하면 1인분으로 환산됩니다.
          </p>
        </details>
      )}

      {/* 합계 카드 */}
      {data && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-lg p-3">
            <div className="text-xs text-gray-400">표준원가 합계</div>
            <div className="text-lg font-semibold">{fmt(data.totals.std_cost_sum)}원</div>
          </div>
          <div className="bg-white border rounded-lg p-3">
            <div className="text-xs text-gray-400">식음매출 합계</div>
            <div className="text-lg font-semibold">{fmt(data.totals.revenue_sum)}원</div>
          </div>
          <div className={`border rounded-lg p-3 ${data.totals.cost_pct != null && data.totals.cost_pct > TARGET_COST_PCT ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <div className="text-xs text-gray-400">통합 원가율</div>
            <div className="text-lg font-semibold">{pct(data.totals.cost_pct)}</div>
          </div>
        </div>
      )}

      {/* 표 */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-3 py-2">월</th>
              <th className="text-left px-3 py-2">구분</th>
              <th className="text-left px-3 py-2">메뉴명</th>
              <th className="text-right px-3 py-2">제공인분</th>
              <th className="text-right px-3 py-2">1인분 표준원가</th>
              <th className="text-right px-3 py-2">표준원가 합</th>
              <th className="text-right px-3 py-2">식음매출</th>
              <th className="text-right px-3 py-2">원가율</th>
              <th className="text-right px-3 py-2 text-gray-300">실제식음원가</th>
              <th className="text-right px-3 py-2 text-gray-300">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center text-gray-400 py-8 text-xs">{loading ? '불러오는 중…' : '해당 기간 데이터가 없습니다'}</td></tr>
            ) : (
              rows.map((r, i) => {
                const over = r.cost_pct != null && r.cost_pct > TARGET_COST_PCT;
                const critical = r.cost_pct != null && r.cost_pct > 100;
                return (
                  <tr key={`${r.month}-${r.event_type}-${r.menu_name}-${i}`}
                    className={`border-t ${critical ? 'bg-red-50' : over ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.month}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.event_type === 'MICE' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>{r.event_type}</span>
                    </td>
                    <td className="px-3 py-2 font-medium">{r.menu_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.portions.toLocaleString('ko-KR')}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.std_cost_per_portion)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.std_cost_sum)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.revenue_sum ? fmt(r.revenue_sum) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${critical ? 'text-red-600' : over ? 'text-amber-600' : 'text-gray-700'}`}>{pct(r.cost_pct)}</td>
                    <td className="px-3 py-2 text-right text-gray-300">—</td>
                    <td className="px-3 py-2 text-right text-gray-300">—</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400">
        · 표준원가 = (set: 실제 식사 인원 / qty·coffee: 입력 수량) × 메뉴 1인분 표준원가(BOM 합).
        식음매출 = 결제 식사 인원 × 판매가. 원가율 = 표준원가 ÷ 식음매출.
        · 실제식음원가·Variance는 구매관리(plenty-storage) 연동 후 채워집니다 (Phase 2).
      </p>
    </div>
  );
}
