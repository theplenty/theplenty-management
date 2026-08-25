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
/**
 * MICE 문의 진행상황 — 3분류 (문의 / 확정(DEF) / 취소(LOS)).
 *
 * 고객정보는 업체별 통화 이력 모음이다. 이 값은 **그 문의가 어떻게 끝났는지**만 말하고,
 * 어디까지 갔는지는 체크 4종(견적서·계약서·회신·계약금)이 문의 건별로 들고 있다.
 * 옛 값 단순문의·INQ·TEN 은 '문의' 로 합쳤다 — INQ 는 원래 '가예약' 뜻으로 만들었지만
 * 실제로는 세일즈팀이 '보류' 로 써 왔고, 진짜 가예약은 행사(Event) 상태 쪽에 있다.
 */
export type MiceInquiryStatus = '문의' | '입금확인중' | 'DEF' | 'LOS';

/** 옛 값 → 3분류. 저장 경로에 걸어두면 아직 안 옮겨진 문서도 다음 저장에 스스로 정리된다. */
export function normalizeMiceStatus(s: string | null | undefined): MiceInquiryStatus {
  return s === 'DEF' ? 'DEF' : s === 'LOS' ? 'LOS' : s === '입금확인중' ? '입금확인중' : '문의';
}

/** 3분류 집계용 그룹 — 입금확인중은 아직 확정 전이라 진행 중(문의 계열)으로 묶는다. */
export function miceStatusGroup(s: string | null | undefined): '문의' | 'DEF' | 'LOS' {
  const n = normalizeMiceStatus(s);
  return n === '입금확인중' ? '문의' : n;
}

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

  // ===== 콜 트래커 (MICE 세일즈 콜백 관리) =====
  // 별도 사이트로 운영하던 문의 트래커를 흡수하면서 들어온 필드들.
  // 세일즈팀이 매일 보는 것은 메모보다 이 네 개 체크와 콜백 기한이다.

  /** 콜백 예정일 — 문의 등록 +7일 자동. 직접 수정 가능. 지나면 화면에서 경고. */
  callback_due?: string | null;
  /**
   * @deprecated 옛 '재통화 예정일'. 콜백 날짜는 callback_due 한 칸으로 합쳤다.
   *
   * 원래는 기한(callback_due)과 약속일(callback_at)을 나누고 **보류(INQ) 상태**로 갈랐는데,
   * 진행상황을 3분류로 줄이면서 그 갈림길이 사라져 두 칸이 같은 일을 하게 됐다.
   * 저장 경로에서 callback_due 로 흡수한 뒤 null 로 비운다. 읽기 호환용으로만 남긴다.
   */
  callback_at?: string | null;

  /** 진행 체크 4종 — 팀이 현재 상태를 판단하는 기준 */
  quote_sent?: boolean;        // 견적서 발송
  contract_sent?: boolean;     // 계약서 발송
  contract_replied?: boolean;  // 계약서 회신됨
  deposit_paid?: boolean;      // 계약금 납부

  /** 자동 확정 시각 — 견적서·회신·계약금 3개가 모두 체크된 순간 기록 */
  confirmed_at?: string | null;

  /**
   * 체크를 '켠' 시각 — 월별 활동 집계용 ("6월에 견적을 몇 건 보냈나").
   * 체크 자체엔 시각이 없어 과거엔 접수월 코호트로만 셀 수 있었다. 지금부터 쌓는다.
   * 켜는 순간 기록, 끄면 지움. 스탬프 도입 전에 켜진 체크는 null(시각 미상)로 둔다 —
   * 없는 시각을 지어내면 월별 표가 조용히 틀어진다.
   */
  quote_sent_at?: string | null;
  contract_sent_at?: string | null;
  contract_replied_at?: string | null;
  deposit_paid_at?: string | null;

  /**
   * 계약금 금액 — 플렌티는 **계약금 = 가톨릭대 대관료** 구조라, 이 값이 연결된 행사의
   * 매출탭 '가톨릭대관료'(gateway_fee)로 흘러간다. (S2)
   */
  deposit_amount?: number | null;
  /** 입금 상세 (S2-2) — 매출탭 가톨릭대관료 블록의 원본이 문의로 옮겨왔다. 여기서 쓰고 행사는 읽기만. */
  deposit_depositor?: string;              // 입금자명
  deposit_date?: string | null;            // 입금일자 (YYYY-MM-DD)
  invoice_type?: string;                   // 계산서 발행 (세금계산서/현금영수증)
  invoice_issue_status?: string;           // 계산서 발행상태 (가톨릭요청/발행완료)
  tax_invoice_issue_date?: string | null;  // 세금계산서 발행일자


  /** 이 문의가 성사된 실제 행사. 연결·해제는 전용 API 한 곳에서만 다룬다(양쪽 필드 동기화 보장). */
  linked_event_id?: string | null;
  linked_at?: string | null;
  linked_by_name?: string;

  /** 계약금 → 행사 매출 자동 반영 스탬프. 반영 금액을 남겨 행사에서 나중에 바뀌었는지 비교한다. */
  revenue_pushed_at?: string | null;
  revenue_pushed_amount?: number | null;
  /** 마지막으로 행사에 밀어낸 값들의 지문 — 같으면 재반영 생략 */
  revenue_pushed_fp?: string | null;

  /**
   * "이 건은 더 이상 콜백하지 않는다" 고 사람이 닫은 시각.
   *
   * 확정(DEF)·취소(LOS)로 넘어간 건은 이 값이 없어도 화면에서 종료로 친다 —
   * 상태에서 이미 드러나는 사실을 굳이 저장할 이유가 없고, 나중에 다시 보류로
   * 되돌리면 콜백도 같이 살아나야 맞다.
   * 이 필드는 '상태는 진행 중이지만 전화는 그만' 인 경우에만 쓴다.
   */
  callback_done_at?: string | null;

  /**
   * 이 문의 건에 대한 통화·협상 메모.
   * 고객 메모(MiceCustomer.memo)는 업체 전반에 대한 것이라, 건별 이력은 여기 쌓는다.
   * 트래커에서 팀이 가장 많이 쓰던 칸이 이것이었다.
   */
  note?: string;
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

