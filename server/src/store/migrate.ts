// 기존 데이터 파일을 신규 스키마로 한 번만 변환한다. 멱등.

import { nanoid } from 'nanoid';
import { store, persist, persistDoc, persistDelete } from './mockStore.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import type {
  MiceContact,
  MiceCustomer,
  MiceInquiry,
  MiceInquiryStatus,
  Tenant,
  WeddingCustomer,
  WeddingEventInquiry,
} from '../types.js';
import { MICE_BOM } from './menuBomData.js';
import { WEDDING_BOM } from './menuWeddingBomData.js';
import { MICE_BEV_BOM, WEDDING_BEV_BOM } from './menuBanquetBomData.js';

const MICE_LEGACY_KEYS = [
  'progress_status',
  'contact_name',
  'phone',
  'email',
  'call_date',
  'source',
  'source_detail',
  'inquiry_event_date',
  'inquiry_event_month',
  'estimate_sent_status',
  'lost_reason',
];

const WEDDING_LEGACY_KEYS = [
  'wedding_progress_status',
  'consultation_datetime',
  'wedding_datetime',
  'guaranteed_guest_count',
  'sales_manager',
  'visit_consultation_comment',
  'estimate_amount',
];

function buildContactFromLegacy(raw: Record<string, unknown>): MiceContact {
  return {
    id: nanoid(10),
    name: (raw.contact_name as string) || '',
    email: (raw.email as string) || '',
    phone: (raw.phone as string) || '',
  };
}

