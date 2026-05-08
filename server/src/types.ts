// 공통 도메인 타입 정의 — 클라이언트와 동일한 형태를 유지한다.

export type Role =
  | 'admin'
  | 'sales_mice'
  | 'sales_wedding'
  | 'banquet'
  | 'kitchen'
  | 'pending'
  | 'disabled';

export type Team = 'sales_mice' | 'sales_wedding' | 'banquet' | 'kitchen' | 'admin' | null;

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

export type EventStatus = 'INQ' | 'TEN' | 'DEF' | 'LOS';

// ===== MICE 고객 =====
// 한 업체(고객)는 여러 문의 건을 가질 수 있음 — inquiries[]로 모델링.
// "X" 라는 옛 진행상황 값은 "단순문의" 로 변경.

export type MiceCategory = '기업' | '학회' | '공공기관' | '학교' | '병원' | '대행사' | '기타';
export type MiceInquiryStatus = 'INQ' | 'TEN' | 'DEF' | 'LOS' | '단순문의';

// 한 문의 내 담당자 (이름/이메일/연락처 한 묶음). 다수 담당자 지원.
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
  // 작성자: id+name 둘 다 보관해 사용자관리에서 이름 변경되어도 추적 가능
  created_by_id: string;
  created_by_name: string;
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
  // 마지막 수정자 정보 — 빠른 표시용
  last_modified_by_id?: string;
  last_modified_by_name?: string;
  last_modified_at?: string;
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
  estimate_amount: string; // 쉼표 표기는 클라이언트 측에서 처리
  estimate_detail: string;
  visit_consultation_comment: string;
  // 담당지배인 — 작성자처럼 자동 채움 + 드롭다운 변경 가능
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
}

export interface WeddingCustomer {
  id: string;
  customer_type: 'WEDDING';
  // (1) 고객기본정보
  wedding_event_name: string;
  progress_status: WeddingProgressStatus;
  inquiry_date: string | null; // 신규문의일자
  desired_consultation_date: string | null; // 희망상담일자
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
  // (2) 문의세부정보 — 여러 건
  event_inquiries: WeddingEventInquiry[];
  // (3) 메모
  memo: string;
  created_at: string;
  updated_at: string;
  last_modified_by_id?: string;
  last_modified_by_name?: string;
  last_modified_at?: string;
}

export type Customer = MiceCustomer | WeddingCustomer;

// ===== 변경 이력 =====
// 고객/행사 등 주요 엔티티의 수정 이력을 누적 기록.
export type ChangeLogEntityType = 'mice_customer' | 'wedding_customer' | 'event';
export type ChangeLogAction = 'create' | 'update' | 'delete';

export interface ChangeLog {
  id: string;
  entity_type: ChangeLogEntityType;
  entity_id: string;
  action: ChangeLogAction;
  summary: string; // 예: "진행상황 INQ → TEN, 담당자 변경"
  changed_by_id: string;
  changed_by_name: string;
  changed_at: string;
}

export type UsageType = 'AD' | 'AH' | 'HA' | 'HH';
export type Hall =
  | 'Hall A+B'
  | 'Hall A'
  | 'Hall B'
  | 'Leaf Room'
  | 'Ivy Room'
  | 'Petal Room'
  | '로비';

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

export interface FoodItem {
  id: string;
  event_id: string;
  menu_name: MenuName;
  // set/lunchbox 메뉴: gtd, exp 사용
  gtd: number | null;
  exp: number | null;
  // coffee break: time_label, service_time, quantity 사용
  time_label: string;
  service_time: string;
  quantity: number | null;
  memo: string;
}

export type CustomerRole = '주최사' | '대행사' | '협력사' | '회계 담당' | '기타';

export interface EventCustomerLink {
  id: string;
  event_id: string;
  customer_id: string;
  customer_role: CustomerRole;
  is_contact_point: boolean;
  // CONTACT POINT로 지정된 경우, 어떤 담당자(혹은 신랑/신부)를 표기할지.
  // - MICE: MiceContact.id
  // - WEDDING: 'groom' | 'bride'
  // 미지정이면 클라이언트가 가장 적절한 담당자를 자동 선택
  contact_point_contact_id: string;
}

export interface Event {
  id: string;
  event_type: CustomerType;
  created_by: string; // user id
  created_by_name: string; // 작성 시점의 사용자 이름 — 사용자가 삭제되어도 표시 유지
  status: EventStatus;
  usage_type: UsageType | null;
  halls: Hall[];
  start_datetime: string;
  end_datetime: string;
  event_name: string;
  seats: number | null;
  // 식음 GTD/EXP — 계약기준(_contract) / 최종확정(_final) 두 버전을 각각 보관
  food_gtd_contract: number | null;
  food_exp_contract: number | null;
  food_gtd_final: number | null;
  food_exp_final: number | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  event_id: string;
  payment_status: '고객요청' | '입금완료' | '총무팀협의-면제대상' | '';
  invoice_type: '세금계산서' | '현금영수증' | '';
  invoice_issue_status: '가톨릭요청' | '발행완료' | '';
  payment_amount: number | null;
  payment_date: string | null;
  tax_invoice_issue_date: string | null;
  depositor_name: string;
}

// file_type:
//   estimate(견적서) / contract(계약서) / beo(BEO) /
//   final_invoice(행사 종료 후 최종 INVOICE — 행사리뷰에서 업로드) / other
export type EventFileType = 'estimate' | 'contract' | 'beo' | 'final_invoice' | 'other';

export interface EventFile {
  id: string;
  event_id: string;
  file_type: EventFileType;
  file_name: string;
  file_url: string;
  uploaded_by: string;
  uploaded_at: string;
}

// 연/월별 영업 목표 (Forecasting). 행사건수와 매출액 두 측면 관리.
// (year, month) 조합이 unique key. Total은 wedding+mice 자동 합산이 기본이지만 별도 저장도 허용.
export interface SalesTarget {
  id: string;
  year: number;
  month: number; // 1~12
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

// 외부 업체에 특정 월 캘린더만 공유하기 위한 토큰
// 토큰 보유자는 해당 월의 행사 캘린더만 조회 가능 (월간 화살표 이동 X, 행사 클릭 상세 X)
export interface CalendarShare {
  id: string;
  token: string; // URL-safe random
  year: number;
  month: number; // 1~12
  label: string; // 메모용 (예: "ABC 케이터링용", "5월")
  created_by: string;
  created_at: string;
  // 행사 타입 필터 — 'ALL' | 'MICE' | 'WEDDING'
  event_type_filter: 'ALL' | 'MICE' | 'WEDDING';
}

export interface Cancellation {
  id: string;
  event_id: string;
  cancel_requested_at: string | null;
  cancel_reason: string;
  plenty_cancel_fee: number | null;
  plenty_cancel_fee_paid_at: string | null;
  catholic_rental_refund_status: '가톨릭요청' | '환불완료' | '';
}

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
  // 행사 종료 후 최종 매출액 — 월별/연별 매출 통계 집계 대상
  final_revenue: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
