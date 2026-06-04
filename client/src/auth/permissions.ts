import type { Role } from '../types';

// ============================================================
// 권한 규칙 (정적). 향후 admin UI 기반 동적 매트릭스로 대체 예정.
// ============================================================
//
// 역할별 기본 권한:
//
//   admin (관리자)
//     - 전체 기능 (관리자 전용 탭 포함)
//
//   sales_mice (기업세일즈)
//     - MICE 고객 DB 보기/작성/수정/삭제
//     - 행사 보기/작성/수정/삭제
//     - 캘린더 공유 링크
//     - 캘린더 요약
//     - 행사리뷰 보기 (작성·수정 불가)
//
//   sales_wedding (웨딩세일즈)
//     - WEDDING 고객 DB 보기/작성/수정/삭제
//     - 행사 보기/작성/수정/삭제
//     - 캘린더 공유 링크
//     - 캘린더 요약
//     - 행사리뷰 보기 (작성·수정 불가)
//
//   banquet (연회팀) — 뷰어 + 행사리뷰 예외
//     - MICE/WEDDING 고객 DB 보기
//     - 행사 보기 (수정 불가)
//     - 행사리뷰 보기/작성/수정 ★
//     - 캘린더 요약 ★
//
//   kitchen (주방팀) — 뷰어
//     - MICE/WEDDING 고객 DB 보기
//     - 행사 보기 (수정 불가)
//     - 행사리뷰 보기 (작성 불가)
//     - 캘린더 요약 ★
//
//   h_kitchen (에이치키친) — 뷰어, 고객 DB 접근 불가
//     - 행사 보기 (수정 불가)
//     - 행사리뷰 보기 (작성 불가)
//     - 캘린더 요약 ★
//     - 고객 DB 접근 X
//
//   pending / disabled — 어떤 화면도 접근 불가 (Pending 화면만)
//
// 관리자 전용 탭: 사용자관리, 외부 API 키, 휴지통

export function isActive(role: Role | undefined): boolean {
  return !!role && role !== 'pending' && role !== 'disabled';
}

export function isAdmin(role: Role | undefined): boolean {
  return role === 'admin';
}

// 세일즈팀 (기업/웨딩)
export function isSales(role: Role | undefined): boolean {
  return role === 'sales_mice' || role === 'sales_wedding';
}

// 뷰어 권한 (작성·수정·삭제 불가)
export function isViewerOnly(role: Role | undefined): boolean {
  return role === 'banquet' || role === 'kitchen' || role === 'h_kitchen';
}

// ===== 행사 =====
export function canCreateEvent(role: Role | undefined): boolean {
  // admin 또는 sales 만 작성/수정 가능
  return role === 'admin' || isSales(role);
}
// 행사 조회는 활성 사용자 모두 가능 (뷰어 포함)
export function canSeeEvents(role: Role | undefined): boolean {
  return isActive(role);
}

// ===== 고객 DB =====
// MICE/WEDDING 세일즈는 서로의 DB도 보기·작성·수정 가능 (양 팀 모두 풀 액세스)
// 뷰어(연회/주방)는 보기만. 에이치키친은 접근 불가.
export function canSeeMice(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'sales_mice' ||
    role === 'sales_wedding' ||
    role === 'banquet' ||
    role === 'kitchen'
  );
}
export function canWriteMice(role: Role | undefined): boolean {
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}
export function canSeeWedding(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    role === 'sales_mice' ||
    role === 'sales_wedding' ||
    role === 'banquet' ||
    role === 'kitchen'
  );
}
export function canWriteWedding(role: Role | undefined): boolean {
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}

// ===== 행사리뷰 =====
// 조회는 활성 사용자 모두 가능
export function canSeeReviews(role: Role | undefined): boolean {
  return isActive(role);
}
// 작성·수정은 admin + banquet 만 (스펙: '연회팀 행사리뷰 탭은 작성 및 수정 가능')
export function canWriteReview(role: Role | undefined): boolean {
  return role === 'admin' || role === 'banquet';
}

// ===== 캘린더 공유 링크 =====
export function canShareCalendar(role: Role | undefined): boolean {
  return role === 'admin' || isSales(role);
}

// ===== 캘린더 요약 =====
// 뷰어 포함 모든 활성 사용자 사용 가능 (스펙 4번 — 출력까지 가능)
export function canUseCalendarSummary(role: Role | undefined): boolean {
  return isActive(role);
}

// ===== 대시보드 =====
// 뷰어 포함 모든 활성 사용자 조회 가능 (대시보드는 집계 정보)
export function canSeeDashboard(role: Role | undefined): boolean {
  return isActive(role);
}

// ===== 관리자 전용 =====
// 사용자관리 / 외부 API 키 / 휴지통 — 모두 admin only.
export function canManageUsers(role: Role | undefined): boolean {
  return role === 'admin';
}
export function canManageApiKeys(role: Role | undefined): boolean {
  return role === 'admin';
}
export function canManageTrash(role: Role | undefined): boolean {
  return role === 'admin';
}

// ===== 협업요청서 =====
// 작성·최종결정: admin + 세일즈. 회신: admin + 주방/연회. 삭제: admin.
export function canCreateCollaboration(role: Role | undefined): boolean {
  return role === 'admin' || isSales(role);
}
export function canDecideCollaboration(role: Role | undefined): boolean {
  return role === 'admin' || isSales(role);
}
export function canReplyCollaboration(role: Role | undefined): boolean {
  return role === 'admin' || role === 'kitchen' || role === 'banquet';
}
// 이 사용자가 회신할 수 있는 팀 (admin 은 양팀 가능 → null 로 표시하고 UI에서 선택)
export function collabReplyTeam(role: Role | undefined): 'kitchen' | 'banquet' | null {
  if (role === 'kitchen') return 'kitchen';
  if (role === 'banquet') return 'banquet';
  return null;
}
// 조회: admin/세일즈는 전체, 주방/연회는 자기 팀 대상 건. h_kitchen 등은 불가.
export function canSeeCollaboration(role: Role | undefined): boolean {
  return (
    role === 'admin' ||
    isSales(role) ||
    role === 'kitchen' ||
    role === 'banquet'
  );
}
export function canDeleteCollaboration(role: Role | undefined): boolean {
  return role === 'admin';
}

// ===== 메뉴 마스터 =====
// 조회: 활성 사용자 전원 가능.
// 등록·수정·비활성화: 사장(admin) + 세일즈 매니저만.
export function canWriteMenu(role: Role | undefined): boolean {
  return role === 'admin' || role === 'sales_mice' || role === 'sales_wedding';
}
export function canSeeMenu(role: Role | undefined): boolean {
  return isActive(role);
}

// ===== 행사 삭제 =====
// 휴지통 안전망이 있으므로 활성 사용자 모두 행사·고객 soft-delete 가능.
// 전체비우기(clearAllEvents) 등 mass 작업은 admin only.
export function canSoftDelete(role: Role | undefined): boolean {
  return isActive(role);
}

// ===== 매출 관리 =====
// 조회: pending/disabled 제외 모든 활성 사용자 가능.
// 수정: admin 전용.
export function canWriteRevenue(role: Role | undefined): boolean {
  return role === 'admin';
}
export function canSeeRevenue(role: Role | undefined): boolean {
  return !!role && role !== 'pending' && role !== 'disabled';
}
