// 구매 시스템(plenty-storage) 원가 읽기 — S1 연동.
//
// 원칙(ROADMAP §7 · docs/S1-원가API-연동안내.md):
//  - 원가는 구매 시스템이 주인. 여기서는 읽기만 하고 다시 계산하지 않는다.
//  - 호출은 서버(Functions)에서만. 키는 Secret `STORAGE_READ_KEY` 로 들어오고 코드·로그에 적지 않는다.
//  - 404 = "아직 마감 전 / 원가 없음". 잠정값을 만들지 않고 그대로 404 로 돌려준다. 404 는 캐시하지 않는다.
//  - 마감된 달의 스냅샷은 바뀌지 않으므로 월 단위로 캐시한다(인스턴스 메모리). 메뉴 코드표는 짧게.

const BASE = (process.env.STORAGE_API_BASE || 'https://plenty-storage.web.app/api/public').replace(/\/$/, '');

export interface StorageMenu {
  code: string;
  name: string;
  사업부: string;
  카테고리: string;
  매출귀속부서: string;
  판매가: number | null;
  기준인분: number;
  상태: string;
}
export interface StorageMenuCost {
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
  스냅샷시각: string;
  소급: boolean;
  단가기준: string;
}
export interface StorageMenuCostMonth {
  month: string;
  소급: boolean;
  단가기준: string;
  menus: StorageMenuCost[];
}
export interface StorageCogsDept {
  부서: string;
  기초재고: number | null;
  매입: number;
  반품: number;
  기말재고: number | null;
  실제원가: number | null;
}
export interface StorageCogsMonth {
  month: string;
  기준: string;
  depts: StorageCogsDept[];
}

export type StorageResult<T> =
  | { ok: true; status: 200; data: T; cached: boolean }
  | { ok: false; status: number; reason: 'no_key' | 'not_closed' | 'unauthorized' | 'bad_request' | 'storage_unconfigured' | 'upstream_error' | 'network' };

export function storageKeyConfigured(): boolean {
  return !!(process.env.STORAGE_READ_KEY || '').trim();
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isValidMonth(m: unknown): m is string {
  return typeof m === 'string' && MONTH_RE.test(m);
}

// ── 캐시 ──
const MENUS_TTL_MS = 10 * 60 * 1000;
let menusCache: { at: number; data: { menus: StorageMenu[] } } | null = null;
const monthCache = new Map<string, unknown>(); // "menu-cost:2026-09" → 응답 (200 만)

function reasonOf(status: number): Extract<StorageResult<never>, { ok: false }>['reason'] {
  if (status === 404) return 'not_closed';
  if (status === 401) return 'unauthorized';
  if (status === 400) return 'bad_request';
  if (status === 503) return 'storage_unconfigured';
  return 'upstream_error';
}

async function fetchJson<T>(path: string): Promise<StorageResult<T>> {
  const key = (process.env.STORAGE_READ_KEY || '').trim();
  if (!key) return { ok: false, status: 0, reason: 'no_key' };
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'GET',
      headers: { 'X-Storage-Read-Key': key, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // 키·본문은 로그에 남기지 않는다 — 경로와 오류 종류만
    console.warn('[storage] 호출 실패', path, (e as Error).name);
    return { ok: false, status: 0, reason: 'network' };
  }
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined); // 본문은 버린다(로그 안 남김) — 연결만 정리
    if (res.status !== 404) console.warn('[storage] 응답', res.status, path);
    return { ok: false, status: res.status, reason: reasonOf(res.status) };
  }
  const data = (await res.json()) as T;
  return { ok: true, status: 200, data, cached: false };
}

/** 메뉴 코드표 — 10분 캐시 */
export async function getStorageMenus(opts: { force?: boolean } = {}): Promise<StorageResult<{ menus: StorageMenu[] }>> {
  if (!opts.force && menusCache && Date.now() - menusCache.at < MENUS_TTL_MS) {
    return { ok: true, status: 200, data: menusCache.data, cached: true };
  }
  const r = await fetchJson<{ menus: StorageMenu[] }>('/menus');
  if (r.ok) menusCache = { at: Date.now(), data: r.data };
  return r;
}

/** 마감된 달의 메뉴별 표준원가 — 200 이면 월 단위 캐시(스냅샷은 안 바뀜). 404 는 캐시 안 함. */
export async function getStorageMenuCost(month: string, opts: { force?: boolean } = {}): Promise<StorageResult<StorageMenuCostMonth>> {
  if (!isValidMonth(month)) return { ok: false, status: 400, reason: 'bad_request' };
  const ck = `menu-cost:${month}`;
  if (!opts.force && monthCache.has(ck)) return { ok: true, status: 200, data: monthCache.get(ck) as StorageMenuCostMonth, cached: true };
  const r = await fetchJson<StorageMenuCostMonth>(`/menu-cost?month=${month}`);
  if (r.ok) monthCache.set(ck, r.data);
  return r;
}

/** 부서별 실제원가(기초·매입·기말) — 2026-08 이후 마감된 달만. */
export async function getStorageCogs(month: string, opts: { force?: boolean } = {}): Promise<StorageResult<StorageCogsMonth>> {
  if (!isValidMonth(month)) return { ok: false, status: 400, reason: 'bad_request' };
  const ck = `cogs:${month}`;
  if (!opts.force && monthCache.has(ck)) return { ok: true, status: 200, data: monthCache.get(ck) as StorageCogsMonth, cached: true };
  const r = await fetchJson<StorageCogsMonth>(`/cogs?month=${month}`);
  if (r.ok) monthCache.set(ck, r.data);
  return r;
}

/** 마감 해제 등으로 스냅샷이 바뀌었을 때 — 관리자 수동 새로고침용 */
export function clearStorageCache(): void {
  menusCache = null;
  monthCache.clear();
}
