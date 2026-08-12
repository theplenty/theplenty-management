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

// 유입 채널 — 인콜(고객이 먼저 문의) vs 아웃콜(우리가 먼저 제안)
export type MiceInquiryChannel = 'INCALL' | 'OUTCALL';
export const MICE_INQUIRY_CHANNEL_LABEL: Record<MiceInquiryChannel, string> = {
  INCALL: '인콜 (고객 문의)',
  OUTCALL: '아웃콜 (영업 제안)',
};

export interface MiceInquiry {
  id: string;
  progress_status: MiceInquiryStatus;
  inquiry_channel: MiceInquiryChannel;
  contacts: MiceContact[];
  call_date: string | null;
  inquiry_event_date_text: string;
  // 작성자: 최초 등록자 (변경 불가)
  created_by_id: string;
  created_by_name: string;
  // 담당자: 실제 고객을 관리하는 세일즈 (작성자와 별개)
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;

  // ===== 콜 트래커 (문의 트래커 흡수) =====
  // 세일즈팀이 매일 보는 건 메모보다 이 네 개 체크와 콜백 기한이다.
  /** 콜백 기한 — 등록 +7일 자동, 수정 가능 */
  callback_due?: string | null;
  /** 보류 상태에서 잡아둔 재통화 예정일 */
  callback_at?: string | null;
  quote_sent?: boolean;
  contract_sent?: boolean;
  contract_replied?: boolean;
  deposit_paid?: boolean;
  /** 견적서·회신·계약금 3개가 모두 체크된 순간 자동 기록 */
  confirmed_at?: string | null;
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
  // 마진계산기 입력 전체를 JSON 직렬화 (재오픈 복원용)
  calc_payload?: string;
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
  search_keyword: string; // 마케팅 검색어 (자유 입력 + 기존 이력 자동완성)
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
export type ChangeLogEntityType =
  | 'mice_customer'
  | 'wedding_customer'
  | 'event'
  | 'collaboration_request';
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
  | '로비'
  | 'CAFE';

export const HALL_OPTIONS: Hall[] = [
  'Hall A+B',
  'Hall A',
  'Hall B',
  'Leaf Room',
  'Ivy Room',
  'Petal Room',
  '로비',
  'CAFE',
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
  | 'Rice Cake Plate'
  | '웨딩국수';

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
  '웨딩국수',
];

// menuModeOf — 메뉴 이름으로 입력 모드 결정.
// 메뉴 마스터 도입 전 하드코딩 레거시 호환용. 마스터가 있으면 Menu.mode 우선 사용.
export function menuModeOf(name: string): MenuMode {
  if (name === 'Coffee Break' || name.toLowerCase().includes('coffee break')) return 'coffee';
  if (
    name === 'Dessert Plate(M)' ||
    name === 'Dessert Plate(L)' ||
    name === 'Rice Cake Plate' ||
    name === '웨딩국수' ||
    name.includes('Dessert') ||
    name.includes('디저트')
  )
    return 'qty';
  return 'set';
}

export interface FoodItem {
  id: string;
  event_id: string;
  menu_name: string; // 메뉴 마스터 name_ko 참조 (자유 문자열)
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
  // 매출 관련 필드
  contract_amount?: number | null;
  sales_total_amount?: number | null;
  discount_rate?: number | null;
  discount_reason?: string;
  contract_date?: string | null;
  gateway_fee?: number | null;
  // BEO(행사 운영 지시서) — 자동 시드 + 담당자 수동 편집 결과를 JSON 직렬화해 보관.
  beo_payload?: string;
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
  LOS: '#000000', // black — 취소 계열은 모두 블랙 (strikethrough 로 구분)
  상담취소: '#000000', // black
  미팅: '#3b82f6', // blue
  미팅취소: '#000000', // black
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

// ===== 메뉴 마스터 =====
export type MenuCategory = '전식' | '주식' | '후식' | '음료' | '주류' | '패키지';

// 식음 항목 입력 모드
//   set    : GTD/EXP 인원 (계약·확정) — 세트·뷔페 등 기본값
//   coffee : 시간 라벨 + 서비스 시간 + 수량 — 커피 브레이크
//   qty    : 단순 수량 — 디저트 플레이트·떡 등
export type MenuMode = 'set' | 'coffee' | 'qty';

export const MENU_MODE_LABEL: Record<MenuMode, string> = {
  set: 'GTD/EXP 인원 (세트)',
  coffee: '시간·수량 (커피 브레이크)',
  qty: '단순 수량 (디저트·떡)',
};

export const MENU_CATEGORIES: MenuCategory[] = ['전식', '주식', '후식', '음료', '주류', '패키지'];

export const MENU_CATEGORY_LABEL: Record<MenuCategory, string> = {
  전식: '전식 (Starter)',
  주식: '주식 (Main)',
  후식: '후식 (Dessert)',
  음료: '음료 (Beverage)',
  주류: '주류 (Alcohol)',
  패키지: '패키지 (Package)',
};

// 카테고리별 배지 색상 (Tailwind)
export const MENU_CATEGORY_COLOR: Record<MenuCategory, string> = {
  전식: 'bg-yellow-100 text-yellow-800',
  주식: 'bg-blue-100 text-blue-800',
  후식: 'bg-pink-100 text-pink-800',
  음료: 'bg-cyan-100 text-cyan-800',
  주류: 'bg-purple-100 text-purple-800',
  패키지: 'bg-green-100 text-green-800',
};

// 메뉴 코스별 식자재 원가 구성 항목 (BOM)
export interface MenuDetail {
  id: string;
  dish_name: string;           // 식재료명
  quantity: string;            // 수량 (표시용 문자열)
  unit: string;                // 단위 (G, ML, EA …)
  unit_price: number | null;   // 단가 (원/단위)
  portion_cost: number | null; // 부분 원가 (원, VAT 제외)
  // 배치 1회가 만드는 인분수. 소스·육수·드레싱처럼 대량 조리분을 한꺼번에 입력했을 때
  // 1인분 환산용. effectivePortionCost = portion_cost / (batch_yield ?? 1).
  // null/미입력이면 1 (portion_cost가 이미 1인분 기준).
  batch_yield?: number | null;
  notes: string;               // 비고
}

// BOM 항목의 1인분 환산 원가 (배치 입력분을 batch_yield로 나눔).
// 편집 중 문자열로 들어올 수 있어 Number()로 강제 변환한다.
export function effectivePortionCost(d: { portion_cost: number | null; batch_yield?: number | null }): number {
  const pc = Number(d.portion_cost) || 0;
  const by = Number(d.batch_yield);
  return pc / (by && by > 0 ? by : 1);
}

// 기업(MICE) / 웨딩(WEDDING) 구분 — 행사 유형과 매칭
export type MenuEventType = 'MICE' | 'WEDDING';

// 담당 부서 — 주방(식음 요리) / 연회(음료·서비스)
export type MenuDept = '주방' | '연회';

export interface Menu {
  id: string;
  // 메뉴명 — MENU_OPTIONS 중 하나 (A set, Coffee Break 등)
  name_ko: string;
  // 코스 카테고리 — 자유 입력 (Appetizer, Soup, Main, Dessert 등)
  category: string;
  // 기업(MICE) / 웨딩(WEDDING) 구분
  event_type: MenuEventType;
  // 담당 부서 — 미설정 시 마이그레이션이 '주방'으로 백필
  dept: MenuDept;
  mode: MenuMode;
  serving_size_default: number;
  list_price: number | null;
  is_active: boolean;
  notes: string;
  // 인보이스 표기명 alias — 실제 인보이스 Description과 name_ko가 다를 때 매핑용
  // 예: name_ko='A set', invoice_labels=['Dinner -Western Set A', 'Western Set A']
  invoice_labels?: string[];
  // BOM: 코스별 식자재 원가 구성
  details?: MenuDetail[];
  created_at: string;
  updated_at: string;
}

// ===== 협업요청서 (Collaboration Request) =====
export type CollabTeam = 'kitchen' | 'banquet';

export type CollabDeviation =
  | '메뉴/식자재'
  | '음주류'
  | '인력/외주'
  | '운영 시간'
  | '공간 세팅'
  | '기타';

export const COLLAB_DEVIATIONS: CollabDeviation[] = [
  '메뉴/식자재',
  '음주류',
  '인력/외주',
  '운영 시간',
  '공간 세팅',
  '기타',
];

export type CollabReplyResult = '가능' | '조건부 가능' | '불가';
export type CollabDecision = '진행' | '조건부진행' | '진행안함';
export type CollabStatus = '회신대기' | '회신완료' | CollabDecision;

export const COLLAB_TEAM_LABEL: Record<CollabTeam, string> = {
  kitchen: '주방',
  banquet: '연회',
};

export interface CollaborationReply {
  team: CollabTeam;
  result: CollabReplyResult | null;
  added_cost: number | null;
  added_cost_memo: string;
  condition_or_reject_reason: string;
  alternative: string;
  replied_by_id: string;
  replied_by_name: string;
  replied_at: string | null;
}

export interface CollaborationRequest {
  id: string;
  event_id: string;
  created_by_id: string;
  created_by_name: string;
  created_by_role: Role;
  created_at: string;
  // 작성 시점에 복사 저장된 값 (감사용 스냅샷)
  customer_event_name: string;
  event_date: string | null;
  // 연결된 행사의 현재 값 — 서버가 조인해서 채워준다. 표시는 이쪽을 우선한다.
  live_event_name?: string | null;
  live_event_date?: string | null;
  event_out_of_sync?: boolean;
  customer_request: string;
  deviations: CollabDeviation[];
  deviation_other: string;
  expected_revenue: number | null;
  expected_revenue_memo: string;
  target_teams: CollabTeam[];
  sales_comment: string;
  replies: CollaborationReply[];
  decision: CollabDecision | null;
  decided_margin: number | null;
  decision_comment: string;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  status: CollabStatus;
  reply_due_at: string;
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

// ===== 매출 항목 마스터 (Revenue Items) =====
export type RevenueCategory = '공간' | '식음' | '장비' | '장식' | '기타';

export interface RevenueItem {
  id: string;
  code: string;
  name_ko: string;
  category: RevenueCategory;
  default_account: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ===== 행사별 세부 매출 라인 =====
export interface EventRevenueLine {
  id: string;
  event_id: string;
  revenue_item_id: string;
  amount: number | null;
  note: string;
  created_at: string;
  updated_at: string;
}

// ===== 결제 매핑 (Payments) =====
export type PaymentType = 'deposit' | 'balance' | 'contract' | 'additional' | 'refund';
export type PaymentMethod = 'card' | 'transfer' | 'cash' | 'other';
export type CardCompany =
  | 'hyundai' | 'samsung' | 'shinhan' | 'kb' | 'lotte'
  | 'bc' | 'woori' | 'hana' | 'other';

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  deposit: '선금',
  balance: '잔금',
  contract: '계약금',
  additional: '추가',
  refund: '환불',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card: '카드',
  transfer: '계좌이체',
  cash: '현금',
  other: '기타',
};

export const CARD_COMPANY_LABEL: Record<CardCompany, string> = {
  hyundai: '현대카드',
  samsung: '삼성카드',
  shinhan: '신한카드',
  kb: 'KB국민카드',
  lotte: '롯데카드',
  bc: 'BC카드',
  woori: '우리카드',
  hana: '하나카드',
  other: '기타카드',
};

// 카드사별 영업일 기준 입금 소요일
export const CARD_DEPOSIT_DAYS: Record<CardCompany, number> = {
  hyundai: 3, samsung: 3, shinhan: 2, kb: 3,
  lotte: 3, bc: 2, woori: 2, hana: 2, other: 3,
};

export const PAYMENT_TYPE_OPTIONS: PaymentType[] = ['contract', 'deposit', 'balance', 'additional', 'refund'];
export const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = ['card', 'transfer', 'cash', 'other'];
export const CARD_COMPANY_OPTIONS: CardCompany[] = ['hyundai', 'samsung', 'shinhan', 'kb', 'lotte', 'bc', 'woori', 'hana', 'other'];

export interface Payment {
  id: string;
  event_id: string;
  payment_type: PaymentType;
  amount: number;
  paid_at: string;
  method: PaymentMethod;
  card_company?: CardCompany;
  approval_no?: string;
  business_name?: string;
  bank_deposit_date?: string;
  bank_deposit_amount?: number;
  note?: string;
  reconciled_at?: string;
  reconciled_by?: string;
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

// ===== 웨딩 고객 랜딩 (가예약 고객용 공개 링크) =====
export type WeddingPriorityKey =
  | 'space' | 'food' | 'access' | 'flower' | 'private' | 'parents' | 'budget' | 'photo';

// 체크 항목 → 랜딩 노출용 다듬어진 문구 (직원 화면·공개 페이지 공용)
export const WEDDING_PRIORITY_LABEL: Record<WeddingPriorityKey, string> = {
  space: '공간 중시',
  food: '음식 중시',
  access: '교통 중시',
  flower: '플라워 중시',
  private: '프라이빗 진행 중시',
  parents: '부모님 의견 중시',
  budget: '예산 중시',
  photo: '사진·영상 중시',
};

export const WEDDING_PRIORITY_SENTENCE: Record<WeddingPriorityKey, string> = {
  private: '하객이 많아도 복잡하지 않은, 프라이빗한 단독홀 예식',
  flower: '사진에서 플라워와 공간이 풍성하게 보이는 웨딩',
  food: '부모님과 하객 모두가 만족할 수 있는 격 있는 식사',
  space: '높은 층고와 긴 버진로드가 만드는 압도적인 공간감',
  access: '서울 어디에서 출발해도 찾아오기 쉬운 위치와 교통',
  parents: '부모님의 마음까지 편안한 결혼식 준비',
  budget: '불필요한 비용 없이, 합리적으로 완성하는 결혼식',
  photo: '화보처럼 오래 남는 사진과 영상',
};

export interface WeddingLandingCta {
  action: 'contract' | 'call';
  at: string;
}

// 랜딩 견적 카드에 노출할 혜택 한 줄 (발행 시점 스냅샷)
export interface WeddingLandingBenefit {
  label: string; // 예: '식대 10% 할인'
  amount: number; // 혜택 금액(원)
}

export interface WeddingLanding {
  id: string;
  event_id: string; // consult 모드에서는 ''
  mode?: 'block' | 'consult'; // block=가블록(행사 연결, 기본) / consult=상담만 (고객 직접 연결)
  customer_id?: string; // consult 모드: 연결 웨딩 고객
  token: string;
  block_until: string; // YYYY-MM-DD — 가블록 종료일(block) / 링크 열람 기한(consult)
  priorities: WeddingPriorityKey[];
  custom_note: string;
  inquiry_id: string;
  guest_count: number | null;
  total_amount: string;
  quote_html: string;
  benefits?: WeddingLandingBenefit[]; // 혜택 내역 (식대할인·플라워 업그레이드·대관할인 등)
  closed: boolean;
  cta_clicks: WeddingLandingCta[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export type WeddingLandingState = 'active' | 'contracted' | 'closed' | 'expired';

export interface WeddingLandingFlowerPhoto {
  url: string;
  loc?: string; // 위치 태그 (버진로드/신부대기실/포토테이블/포토월)
}

// 랜딩 미디어 설정 (settings key: 'wedding-landing-media') — admin이 관리
export interface WeddingLandingMedia {
  hall_video_url?: string; // 섹션 삽입용 mp4 (자동재생 루프)
  hall_video_poster?: string; // 섹션 영상 포스터 (재생 전/불가 환경 표시용)
  full_video_url?: string; // 풀 영상 (YouTube 일부공개 링크 또는 mp4)
  // 플라워 사진 — loc: 위치 태그 (버진로드/신부대기실/포토테이블/포토월)
  flower_photos?: {
    basic?: WeddingLandingFlowerPhoto[];
    luxury?: WeddingLandingFlowerPhoto[];
    grand?: WeddingLandingFlowerPhoto[];
  };
  menu_photos?: { a?: string[]; b?: string[]; c?: string[]; option?: string[] };
  directions_image?: string;
  kakao_url?: string; // 카카오톡 채널 링크
}
