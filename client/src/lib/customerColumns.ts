import type { ColumnDef } from './excel';
import { nanoid } from './clientId';
import type {
  MiceContact,
  MiceCustomer,
  MiceInquiry,
  MiceInquiryStatus,
  WeddingCustomer,
  WeddingEventInquiry,
  WeddingProgressStatus,
  WeddingSource,
  WeddingSourceDetail,
} from '../types';

// ============================================================
// 엑셀 라운드트립 전략
// ============================================================
// 한 고객은 여러 문의(MICE) 또는 여러 예식 후보(WEDDING)를 가질 수 있다.
// 엑셀은 평면 시트라서, 한 행 = 한 문의/한 예식 후보로 펼친다.
// 같은 업체/같은 행사명을 가진 행들은 import 시 하나의 고객으로 묶는다.
// 회사·고객 단위 칼럼은 첫 행에만 채우고 나머지 행은 비워두면 깔끔하지만,
// 모든 행에 동일한 값을 채워도 group 시 이상 없도록 처리한다.

// 한 행 = (업체, 문의, 담당자) 한 묶음.
// "고객 ID"는 upsert 매칭 키 — 빈 값으로 import 시 신규 추가, 값이 있으면 기존 갱신.
// "문의 #" 컬럼으로 같은 문의 내 여러 담당자를 묶고,
// 같은 업체명을 가진 행들은 import 시 한 고객으로 그룹화한다.
export interface MiceFlatRow {
  // upsert 매칭 키 (시스템 ID, 첫 번째 컬럼 — 사용자가 수정하지 않음)
  customer_id: string;
  // (1) 업체정보 — 회사 단위, 매 행에 반복
  mice_category: string;
  organization_name: string;
  official_phone: string;
  official_email: string;
  official_website: string;
  // (2) 문의세부정보 — 같은 문의# 내 행들은 동일 값
  inquiry_no: number | null;
  progress_status: string;
  call_date: string | null;
  inquiry_event_date_text: string;
  event_memo: string;
  created_by_name: string;
  // 담당자 단위
  contact_name: string;
  email: string;
  phone: string;
  // (3) 메모 — 회사 단위
  memo: string;
}

export const MICE_FLAT_COLUMNS: ColumnDef<MiceFlatRow>[] = [
  { header: '고객 ID', key: 'customer_id', width: 14 }, // upsert 매칭 키
  // (1) 업체정보
  { header: '구분', key: 'mice_category', width: 12 },
  { header: '업체명', key: 'organization_name', width: 28 },
  { header: '공식연락처', key: 'official_phone', width: 16 },
  { header: '공식이메일', key: 'official_email', width: 24 },
  { header: '공식홈페이지/블로그', key: 'official_website', width: 28 },
  // (2) 문의세부정보
  { header: '문의 #', key: 'inquiry_no', width: 8 },
  { header: '진행상황', key: 'progress_status', width: 10 },
  { header: '통화일자', key: 'call_date', width: 14 },
  { header: '문의 행사일', key: 'inquiry_event_date_text', width: 18 },
  { header: '행사관련메모', key: 'event_memo', width: 24 },
  { header: '작성자', key: 'created_by_name', width: 16 },
  // 담당자 단위
  { header: '담당자', key: 'contact_name', width: 14 },
  { header: '연락처', key: 'phone', width: 16 },
  { header: '이메일', key: 'email', width: 24 },
  // (3) 메모
  { header: '메모', key: 'memo', width: 36 },
];

export function buildMiceFlatRows(customers: MiceCustomer[]): MiceFlatRow[] {
  const rows: MiceFlatRow[] = [];
  for (const c of customers) {
    const companyFields = {
      customer_id: c.id, // upsert 매칭 키 — 첫 행에만 채우고 나머지는 비워두면 import 시 같은 그룹으로 인식됨
      mice_category: c.mice_category,
      organization_name: c.organization_name,
      official_phone: c.official_phone,
      official_email: c.official_email,
      official_website: c.official_website,
    };
    if (c.inquiries.length === 0) {
      rows.push({
        ...companyFields,
        inquiry_no: null,
        progress_status: '',
        call_date: null,
        inquiry_event_date_text: '',
        event_memo: '',
        created_by_name: '',
        contact_name: '',
        email: '',
        phone: '',
        memo: c.memo,
      });
      continue;
    }
    let isFirstRow = true;
    c.inquiries.forEach((inq, iIdx) => {
      const inquiryFields = {
        inquiry_no: iIdx + 1,
        progress_status: inq.progress_status,
        call_date: inq.call_date,
        inquiry_event_date_text: inq.inquiry_event_date_text,
        event_memo: inq.event_memo,
        created_by_name: inq.created_by_name,
      };
      const contacts = inq.contacts.length ? inq.contacts : [{ id: '', name: '', email: '', phone: '' }];
      contacts.forEach((ct) => {
        rows.push({
          ...companyFields,
          ...inquiryFields,
          contact_name: ct.name,
          email: ct.email,
          phone: ct.phone,
          memo: isFirstRow ? c.memo : '', // 첫 행에만 회사 메모
        });
        isFirstRow = false;
      });
    });
  }
  return rows;
}

