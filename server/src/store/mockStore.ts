import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  User,
  MiceCustomer,
  WeddingCustomer,
  Event,
  EventCustomerLink,
  FoodItem,
  Invoice,
  EventFile,
  Cancellation,
  EventReview,
  CalendarShare,
  ChangeLog,
  SalesTarget,
  ApiKey,
  CollaborationRequest,
} from '../types.js';

// 데이터 파일은 서버 루트의 data/ 폴더에 JSON으로 저장한다.
// 빌드 후에도 동일 경로를 가리키도록 src/ 기준으로 두 단계 위로 올라간다.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SNAPSHOT_RETAIN_DAYS = 30;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

interface DB {
  users: User[];
  mice_customers: MiceCustomer[];
  wedding_customers: WeddingCustomer[];
  events: Event[];
  event_customers: EventCustomerLink[];
  event_food_items: FoodItem[];
  invoices: Invoice[];
  event_files: EventFile[];
  cancellations: Cancellation[];
  event_reviews: EventReview[];
  calendar_shares: CalendarShare[];
  change_logs: ChangeLog[];
  sales_targets: SalesTarget[];
  api_keys: ApiKey[];
  collaboration_requests: CollaborationRequest[];
}

const COLLECTIONS: (keyof DB)[] = [
  'users',
  'mice_customers',
  'wedding_customers',
  'events',
  'event_customers',
  'event_food_items',
  'invoices',
  'event_files',
  'cancellations',
  'event_reviews',
  'calendar_shares',
  'change_logs',
  'sales_targets',
  'api_keys',
  'collaboration_requests',
];

function safeReadJSON<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error(`[mockStore] failed to read ${file}:`, e);
    return null;
  }
}

function loadCollection<K extends keyof DB>(name: K): DB[K] {
  const file = path.join(DATA_DIR, `${name}.json`);
  const prev = path.join(DATA_DIR, `${name}.json.prev`);
  const main = safeReadJSON<DB[K]>(file);
  if (main !== null) return main;
  // 메인이 깨졌거나 비어있으면 .prev 백업으로 자동 복구
  const fallback = safeReadJSON<DB[K]>(prev);
  if (fallback !== null) {
    console.warn(`[mockStore] ${name}.json 손상 — ${name}.json.prev 백업으로 복구`);
    return fallback;
  }
  return [] as unknown as DB[K];
}

// 쓰기 전: 현재 파일을 .prev로 회전 + 일자별 스냅샷
function rotateBackup(name: keyof DB) {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return;
  try {
    fs.copyFileSync(file, path.join(DATA_DIR, `${name}.json.prev`));
  } catch (e) {
    console.warn(`[mockStore] .prev 회전 실패 (${name}):`, e);
  }
  // 하루에 한 번만 스냅샷 — 같은 날짜 파일 있으면 skip
  const today = new Date().toISOString().slice(0, 10);
  const snap = path.join(BACKUP_DIR, `${name}_${today}.json`);
  if (!fs.existsSync(snap)) {
    try {
      fs.copyFileSync(file, snap);
    } catch (e) {
      console.warn(`[mockStore] 스냅샷 실패 (${name}):`, e);
    }
    pruneOldSnapshots(name);
  }
}

