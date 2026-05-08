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
};

export function getCollection<K extends keyof DB>(name: K): DB[K] {
  return db[name];
}

// 디바운스 — 동기 루프 안에서 다수의 mutation이 발생하더라도 디스크 쓰기는 1회로 합쳐짐.
// 일반 요청-응답 사이클에서는 응답 전에 flushPending()이 호출되어 즉시 기록되므로 안전.
const PERSIST_DEBOUNCE_MS = 25;
const pendingPersists = new Map<keyof DB, NodeJS.Timeout>();

function scheduleWrite(name: keyof DB) {
  const existing = pendingPersists.get(name);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingPersists.delete(name);
    try {
      saveCollection(name, db[name]);
    } catch (e) {
      console.error(`[mockStore] persist 실패 (${name}):`, e);
    }
  }, PERSIST_DEBOUNCE_MS);
  pendingPersists.set(name, t);
}

export function persist<K extends keyof DB>(name: K) {
  scheduleWrite(name);
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