// upsert를 위해 id를 옵션으로 포함. id가 있으면 서버에서 매칭 키로 사용.
type MicePostShape = Omit<MiceCustomer, 'id' | 'created_at' | 'updated_at' | 'customer_type'> & {
  id?: string;
};

/**
 * Excel 행 → 고객 그룹 (import).
 * 그룹화 규칙:
 *   - 같은 customer_id(있으면) 또는 같은 업체명 = 한 고객
 *   - 같은 customer_id + 같은 문의# = 한 문의 (여러 행 = 여러 담당자)
 *   - 문의# 누락 시: 행마다 새 문의 (구버전 엑셀 호환성)
 */
export function groupMiceFlatRows(
  rows: Partial<MiceFlatRow>[],
  fallbackAuthorId: string,
  fallbackAuthorName: string
): MicePostShape[] {
  const map = new Map<string, MicePostShape>();
  // 고객별로 inquiry_no → MiceInquiry 매핑
  const inquiryMap = new Map<string, Map<string, MiceInquiry>>();
  // 문의# 누락 시 임의 자동증가 카운터 (고객별)
  const autoCounter = new Map<string, number>();

  // 같은 고객의 여러 행 사이에서 customer_id가 첫 행에만 채워진 경우 처리.
  // → key는 customer_id(있으면) 또는 업체명. 같은 업체명 내에서는 id가 한 번이라도 있으면 그걸 채택.
  const idByOrg = new Map<string, string>();
  for (const r of rows) {
    const orgName = (r.organization_name || '').trim();
    if (!orgName) continue;
    const cid = (r.customer_id || '').trim();
    if (cid && !idByOrg.has(orgName.toLowerCase())) {
      idByOrg.set(orgName.toLowerCase(), cid);
    }
  }

  for (const r of rows) {
    const orgName = (r.organization_name || '').trim();
    if (!orgName) continue;
    const orgKey = orgName.toLowerCase();
    const customerId = (r.customer_id || '').trim() || idByOrg.get(orgKey) || '';
    // 그룹 키 — id 우선, 없으면 정규화 업체명
    const groupKey = customerId || orgKey;

    let cust = map.get(groupKey);
    if (!cust) {
      cust = {
        id: customerId || undefined,
        mice_category: (r.mice_category as MiceCustomer['mice_category']) || '기업',
        organization_name: orgName,
        official_phone: r.official_phone || '',
        official_email: r.official_email || '',
        official_website: r.official_website || '',
        inquiries: [],
        memo: r.memo || '',
      };
      map.set(groupKey, cust);
      inquiryMap.set(groupKey, new Map());
      autoCounter.set(groupKey, 0);
    } else {
      if (!cust.official_phone && r.official_phone) cust.official_phone = r.official_phone;
      if (!cust.official_email && r.official_email) cust.official_email = r.official_email;
      if (!cust.official_website && r.official_website)
        cust.official_website = r.official_website;
      if (!cust.memo && r.memo) cust.memo = r.memo;
    }

    const hasInquiry =
      !!r.progress_status ||
      !!r.contact_name ||
      !!r.email ||
      !!r.phone ||
      !!r.call_date ||
      !!r.inquiry_event_date_text ||
      !!r.event_memo;
    if (!hasInquiry) continue;

    // 문의# 결정 — 명시된 값 우선, 없으면 자동 증가
    let inquiryKey: string;
    const inqNo = r.inquiry_no as number | string | null | undefined;
    if (inqNo !== null && inqNo !== undefined && String(inqNo).trim() !== '') {
      inquiryKey = String(inqNo);
    } else {
      const next = (autoCounter.get(groupKey) || 0) + 1;
      autoCounter.set(groupKey, next);
      inquiryKey = `auto_${next}`;
    }

    const customerInquiries = inquiryMap.get(groupKey)!;
    let inq: MiceInquiry | undefined = customerInquiries.get(inquiryKey);
    if (!inq) {
      inq = {
        id: nanoid(),
        progress_status: ((r.progress_status as MiceInquiryStatus) || 'INQ') as MiceInquiryStatus,
        inquiry_channel: 'INCALL', // 엑셀 임포트 기본값 — admin 이 추후 재분류
        contacts: [],
        call_date: r.call_date || null,
        inquiry_event_date_text: r.inquiry_event_date_text || '',
        event_memo: r.event_memo || '',
        created_by_id: '',
        created_by_name: r.created_by_name || fallbackAuthorName,
        // 담당자 미지정 시 서버가 작성자에서 fallback — Excel import 단계에서는 비워둔다
        assigned_manager_id: '',
        assigned_manager_name: '',
        created_at: new Date().toISOString(),
      };
      if (inq.created_by_name === fallbackAuthorName) {
        inq.created_by_id = fallbackAuthorId;
      }
      customerInquiries.set(inquiryKey, inq);
      cust.inquiries.push(inq);
    }

    // 담당자 추가 (이름/이메일/연락처 중 하나라도 있을 때)
    if (r.contact_name || r.email || r.phone) {
      const ct: MiceContact = {
        id: nanoid(),
        name: r.contact_name || '',
        email: r.email || '',
        phone: r.phone || '',
      };
      inq.contacts.push(ct);
    }
  }
  return Array.from(map.values());
}

