// 한국식 천 단위 쉼표. 입력 중에도 자연스럽게 동작.
// "70000000" → "70,000,000". 빈 문자열은 그대로 빈 문자열.

export function formatKoreanCommas(input: string): string {
  if (input == null) return '';
  const digits = String(input).replace(/[^\d]/g, '');
  if (!digits) return '';
  return Number(digits).toLocaleString('ko-KR');
}

// 저장 후 표시 시점에서 한 번 더 정규화
export function normalizeNumeric(s: string): string {
  return formatKoreanCommas(s);
}
