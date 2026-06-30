// 월말 메뉴별 식음 표준원가 산출 API.
// 폐기율을 행사마다 기록하지 않고도, 메뉴 단위 표준원가/원가율을 월별로 자동 추출한다.
//
// 표준원가(메뉴 1인분) = name_ko + event_type 이 같은 모든 Menu 레코드(카테고리 분리)의
//   Σ effectivePortionCost(detail)   (effectivePortionCost = portion_cost / (batch_yield ?? 1))
// 행사별: set 메뉴는 actual/paid_meal_count 기준(EventReview), qty/coffee 는 quantity 기준.
// 실제 매입 대비 차이(variance)는 Phase 2 — 응답에 빈칸 컬럼만 마련.

import { Router } from 'express';
import { store } from '../store/mockStore.js';
import { requireActiveRole } from '../middleware/auth.js';
import { menuModeOf, effectivePortionCost } from '../types.js';
import type { Menu, MenuMode, MenuEventType, FoodItem } from '../types.js';

const router = Router();
router.use(requireActiveRole);

interface MenuGroup {
  stdCostPerPortion: number; // Σ effectivePortionCost (전 카테고리 합)
  listPrice: number | null;
  mode: MenuMode;
}

// name_ko + event_type → 그룹 표준원가/판매가/모드
function buildMenuGroups(): Map<string, MenuGroup> {
  const byKey = new Map<string, Menu[]>();
  for (const m of store.menus) {
    const key = `${m.event_type}|${m.name_ko}`;
    const arr = byKey.get(key) ?? [];
    arr.push(m);
    byKey.set(key, arr);
  }
  const groups = new Map<string, MenuGroup>();
  for (const [key, records] of byKey) {
    let stdCost = 0;
    let listPrice: number | null = null;
    let mode: MenuMode | null = null;
    for (const r of records) {
      for (const d of r.details ?? []) stdCost += effectivePortionCost(d);
      // 세트 판매가는 보통 한 레코드에만 — 중복 합산 방지 위해 최댓값(0 회피).
      if (r.list_price != null) {
        listPrice = listPrice == null ? r.list_price : Math.max(listPrice, r.list_price);
      }
      if (mode == null) mode = r.mode;
    }
    groups.set(key, {
      stdCostPerPortion: stdCost,
      listPrice,
      mode: mode ?? menuModeOf(records[0].name_ko),
    });
  }
  return groups;
}

interface CostRow {
  month: string;
  event_type: MenuEventType;
  menu_name: string;
  portions: number;
  std_cost_per_portion: number;
  std_cost_sum: number;
  list_price: number | null;
  revenue_sum: number;
  cost_pct: number | null;
  actual_food_cost: number | null; // Phase 2 — 수기/연동 예정
  variance: number | null;         // Phase 2 — actual - standard
}

interface CostWarning {
  level: 'warn' | 'error';
  kind: 'batch_suspect' | 'no_list_price' | 'cost_over_price';
  menu: string;
  event_type: string;
  detail?: string;
  message: string;
}

