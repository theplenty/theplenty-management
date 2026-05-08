import type { Role } from '../types';

export function isActive(role: Role | undefined): boolean {
  return !!role && role !== 'pending' && role !== 'disabled';
}

export function isAdmin(role: Role | undefined): boolean {
  return role === 'admin';
}

// 세일즈팀(MICE/WEDDING)은 한 팀으로 보고 행사 기능을 동등하게 처리.
// 역할 분리는 "고객정보 입력 담당자" 분리 용도일 뿐.
export function isSales(role: Role | undefined): boolean {
  return role === 'sales_mice' || role === 'sales_wedding';
}

export function canCreateEvent(role: Role | undefined): boolean {
  return role === 'admin' || isSales(role);
}

// 고객정보 DB는 입력 담당자 분리를 위해 그대로 분할 유지
export function canSeeMice(role: Role | undefined): boolean {
  return role === 'admin' || role === 'sales_mice';
}

export function canSeeWedding(role: Role | undefined): boolean {
  return role === 'admin' || role === 'sales_wedding';
}

// 행사리뷰 조회 — 주방팀 외 모두
export function canSeeReviews(role: Role | undefined): boolean {
  return role === 'admin' || role === 'banquet' || isSales(role);
}

// 행사리뷰 작성·수정 — 연회팀(과 관리자)만
export function canWriteReview(role: Role | undefined): boolean {
  return role === 'admin' || role === 'banquet';
}

// 캘린더 공유 링크 생성 — 관리자/세일즈
export function canShareCalendar(role: Role | undefined): boolean {
  return role === 'admin' || isSales(role);
}

// 대시보드 조회 — 주방팀 외 모두 (운영 인사이트 공유)
export function canSeeDashboard(role: Role | undefined): boolean {
  return role === 'admin' || role === 'banquet' || isSales(role);
}