function pruneOldSnapshots(name: keyof DB) {
  try {
    const cutoff = Date.now() - SNAPSHOT_RETAIN_DAYS * 86400 * 1000;
    const prefix = `${name}_`;
    for (const entry of fs.readdirSync(BACKUP_DIR)) {
      if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue;
      const full = path.join(BACKUP_DIR, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {
        // ignore individual file errors
      }
    }
  } catch (e) {
    console.warn(`[mockStore] 스냅샷 prune 실패 (${name}):`, e);
  }
}

// 원자적 쓰기 — .tmp에 먼저 쓰고 rename. 도중에 크래시해도 원본은 안전.
function atomicWrite(file: string, data: string) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, data, 'utf-8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows에서 대상 파일이 잠겨 있으면 rename 실패 — copy로 폴백 후 tmp 정리
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function saveCollection<K extends keyof DB>(name: K, value: DB[K]) {
  const file = path.join(DATA_DIR, `${name}.json`);
  rotateBackup(name);
  atomicWrite(file, JSON.stringify(value, null, 2));
}

const db: DB = {
  users: loadCollection('users'),
  mice_customers: loadCollection('mice_customers'),
  wedding_customers: loadCollection('wedding_customers'),
  events: loadCollection('events'),
  event_customers: loadCollection('event_customers'),
  event_food_items: loadCollection('event_food_items'),
  invoices: loadCollection('invoices'),
  event_files: loadCollection('event_files'),
  cancellations: loadCollection('cancellations'),
  event_reviews: loadCollection('event_reviews'),
  calendar_shares: loadCollection('calendar_shares'),
  change_logs: loadCollection('change_logs'),
  sales_targets: loadCollection('sales_targets'),
  api_keys: loadCollection('api_keys'),
  collaboration_requests: loadCollection('collaboration_requests'),
};

export function getCollection<K extends keyof DB>(name: K): DB[K] {
  return db[name];
}

// ===================================================================
// Firestore에서 부팅 시 in-memory 데이터 hydrate
// ===================================================================
// Cloud Functions 환경 (STORE_BACKEND=firestore)에서는 JSON 파일이 없으므로
// 부팅 시 Firestore에서 모든 컬렉션을 메모리로 로드해야 라우트들이 정상 동작.
// dev 환경 (STORE_BACKEND=json|dual)에서는 JSON 파일이 이미 로드되었으니 skip.
let _hydratePromise: Promise<void> | null = null;

async function hydrateFromFirestore() {
  const backend = (process.env.STORE_BACKEND || 'json').toLowerCase();
  if (backend !== 'firestore') return; // JSON / dual 모드는 이미 부팅 완료
  // eslint-disable-next-line no-console
  console.log('[mockStore] Firestore에서 in-memory hydrate 시작');
  const { firestore } = await import('../lib/firebase.js');
  const t0 = Date.now();
  let total = 0;
  for (const coll of COLLECTIONS) {
    const snap = await firestore.collection(coll).get();
    const docs = snap.docs.map((d) => d.data());
    // 기존 배열 in-place 갱신 (다른 모듈이 store reference를 hold할 수 있으므로)
    (db[coll] as unknown[]).length = 0;
    (db[coll] as unknown[]).push(...docs);
    total += docs.length;
    // eslint-disable-next-line no-console
    console.log(`  [hydrate] ${coll}: ${docs.length}건`);
  }
  // eslint-disable-next-line no-console
  console.log(`[mockStore] hydrate 완료 — 총 ${total}건 (${Date.now() - t0}ms)`);
}

export function ensureHydrated(): Promise<void> {
  if (!_hydratePromise) {
    _hydratePromise = hydrateFromFirestore().catch((e) => {
      console.error('[mockStore] hydrate 실패:', e);
      _hydratePromise = null; // 다음 요청에서 재시도 가능하게
      throw e;
    });
  }
  return _hydratePromise;
}

// ===================================================================
// Firestore 동기화 — STORE_BACKEND 에 따라 활성화
// ===================================================================
// 'json'      : 로컬 JSON 파일에만 쓰기 (개발 기본)
// 'dual'      : 로컬 JSON + Firestore 둘 다 쓰기 (전환 안전 모드)
// 'firestore' : Firestore에만 쓰기 (Cloud Functions 운영 모드, JSON 파일은 캐시 미사용)
//
// 주의: ESM import 순서 때문에 모듈 로드 시점에는 dotenv가 아직 안 끝났을 수 있음.
// 그래서 모듈-level const가 아니라 함수 호출 시점에 process.env를 읽음.
function getBackendMode(): 'json' | 'dual' | 'firestore' {
  const v = (process.env.STORE_BACKEND || 'json').toLowerCase();
  if (v === 'dual' || v === 'firestore') return v;
  return 'json';
}
function isFirestoreEnabled(): boolean {
  const m = getBackendMode();
  return m === 'dual' || m === 'firestore';
}
function isJsonEnabled(): boolean {
  const m = getBackendMode();
  return m === 'json' || m === 'dual';
}

// undefined 필드 제거 (Firestore가 거부) — 깊은 복사 + 정제
function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sanitizeForFirestore);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = sanitizeForFirestore(v);
    }
    return out;
  }
  return value;
}

let firestoreModulePromise: Promise<typeof import('../lib/firebase.js')> | null = null;
function getFirestore() {
  if (!firestoreModulePromise) {
    firestoreModulePromise = import('../lib/firebase.js');
  }
  return firestoreModulePromise;
}

