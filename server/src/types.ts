// 공통 도메인 타입 정의 — 클라이언트와 동일한 형태를 유지한다.

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
  // 멀티테넌시 — 이 사용자가 속한 회사(워크스페이스). 미지정 시 기본 테넌트로 간주.
  tenant_id?: string;
  email: string;
  name: string;
  picture?: string | null;
  role: Role;
  team: Team;
  created_at: string;
  updated_at: string;
}

// ===== 멀티테넌시 (회사/워크스페이스) =====
// SaaS 전환을 위한 테넌트 모델. 모든 업무 데이터는 tenant_id 로 회사별 격리한다.
// 기존(단일 회사) 데이터는 부팅 시 DEFAULT_TENANT_ID 로 일괄 백필된다.
export const DEFAULT_TENANT_ID = 'plenty';

export type TenantPlan = 'owner' | 'free' | 'pro' | 'enterprise';
export type TenantStatus = 'active' | 'suspended';

export interface Tenant {
  id: string;
  name: string; // 회사명 (예: 플렌티컨벤션)
  slug: string; // URL-safe 식별자 — 향후 서브도메인 후보
  plan: TenantPlan;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export type CustomerType = 'MICE' | 'WEDDING';

// TEN 은 2026-05-14 정책 변경으로 제거 — migrate.ts 에서 INQ 로 자동 변환.
export type EventStatus =
  | 'INQ'
  | 'DEF'
  | 'LOS'
  | '상담취소'
  | '미팅'
  | '미팅취소'
  | '시식';

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

// 인콜(고객이 먼저 문의) vs 아웃콜(우리가 먼저 영업) — 영업 액션 추적용.
// 기존 데이터는 마이그레이션에서 'INCALL' 로 일괄 채움.
export type MiceInquiryChannel = 'INCALL' | 'OUTCALL';

export interface MiceInquiry {
  id: string;
  progress_status: MiceInquiryStatus;
  // 유입 채널 — 신규 문의 등록 시 필수. 기존 데이터는 INCALL 로 일괄 마이그레이션.
  inquiry_channel: MiceInquiryChannel;
  contacts: MiceContact[];
  call_date: string | null;
  inquiry_event_date_text: string;
  // 작성자: 최초 등록자 (변경 불가, 추적용)
  created_by_id: string;
  created_by_name: string;
  // 담당자: 실제 고객을 관리하는 세일즈 (작성자와 별개. 작성자 = 담당자였던 옛 레코드는 created_by_* 값으로 fallback)
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
}

export interface MiceCustomer {
  id: string;
  tenant_id?: string;
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
  // 휴지통 (soft delete) — null/미설정이면 활성. 값이 있으면 휴지통에 들어감.
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
  estimate_amount: string; // 쉼표 표기는 클라이언트 측에서 처리
  estimate_detail: string;
  visit_consultation_comment: string;
  // 담당지배인 — 작성자처럼 자동 채움 + 드롭다운 변경 가능
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
  // 마진계산기 입력 전체를 JSON 직렬화 (재오픈 복원용). 임베디드 필드라 마이그레이션 영향 없음.
  calc_payload?: string;
}

export interface WeddingCustomer {
  id: string;
  tenant_id?: string;
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
  search_keyword: string; // 마케팅 검색어 (자유 입력 + 기존 이력 자동완성)
  // (2) 문의세부정보 — 여러 건
  event_inquiries: WeddingEventInquiry[];
  // (3) 메모
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

export type Customer = MiceCustomer | WeddingCustomer;

// ===== 변경 이력 =====
// 고객/행사 등 주요 엔티티의 수정 이력을 누적 기록.
export type ChangeLogEntityType =
  | 'mice_customer'
  | 'wedding_customer'
  | 'event'
  | 'collaboration_request';
export type ChangeLogAction = 'create' | 'update' | 'delete';

export interface ChangeLogChange {
  field: string; // 사람이 읽는 라벨 (예: '행사일자')
  before: string;
  after: string;
}

export interface ChangeLog {
  id: string;
  tenant_id?: string;
  entity_type: ChangeLogEntityType;
  entity_id: string;
  action: ChangeLogAction;
  summary: string; // 예: "진행상황 INQ → TEN, 담당자 변경"
  // 구조화된 변경 내역 — 펼치기 UI에서 before/after 카드를 만들 때 사용.
  // 옛 레코드는 없을 수 있어 optional.
  changes?: ChangeLogChange[];
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
  | '로비'
  | 'CAFE';

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

export interface FoodItem {
  id: string;
  tenant_id?: string;
  event_id: string;
  menu_name: string; // 메뉴 마스터 name_ko 참조 (자유 문자열로 관리)
  // set/lunchbox 메뉴 — 계약 시점과 행사 직전 확정 시점을 분리해서 보관
  gtd_contract: number | null;
  exp_contract: number | null;
  gtd_final: number | null;
  exp_final: number | null;
  // coffee break: time_label, service_time, quantity 사용
  time_label: string;
  service_time: string;
  quantity: number | null;
  memo: string;
}

export type CustomerRole = '주최사' | '대행사' | '협력사' | '회계 담당' | '기타';

export interface EventCustomerLink {
  id: string;
  tenant_id?: string;
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
  tenant_id?: string;
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
  // 내부 운영 참고용 메모 (캘린더 상세에서 입력/수정).
  memo: string;
  // 담당자.
  // MICE: 드롭다운으로 직접 선택. WEDDING: 연결된 WEDDING 고객의 담당지배인에서 자동 채움.
  assigned_manager_id: string;
  assigned_manager_name: string;
  created_at: string;
  updated_at: string;
  // 휴지통 (soft delete) — 행사 부모만 soft delete. 자식(food_items/invoice/files 등)은 그대로 남고,
  // 부모가 deleted_at 갖는 한 모든 list/detail 쿼리에서 보이지 않음. 영구삭제 시에만 cascade.
  deleted_at?: string | null;
  deleted_by_id?: string | null;
  deleted_by_name?: string | null;
  // ===== 매출 정보 (A3) =====
  contract_amount?: number | null;      // 계약서 금액 (할인 전)
  sales_total_amount?: number | null;   // 실제 매출 (할인 후)
  discount_rate?: number | null;        // 할인율 (0.1 = 10%)
  discount_reason?: string;             // 할인 사유
  contract_date?: string | null;        // 계약일
  gateway_fee?: number | null;          // 가톨릭대 대관료 (별도 지급)
  // ===== BEO(행사 운영 지시서) =====
  // 자동 시드 + 담당자 수동 편집한 BEO 문서를 JSON 직렬화해 보관 (변경이력 diff 제외).
  beo_payload?: string;
}

export interface Invoice {
  id: string;
  tenant_id?: string;
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
  tenant_id?: string;
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
  tenant_id?: string;
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

// 외부 클라이언트용 API 키.
// 발급 시 token 은 한 번만 평문으로 노출 (admin 화면에서 복사). 이후 마스킹.
// scope 별 캘린더 접근 권한:
//   all     — 모든 행사 + 전체 디테일 (event_name, hall, 담당자 등)
//   summary — 전체 행사가 보이지만 디테일 가려짐 (event_type/status/시간만, 행사명·고객명 미노출)
//   wedding — WEDDING 행사만 + 전체 디테일
//   mice    — MICE 행사만 + 전체 디테일
export type ApiKeyScope = 'all' | 'summary' | 'wedding' | 'mice';

export interface ApiKey {
  id: string;
  tenant_id?: string;
  label: string;
  token: string;
  scope: ApiKeyScope;
  created_by_id: string;
  created_by_name: string;
  created_at: string;
  last_used_at: string | null;
  active: boolean;
}

// 외부 업체에 특정 월 캘린더만 공유하기 위한 토큰
// 토큰 보유자는 해당 월의 행사 캘린더만 조회 가능 (월간 화살표 이동 X, 행사 클릭 상세 X)
export interface CalendarShare {
  id: string;
  tenant_id?: string;
  token: string; // URL-safe random
  year: number;
  month: number; // 1~12
  label: string; // 메모용 (예: "ABC 케이터링용", "5월")
  created_by: string;
  created_at: string;
  // 행사 타입 필터 — 'ALL' | 'MICE' | 'WEDDING'
  event_type_filter: 'ALL' | 'MICE' | 'WEDDING';
}

// 캘린더 요약 공개 공유 — 단일 토큰. 토큰 보유자는 로그인 없이 요약을 열람.
export interface SummaryShare {
  id: string;
  tenant_id?: string;
  token: string;
  created_at: string;
  created_by: string;
}

export interface Cancellation {
  id: string;
  tenant_id?: string;
  event_id: string;
  cancel_requested_at: string | null;
  cancel_reason: string;
  plenty_cancel_fee: number | null;
  plenty_cancel_fee_paid_at: string | null;
  catholic_rental_refund_status: '가톨릭요청' | '환불완료' | '';
}

export interface EventReview {
  id: string;
  tenant_id?: string;
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

// ===== 협업요청서 (Collaboration Request) =====
// 세일즈팀이 고객의 비표준 요청을 받았을 때 주방/연회와 협업 가능 여부를
// 신속하게 합의하기 위한 양식. 행사(Event)에 연결되며 작성→회신→결정 워크플로우.
export type CollabTeam = 'kitchen' | 'banquet';

// 표준 운영 대비 다른 부분 (다중 선택)
export type CollabDeviation =
  | '메뉴/식자재'
  | '음주류'
  | '인력/외주'
  | '운영 시간'
  | '공간 세팅'
  | '기타';

export type CollabReplyResult = '가능' | '조건부 가능' | '불가';
export type CollabDecision = '진행' | '조건부진행' | '진행안함';
export type CollabStatus = '회신대기' | '회신완료' | CollabDecision;

// 팀별 회신 (화면 2)
export interface CollaborationReply {
  team: CollabTeam;
  result: CollabReplyResult | null;
  added_cost: number | null; // 추가 COST 예상 (숫자)
  added_cost_memo: string; // 보충 메모 (식자재/인건비 등)
  condition_or_reject_reason: string; // '조건부 가능'/'불가' 시 필수
  alternative: string; // 대안 제안 (선택)
  replied_by_id: string;
  replied_by_name: string;
  replied_at: string | null;
}

// ===== 메뉴 마스터 =====
// 판매 메뉴 카탈로그. 행사 식음 항목(event_food_items) 및 BOM(레시피) 연결 대상.
export type MenuCategory = '전식' | '주식' | '후식' | '음료' | '주류' | '패키지';

// 식음 항목 입력 모드 — 메뉴별로 어떤 수량 정보를 받을지 결정.
//   set    : GTD/EXP 인원 (계약·확정) — 세트·뷔페 등
//   coffee : 시간 라벨 + 서비스 시간 + 수량 — 커피 브레이크
//   qty    : 단순 수량 — 디저트 플레이트·떡 등
export type MenuMode = 'set' | 'coffee' | 'qty';

// menuModeOf — 메뉴 이름으로 입력 모드 결정 (마스터 없을 때 폴백; 마스터 있으면 Menu.mode 우선).
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

// 메뉴 코스별 식자재 원가 구성 항목 (BOM)
export interface MenuDetail {
  id: string;
  dish_name: string;           // 식재료명
  quantity: string;            // 수량 (표시용 문자열)
  unit: string;                // 단위 (G, ML, EA …)
  unit_price: number | null;   // 단가 (원/단위)
  portion_cost: number | null; // 부분 원가 (원, VAT 제외)
  // 배치 1회가 만드는 인분수 — 대량 조리분(소스·육수 등)을 1인분으로 환산.
  // effectivePortionCost = portion_cost / (batch_yield ?? 1)
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
  tenant_id?: string;
  // 메뉴명 — MENU_OPTIONS 중 하나 (A set, Coffee Break 등)
  // 같은 name_ko + 다른 category 조합으로 여러 행 허용
  name_ko: string;
  // 코스 카테고리 — 자유 입력 (Appetizer, Soup, Main, Dessert 등)
  category: string;
  // 기업(MICE) / 웨딩(WEDDING) 구분 — 신규 필드, 미설정 시 마이그레이션이 'MICE'로 백필
  event_type: MenuEventType;
  // 담당 부서 — 미설정 시 마이그레이션이 '주방'으로 백필
  dept: MenuDept;
  mode: MenuMode;
  serving_size_default: number;
  list_price: number | null; // 메뉴 판매 단가 (원가율 계산 기준)
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

export interface CollaborationRequest {
  id: string;
  tenant_id?: string;
  event_id: string;

