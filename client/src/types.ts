// 클라이언트 측에서 사용하는 도메인 타입.
// 서버 src/types.ts와 같은 형태를 유지하되, 별도 파일로 둔다 (모노레포 변환 시 공유 가능).

export type Role =
  | 'admin'
  | 'sales_mice'
  | 'sales_wedding'
  | 'banquet'
  | 'kitchen'
  | 'h_kitchen' // 에이치키친 — 뷰어, 고객 DB 접근 불가
  | 'pending'
  | 'disabled';

export type Team =
  | 'sales_mice'
  | 'sales_wedding'
  | 'banquet'
  | 'kitchen'
  | 'h_kitchen'
  | 'admin'
  | null;

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: Role;
  team: Team;
  created_at: string;
  updated_at: string;
}

export type CustomerType = 'MICE' | 'WEDDING';
// TEN 은 2026-05-14 정책 변경으로 제거 — 기존 TEN 데이터는 INQ 로 자동 마이그레이션.
export type EventStatus =
  | 'INQ'
  | 'DEF'
  | 'LOS'
  | '상담취소'
  | '미팅'
  | '미팅취소'
  | '시식';

// ===== MICE 고객 (multi-inquiry) =====
export type MiceCategory = '기업' | '학회' | '공공기관' | '학교' | '병원' | '대행사' | '기타';
export type MiceInquiryStatus = 'INQ' | 'TEN' | 'DEF' | 'LOS' | '단순문의';