async function fsUpsert<K extends keyof DB>(coll: K, docId: string) {
  if (!isFirestoreEnabled()) return;
  const arr = db[coll] as unknown as Array<{ id: string }>;
  const doc = arr.find((d) => d.id === docId);
  if (!doc) return;
  try {
    const { firestore } = await getFirestore();
    await firestore
      .collection(coll)
      .doc(docId)
      .set(sanitizeForFirestore(doc) as Record<string, unknown>);
  } catch (e) {
    console.error(`[mockStore] Firestore upsert 실패 (${coll}/${docId}):`, e);
  }
}

async function fsDelete<K extends keyof DB>(coll: K, docId: string) {
  if (!isFirestoreEnabled()) return;
  try {
    const { firestore } = await getFirestore();
    await firestore.collection(coll).doc(docId).delete();
  } catch (e) {
    console.error(`[mockStore] Firestore delete 실패 (${coll}/${docId}):`, e);
  }
}

// ===================================================================
// 디바운스 + 영속화 (JSON + Firestore)
// ===================================================================
const PERSIST_DEBOUNCE_MS = 25;
const pendingPersists = new Map<keyof DB, NodeJS.Timeout>();

function scheduleJsonWrite(name: keyof DB) {
  if (!isJsonEnabled()) return;
  const existing = pendingPersists.get(name);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingPersists.delete(name);
    try {
      saveCollection(name, db[name]);
    } catch (e) {
      console.error(`[mockStore] JSON persist 실패 (${name}):`, e);
    }
  }, PERSIST_DEBOUNCE_MS);
  pendingPersists.set(name, t);
}

// 단일 doc 변경 (생성/업데이트). 가장 흔한 패턴.
export function persistDoc<K extends keyof DB>(coll: K, docId: string) {
  scheduleJsonWrite(coll);
  void fsUpsert(coll, docId);
}

// 단일 doc 삭제
export function persistDelete<K extends keyof DB>(coll: K, docId: string) {
  scheduleJsonWrite(coll);
  void fsDelete(coll, docId);
}

// "특정 조건의 docs 모두 X로 교체" 패턴 (replaceFoodItems 등)
// in-memory 변경까지 안에서 처리하고, Firestore에는 (사라진 것=delete, 새 것=upsert) 만 보냄
export function replaceMatching<K extends keyof DB>(
  coll: K,
  predicate: (item: DB[K] extends Array<infer T> ? T : never) => boolean,
  newItems: DB[K] extends Array<infer T> ? T[] : never
) {
  const arr = db[coll] as unknown as Array<{ id: string }>;
  const oldIds = new Set(arr.filter((x) => predicate(x as never)).map((x) => x.id));
  const newIds = new Set((newItems as unknown as Array<{ id: string }>).map((x) => x.id));

  // in-memory 교체
  const remaining = arr.filter((x) => !predicate(x as never));
  remaining.push(...(newItems as unknown as Array<{ id: string }>));
  (db[coll] as unknown as Array<{ id: string }>).length = 0;
  (db[coll] as unknown as Array<{ id: string }>).push(...remaining);

  scheduleJsonWrite(coll);
  if (isFirestoreEnabled()) {
    for (const id of oldIds) {
      if (!newIds.has(id)) void fsDelete(coll, id);
    }
    for (const id of newIds) {
      void fsUpsert(coll, id);
    }
  }
}

// ===================================================================
// 휴지통 (soft delete) — wedding_customers / mice_customers / events
// ===================================================================
// 정책:
//   - softDelete: deleted_at/by 필드를 채우고 persist. 실제 row는 유지.
//   - restoreSoft: 같은 필드를 null로 비우고 persist.
//   - purgeHard: 실제 row 삭제 + (event의 경우) 자식 cascade.
//   - 일반 list/get은 별도 헬퍼(filterActive) 또는 라우트에서 deleted_at 체크.
export interface SoftDeleteUser {
  id: string;
  name: string;
}

const SOFT_DELETE_COLLECTIONS = ['mice_customers', 'wedding_customers', 'events'] as const;
export type SoftDeleteCollection = (typeof SOFT_DELETE_COLLECTIONS)[number];