  // --- 화면 1: 작성 (세일즈) ---
  created_by_id: string;
  created_by_name: string;
  created_by_role: Role;
  created_at: string;
  customer_event_name: string; // 고객사/행사명 (필수)
  event_date: string | null; // 행사 예정일 (필수)
  customer_request: string; // 고객 요청 사항 (필수, ≤100)
  deviations: CollabDeviation[]; // 표준 대비 다른 부분 (다중)
  deviation_other: string; // '기타' 선택 시 텍스트
  expected_revenue: number | null; // 예상 매출 (필수)
  expected_revenue_memo: string; // 메모 (선택)
  target_teams: CollabTeam[]; // 협업 요청 받는 팀 (1개 이상)
  sales_comment: string; // 세일즈 의견 (≤200)

  // --- 화면 2: 팀별 회신 ---
  replies: CollaborationReply[];

  // --- 화면 3: 최종 결정 (세일즈) ---
  decision: CollabDecision | null;
  decided_margin: number | null; // 예상매출 - 추가COST 합 (자동계산, 수정가능)
  decision_comment: string;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decided_at: string | null;

  // --- 상태 / 메타 ---
  status: CollabStatus;
  reply_due_at: string; // created_at + 24h (카운트다운 기준)
  updated_at: string;
}

// ===== 매출 항목 마스터 (Revenue Items) =====
export type RevenueCategory = '공간' | '식음' | '장비' | '장식' | '기타';

export interface RevenueItem {
  id: string;
  tenant_id?: string;
  code: string;
  name_ko: string;
  category: RevenueCategory;
  default_account: string;  // 회계 계정 코드
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ===== 행사별 세부 매출 라인 (Event Revenue Lines) =====
export interface EventRevenueLine {
  id: string;
  tenant_id?: string;
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

export interface Payment {
  id: string;
  tenant_id?: string;
  event_id: string;
  payment_type: PaymentType;
  amount: number;               // 고객 결제 금액
  paid_at: string;              // 고객이 결제한 날 (ISO date)
  method: PaymentMethod;
  card_company?: CardCompany;   // method=card 일 때만
  approval_no?: string;         // 카드 승인번호
  business_name?: string;       // 현금영수증/세금계산서 사업자명
  bank_deposit_date?: string;   // 카드사가 우리 통장 입금한 날
  bank_deposit_amount?: number; // 수수료 차감 후 실제 입금액
  note?: string;
  reconciled_at?: string;
  reconciled_by?: string;       // user id
  created_at: string;
  updated_at: string;
}

// ===== 앱 설정 (전 직원 공유, key-value) =====
// 마진계산기 기준값 등 admin이 편집하고 전 직원이 읽는 설정을 저장.
// id === key (persistDoc/Firestore 문서 키 호환용).
export interface AppSetting {
  id: string;         // = key ('wedding-calc' 등)
  key: string;        // 'wedding-calc' 등
  value: unknown;     // 설정 JSON (타입은 key별로 상이)
  updated_at: string;
  updated_by?: string;
}

// ===== 웨딩 마진계산기 기준값 (Admin 편집) =====
export interface WCPriceTier { label: string; from: string; A: number; B: number; C: number; fB: number; fL: number; fG: number; }
export interface WCRentItem { n: string; rmk: string; }
export interface WCOptItem { n: string; p: number; rmk: string; minG: number; }
export interface WCOtherItem { n: string; p: number; rmk: string; svc: boolean; qty?: number; qtyMode?: boolean; off?: boolean; }
export interface WCBevItem { n: string; p: number; rmk: string; }
export interface WCCtype { name: string; mealDisc: number; flowerUp: boolean; }
export interface WCCost {
  foodA: number; foodB: number; foodC: number; extPP: number; fixed: number;
  flowerCostR: number; intBurden: number; comBurden: number;
}
export type WCSeason = '워크인' | '임직원' | '비수기';
export interface WCPreset {
  period: string; season: WCSeason; day: '토' | '일'; time: '점심' | '저녁';
  discount: number; coursePrice: number; director: number; flower: number;
  wine: number; reception: boolean; fixed: number; marginRate: number;
}
export interface WeddingCalcSettings {
  price: WCPriceTier[];
  courseDesc: { A: string; B: string; C: string };
  flowerDesc: { basic: string; lux: string; grand: string };
  rentList: number;
  rentSpecial: number;
  rentItems: WCRentItem[];
  optItems: WCOptItem[];
  otherItems: WCOtherItem[];
  bevItems: WCBevItem[];
  ctypes: WCCtype[];
  cost: WCCost;
  presets?: WCPreset[];
  tierTeamlead?: { lunchSat: number; other: number };
  tierExecFloor?: number;
}
