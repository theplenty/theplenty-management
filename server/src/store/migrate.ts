// 기존 데이터 파일을 신규 스키마로 한 번만 변환한다. 멱등.

import { nanoid } from 'nanoid';
import { store, persist } from './mockStore.js';
import type {
  MiceContact,
  MiceCustomer,
  MiceInquiry,
  MiceInquiryStatus,
  WeddingCustomer,
  WeddingEventInquiry,
} from '../types.js';

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
        contacts: [buildContactFromLegacy(raw)],
        call_date: (raw.call_date as string) || null,
        inquiry_event_date_text:
          (raw.inquiry_event_date as string) || (raw.inquiry_event_month as string) || '',
        event_memo: (raw.lost_reason as string) || '',
        created_by_id: '',
        created_by_name: '시스템 마이그레이션',
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
      if ('lost_reason' in inq && !('event_memo' in inq)) {
        inq.event_memo = inq.lost_reason ?? '';
        delete inq.lost_reason;
        dirty = true;
      }
      if (!('created_by_id' in inq)) {
        inq.created_by_id = '';
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

    // 신규 스키마 — assigned_manager_id/name 없는 옛 행 보정
    let dirty = false;
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
  const userById = new Map(store.users.map((u) => [u.id, u.name]));
  for (const e of store.events) {
    const raw = e as unknown as Record<string, unknown>;
    if (typeof raw.created_by_name !== 'string' || !raw.created_by_name) {
      raw.created_by_name = userById.get(e.created_by) || '';
      count++;
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
  if (count > 0 || foodSplitCount > 0) {
    persist('events');
    if (count > 0) console.log(`[migrate] events ${count}건 → created_by_name 필드 추가`);
    if (foodSplitCount > 0)
      console.log(`[migrate] events ${foodSplitCount}건 → 식음 GTD/EXP 계약·최종 분리`);
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

export function runMigrations() {
  migrateMiceCustomers();
  migrateWeddingCustomers();
  migrateEventReviews();
  migrateEvents();
  migrateFoodItems();
}