// ============================================================
// WEDDING
// ============================================================

export interface WeddingFlatRow {
  // upsert 매칭 키
  customer_id: string;
  // (1) 고객기본정보
  wedding_event_name: string;
  progress_status: string;
  inquiry_date: string | null;
  desired_consultation_date: string | null;
  first_inform_comment: string;
  groom_name: string;
  groom_phone: string;
  groom_email: string;
  bride_name: string;
  bride_phone: string;
  bride_email: string;
  competing_venues: string;
  desired_budget: string;
  source: string;
  source_detail: string;
  // (2) 문의세부정보 (예식 후보)
  wedding_datetime: string | null;
  guaranteed_guest_count: number | null;
  estimate_amount: string;
  estimate_detail: string;
  visit_consultation_comment: string;
  assigned_manager_name: string;
  // (3) 메모
  memo: string;
}

export const WEDDING_FLAT_COLUMNS: ColumnDef<WeddingFlatRow>[] = [
  { header: '고객 ID', key: 'customer_id', width: 14 }, // upsert 매칭 키
  // (1) 고객기본정보
  { header: '행사명', key: 'wedding_event_name', width: 28 },
  { header: '진행단계', key: 'progress_status', width: 12 },
  { header: '신규문의일자', key: 'inquiry_date', width: 14 },
  { header: '희망상담일자', key: 'desired_consultation_date', width: 14 },
  { header: '최초 인폼 코멘트', key: 'first_inform_comment', width: 34 },
  { header: '신랑 이름', key: 'groom_name', width: 14 },
  { header: '신랑 휴대폰', key: 'groom_phone', width: 18 },
  { header: '신랑 이메일', key: 'groom_email', width: 24 },
  { header: '신부 이름', key: 'bride_name', width: 14 },
  { header: '신부 휴대폰', key: 'bride_phone', width: 18 },
  { header: '신부 이메일', key: 'bride_email', width: 24 },
  { header: '비교웨딩홀', key: 'competing_venues', width: 22 },
  { header: '희망예산', key: 'desired_budget', width: 16 },
  { header: '유입경로', key: 'source', width: 22 },
  { header: '유입 세부경로', key: 'source_detail', width: 18 },
  // (2) 문의세부정보
  { header: '예식날짜 및 시간', key: 'wedding_datetime', width: 20 },
  { header: '예식 보증인원', key: 'guaranteed_guest_count', width: 12 },
  { header: '견적비용', key: 'estimate_amount', width: 16 },
  { header: '견적세부', key: 'estimate_detail', width: 32 },
  { header: '방문 상담일 코멘트', key: 'visit_consultation_comment', width: 32 },
  { header: '담당지배인', key: 'assigned_manager_name', width: 16 },
  // (3) 메모
  { header: '메모', key: 'memo', width: 36 },
];

