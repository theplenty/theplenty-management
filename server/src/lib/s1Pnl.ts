// S1 — 행사 메뉴 ↔ 구매 시스템 메뉴 코드, 식수, 매출 부서 태그, 컨벤션 P&L.
// 설계: docs/S1-원가연동-설계.md (2026-10-21 대표님 확인 반영).
//
// 원칙: 원가 숫자는 구매 시스템 스냅샷(/menu-cost)·실제원가(/cogs) 값을 그대로 쓴다. 여기서는
//       식수 × 1인분원가 같은 "곱하기·더하기" 만 한다(원가 재계산 아님). 스냅샷이 없으면(404) 빈칸.
// 범위: management 는 컨벤션만 — 카페 두 부서는 구매 시스템에서 본다.
import { store } from '../store/mockStore.js';
import type { Event, EventReview, FoodItem } from '../types.js';
import type { StorageCogsMonth, StorageMenuCostMonth } from './storageCost.js';

export const CONVENTION_DEPTS = ['컨벤션_주방', '컨벤션_홀'] as const;
export type ConventionDept = (typeof CONVENTION_DEPTS)[number];
export type RevenueDeptTag = ConventionDept | '비식음';

// ── 1. 메뉴 코드 ────────────────────────────────────────────────────────────
// 구매 시스템 코드는 불변(ROADMAP §7.1). management 메뉴명은 고정 목록이라 표로 잇는다.
// "A set" 처럼 기업·웨딩이 같은 이름이면 행사 구분으로 가른다.
type CountBasis =
  | 'meal' // 실제 식사 인원 × 1인분원가 (세트·도시락·국수)
  | 'plates' // 접시 수 × 합계원가(기준인분 단위) — 디저트·떡 플레이트
  | 'people'; // 인원수 × 1인분원가 — 커피브레이크(커피+쿠키 세트)

interface MenuCodeRule {
  code: string | null; // null = 코드표에 아직 없음
  basis: CountBasis;
  note?: string;
}

const MENU_CODE_RULES: Record<string, { MICE?: MenuCodeRule; WEDDING?: MenuCodeRule; any?: MenuCodeRule }> = {
  'A set': { MICE: { code: 'CV-BIZ-A', basis: 'meal' }, WEDDING: { code: 'CV-WED-A', basis: 'meal' } },
  'B set': { MICE: { code: 'CV-BIZ-B', basis: 'meal' }, WEDDING: { code: 'CV-WED-B', basis: 'meal' } },
  'C set': { MICE: { code: 'CV-BIZ-C', basis: 'meal' }, WEDDING: { code: 'CV-WED-C', basis: 'meal' } },
  'D set': { any: { code: 'CV-BIZ-D', basis: 'meal' } },
  'Korean Lunch Box': { any: { code: 'CV-BOX-KR', basis: 'meal' } },
  'Chinese Lunch Box': { any: { code: 'CV-BOX-CN', basis: 'meal' } },
  'Rice Cake Plate': { any: { code: 'CV-DES-01', basis: 'plates', note: '떡 플레이트' } },
  'Dessert Plate(M)': { any: { code: 'CV-DES-02', basis: 'plates' } },
  'Dessert Plate(L)': { any: { code: 'CV-DES-04', basis: 'plates' } },
  웨딩국수: { any: { code: 'CV-NDL-01', basis: 'people' } }, // 화면에서 수량(인분)으로 받는다
  // 커피브레이크 = 커피 3,000 + 쿠키 10,000 = 13,000원 1인 세트 (구매팀 확인 2026-10-21).
  // 2026-06~09 소급 스냅샷엔 커피 줄이 없어 쿠키 원가만 잡힌다 — 커피는 10월 마감 스냅샷부터.
  'Coffee Break': { any: { code: 'CV-DES-03', basis: 'people' } },
};
const NO_MEAL = new Set(['식사없음']);

export interface ResolvedMenu {
  code: string | null;
  basis: CountBasis | null;
  status: 'mapped' | 'no_code' | 'no_meal' | 'unknown';
}