export interface MiceContact {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface MiceInquiry {
  id: string;
  progress_status: MiceInquiryStatus;
  contacts: MiceContact[];
  call_date: string | null;
  inquiry_event_date_text: string;
  event_memo: string;
  // 작성자: 최초 등록자 (변경 불가)
  created_by_id: string;
  created_by_name: string;
  // 담당자: 실제 고객을 관리하는 세일즈 (작성자와 별개)
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
}

export interface MiceCustomer {
  id: string;
  customer_type: 'MICE';
  mice_category: MiceCategory;
  organization_name: string;
  official_phone: string;
  official_email: string;
  official_website: string;
  inquiries: MiceInquiry[];
  memo: string;
  created_at: string;
  updated_at: string;
  last_modified_by_id?: string;
  last_modified_by_name?: string;
  last_modified_at?: string;
  // 휴지통 (soft delete)
  deleted_at?: string | null;
  deleted_by_id?: string | null;
  deleted_by_name?: string | null;
}

// ===== WEDDING 고객 =====
export type WeddingProgressStatus =
  | '신규문의'
  | '상담'
  | '상담취소'
  | 'INQ'
  | 'TEN'
  | 'DEF'
  | 'LOS';

export type WeddingSource =
  | '가톨릭동문(교직원, 관계자)'
  | '성모병원(의사 및 간호사)'
  | '컨설팅'
  | '워크인';

export type WeddingSourceDetail = '컨설팅' | 'CTalk' | '인스타그램' | '네이버' | '지인추천';

export interface WeddingEventInquiry {
  id: string;
  wedding_datetime: string | null;
  guaranteed_guest_count: number | null;
  estimate_amount: string; // "70,000,000" 같은 쉼표 포함 형태로 저장
  estimate_detail: string;
  visit_consultation_comment: string;
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
}

export interface WeddingCustomer {
  id: string;
  customer_type: 'WEDDING';
  wedding_event_name: string;
  progress_status: WeddingProgressStatus;
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
  source: WeddingSource | '';
  source_detail: WeddingSourceDetail | '';
  event_inquiries: WeddingEventInquiry[];
  memo: string;
  created_at: string;
  updated_at: string;
  last_modified_by_id?: string;
  last_modified_by_name?: string;
  last_modified_at?: string;
  // 휴지통 (soft delete)
  deleted_at?: string | null;
  deleted_by_id?: string | null;
  deleted_by_name?: string | null;
}

// ===== 변경 이력 =====
export type ChangeLogEntityType = 'mice_customer' | 'wedding_customer' | 'event';
export type ChangeLogAction = 'create' | 'update' | 'delete';

// ===== 외부 클라이언트용 API 키 =====
export type ApiKeyScope = 'all' | 'summary' | 'wedding' | 'mice';

export const API_KEY_SCOPE_DESC: Record<ApiKeyScope, string> = {
  all: '전체 — 모든 행사 + 전체 디테일',
  summary: '종류만 — 행사 종류·시간·홀만 (행사명/고객 미노출)',
  wedding: 'WEDDING 만 + 전체 디테일',
  mice: 'MICE 만 + 전체 디테일',
};

// 관리자 화면용 — 평문 token 은 발급 직후 한 번만 노출되므로 별도 필드.
export interface ApiKeySafe {
  id: string;
  label: string;
  masked_token: string;
  scope: ApiKeyScope;
  created_by_id: string;
  created_by_name: string;
  created_at: string;
  last_used_at: string | null;
  active: boolean;
}

export interface ChangeLogChange {
  field: string;
  before: string;
  after: string;
}

export interface ChangeLog {
  id: string;
  entity_type: ChangeLogEntityType;
  entity_id: string;
  action: ChangeLogAction;
  summary: string;
  // 옛 레코드는 없을 수 있음 — 펼치기 UI에서 fallback 처리
  changes?: ChangeLogChange[];
  changed_by_id: string;
  changed_by_name: string;
  changed_at: string;
}

// 활성 사용자 목록 응답 (드롭다운용 — 최소 정보)
export interface ActiveUserOption {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: '관리자',
  sales_mice: '기업세일즈(MICE)',
  sales_wedding: '웨딩세일즈(WEDDING)',
  banquet: '연회팀',
  kitchen: '주방팀',
  h_kitchen: '에이치키친',
  pending: '권한대기',
  disabled: '비활성',
};

export const STATUS_DESC: Record<EventStatus, string> = {
  INQ: 'INQ — 문의/견적',
  DEF: 'DEF — 확정',
  LOS: 'LOS — 취소',
  상담취소: '상담취소',
  미팅: '미팅',
  미팅취소: '미팅취소',
  시식: '시식',
};

// 상담취소·미팅취소 — LOS 와 동일하게 줄긋기 + 흐림 처리.
export const CANCELLED_STATUSES: EventStatus[] = ['LOS', '상담취소', '미팅취소'];
export function isCancelledStatus(s: EventStatus): boolean {
  return CANCELLED_STATUSES.includes(s);
}

// WEDDING 고객 진행상황 중 캘린더에 "취소" 로 반영되어야 하는 상태.
// 상담취소 = 상담 자체 취소, LOS = 딜 자체 lost (역시 상담 진행 안 됨).
export const CANCELLED_WEDDING_PROGRESS: WeddingProgressStatus[] = ['상담취소', 'LOS'];
export function isCancelledWeddingProgress(s: WeddingProgressStatus): boolean {
  return CANCELLED_WEDDING_PROGRESS.includes(s);
}

// MICE 문의 진행상황 (단순문의 추가)
export const MICE_INQUIRY_STATUS_OPTIONS: MiceInquiryStatus[] = [
  'INQ',
  'TEN',
  'DEF',
  'LOS',
  '단순문의',
];

export const MICE_INQUIRY_STATUS_DESC: Record<MiceInquiryStatus, string> = {
  INQ: 'INQ — 문의/견적',
  TEN: 'TEN — 계약 발송',
  DEF: 'DEF — 확정',
  LOS: 'LOS — 취소',
  단순문의: '단순문의 (행사화 안 됨)',
};

// WEDDING 진행단계
export const WEDDING_PROGRESS_OPTIONS: WeddingProgressStatus[] = [
  '신규문의',
  '상담',
  '상담취소',
  'INQ',
  'TEN',
  'DEF',
  'LOS',
];

export const WEDDING_SOURCE_OPTIONS: WeddingSource[] = [
  '가톨릭동문(교직원, 관계자)',
  '성모병원(의사 및 간호사)',
  '컨설팅',
  '워크인',
];

export const WEDDING_SOURCE_DETAIL_OPTIONS: WeddingSourceDetail[] = [
  '컨설팅',
  'CTalk',
  '인스타그램',
  '네이버',
  '지인추천',
];

export const STATUS_BG: Record<EventStatus, string> = {
  INQ: 'bg-status-inq text-white',
  DEF: 'bg-status-def text-white',
  LOS: 'bg-status-los text-white',
  상담취소: 'bg-status-los text-white',
  미팅: 'bg-blue-500 text-white',
  미팅취소: 'bg-status-los text-white',
  시식: 'bg-orange-500 text-white',
};

export const MICE_CATEGORIES: MiceCategory[] = [
  '기업',
  '학회',
  '공공기관',
  '학교',
  '병원',
  '대행사',
  '기타',
];

export const EVENT_STATUS_OPTIONS: EventStatus[] = [
  'INQ',
  'DEF',
  'LOS',
  '상담취소',
  '미팅',
  '미팅취소',
  '시식',
];

// ===== 행사 도메인 =====

export type UsageType = 'AD' | 'AH' | 'HA' | 'HH';

export const USAGE_TYPE_DESC: Record<UsageType, string> = {
  AD: 'AD — 전칸 종일',
  AH: 'AH — 전칸 반일',
  HA: 'HA — 반칸 종일',
  HH: 'HH — 반칸 반일',
};

export const USAGE_TYPE_OPTIONS: UsageType[] = ['AD', 'AH', 'HA', 'HH'];

export type Hall =
  | 'Hall A+B'
  | 'Hall A'
  | 'Hall B'
  | 'Leaf Room'
  | 'Ivy Room'
  | 'Petal Room'
  | '로비';

export const HALL_OPTIONS: Hall[] = [
  'Hall A+B',
  'Hall A',
  'Hall B',
  'Leaf Room',
  'Ivy Room',
  'Petal Room',
  '로비',
];

export type MenuName =
  | 'A set'
  | 'B set'
  | 'C set'
  | 'D set'
  | 'Korean Lunch Box'
  | 'Chinese Lunch Box'
  | 'Coffee Break'
  | 'Dessert Plate(M)'
  | 'Dessert Plate(L)'
  | 'Rice Cake Plate';

export const MENU_OPTIONS: MenuName[] = [
  'A set',
  'B set',
  'C set',
  'D set',
  'Korean Lunch Box',
  'Chinese Lunch Box',
  'Coffee Break',
  'Dessert Plate(M)',
  'Dessert Plate(L)',
  'Rice Cake Plate',
];

// 메뉴 입력 모드 — 스펙에 따라 3종류
export type MenuMode = 'set' | 'coffee' | 'qty';
export function menuModeOf(name: MenuName): MenuMode {
  if (name === 'Coffee Break') return 'coffee';
  if (name === 'Dessert Plate(M)' || name === 'Dessert Plate(L)' || name === 'Rice Cake Plate')
    return 'qty';
  return 'set';
}

export interface FoodItem {
  id: string;
  event_id: string;
  menu_name: MenuName;
  // set/lunchbox 메뉴 — 계약 시점과 행사 직전 확정 시점을 분리하여 인원/식수 변화를 추적
  gtd_contract: number | null;
  exp_contract: number | null;
  gtd_final: number | null;
  exp_final: number | null;
  time_label: string;
  service_time: string;
  quantity: number | null;
  memo: string;
}

export interface Event {
  id: string;
  event_type: CustomerType;
  created_by: string;
  created_by_name: string;
  status: EventStatus;
  usage_type: UsageType | null;
  halls: Hall[];
  start_datetime: string;
  end_datetime: string;
  event_name: string;
  seats: number | null;
  food_gtd_contract: number | null;
  food_exp_contract: number | null;
  food_gtd_final: number | null;
  food_exp_final: number | null;
  // 내부 운영 참고용 메모
  memo: string;
  // 담당자 — MICE: 직접 선택 / WEDDING: 연결된 고객에서 자동 채움
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
  updated_at: string;
  // 휴지통 (soft delete) — 부모 행사만 soft delete. 자식은 그대로 남음.
  deleted_at?: string | null;
  deleted_by_id?: string | null;
  deleted_by_name?: string | null;
}

// ===== 휴지통 =====
export type TrashType = 'wedding' | 'mice' | 'event';

export interface TrashItem {
  type: TrashType;
  id: string;
  label: string;
  detail: string;
  deleted_at: string;
  deleted_by_id: string | null;
  deleted_by_name: string | null;
}

export const TRASH_TYPE_LABEL: Record<TrashType, string> = {
  wedding: 'WEDDING 고객',
  mice: 'MICE 고객',
  event: '행사',
};

// 캘린더 목록 응답에 포함되는 확장 타입 (invoice는 대시보드 매출 집계용)
export interface EventWithFood extends Event {
  food_items: FoodItem[];
  invoice?: Invoice | null;
}

// ===== 행사-고객 연결 =====
export type CustomerRole = '주최사' | '대행사' | '협력사' | '회계 담당' | '기타';
export const CUSTOMER_ROLE_OPTIONS: CustomerRole[] = [
  '주최사',
  '대행사',
  '협력사',
  '회계 담당',
  '기타',
];

export interface EventCustomerLink {
  id: string;
  event_id: string;
  customer_id: string;
  customer_role: CustomerRole;
  is_contact_point: boolean;
  contact_point_contact_id: string;
}

// ===== INVOICE / 행사취소 =====
export type PaymentStatus = '고객요청' | '입금완료' | '총무팀협의-면제대상' | '';
export type InvoiceType = '세금계산서' | '현금영수증' | '';
export type InvoiceIssueStatus = '가톨릭요청' | '발행완료' | '';
export type CatholicRefundStatus = '가톨릭요청' | '환불완료' | '';

export const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  '',
  '고객요청',
  '입금완료',
  '총무팀협의-면제대상',
];
export const INVOICE_TYPE_OPTIONS: InvoiceType[] = ['', '세금계산서', '현금영수증'];
export const INVOICE_ISSUE_STATUS_OPTIONS: InvoiceIssueStatus[] = ['', '가톨릭요청', '발행완료'];
export const CATHOLIC_REFUND_STATUS_OPTIONS: CatholicRefundStatus[] = [
  '',
  '가톨릭요청',
  '환불완료',
];

