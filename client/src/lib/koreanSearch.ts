// 한글 부분/초성 검색 유틸.
// "ㅇ" 만 입력해도 "오케이금융" 같이 초성에 ㅇ이 포함된 단어가 매칭되어야 한다는 요구사항을 처리한다.

const HANGUL_CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ',
  'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ',
  'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const CYCLE = 21 * 28; // 중성 21 × 종성 28

// 한 음절을 초성 한 글자로 변환. 한글이 아니면 그대로 반환.
function syllableToCho(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return ch;
  const idx = Math.floor((code - HANGUL_BASE) / CYCLE);
  return HANGUL_CHO[idx] ?? ch;
}

export function toChoseong(text: string): string {
  let out = '';
  for (const ch of text) out += syllableToCho(ch);
  return out;
}

// 검색어가 초성/자음만으로 이뤄졌는지 — 그렇다면 초성 비교 모드.
function isOnlyJamo(q: string): boolean {
  if (!q) return false;
  for (const ch of q) {
    const c = ch.charCodeAt(0);
    // 한글 자음 영역 (ㄱ~ㅎ): 0x3131 ~ 0x314E
    const isJamo = c >= 0x3131 && c <= 0x314e;
    if (!isJamo && ch !== ' ') return false;
  }
  return true;
}

// 숫자만 포함된 검색어인지 (예: "4784", "01012345678")
function isOnlyDigits(q: string): boolean {
  return /^\d+$/.test(q);
}

/**
 * 텍스트가 검색어를 포함하는지 판정.
 * - 검색어가 한글 자음(초성)만 → 텍스트의 초성 추출 후 부분일치
 * - 검색어가 숫자만 → 텍스트에서 숫자만 추출한 형태로도 부분일치 (전화번호 하이픈 무시)
 * - 그 외 → toLowerCase 부분일치
 */
export function fuzzyMatch(text: string | undefined | null, query: string): boolean {
  if (!query) return true;
  if (!text) return false;
  const q = query.trim();
  if (!q) return true;

  if (isOnlyJamo(q)) {
    return toChoseong(text).includes(q.replace(/\s/g, ''));
  }

  const lowerText = text.toLowerCase();
  if (lowerText.includes(q.toLowerCase())) return true;

  // 숫자 검색어 → 하이픈/공백 등 비숫자 제거 후 매칭 (전화번호 끝자리 검색용)
  if (isOnlyDigits(q)) {
    const textDigits = text.replace(/\D/g, '');
    if (textDigits.includes(q)) return true;
  }

  return false;
}

/**
 * 여러 필드에서 검색어 매칭이 하나라도 되면 true.
 */
export function matchesAnyField(item: Record<string, unknown>, fields: string[], query: string): boolean {
  if (!query) return true;
  for (const f of fields) {
    const v = item[f];
    if (typeof v === 'string' && fuzzyMatch(v, query)) return true;
    if (typeof v === 'number' && fuzzyMatch(String(v), query)) return true;
  }
  return false;
}