export function resolveMenu(line: Pick<FoodItem, 'menu_name'> & { menu_code?: string | null }, eventType: string): ResolvedMenu {
  const name = (line.menu_name || '').trim();
  if (NO_MEAL.has(name)) return { code: null, basis: null, status: 'no_meal' };
  const rules = MENU_CODE_RULES[name];
  const rule = rules ? (eventType === 'WEDDING' ? rules.WEDDING : rules.MICE) || rules.any : undefined;
  // 사람이 직접 지정한 코드가 있으면 우선 (기준은 표에서)
  const code = (line.menu_code || '').trim() || rule?.code || null;
  if (!rule && !code) return { code: null, basis: null, status: 'unknown' };
  if (!code) return { code: null, basis: rule?.basis ?? null, status: 'no_code' };
  return { code, basis: rule?.basis ?? 'meal', status: 'mapped' };
}

// ── 2. 매출 부서 태그 ───────────────────────────────────────────────────────
// 항목 코드별 기본 배분. Coffee Break 는 커피 3,000(홀) + 쿠키 10,000(주방) 세트라 홀 3 : 주방 10 으로 나눈다.
// (구매 코드표의 매출귀속부서는 한 부서만 적을 수 있어 '컨벤션_홀' 로 되어 있지만, 매출 부서는 management 가 정한다)
const REVENUE_DEPT_DEFAULT: Record<string, Partial<Record<RevenueDeptTag, number>>> = {
  FOOD: { 컨벤션_주방: 1 },
  SNACK: { 컨벤션_주방: 1 },
  BEV: { 컨벤션_홀: 1 },
  CORKAGE: { 컨벤션_홀: 1 },
  CB: { 컨벤션_홀: 3 / 13, 컨벤션_주방: 10 / 13 },
  CONV: { 비식음: 1 },
  MEDIAWALL: { 비식음: 1 },
  BOOTH: { 비식음: 1 },
  STAGE: { 비식음: 1 },
  SYSTEM: { 비식음: 1 },
  FLOWER: { 비식음: 1 },
};

export function revenueDeptSplit(itemCode: string, override?: string | null): Partial<Record<RevenueDeptTag, number>> {
  if (override === '컨벤션_주방' || override === '컨벤션_홀' || override === '비식음') return { [override]: 1 };
  return REVENUE_DEPT_DEFAULT[itemCode] || { 비식음: 1 };
}

export function revenueDeptLabel(itemCode: string): string {
  const s = REVENUE_DEPT_DEFAULT[itemCode];
  if (!s) return '비식음';
  const keys = Object.keys(s);
  if (keys.length === 1) return keys[0] === '비식음' ? '비식음' : keys[0].replace('컨벤션_', '');
  return '홀 3 : 주방 10';
}

// ── 3. 식수 ─────────────────────────────────────────────────────────────────
const MEAL_COUNT_FROM = '2026-01-01'; // 이 날 이후 행사는 식수 미입력을 알린다 (그 전은 그대로 둔다)

function reviewOf(eventId: string): EventReview | undefined {
  return store.event_reviews.find((r) => r.event_id === eventId);
}

function hasMealMenu(eventId: string, eventType: string): boolean {
  return store.event_food_items.some((f) => f.event_id === eventId && resolveMenu(f, eventType).basis === 'meal');
}