export function buildWeddingFlatRows(customers: WeddingCustomer[]): WeddingFlatRow[] {
  const rows: WeddingFlatRow[] = [];
  for (const c of customers) {
    const baseLeft = {
      customer_id: c.id,
      wedding_event_name: c.wedding_event_name,
      progress_status: c.progress_status,
      inquiry_date: c.inquiry_date,
      desired_consultation_date: c.desired_consultation_date,
      first_inform_comment: c.first_inform_comment,
      groom_name: c.groom_name,
      groom_phone: c.groom_phone,
      groom_email: c.groom_email,
      bride_name: c.bride_name,
      bride_phone: c.bride_phone,
      bride_email: c.bride_email,
      competing_venues: c.competing_venues,
      desired_budget: c.desired_budget,
      source: c.source,
      source_detail: c.source_detail,
    };
    if (c.event_inquiries.length === 0) {
      rows.push({
        ...baseLeft,
        wedding_datetime: null,
        guaranteed_guest_count: null,
        estimate_amount: '',
        estimate_detail: '',
        visit_consultation_comment: '',
        assigned_manager_name: '',
        memo: c.memo,
      });
      continue;
    }
    c.event_inquiries.forEach((i, idx) => {
      rows.push({
        ...baseLeft,
        wedding_datetime: i.wedding_datetime,
        guaranteed_guest_count: i.guaranteed_guest_count,
        estimate_amount: i.estimate_amount,
        estimate_detail: i.estimate_detail,
        visit_consultation_comment: i.visit_consultation_comment,
        assigned_manager_name: i.assigned_manager_name,
        memo: idx === 0 ? c.memo : '',
      });
    });
  }
  return rows;
}

type WeddingPostShape = Omit<WeddingCustomer, 'id' | 'created_at' | 'updated_at' | 'customer_type'> & {
  id?: string;
};

export function groupWeddingFlatRows(
  rows: Partial<WeddingFlatRow>[],
  fallbackManagerId: string,
  fallbackManagerName: string
): WeddingPostShape[] {
  const map = new Map<string, WeddingPostShape>();
  // 같은 행사명 그룹의 id가 첫 행에만 있어도 묶일 수 있도록
  const idByName = new Map<string, string>();
  for (const r of rows) {
    const name = (r.wedding_event_name || '').trim();
    if (!name) continue;
    const cid = (r.customer_id || '').trim();
    if (cid && !idByName.has(name.toLowerCase())) {
      idByName.set(name.toLowerCase(), cid);
    }
  }
  for (const r of rows) {
    const name = (r.wedding_event_name || '').trim();
    if (!name) continue;
    const nameKey = name.toLowerCase();
    const customerId = (r.customer_id || '').trim() || idByName.get(nameKey) || '';
    const groupKey = customerId || nameKey;
    let cust = map.get(groupKey);
    if (!cust) {
      cust = {
        id: customerId || undefined,
        wedding_event_name: name,
        progress_status: ((r.progress_status as WeddingProgressStatus) || '신규문의') as WeddingProgressStatus,
        inquiry_date: r.inquiry_date || null,
        desired_consultation_date: r.desired_consultation_date || null,
        first_inform_comment: r.first_inform_comment || '',
        groom_name: r.groom_name || '',
        groom_phone: r.groom_phone || '',
        groom_email: r.groom_email || '',
        bride_name: r.bride_name || '',
        bride_phone: r.bride_phone || '',
        bride_email: r.bride_email || '',
        competing_venues: r.competing_venues || '',
        desired_budget: r.desired_budget || '',
        source: ((r.source as WeddingSource | '') || '') as WeddingSource | '',
        source_detail: ((r.source_detail as WeddingSourceDetail | '') ||
          '') as WeddingSourceDetail | '',
        event_inquiries: [],
        memo: r.memo || '',
      };
      map.set(groupKey, cust);
    } else {
      if (!cust.first_inform_comment && r.first_inform_comment)
        cust.first_inform_comment = r.first_inform_comment;
      if (!cust.memo && r.memo) cust.memo = r.memo;
    }
    const hasInquiry =
      !!r.wedding_datetime ||
      (r.guaranteed_guest_count !== null && r.guaranteed_guest_count !== undefined) ||
      !!r.estimate_amount ||
      !!r.estimate_detail ||
      !!r.visit_consultation_comment ||
      !!r.assigned_manager_name;
    if (hasInquiry) {
      const managerName = r.assigned_manager_name || fallbackManagerName;
      const inq: WeddingEventInquiry = {
        id: nanoid(),
        wedding_datetime: r.wedding_datetime || null,
        guaranteed_guest_count:
          r.guaranteed_guest_count !== null && r.guaranteed_guest_count !== undefined
            ? Number(r.guaranteed_guest_count)
            : null,
        estimate_amount: r.estimate_amount || '',
        estimate_detail: r.estimate_detail || '',
        visit_consultation_comment: r.visit_consultation_comment || '',
        assigned_manager_id: managerName === fallbackManagerName ? fallbackManagerId : '',
        assigned_manager_name: managerName,
        created_at: new Date().toISOString(),
      };
      cust.event_inquiries.push(inq);
    }
  }
  return Array.from(map.values());
}