// GET /api/menu-cost?year=2026&month=6&event_type=MICE
//   month 생략 → 해당 연도 전체, event_type 생략 → 전체
router.get('/', (req, res) => {
  const year = req.query.year ? Number(req.query.year) : null;
  const month = req.query.month ? Number(req.query.month) : null; // 1~12
  const evtFilter = String(req.query.event_type || '').trim().toUpperCase(); // MICE|WEDDING|''

  const groups = buildMenuGroups();
  const groupOf = (name: string, et: MenuEventType) => groups.get(`${et}|${name}`);
  const modeOf = (name: string, et: MenuEventType): MenuMode => groupOf(name, et)?.mode ?? menuModeOf(name);
  const stdCostOf = (name: string, et: MenuEventType): number => groupOf(name, et)?.stdCostPerPortion ?? 0;
  const listPriceOf = (name: string, et: MenuEventType): number | null => groupOf(name, et)?.listPrice ?? null;

  const reviewByEvent = new Map(store.event_reviews.map((r) => [r.event_id, r]));
  const foodByEvent = new Map<string, FoodItem[]>();
  for (const f of store.event_food_items) {
    const arr = foodByEvent.get(f.event_id) ?? [];
    arr.push(f);
    foodByEvent.set(f.event_id, arr);
  }

  interface Acc { month: string; event_type: MenuEventType; menu_name: string; portions: number; std_cost_sum: number; revenue_sum: number; }
  const rollup = new Map<string, Acc>();

  for (const ev of store.events) {
    if (ev.deleted_at) continue;
    if (!ev.start_datetime) continue;
    const evYear = Number(ev.start_datetime.slice(0, 4));
    const evMonth = Number(ev.start_datetime.slice(5, 7));
    if (year && evYear !== year) continue;
    if (month && evMonth !== month) continue;
    const et = ev.event_type as MenuEventType;
    if (et !== 'MICE' && et !== 'WEDDING') continue;
    if (evtFilter && et !== evtFilter) continue;

    const ym = ev.start_datetime.slice(0, 7);
    const review = reviewByEvent.get(ev.id);
    const actualCount = review?.actual_meal_count ?? null;
    const paidCount = review?.paid_meal_count ?? null;
    const foods = foodByEvent.get(ev.id) ?? [];

    // set 메뉴 간 actual/paid 안분용 비율 (gtd_final ?? exp_final)
    const setFoods = foods.filter((f) => modeOf(f.menu_name, et) === 'set');
    const ratioDenom = setFoods.reduce((s, f) => s + (f.gtd_final ?? f.exp_final ?? 0), 0);

    for (const f of foods) {
      const mode = modeOf(f.menu_name, et);
      const stdPer = stdCostOf(f.menu_name, et);
      const lp = listPriceOf(f.menu_name, et) ?? 0;

      let stdPortions = 0;
      let revPortions = 0;

      if (mode === 'set') {
        const w = f.gtd_final ?? f.exp_final ?? 0;
        const frac = ratioDenom > 0 ? w / ratioDenom : (setFoods.length > 0 ? 1 / setFoods.length : 1);
        // 표준원가용 = 실제 식사 인원, 매출용 = 결제 식사 인원
        // EventReview 없으면 폴백: food_item 자체값(gtd_final ?? exp_final ?? Event.food_gtd_final)
        const fallback = f.gtd_final ?? f.exp_final ?? ev.food_gtd_final ?? 0;
        stdPortions = actualCount != null ? actualCount * frac : fallback;
        revPortions = paidCount != null ? paidCount * frac : fallback;
      } else {
        // qty | coffee — 인원과 무관, 직접 입력 수량
        const qty = f.quantity ?? 0;
        stdPortions = qty;
        revPortions = qty;
      }

      const key = `${ym}|${et}|${f.menu_name}`;
      const acc = rollup.get(key) ?? { month: ym, event_type: et, menu_name: f.menu_name, portions: 0, std_cost_sum: 0, revenue_sum: 0 };
      acc.portions += stdPortions;
      acc.std_cost_sum += stdPortions * stdPer;
      acc.revenue_sum += revPortions * lp;
      rollup.set(key, acc);
    }
  }

  const rows: CostRow[] = [...rollup.values()].map((a) => ({
    month: a.month,
    event_type: a.event_type,
    menu_name: a.menu_name,
    portions: Math.round(a.portions * 100) / 100,
    std_cost_per_portion: Math.round(stdCostOf(a.menu_name, a.event_type)),
    std_cost_sum: Math.round(a.std_cost_sum),
    list_price: listPriceOf(a.menu_name, a.event_type),
    revenue_sum: Math.round(a.revenue_sum),
    cost_pct: a.revenue_sum > 0 ? Math.round((a.std_cost_sum / a.revenue_sum) * 1000) / 10 : null,
    actual_food_cost: null,
    variance: null,
  }));
  rows.sort((a, b) => (b.cost_pct ?? -1) - (a.cost_pct ?? -1));

  const totalStd = rows.reduce((s, r) => s + r.std_cost_sum, 0);
  const totalRev = rows.reduce((s, r) => s + r.revenue_sum, 0);
  const totals = {
    std_cost_sum: totalStd,
    revenue_sum: totalRev,
    cost_pct: totalRev > 0 ? Math.round((totalStd / totalRev) * 1000) / 10 : null,
  };

  // ── 데이터 정합성 경고 ────────────────────────────────────────
  const warnings: CostWarning[] = [];
  // 단일 재료 원가 이상치 (배치 단위 의심)
  for (const m of store.menus) {
    for (const d of m.details ?? []) {
      const raw = d.portion_cost ?? 0;
      if (raw > 10000 && !(d.batch_yield && d.batch_yield > 0)) {
        warnings.push({
          level: 'warn', kind: 'batch_suspect', menu: m.name_ko, event_type: m.event_type, detail: d.dish_name,
          message: `${m.name_ko}(${m.event_type}) · ${d.dish_name}: 단일 재료 원가 ${Math.round(raw).toLocaleString()}원 — 배치 단위 의심(batch_yield 입력 필요)`,
        });
      }
    }
  }
  // 그룹 단위: 판매가 누락 / 원가율 초과
  for (const [key, g] of groups) {
    if (g.stdCostPerPortion <= 0) continue;
    const sep = key.indexOf('|');
    const et = key.slice(0, sep);
    const name = key.slice(sep + 1);
    if (g.listPrice == null) {
      warnings.push({ level: 'warn', kind: 'no_list_price', menu: name, event_type: et, message: `${name}(${et}): 판매가(list_price) 미입력 — 원가율 계산 불가` });
    } else if (g.stdCostPerPortion > g.listPrice) {
      warnings.push({ level: 'error', kind: 'cost_over_price', menu: name, event_type: et, message: `${name}(${et}): 표준원가 ${Math.round(g.stdCostPerPortion).toLocaleString()}원 > 판매가 ${g.listPrice.toLocaleString()}원 (원가율 100% 초과)` });
    }
  }

  res.json({
    year: year ?? null,
    month: month ?? null,
    event_type: evtFilter || 'ALL',
    rows,
    totals,
    warnings,
  });
});

export default router;