// TEN 은 2026-08-25 제거 (행사 상태의 TEN 폐기와 같은 정리) — 남은 데이터는 migrate 에서 INQ 로 접는다.
export type WeddingProgressStatus =
  | '신규문의'
  | '상담'
  | '상담취소'
  | 'INQ'
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
  // ===== 계약금 (= 가톨릭대 대관료, 웨딩은 154만원 정액) — 2026-08-25 =====
  // 이 후보가 '가예약된 그 날짜' 가 되면 계약금이 붙는다. 원본은 여기(고객정보)이고
  // 행사 매출탭은 읽기 전용 거울이다. INQ 부터 입력하며 DEF 이후에도 계속 보인다.
  linked_event_id?: string | null; // 미러 대상 행사 (후보 날짜로 자동 매칭, 다르면 직접 지정)
  deposit_amount?: number | null;
  deposit_paid?: boolean; // 입금 확인 — 켜지면 진행단계·행사가 DEF 로 전환된다
  deposit_paid_at?: string | null;
  deposit_depositor?: string;
  deposit_date?: string | null;
  invoice_type?: string; // 세금계산서 | 현금영수증
  invoice_issue_status?: string; // 가톨릭요청 | 발행완료
  tax_invoice_issue_date?: string | null;
  revenue_pushed_at?: string | null;
  revenue_pushed_amount?: number | null;
  revenue_pushed_fp?: string; // 같은 값 재반영·로그 중복 방지 지문
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
  /**
   * 진행단계를 행사 상태와 **일부러 다르게** 지정한 흔적 (W2).
   * 예: 그 날짜는 놓쳐 행사는 LOS 지만 다른 날짜로 재상담 중이라 고객은 '상담' 으로 둔 경우.
   * 값이 있으면 화면에 "행사와 다름 · 수동 지정" 배지가 붙는다. 조용한 불일치를 막기 위한 것.
   */
  stage_manual_at?: string | null;
  stage_manual_by_name?: string;
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
  // 출처 문의 (S2) — 이 행사가 어느 MICE 문의에서 왔는지. 역참조 캐시(연결 API 가 함께 기록).
  source_customer_id?: string | null;
  source_inquiry_id?: string | null;
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

// ===== 웨딩 고객 랜딩 (가예약 고객용 공개 링크) =====
// INQ 웨딩 행사마다 1개. 고객이 가블록 기간 동안 열람하는 모바일 랜딩 페이지.
// 견적은 직원이 "발행" 시점에 고객용 HTML 스냅샷으로 저장 (마진·원가 등 내부 데이터 미포함).
// 상태: LOS/휴지통 → 닫힘 · DEF → '계약 완료' 감사 화면 · 가블록 종료일 경과 → 만료 · closed → 수동 닫힘.

// 상담 중시항목 키 (고정 8종) — 랜딩에서 항목별 다듬어진 문구로 노출
export type WeddingPriorityKey =
  | 'space'      // 공간중시
  | 'food'       // 음식중시
  | 'access'     // 교통중시
  | 'flower'     // 플라워중시
  | 'private'    // 프라이빗 진행 중시
  | 'parents'    // 부모님 의견 중시
  | 'budget'     // 예산 중시
  | 'photo';     // 사진 및 영상 중시

