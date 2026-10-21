// 메뉴별 원가 — 구매 시스템(plenty-storage) 월 표준원가 스냅샷을 읽기 전용으로 보여준다 (S1, 2026-10-21).
// 원가는 구매 시스템이 주인이라 여기서 다시 계산하지 않는다. 예전 management 자체 레시피(BOM) 계산 화면은
// ROADMAP §7 "양쪽 폐기·신기준" 원칙에 따라 내렸다 (서버 /api/menu-cost 는 남아 있음).
// 마감 전 달(404)은 "아직 마감 전" — 잠정값을 만들지 않는다.

import { useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../lib/api';

interface StorageMenu {
  code: string;
  name: string;
  사업부: string;
  카테고리: string;
  매출귀속부서: string;
  판매가: number | null;
  기준인분: number;
  상태: string;
}
interface MenuCost {
  code: string;
  기준인분: number;
  합계원가: number;
  '1인분원가': number;
  부서별원가: Record<string, number>;
  판매가: number | null;
  판매가_공급가: number | null;
  원가율: number | null;
  완전: boolean;
  미확인수: number;
  소급: boolean;
  단가기준: string;
}
interface MenuCostMonth {
  month: string;
  소급: boolean;
  단가기준: string;
  menus: MenuCost[];
}

const DEPT_SHORT: Record<string, string> = { 컨벤션_주방: '컨주', 컨벤션_홀: '컨홀', 카페_주방: '카주', 카페_홀: '카홀' };
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ko-KR'));
const pct = (r: number | null | undefined) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);

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

export default function MenuCostPage() {
  const [month, setMonth] = useState(prevMonth);
  const [biz, setBiz] = useState<'컨벤션' | '카페' | 'ALL'>('컨벤션');
  const [menus, setMenus] = useState<StorageMenu[]>([]);
  const [cost, setCost] = useState<MenuCostMonth | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'not_closed' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api
      .get<{ menus: StorageMenu[] }>('/api/storage/menus')
      .then((r) => setMenus(r.menus))
      .catch(() => setMenus([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    api
      .get<MenuCostMonth>(`/api/storage/menu-cost?month=${month}`)
      .then((r) => {
        if (cancelled) return;
        setCost(r);
        setState('ok');
      })
      .catch((e) => {
        if (cancelled) return;
        setCost(null);
        const err = e as ApiError;
        setState(err.status === 404 ? 'not_closed' : 'error');
        setMessage(((err.payload as { message?: string } | undefined)?.message) || err.message || '');
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const menuByCode = useMemo(() => new Map(menus.map((m) => [m.code, m])), [menus]);
  const rows = useMemo(() => {
    const list = (cost?.menus || []).map((c) => ({ c, m: menuByCode.get(c.code) }));
    return list
      .filter(({ c, m }) => biz === 'ALL' || (m?.사업부 || (c.code.startsWith('CV-') ? '컨벤션' : '카페')) === biz)
      .sort((a, b) => a.c.code.localeCompare(b.c.code));
  }, [cost, menuByCode, biz]);
  const incomplete = rows.filter((r) => !r.c.완전).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">🧮 메뉴별 원가</h1>
          <p className="text-xs text-gray-500 mt-1">
            구매 시스템이 월 마감 때 굳힌 표준원가 · 읽기 전용 (원가·레시피 수정은 구매 시스템에서)
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <select className="input !py-1 !text-sm !w-auto" value={biz} onChange={(e) => setBiz(e.target.value as typeof biz)}>
            <option value="컨벤션">컨벤션</option>
            <option value="카페">카페</option>
            <option value="ALL">전체</option>
          </select>
          <button onClick={() => setMonth((m) => shift(m, -1))} className="px-2 py-1 rounded hover:bg-gray-100" aria-label="이전 달">‹</button>
          <span className="font-medium w-20 text-center">{month}</span>
          <button onClick={() => setMonth((m) => shift(m, 1))} className="px-2 py-1 rounded hover:bg-gray-100" aria-label="다음 달">›</button>
        </div>
      </div>

      {state === 'ok' && cost && (
        <div className="flex flex-wrap gap-2 text-xs">
          {cost.소급 && (
            <span className="px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-800">
              ⏪ {cost.단가기준} 단가로 소급한 값 — 그 달 실제 단가가 아님
            </span>
          )}
          {incomplete > 0 && (
            <span className="px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700">
              ⚠ 원가 일부 미확인 {incomplete}메뉴 — 재료 단가를 못 찾아 실제보다 낮게 나올 수 있음
            </span>
          )}
          <span className="px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-600">
            원가율 = 합계원가 ÷ (판매가 ÷ 1.1) · 디저트처럼 기준인분이 1이 아닌 메뉴는 그 인분 기준
          </span>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-x-auto">
        {state === 'loading' && <div className="p-8 text-center text-sm text-gray-400">불러오는 중…</div>}
        {state === 'not_closed' && (
          <div className="p-10 text-center">
            <div className="text-3xl mb-2">⏳</div>
            <div className="font-semibold text-gray-800">{month} 은 아직 마감 전입니다</div>
            <div className="text-xs text-gray-500 mt-1">구매 시스템에서 월 마감을 해야 그 달 원가가 생깁니다. 임시 값은 보여주지 않습니다.</div>
          </div>
        )}
        {state === 'error' && (
          <div className="p-8 text-center text-sm text-red-600">원가를 불러오지 못했습니다. {message}</div>
        )}
        {state === 'ok' && (
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="text-left px-3 py-2">코드</th>
                <th className="text-left px-3 py-2">메뉴</th>
                <th className="text-left px-3 py-2">카테고리</th>
                <th className="text-right px-3 py-2">기준인분</th>
                <th className="text-right px-3 py-2">판매가</th>
                <th className="text-right px-3 py-2">합계원가</th>
                <th className="text-right px-3 py-2">1인분원가</th>
                <th className="text-left px-3 py-2">부서별 원가</th>
                <th className="text-right px-3 py-2">원가율</th>
                <th className="text-left px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-400 text-sm">해당 사업부 메뉴가 없습니다.</td>
                </tr>
              )}
              {rows.map(({ c, m }) => (
                <tr key={c.code} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-xs text-gray-500">{c.code}</td>
                  <td className="px-3 py-1.5 font-medium text-gray-900">{m?.name || '—'}</td>
                  <td className="px-3 py-1.5 text-gray-600">{m?.카테고리 || '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.기준인분}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{won(c.판매가)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{won(c.합계원가)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{won(c['1인분원가'])}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">
                    {Object.entries(c.부서별원가 || {})
                      .map(([d, v]) => `${DEPT_SHORT[d] || d} ${won(v)}`)
                      .join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{pct(c.원가율)}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {c.완전 ? (
                      <span className="text-emerald-700">완전</span>
                    ) : (
                      <span className="text-red-600" title="재료 중 단가를 못 찾은 것이 있음">일부 미확인 {c.미확인수}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
