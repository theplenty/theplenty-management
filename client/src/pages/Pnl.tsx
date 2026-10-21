// 컨벤션 P&L — 부서별 식음매출 · 이론원가 · 실제원가 · COST% (S1, 2026-10-21).
// 매출·식수는 management, 원가는 구매 시스템(스냅샷·실제원가)을 서버가 읽어 합친다.
// 카페 두 부서는 management 에 매출이 없어 구매 시스템에서 본다 (대표님 결정).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiError } from '../lib/api';

interface DeptRow {
  dept: string;
  food_revenue: number;
  theoretical_cost: number | null;
  actual_cost: number | null;
  cost_pct: number | null;
  theoretical_cost_pct: number | null;
  loss: number | null;
  loss_pct: number | null;
}
interface PnlResponse {
  month: string;
  event_count: number;
  snapshot: { 소급: boolean; 단가기준: string } | null;
  cogs_basis: string | null;
  depts: DeptRow[];
  total: {
    food_revenue: number;
    nonfood_revenue: number;
    theoretical_cost: number | null;
    actual_cost: number | null;
    loss: number | null;
    cost_pct: number | null;
    theoretical_cost_pct: number | null;
    loss_pct: number | null;
  };
  issues: {
    no_revenue_lines: string[];
    missing_meal_count: string[];
    multi_meal_needs_split: string[];
    missing_quantity: string[];
    no_code_lines: number;
    code_not_in_snapshot: string[];
    incomplete_menus: string[];
  };
  menu_cost_status: string;
  cogs_status: string;
}

const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ko-KR'));
const pct = (r: number | null | undefined) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const STATUS_TEXT: Record<string, string> = {
  ok: '',
  not_closed: '아직 마감 전 — 빈칸',
  no_key: '구매 시스템 읽기 키 미등록',
  unauthorized: '구매 시스템 키 불일치',
  network: '구매 시스템 연결 실패',
};

function prevMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PnlPage() {
  const [month, setMonth] = useState(prevMonth);
  const [data, setData] = useState<PnlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .get<PnlResponse>(`/api/storage/pnl?month=${month}`)
      .then((r) => !cancelled && setData(r))
      .catch((e) => {
        if (cancelled) return;
        const err = e as ApiError;
        setError(((err.payload as { message?: string } | undefined)?.message) || err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const rows: Array<{ label: string; get: (d: DeptRow | PnlResponse['total']) => string; strong?: boolean; hint?: string }> = [
    { label: '식음 매출', get: (d) => won(d.food_revenue), strong: true, hint: '그 달 DEF 행사의 매출 라인을 부서 태그로 나눈 것 (대관료·장비·플라워 등 비식음 제외)' },
    { label: '이론원가', get: (d) => won(d.theoretical_cost), hint: '실제 식사 인원 × 1인분원가 (떡·디저트는 접시 수 × 합계원가, 커피브레이크는 인원 × 1인분원가)' },
    { label: '실제원가', get: (d) => won(d.actual_cost), hint: '구매 시스템: 기초재고 + 매입 − 기말재고' },
    { label: 'COST%', get: (d) => pct(d.cost_pct), strong: true, hint: '실제원가 ÷ 식음 매출' },
    { label: '이론 COST%', get: (d) => pct(d.theoretical_cost_pct), hint: '이론원가 ÷ 식음 매출' },
    { label: '로스', get: (d) => (d.loss == null ? '—' : `${won(d.loss)} (${pct(d.loss_pct)})`), hint: '실제원가 − 이론원가' },
  ];
  const deptLabel = (d: string) => d.replace('컨벤션_', '컨벤션 ');
  const i = data?.issues;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">📒 컨벤션 P&L</h1>
          <p className="text-xs text-gray-500 mt-1">
            매출·식수 = management · 원가 = 구매 시스템(월 마감 스냅샷·실제원가) · 카페는 구매 시스템에서
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setMonth((m) => shift(m, -1))} className="px-2 py-1 rounded hover:bg-gray-100" aria-label="이전 달">‹</button>
          <span className="font-medium w-20 text-center">{month}</span>
          <button onClick={() => setMonth((m) => shift(m, 1))} className="px-2 py-1 rounded hover:bg-gray-100" aria-label="다음 달">›</button>
        </div>
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>}
      {!data && !error && <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>}

      {data && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded border bg-gray-50 text-gray-600">DEF 행사 {data.event_count}건</span>
            {data.menu_cost_status !== 'ok' && (
              <span className="px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-600">
                메뉴 원가: {STATUS_TEXT[data.menu_cost_status] || data.menu_cost_status} → 이론원가 빈칸
              </span>
            )}
            {data.cogs_status !== 'ok' && (
              <span className="px-2 py-1 rounded border border-gray-300 bg-gray-50 text-gray-600">
                실제원가: {STATUS_TEXT[data.cogs_status] || data.cogs_status} → 빈칸 (2026-08 이전 달은 없음)
              </span>
            )}
            {data.snapshot?.소급 && (
              <span className="px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-800">
                ⏪ 메뉴 원가는 {data.snapshot.단가기준} 단가로 소급한 값
              </span>
            )}
            {i && i.incomplete_menus.length > 0 && (
              <span className="px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700">
                ⚠ 원가 일부 미확인 메뉴: {i.incomplete_menus.join(', ')}
              </span>
            )}
          </div>

          <div className="bg-white border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 w-40">항목</th>
                  {data.depts.map((d) => (
                    <th key={d.dept} className="text-right px-3 py-2">{deptLabel(d.dept)}</th>
                  ))}
                  <th className="text-right px-3 py-2 border-l">컨벤션 합계</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t">
                    <td className={`px-3 py-2 ${r.strong ? 'font-semibold text-gray-900' : 'text-gray-700'}`} title={r.hint}>
                      {r.label}
                    </td>
                    {data.depts.map((d) => (
                      <td key={d.dept} className={`px-3 py-2 text-right tabular-nums ${r.strong ? 'font-semibold' : ''}`}>{r.get(d)}</td>
                    ))}
                    <td className={`px-3 py-2 text-right tabular-nums border-l ${r.strong ? 'font-semibold' : ''}`}>{r.get(data.total)}</td>
                  </tr>
                ))}
                <tr className="border-t text-gray-500">
                  <td className="px-3 py-2 text-xs" title="COST% 분모에서 제외">비식음 매출 (참고)</td>
                  <td colSpan={data.depts.length} />
                  <td className="px-3 py-2 text-right tabular-nums text-xs border-l">{won(data.total.nonfood_revenue)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {i &&
            (i.missing_meal_count.length > 0 ||
              i.multi_meal_needs_split.length > 0 ||
              i.missing_quantity.length > 0 ||
              i.no_revenue_lines.length > 0 ||
              i.no_code_lines > 0 ||
              i.code_not_in_snapshot.length > 0) && (
            <div className="bg-white border rounded-lg p-4 text-sm space-y-2">
              <h2 className="font-semibold text-gray-900">계산에서 빠진 것 — 채우면 숫자가 정확해집니다</h2>
              <Issue label="실제 식사 인원 미입력 (이론원가 빠짐)" items={i.missing_meal_count} link="/reviews" linkLabel="행사리뷰에서 입력" />
              <Issue label="세트가 2개 이상인데 메뉴별 실제 인원 없음" items={i.multi_meal_needs_split} hint="행사 → 기본정보 → 식음 메뉴에서 '실제 인원'" />
              <Issue label="수량 없음 (떡·디저트 접시 수 / 커피브레이크 인원)" items={i.missing_quantity} />
              <Issue label="매출 라인 없음 (식음 매출 빠짐)" items={i.no_revenue_lines} link="/revenue" linkLabel="매출·정산에서 입력" />
              {i.no_code_lines > 0 && (
                <div className="text-xs text-gray-600">· 구매 코드표에 없는 메뉴 라인 {i.no_code_lines}건</div>
              )}
              {i.code_not_in_snapshot.length > 0 && (
                <div className="text-xs text-gray-600">· 그 달 스냅샷에 없는 코드: {i.code_not_in_snapshot.join(', ')}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Issue({ label, items, link, linkLabel, hint }: { label: string; items: string[]; link?: string; linkLabel?: string; hint?: string }) {
  if (!items.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-gray-700">
        · {label} <b className="text-red-600">{items.length}건</b>
        {link && (
          <Link to={link} className="ml-2 text-blue-600 hover:underline">
            {linkLabel} →
          </Link>
        )}
        {hint && <span className="ml-2 text-gray-400">{hint}</span>}
      </summary>
      <ul className="mt-1 ml-4 list-disc text-gray-600 space-y-0.5">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}