export interface WeddingLandingCta {
  action: 'contract' | 'call'; // 계약하고 싶어요 | 전화로 상의할게요
  at: string; // ISO
}

// 랜딩 견적 카드에 노출할 혜택 한 줄 (발행 시점 스냅샷)
export interface WeddingLandingBenefit {
  label: string; // 예: '식대 10% 할인'
  amount: number; // 혜택 금액(원)
}

export interface WeddingLanding {
  id: string;
  tenant_id?: string;
  event_id: string; // block 모드: 연결 행사. consult 모드에서는 ''
  mode?: 'block' | 'consult'; // block=가블록(행사 연결, 기본) / consult=상담만 하고 간 고객 (고객 직접 연결)
  customer_id?: string; // consult 모드: 연결 웨딩 고객
  token: string; // 공개 링크 토큰 (/l/:token)
  block_until: string; // 가블록 종료일(block) / 링크 열람 기한(consult) YYYY-MM-DD — 경과 시 만료
  priorities: WeddingPriorityKey[];
  custom_note: string; // 자유 추가 문구 (선택)
  inquiry_id: string; // 매칭된 예식후보 id (견적 출처)
  guest_count: number | null; // 스냅샷: 예상 하객
  total_amount: string; // 스냅샷: 총 예상비용 (예: "34,500,000")
  quote_html: string; // 스냅샷: 고객용 견적서 HTML
  benefits?: WeddingLandingBenefit[]; // 스냅샷: 혜택 내역 (식대할인·플라워 업그레이드 등)
  closed: boolean; // 직원 수동 닫기
  cta_clicks: WeddingLandingCta[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
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
  noodleP?: number;
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

// ===== 알림 발송 이력 (A4 알림 자동화) =====
// 같은 건이 매일 반복 발송되는 것을 막는 dedup 키 저장소.
// 규칙별 재알림 주기(repeat_days)가 지나면 다시 보낸다.
export interface NotificationLog {
  id: string;          // = dedup_key (문서 키 호환)
  dedup_key: string;   // '<rule>:<대상 id>' — 예: 'payment_overdue:pmt_abc'
  rule: string;        // 규칙 id
  target_id: string;   // 행사/결제/협업 id
  channel: string;     // 'slack' 등
  sent_at: string;     // ISO
}

// ===== 견적 버전 (B2 — JSON blob → 1급 엔티티) =====
//
// 이전에는 계산기 입력을 통짜 JSON 문자열(`event_inquiry.calc_payload`)로 넣고
// **저장할 때마다 덮어썼다.** 그래서 같은 고객에게 견적을 여러 번 내도 마지막 것만 남고,
// "처음에 얼마를 불렀는지 / 왜 깎아줬는지" 를 되짚을 수 없었다.
//
// 여기서는 저장할 때마다 **새 버전을 쌓는다.** 지우지 않는다.
// 조회·집계에 쓰는 값(보증인원·코스·할인율·금액)은 필드로 꺼내 두고,
// 원본 입력은 `inputs_json` 에 그대로 남겨 나중에 그 조건을 다시 열어볼 수 있게 한다.
export interface QuoteVersion {
  id: string;
  tenant_id?: string;

  customer_id: string;   // wedding_customers.id
  inquiry_id: string;    // wedding_customers.event_inquiries[].id
  version: number;       // 같은 문의 안에서 1부터 증가

  created_at: string;
  created_by_id: string;
  created_by_name: string;

  // ── 꺼내 둔 조회·집계용 필드 ──
  groom: string;
  bride: string;
  wedding_date: string | null;  // YYYY-MM-DD
  wedding_time: string;         // HH:mm (표기용)
  slot: string;                 // '토 점심' 등 계산 기준 슬롯
  guests: number;               // 보증인원
  customer_type: string;        // 고객유형 이름 (가톨릭동문 등)
  course: string;               // 코스 키
  meal_discount_rate: number;   // %
  flower_bill: string;          // 청구 등급
  flower_give: string;          // 제공 등급
  flower_upgrade: boolean;
  noodle: boolean;              // 웨딩국수 포함 여부

  // ── 금액 스냅샷 (발행 시점 기준. 기준단가가 바뀌어도 이 값은 안 변한다) ──
  total_amount: number;         // 최종 제안가
  list_total: number;           // 정가 합계
  total_benefit: number;        // 총 혜택(할인) 금액
  meal_revenue: number;
  flower_revenue: number;
  rent_revenue: number;
  margin_rate: number | null;   // 내부 마진율(%) — 고객 노출 금지

  // ── 원본 ──
  inputs_json: string;          // CalcInputs 원본 (재현용)
  summary_text: string;         // 사람이 읽는 한 줄 요약
  note: string;                 // 이 버전에 대한 메모 (왜 이 조건으로 냈는지)
}