const kstDay = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/** 2026 이후 종료된 DEF 행사 중 식사 메뉴가 있는데 실제 식사 인원이 비어 있는 것. 0 은 입력한 값(식수 미이용)이다. */
export function missingMealCountEvents(now = new Date()): Array<{ event_id: string; event_name: string; event_type: string; start_datetime: string; days_since: number }> {
  const today = kstDay(now.toISOString());
  const out = [];
  for (const e of store.events as Event[]) {
    if (e.deleted_at || e.status !== 'DEF') continue;
    const end = kstDay(e.end_datetime || e.start_datetime);
    if (kstDay(e.start_datetime) < MEAL_COUNT_FROM || end >= today) continue;
    if (!hasMealMenu(e.id, e.event_type)) continue;
    const r = reviewOf(e.id);
    if (r && r.actual_meal_count != null) continue;
    out.push({
      event_id: e.id,
      event_name: e.event_name,
      event_type: e.event_type,
      start_datetime: e.start_datetime,
      days_since: Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${end}T00:00:00Z`).getTime()) / 86400_000),
    });
  }
  return out.sort((a, b) => (a.start_datetime < b.start_datetime ? 1 : -1));
}

// ── 4. 매핑 미리보기 (쓰기 없음) ────────────────────────────────────────────
export function menuCodePreview() {
  const evById = new Map((store.events as Event[]).filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const rows = new Map<string, { menu_name: string; event_type: string; code: string | null; status: ResolvedMenu['status']; lines: number; already: number }>();
  let total = 0;
  for (const f of store.event_food_items as Array<FoodItem & { menu_code?: string | null }>) {
    const e = evById.get(f.event_id);
    if (!e) continue;
    total++;
    const r = resolveMenu(f, e.event_type);
    const k = `${f.menu_name}|${e.event_type}`;
    const row = rows.get(k) || { menu_name: f.menu_name, event_type: e.event_type, code: r.code, status: r.status, lines: 0, already: 0 };
    row.lines++;
    if (f.menu_code) row.already++;
    rows.set(k, row);
  }
  const list = [...rows.values()].sort((a, b) => b.lines - a.lines);
  const sum = (s: ResolvedMenu['status']) => list.filter((r) => r.status === s).reduce((a, r) => a + r.lines, 0);
  // 한 행사에 '식수 기준' 메뉴가 둘 이상이면 리뷰 식수 하나로 나눌 수 없다 — 라인별 인원 입력 대상
  const multiMeal = [...evById.values()].filter(
    (e) => store.event_food_items.filter((f) => f.event_id === e.id && resolveMenu(f, e.event_type).basis === 'meal').length > 1
  ).length;
  return { total, mapped: sum('mapped'), no_code: sum('no_code'), no_meal: sum('no_meal'), unknown: sum('unknown'), multi_meal_events: multiMeal, rows: list };
}

// ── 5. 컨벤션 P&L ───────────────────────────────────────────────────────────
interface DeptRow {
  dept: ConventionDept;
  food_revenue: number;
  theoretical_cost: number | null;
  actual_cost: number | null;
  cost_pct: number | null;
  theoretical_cost_pct: number | null;
  loss: number | null;
  loss_pct: number | null;
}

const inMonth = (iso: string, month: string) => kstDay(iso).slice(0, 7) === month;

export function computeConventionPnl(month: string, menuCost: StorageMenuCostMonth | null, cogs: StorageCogsMonth | null) {
  const events = (store.events as Event[]).filter((e) => !e.deleted_at && e.status === 'DEF' && inMonth(e.start_datetime, month));
  const itemCode = new Map(store.revenue_items.map((i) => [i.id, i.code]));
  const costByCode = new Map((menuCost?.menus || []).map((m) => [m.code, m]));

  const revenue: Record<RevenueDeptTag, number> = { 컨벤션_주방: 0, 컨벤션_홀: 0, 비식음: 0 };
  const theo: Record<ConventionDept, number> = { 컨벤션_주방: 0, 컨벤션_홀: 0 };
  const issues = {
    no_revenue_lines: [] as string[],
    missing_meal_count: [] as string[],
    multi_meal_needs_split: [] as string[],
    missing_quantity: [] as string[],
    no_code_lines: 0,
    code_not_in_snapshot: new Set<string>(),
    incomplete_menus: new Set<string>(),
  };

  for (const e of events) {
    const label = `${kstDay(e.start_datetime)} ${e.event_name}`;
    // 매출 — 라인을 부서로 나눈다. 대관료(gateway_fee)는 비식음.
    const lines = store.event_revenue_lines.filter((l) => l.event_id === e.id && l.amount);
    if (!lines.length) issues.no_revenue_lines.push(label);
    for (const l of lines) {
      const split = revenueDeptSplit(itemCode.get(l.revenue_item_id) || '', (l as { dept?: string | null }).dept);
      for (const [d, ratio] of Object.entries(split)) revenue[d as RevenueDeptTag] += (l.amount || 0) * (ratio || 0);
    }
    if (e.gateway_fee) revenue.비식음 += e.gateway_fee;

    // 이론원가 — 스냅샷 원가 × 식수(또는 접시·인원 수)
    const foods = store.event_food_items.filter((f) => f.event_id === e.id) as Array<FoodItem & { menu_code?: string | null; actual_count?: number | null }>;
    const mealLines = foods.filter((f) => resolveMenu(f, e.event_type).basis === 'meal');
    const review = reviewOf(e.id);
    for (const f of foods) {
      const r = resolveMenu(f, e.event_type);
      if (r.status === 'no_meal') continue;
      if (r.status !== 'mapped') {
        issues.no_code_lines++;
        continue;
      }
      let count: number | null = null;
      if (r.basis === 'meal') {
        if (f.actual_count != null) count = f.actual_count;
        else if (mealLines.length > 1) {
          issues.multi_meal_needs_split.push(`${label} · ${f.menu_name}`);
          continue;
        } else count = review?.actual_meal_count ?? null;
        if (count == null) {
          if (!issues.missing_meal_count.includes(label)) issues.missing_meal_count.push(label);
          continue;
        }
      } else {
        count = f.actual_count ?? f.quantity ?? null;
        if (count == null) {
          issues.missing_quantity.push(`${label} · ${f.menu_name}`);
          continue;
        }
      }
      const mc = costByCode.get(r.code!);
      if (!mc) {
        issues.code_not_in_snapshot.add(r.code!);
        continue;
      }
      if (!mc.완전) issues.incomplete_menus.add(r.code!);
      // 접시는 기준인분 단위 원가(합계원가), 사람은 1인분원가. 부서별 원가 비율 그대로 나눈다.
      const unitTotal = r.basis === 'plates' ? mc.합계원가 : mc['1인분원가'];
      const deptTotal = Object.values(mc.부서별원가 || {}).reduce((a, b) => a + b, 0) || mc.합계원가 || 0;
      for (const d of CONVENTION_DEPTS) {
        const share = deptTotal ? (mc.부서별원가?.[d] || 0) / deptTotal : 0;
        theo[d] += count * unitTotal * share;
      }
    }
  }

  const cogsByDept = new Map((cogs?.depts || []).map((d) => [d.부서, d]));
  const pct = (a: number | null, b: number) => (a == null || !b ? null : a / b);
  const depts: DeptRow[] = CONVENTION_DEPTS.map((d) => {
    const food = Math.round(revenue[d]);
    const theoretical = menuCost ? Math.round(theo[d]) : null;
    const actual = cogsByDept.get(d)?.실제원가 ?? null;
    const loss = actual != null && theoretical != null ? actual - theoretical : null;
    return {
      dept: d,
      food_revenue: food,
      theoretical_cost: theoretical,
      actual_cost: actual,
      cost_pct: pct(actual, food),
      theoretical_cost_pct: pct(theoretical, food),
      loss,
      loss_pct: pct(loss, food),
    };
  });
  const sumOrNull = (k: 'theoretical_cost' | 'actual_cost' | 'loss') =>
    depts.some((r) => r[k] == null) ? null : depts.reduce((a, r) => a + (r[k] as number), 0);
  const totalFood = depts.reduce((a, r) => a + r.food_revenue, 0);
  const total = {
    food_revenue: totalFood,
    nonfood_revenue: Math.round(revenue.비식음),
    theoretical_cost: sumOrNull('theoretical_cost'),
    actual_cost: sumOrNull('actual_cost'),
    loss: sumOrNull('loss'),
  };
  return {
    month,
    event_count: events.length,
    snapshot: menuCost ? { 소급: menuCost.소급, 단가기준: menuCost.단가기준 } : null,
    cogs_basis: cogs?.기준 ?? null,
    depts,
    total: {
      ...total,
      cost_pct: pct(total.actual_cost, totalFood),
      theoretical_cost_pct: pct(total.theoretical_cost, totalFood),
      loss_pct: pct(total.loss, totalFood),
    },
    issues: {
      no_revenue_lines: issues.no_revenue_lines,
      missing_meal_count: issues.missing_meal_count,
      multi_meal_needs_split: issues.multi_meal_needs_split,
      missing_quantity: issues.missing_quantity,
      no_code_lines: issues.no_code_lines,
      code_not_in_snapshot: [...issues.code_not_in_snapshot],
      incomplete_menus: [...issues.incomplete_menus],
    },
  };
}