function migrateMiceCustomers() {
  let convertedCount = 0;
  let renameCount = 0;
  let contactsAddedCount = 0;

  for (const c of store.mice_customers) {
    const raw = c as unknown as Record<string, unknown>;

    // 1) 완전 옛 스키마 (inquiries 없음) → 변환
    if (!Array.isArray(raw.inquiries)) {
      const oldStatus = (raw.progress_status as string) || 'INQ';
      const status: MiceInquiryStatus =
        oldStatus === 'X' ? '단순문의' : (oldStatus as MiceInquiryStatus);

      const inquiry: MiceInquiry = {
        id: nanoid(10),
        progress_status: status,
        inquiry_channel: 'INCALL', // 기존 데이터 일괄 INCALL 분류
        contacts: [buildContactFromLegacy(raw)],
        call_date: (raw.call_date as string) || null,
        inquiry_event_date_text:
          (raw.inquiry_event_date as string) || (raw.inquiry_event_month as string) || '',
        created_by_id: '',
        created_by_name: '시스템 마이그레이션',
        assigned_manager_id: '',
        assigned_manager_name: '',
        created_at: (raw.created_at as string) || new Date().toISOString(),
      };

      const next: MiceCustomer = {
        id: c.id,
        customer_type: 'MICE',
        mice_category: c.mice_category,
        organization_name: c.organization_name,
        official_phone: (raw.phone as string) || '',
        official_email: (raw.email as string) || '',
        official_website: '',
        inquiries: [inquiry],
        memo: c.memo,
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
      for (const k of MICE_LEGACY_KEYS) delete raw[k];
      Object.assign(c, next);
      convertedCount++;
      continue;
    }

    // 2) 신규 스키마 — 각 inquiry 내부 보정
    let dirty = false;
    for (const inq of c.inquiries as unknown as Record<string, unknown>[]) {
      // event_memo(행사관련메모) 필드 폐기 — 남아있는 옛 값/이전 lost_reason 키 정리.
      if ('event_memo' in inq) {
        delete inq.event_memo;
        dirty = true;
      }
      if ('lost_reason' in inq) {
        delete inq.lost_reason;
        dirty = true;
      }
      if (!('created_by_id' in inq)) {
        inq.created_by_id = '';
        dirty = true;
      }
      // 유입 채널 필드 추가 — 기존 데이터는 모두 INCALL 로 일괄 분류. admin 이 추후 OUTCALL 재분류.
      if (!('inquiry_channel' in inq)) {
        inq.inquiry_channel = 'INCALL';
        dirty = true;
      }
      // contacts[] 없는 경우 → 기존 contact_name/email/phone를 한 명의 담당자로 변환
      if (!Array.isArray(inq.contacts)) {
        const hasAny = !!(inq.contact_name || inq.email || inq.phone);
        inq.contacts = hasAny
          ? [
              {
                id: nanoid(10),
                name: (inq.contact_name as string) || '',
                email: (inq.email as string) || '',
                phone: (inq.phone as string) || '',
              },
            ]
          : [];
        delete inq.contact_name;
        delete inq.email;
        delete inq.phone;
        contactsAddedCount++;
        dirty = true;
      }
    }
    if (dirty) renameCount++;
  }

  if (convertedCount + renameCount > 0) {
    persist('mice_customers');
    if (convertedCount > 0)
      console.log(`[migrate] mice_customers ${convertedCount}건 → 신규 스키마로 이전`);
    if (renameCount > 0)
      console.log(`[migrate] mice_customers ${renameCount}건 → 내부 필드 보정`);
    if (contactsAddedCount > 0)
      console.log(`[migrate] mice_customers inquiry ${contactsAddedCount}건 → contacts[] 변환`);
  }
}

function migrateWeddingCustomers() {
  let convertedCount = 0;
  let renameCount = 0;

  for (const c of store.wedding_customers) {
    const raw = c as unknown as Record<string, unknown>;

    if (!Array.isArray(raw.event_inquiries)) {
      const oldStatus = (raw.wedding_progress_status as string) || 'INQ';
      const inquiry: WeddingEventInquiry = {
        id: nanoid(10),
        wedding_datetime: (raw.wedding_datetime as string) || null,
        guaranteed_guest_count: (raw.guaranteed_guest_count as number) ?? null,
        estimate_amount: (raw.estimate_amount as string) || '',
        estimate_detail: '',
        visit_consultation_comment: (raw.visit_consultation_comment as string) || '',
        assigned_manager_id: '',
        assigned_manager_name: (raw.sales_manager as string) || '',
        created_at: (raw.created_at as string) || new Date().toISOString(),
      };
      const next: WeddingCustomer = {
        id: c.id,
        customer_type: 'WEDDING',
        wedding_event_name: c.wedding_event_name,
        progress_status: oldStatus as WeddingCustomer['progress_status'],
        inquiry_date: c.inquiry_date,
        desired_consultation_date: (raw.consultation_datetime as string) || null,
        first_inform_comment: c.first_inform_comment,
        groom_name: c.groom_name,
        groom_phone: c.groom_phone,
        groom_email: c.groom_email,
        bride_name: c.bride_name,
        bride_phone: c.bride_phone,
        bride_email: c.bride_email,
        competing_venues: c.competing_venues,
        desired_budget: c.desired_budget,
        source: '',
        source_detail: '',
        search_keyword: '',
        event_inquiries: [inquiry],
        memo: c.memo,
        created_at: c.created_at,
        updated_at: c.updated_at,
      };
      for (const k of WEDDING_LEGACY_KEYS) delete raw[k];
      delete raw.source;
      delete raw.source_detail;
      Object.assign(c, next);
      convertedCount++;
      continue;
    }

    // 신규 스키마 — search_keyword 누락 행 백필 + assigned_manager_id/name 없는 옛 행 보정
    let dirty = false;
    if (!('search_keyword' in raw)) {
      raw.search_keyword = '';
      dirty = true;
    }
    for (const inq of c.event_inquiries as unknown as Record<string, unknown>[]) {
      if (!('assigned_manager_id' in inq)) {
        inq.assigned_manager_id = '';
        dirty = true;
      }
      if (!('assigned_manager_name' in inq)) {
        inq.assigned_manager_name = '';
        dirty = true;
      }
    }
    if (dirty) renameCount++;
  }

  if (convertedCount + renameCount > 0) {
    persist('wedding_customers');
    if (convertedCount > 0)
      console.log(`[migrate] wedding_customers ${convertedCount}건 → 신규 스키마로 이전`);
    if (renameCount > 0)
      console.log(`[migrate] wedding_customers ${renameCount}건 → 담당지배인 필드 추가`);
  }
}

function migrateEventReviews() {
  let count = 0;
  for (const r of store.event_reviews) {
    const raw = r as unknown as Record<string, unknown>;
    if (!('final_revenue' in raw)) {
      raw.final_revenue = null;
      count++;
    }
  }
  if (count > 0) {
    persist('event_reviews');
    console.log(`[migrate] event_reviews ${count}건 → final_revenue 필드 추가`);
  }
}

function migrateEvents() {
  let count = 0;
  let foodSplitCount = 0;
  let tenCount = 0;
  let hallsDedupCount = 0;
  const hallsDedupIds: string[] = [];
  const userById = new Map(store.users.map((u) => [u.id, u.name]));
  for (const e of store.events) {
    const raw = e as unknown as Record<string, unknown>;
    // 사용홀 중복 제거 — Excel import 등으로 ['Hall A+B', 'Leaf Room', 'Hall A+B'] 같은 중복 발생 가능.
    // persist('events')는 JSON만 갱신하므로, Firestore까지 반영하기 위해 persistDoc을 별도 호출한다.
    if (Array.isArray(raw.halls)) {
      const deduped = [...new Set(raw.halls as string[])];
      if (deduped.length !== (raw.halls as string[]).length) {
        raw.halls = deduped;
        hallsDedupCount++;
        hallsDedupIds.push(e.id);
      }
    }
    if (typeof raw.created_by_name !== 'string' || !raw.created_by_name) {
      raw.created_by_name = userById.get(e.created_by) || '';
      count++;
    }
    // TEN 폐기 (2026-05-14 정책 변경) → 모두 INQ 로 일괄 이전
    if (raw.status === 'TEN') {
      raw.status = 'INQ';
      tenCount++;
    }
    // 기존 food_gtd / food_exp → food_gtd_contract / food_exp_contract 로 이전.
    // 최종확정 값은 사용자가 추후 입력하므로 null로 초기화.
    if ('food_gtd' in raw || 'food_exp' in raw) {
      if (!('food_gtd_contract' in raw))
        raw.food_gtd_contract = (raw.food_gtd as number | null) ?? null;
      if (!('food_exp_contract' in raw))
        raw.food_exp_contract = (raw.food_exp as number | null) ?? null;
      if (!('food_gtd_final' in raw)) raw.food_gtd_final = null;
      if (!('food_exp_final' in raw)) raw.food_exp_final = null;
      delete raw.food_gtd;
      delete raw.food_exp;
      foodSplitCount++;
    } else {
      if (!('food_gtd_contract' in raw)) raw.food_gtd_contract = null;
      if (!('food_exp_contract' in raw)) raw.food_exp_contract = null;
      if (!('food_gtd_final' in raw)) raw.food_gtd_final = null;
      if (!('food_exp_final' in raw)) raw.food_exp_final = null;
    }
  }
  if (count > 0 || foodSplitCount > 0 || tenCount > 0 || hallsDedupCount > 0) {
    persist('events'); // JSON 파일 갱신
    if (count > 0) console.log(`[migrate] events ${count}건 → created_by_name 필드 추가`);
    if (foodSplitCount > 0)
      console.log(`[migrate] events ${foodSplitCount}건 → 식음 GTD/EXP 계약·최종 분리`);
    if (tenCount > 0) console.log(`[migrate] events ${tenCount}건 → TEN 상태를 INQ 로 이전`);
    if (hallsDedupCount > 0) {
      console.log(`[migrate] events ${hallsDedupCount}건 → 사용홀 중복 제거 (Firestore 반영 중)`);
      // persist()는 JSON만 갱신하므로, 변경된 건만 persistDoc으로 Firestore에도 기록
      for (const id of hallsDedupIds) persistDoc('events', id);
    }
  }
}

// 식음 메뉴 항목 — 기존 단일 gtd/exp → 계약기준/확정 두 쌍으로 분리.
// 기존 값은 의미상 "계약 시점"으로 간주하여 gtd_contract/exp_contract로 이관, 확정은 null.
function migrateFoodItems() {
  let count = 0;
  for (const f of store.event_food_items) {
    const raw = f as unknown as Record<string, unknown>;
    const hasLegacy = 'gtd' in raw || 'exp' in raw;
    const missingNew =
      !('gtd_contract' in raw) ||
      !('exp_contract' in raw) ||
      !('gtd_final' in raw) ||
      !('exp_final' in raw);
    if (!hasLegacy && !missingNew) continue;
    if (!('gtd_contract' in raw)) raw.gtd_contract = (raw.gtd as number | null) ?? null;
    if (!('exp_contract' in raw)) raw.exp_contract = (raw.exp as number | null) ?? null;
    if (!('gtd_final' in raw)) raw.gtd_final = null;
    if (!('exp_final' in raw)) raw.exp_final = null;
    if ('gtd' in raw) delete raw.gtd;
    if ('exp' in raw) delete raw.exp;
    count++;
  }
  if (count > 0) {
    persist('event_food_items');
    console.log(`[migrate] event_food_items ${count}건 → 식음 GTD/EXP 계약·확정 분리`);
  }
}

// ===== 멀티테넌시 백필 =====
// 기본 테넌트를 보장하고, 기존 단일 회사 데이터 전체에 tenant_id 를 채운다. 멱등.
function migrateTenants() {
  if (!store.tenants.find((t) => t.id === DEFAULT_TENANT_ID)) {
    const now = new Date().toISOString();
    const t: Tenant = {
      id: DEFAULT_TENANT_ID,
      name: '플렌티컨벤션',
      slug: DEFAULT_TENANT_ID,
      plan: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    store.tenants.push(t);
    persist('tenants');
    console.log('[migrate] 기본 테넌트 생성:', DEFAULT_TENANT_ID);
  }

  const collections = [
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
    'summary_shares',
    'menus',
  ] as const;

  for (const coll of collections) {
    const arr = store[coll] as unknown as Array<Record<string, unknown>>;
    let n = 0;
    for (const row of arr) {
      if (!row.tenant_id) {
        row.tenant_id = DEFAULT_TENANT_ID;
        n++;
      }
    }
    if (n > 0) {
      persist(coll);
      console.log(`[migrate] ${coll} ${n}건 → tenant_id 백필`);
    }
  }
}

function migrateMenus() {
  let count = 0;
  for (const m of store.menus) {
    const raw = m as unknown as Record<string, unknown>;
    if (!('mode' in raw)) {
      const name = ((raw.name_ko as string) || '').toLowerCase();
      if (name.includes('coffee break')) {
        raw.mode = 'coffee';
      } else if (
        name.includes('dessert') ||
        name.includes('rice cake') ||
        name.includes('디저트') ||
        name.includes('케이크')
      ) {
        raw.mode = 'qty';
      } else {
        raw.mode = 'set';
      }
      count++;
    }
  }
  if (count > 0) {
    persist('menus');
    console.log(`[migrate] menus ${count}건 → mode 필드 백필`);
  }
}

// ── 메뉴 BOM 일괄 등록 (기업/MICE — 2026년 4월 기준) ─────────────────
// 멱등: 이미 (name_ko + category + event_type='MICE') 조합이 존재하면 스킵.
// 구 스타일 카테고리(전식/주식/후식/음료/주류/패키지)로 된 메뉴는 BOM 등록 전 제거.
// 주의: persist()는 Firestore 모드에서 no-op. 각 doc 단위로 persistDoc/persistDelete 사용.
function migrateMenuBOM() {
  const OLD_CATS = new Set(['전식', '주식', '후식', '음료', '주류', '패키지']);

  // 1) 구 스타일 카테고리 제거 — persistDelete 로 Firestore에도 반영
  const toRemove = store.menus.filter((m) => OLD_CATS.has(m.category));
  if (toRemove.length > 0) {
    store.menus = store.menus.filter((m) => !OLD_CATS.has(m.category));
    for (const m of toRemove) persistDelete('menus', m.id);
    console.log(`[migrate] 구 카테고리 메뉴 ${toRemove.length}건 제거`);
  }

  // 2) 기존 event_type 필드 백필 (없는 것은 'MICE' 로) — persistDoc 로 Firestore 반영
  const backfilledIds: string[] = [];
  for (const m of store.menus) {
    const raw = m as unknown as Record<string, unknown>;
    if (!raw.event_type) {
      raw.event_type = 'MICE';
      backfilledIds.push(m.id);
    }
  }
  if (backfilledIds.length > 0) {
    for (const id of backfilledIds) persistDoc('menus', id);
    console.log(`[migrate] menus ${backfilledIds.length}건 → event_type 백필`);
  }

  // 3) MenuDetail 확장 필드 백필 (unit/unit_price/portion_cost 없으면 기본값)
  const detailBackfilledIds = new Set<string>();
  for (const m of store.menus) {
    if (!Array.isArray(m.details)) continue;
    for (const d of m.details) {
      const raw = d as unknown as Record<string, unknown>;
      let changed = false;
      if (raw.unit === undefined) { raw.unit = ''; changed = true; }
      if (raw.unit_price === undefined) { raw.unit_price = null; changed = true; }
      if (raw.portion_cost === undefined) { raw.portion_cost = null; changed = true; }
      if (changed) detailBackfilledIds.add(m.id);
    }
  }
  if (detailBackfilledIds.size > 0) {
    for (const id of detailBackfilledIds) persistDoc('menus', id);
    console.log(`[migrate] menu details ${detailBackfilledIds.size}건 → 원가 필드 백필`);
  }

  // 4) dept 필드 백필 — 미설정 항목 전체를 '주방' 으로
  const deptBackfilledIds: string[] = [];
  for (const m of store.menus) {
    const raw = m as unknown as Record<string, unknown>;
    if (raw.dept === undefined || raw.dept === null || raw.dept === '') {
      raw.dept = '주방';
      deptBackfilledIds.push(m.id);
    }
  }
  if (deptBackfilledIds.length > 0) {
    for (const id of deptBackfilledIds) persistDoc('menus', id);
    console.log(`[migrate] menus ${deptBackfilledIds.length}건 → dept 백필 (주방)`);
  }

  // 5) invoice_labels 백필 — 미설정 항목에 빈 배열 부여
  const labelBackfilledIds: string[] = [];
  for (const m of store.menus) {
    const raw = m as unknown as Record<string, unknown>;
    if (!Array.isArray(raw.invoice_labels)) {
      raw.invoice_labels = [];
      labelBackfilledIds.push(m.id);
    }
  }
  if (labelBackfilledIds.length > 0) {
    for (const id of labelBackfilledIds) persistDoc('menus', id);
    console.log(`[migrate] menus ${labelBackfilledIds.length}건 → invoice_labels 백필`);
  }

  // 6) BOM 데이터 등록 (미존재 항목만) — persistDoc 로 Firestore에 즉시 기록
  const t = new Date().toISOString();
  const newIds: string[] = [];
  for (const course of MICE_BOM) {
    const exists = store.menus.find(
      (m) => m.name_ko === course.name_ko && m.category === course.category && m.event_type === 'MICE'
    );
    if (exists) continue;

    const id = nanoid(10);
    const details = course.ingredients.map(([name, qty, unit, unitPrice, portionCost]) => ({
      id: nanoid(10),
      dish_name: name as string,
      quantity: String(qty),
      unit: unit as string,
      unit_price: unitPrice as number,
      portion_cost: portionCost as number,
      notes: '',
    }));

    store.menus.push({
      id,
      tenant_id: DEFAULT_TENANT_ID,
      name_ko: course.name_ko,
      category: course.category,
      event_type: 'MICE',
      dept: course.dept ?? '주방',
      mode: course.mode,
      serving_size_default: 1,
      list_price: course.list_price ?? null,
      is_active: true,
      notes: course.notes ?? '',
      details,
      created_at: t,
      updated_at: t,
    });
    newIds.push(id);
  }

  if (newIds.length > 0) {
    for (const id of newIds) persistDoc('menus', id);
    console.log(`[migrate] MICE BOM 메뉴 ${newIds.length}건 등록 완료 (기업 2026년 4월 기준)`);
  }
}

// ── 웨딩(WEDDING) 메뉴 BOM 일괄 등록 — 2026년 4월 기준 ───────────────
// 멱등: 이미 (name_ko + category + event_type='WEDDING') 조합이 존재하면 스킵.
function migrateWeddingMenuBOM() {
  const t = new Date().toISOString();
  const newIds: string[] = [];
  for (const course of WEDDING_BOM) {
    const exists = store.menus.find(
      (m) => m.name_ko === course.name_ko && m.category === course.category && m.event_type === 'WEDDING'
    );
    if (exists) continue;

    const id = nanoid(10);
    const details = course.ingredients.map(([name, qty, unit, unitPrice, portionCost]) => ({
      id: nanoid(10),
      dish_name: name as string,
      quantity: String(qty),
      unit: unit as string,
      unit_price: unitPrice as number,
      portion_cost: portionCost as number,
      notes: '',
    }));

    store.menus.push({
      id,
      tenant_id: DEFAULT_TENANT_ID,
      name_ko: course.name_ko,
      category: course.category,
      event_type: 'WEDDING',
      dept: course.dept ?? '주방',
      mode: course.mode,
      serving_size_default: 1,
      list_price: course.list_price ?? null,
      is_active: true,
      notes: course.notes ?? '',
      details,
      created_at: t,
      updated_at: t,
    });
    newIds.push(id);
  }

  if (newIds.length > 0) {
    for (const id of newIds) persistDoc('menus', id);
    console.log(`[migrate] WEDDING BOM 메뉴 ${newIds.length}건 등록 완료 (웨딩 2026년 4월 기준)`);
  }
}

// ── 연회팀 음료 BOM 일괄 등록 (MICE + WEDDING) ─────────────────────────
// 멱등: 이미 (name_ko + category + event_type) 조합이 존재하면 스킵.
// 원본 금액은 VAT 포함 → ÷1.1 하여 저장 (UI에서 ×1.1로 VAT 포함 합계 표시).
function migrateBanquetBevBOM() {
  const t = new Date().toISOString();
  const newIds: string[] = [];

  const bevGroups: Array<{ bom: typeof MICE_BEV_BOM; event_type: 'MICE' | 'WEDDING' }> = [
    { bom: MICE_BEV_BOM, event_type: 'MICE' },
    { bom: WEDDING_BEV_BOM, event_type: 'WEDDING' },
  ];

  for (const { bom, event_type } of bevGroups) {
    for (const course of bom) {
      const exists = store.menus.find(
        (m) => m.name_ko === course.name_ko && m.category === course.category && m.event_type === event_type
      );
      if (exists) continue;

      const id = nanoid(10);
      const details = course.ingredients.map(([name, qty, unit, unitPrice, portionCost]) => ({
        id: nanoid(10),
        dish_name: name as string,
        quantity: String(qty),
        unit: unit as string,
        unit_price: unitPrice as number,
        portion_cost: portionCost as number,
        notes: '',
      }));

      store.menus.push({
        id,
        tenant_id: DEFAULT_TENANT_ID,
        name_ko: course.name_ko,
        category: course.category,
        event_type,
        dept: course.dept ?? '연회',
        mode: course.mode,
        serving_size_default: 1,
        list_price: course.list_price ?? null,
        is_active: true,
        notes: course.notes ?? '',
        details,
        created_at: t,
        updated_at: t,
      });
      newIds.push(id);
    }
  }

  if (newIds.length > 0) {
    for (const id of newIds) persistDoc('menus', id);
    console.log(`[migrate] 연회 음료 BOM ${newIds.length}건 등록 완료 (MICE ${MICE_BEV_BOM.length}종 + WEDDING ${WEDDING_BEV_BOM.length}종)`);
  }
}

export function runMigrations() {
  migrateTenants();
  migrateMiceCustomers();
  migrateWeddingCustomers();
  migrateEventReviews();
  migrateEvents();
  migrateFoodItems();
  migrateMenus();
  migrateMenuBOM();
  migrateWeddingMenuBOM();
  migrateBanquetBevBOM();
}