export interface Invoice {
  id: string;
  event_id: string;
  payment_status: PaymentStatus;
  invoice_type: InvoiceType;
  invoice_issue_status: InvoiceIssueStatus;
  payment_amount: number | null;
  payment_date: string | null;
  tax_invoice_issue_date: string | null;
  depositor_name: string;
}

export interface Cancellation {
  id: string;
  event_id: string;
  cancel_requested_at: string | null;
  cancel_reason: string;
  plenty_cancel_fee: number | null;
  plenty_cancel_fee_paid_at: string | null;
  catholic_rental_refund_status: CatholicRefundStatus;
}

export const STATUS_HEX: Record<EventStatus, string> = {
  INQ: '#9ca3af', // gray
  DEF: '#22c55e', // green
  LOS: '#ef4444', // red
  상담취소: '#ef4444', // LOS 동일 (취소표시는 클래스로 strikethrough)
  미팅: '#3b82f6', // blue
  미팅취소: '#ef4444', // LOS 동일
  시식: '#f97316', // orange
};

// ===== 첨부파일 =====
// final_invoice: 행사 종료 후 최종 INVOICE — 행사리뷰에서 업로드 대상
export type EventFileType = 'estimate' | 'contract' | 'beo' | 'final_invoice' | 'other';

export const EVENT_FILE_TYPE_LABEL: Record<EventFileType, string> = {
  estimate: '견적서',
  contract: '계약서',
  beo: 'BEO',
  final_invoice: '최종 INVOICE',
  other: '기타',
};

export interface EventFile {
  id: string;
  event_id: string;
  file_type: EventFileType;
  file_name: string;
  file_url: string;
  uploaded_by: string;
  uploaded_at: string;
}

// ===== 행사 리뷰 =====
export interface EventReview {
  id: string;
  event_id: string;
  banquet_manager: string;
  actual_meal_count: number | null;
  paid_meal_count: number | null;
  additional_sales: string;
  system_issues: string;
  event_special_notes: string;
  flower_issues: string;
  next_event_feedback: string;
  general_comment: string;
  final_revenue: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ===== 영업 목표 (Forecasting) =====
export interface SalesTarget {
  id: string;
  year: number;
  month: number;
  wedding_event_count_forecast: number | null;
  mice_event_count_forecast: number | null;
  total_event_count_forecast: number | null;
  wedding_revenue_forecast: number | null;
  mice_revenue_forecast: number | null;
  total_revenue_forecast: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ===== 캘린더 공유 =====
export interface CalendarShare {
  id: string;
  token: string;
  year: number;
  month: number;
  label: string;
  created_by: string;
  created_at: string;
  event_type_filter: 'ALL' | 'MICE' | 'WEDDING';
}