export function softDelete<K extends SoftDeleteCollection>(coll: K, id: string, user: SoftDeleteUser): boolean {
  const arr = db[coll] as unknown as Array<{
    id: string;
    deleted_at?: string | null;
    deleted_by_id?: string | null;
    deleted_by_name?: string | null;
  }>;
  const item = arr.find((d) => d.id === id);
  if (!item) return false;
  item.deleted_at = new Date().toISOString();
  item.deleted_by_id = user.id;
  item.deleted_by_name = user.name;
  scheduleJsonWrite(coll);
  void fsUpsert(coll, id);
  return true;
}

export function restoreSoft<K extends SoftDeleteCollection>(coll: K, id: string): boolean {
  const arr = db[coll] as unknown as Array<{
    id: string;
    deleted_at?: string | null;
    deleted_by_id?: string | null;
    deleted_by_name?: string | null;
  }>;
  const item = arr.find((d) => d.id === id);
  if (!item) return false;
  item.deleted_at = null;
  item.deleted_by_id = null;
  item.deleted_by_name = null;
  scheduleJsonWrite(coll);
  void fsUpsert(coll, id);
  return true;
}

// 실제 row 삭제. events 의 경우 자식 cascade.
export function purgeHard<K extends SoftDeleteCollection>(coll: K, id: string): boolean {
  const arr = db[coll] as unknown as Array<{ id: string }>;
  const idx = arr.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  arr.splice(idx, 1);
  scheduleJsonWrite(coll);
  void fsDelete(coll, id);
  if (coll === 'events') {
    deleteMatching('event_food_items', (f) => f.event_id === id);
    deleteMatching('event_customers', (l) => l.event_id === id);
    deleteMatching('invoices', (i) => i.event_id === id);
    deleteMatching('event_files', (f) => f.event_id === id);
    deleteMatching('cancellations', (c) => c.event_id === id);
    deleteMatching('event_reviews', (r) => r.event_id === id);
  }
  return true;
}

// 활성 row만 반환하는 헬퍼 — 라우트 GET에서 사용.
export function activeRows<T extends { deleted_at?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !r.deleted_at);
}

export function isDeleted<T extends { deleted_at?: string | null }>(row: T | undefined | null): boolean {
  return !!(row && row.deleted_at);
}

// "특정 조건의 docs 모두 삭제" 패턴 (cascade delete 시)
export function deleteMatching<K extends keyof DB>(
  coll: K,
  predicate: (item: DB[K] extends Array<infer T> ? T : never) => boolean
) {
  const arr = db[coll] as unknown as Array<{ id: string }>;
  const matchedIds = arr.filter((x) => predicate(x as never)).map((x) => x.id);
  const remaining = arr.filter((x) => !predicate(x as never));
  (db[coll] as unknown as Array<{ id: string }>).length = 0;
  (db[coll] as unknown as Array<{ id: string }>).push(...remaining);

  scheduleJsonWrite(coll);
  if (isFirestoreEnabled()) {
    for (const id of matchedIds) void fsDelete(coll, id);
  }
}

// Legacy compat: collection 전체를 다시 저장. JSON에는 OK이지만 Firestore에서는 비효율.
// 가능하면 persistDoc/persistDelete/replaceMatching 사용. 부팅·마이그레이션 용도로만 남김.
export function persist<K extends keyof DB>(name: K) {
  scheduleJsonWrite(name);
  // Firestore 전체 컬렉션 재기록은 하지 않음 — doc 단위로 명시적 호출이 필요.
  // 마이그레이션·시드 시점은 별도 스크립트가 처리.
}

// 보류 중인 모든(또는 특정) collection의 디스크 쓰기를 즉시 flush.
export function flushPending<K extends keyof DB>(name?: K) {
  const targets = name ? [name] : Array.from(pendingPersists.keys());
  for (const n of targets) {
    const t = pendingPersists.get(n);
    if (!t) continue;
    clearTimeout(t);
    pendingPersists.delete(n);
    try {
      saveCollection(n, db[n]);
    } catch (e) {
      console.error(`[mockStore] flush 실패 (${n}):`, e);
    }
  }
}

export function persistAll() {
  for (const c of COLLECTIONS) saveCollection(c, db[c]);
}

// 프로세스 종료 시 보류 중인 쓰기를 안전하게 flush.
let exitHandlersInstalled = false;
function installExitHandlers() {
  if (exitHandlersInstalled) return;
  exitHandlersInstalled = true;
  const handler = () => {
    flushPending();
  };
  process.on('beforeExit', handler);
  process.on('exit', handler);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      flushPending();
      process.exit(0);
    });
  }
}
installExitHandlers();

export const store = db;
