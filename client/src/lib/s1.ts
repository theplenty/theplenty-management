// S1 (구매 시스템 원가 연동) — 화면 쪽 공용 값. 계산 규칙의 원본은 server/src/lib/s1Pnl.ts.

export const REVENUE_DEPT_OPTIONS = [
  { value: '', label: '기본값' },
  { value: '컨벤션_주방', label: '주방' },
  { value: '컨벤션_홀', label: '홀' },
  { value: '비식음', label: '비식음 (COST% 제외)' },
] as const;

/** 매출 항목 코드별 기본 부서 표시 — 서버 REVENUE_DEPT_DEFAULT 와 같은 내용 */
export function revenueDeptDefaultLabel(code: string): string {
  switch (code) {
    case 'FOOD':
    case 'SNACK':
      return '주방';
    case 'BEV':
    case 'CORKAGE':
      return '홀';
    case 'CB':
      return '홀 3 : 주방 10'; // 커피 3,000(홀) + 쿠키 10,000(주방)
    default:
      return '비식음';
  }
}
