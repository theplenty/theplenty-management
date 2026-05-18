// 검색·중복 매칭용 문자열 정규화 헬퍼.
// - 업체명 정규화: 공백/괄호/흔한 접미사 제거
// - 전화·이메일에서 비교용 토큰 추출
// - Levenshtein 거리 (한글은 글자 단위로 비교)

// MICE 업체명에서 자주 붙는 접미사·접두사 — 비교 시 제거
const ORG_NOISE_TOKENS = [
  '주식회사', '(주)', '㈜',
  '유한회사', '(유)',
  '재단법인', '학교법인', '의료법인', '사회복지법인', '사단법인',
  'co.,ltd', 'co., ltd', 'co.ltd', 'coltd', 'co.,inc.',
  'co.', 'ltd.', 'inc.', 'corp.', 'corp', 'group', 'company',
  '주식', '법인', '재단', '학원', '학회', '의원', '병원',
  '협회', '위원회', '연구원', '연구소', '센터',
  '컨벤션', '컨퍼런스',
];

/**
 * MICE 업체명을 매칭 가능한 핵심 토큰으로 정규화.
 *
 * 예시:
 *   "(주)서울성모병원 의료법인" → "서울성모"
 *   "이비인후과학회"          → "이비인후과"
 *   "이빈후과 학회"           → "이빈후과"
 *   "Samsung Co., Ltd."       → "samsung"
 *
 * 빈 문자열이 나올 경우 (전체가 접미사로만 구성된 경우) 원본의 공백 제거본을 반환.
 */
export function normalizeOrgName(input: string | null | undefined): string {
  if (!input) return '';
  let s = input.toLowerCase();
  // 괄호 안 내용 통째로 제거: "회사명(영문약자)" 같은 케이스
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\[[^\]]*\]/g, '');
  // 모든 공백·하이픈·구두점 제거
  s = s.replace(/[\s\-_·.,/&+]/g, '');
  // 접미사·접두사 토큰 제거 (긴 토큰부터 우선 매칭)
  const tokens = [...ORG_NOISE_TOKENS].sort((a, b) => b.length - a.length);
  for (const t of tokens) {
    const nt = t.toLowerCase().replace(/[\s\-_·.,/&+]/g, '');
    while (s.includes(nt)) s = s.replace(nt, '');
  }
  if (!s) {
    // 모두 제거됐으면 원본 공백/구두점만 정리한 버전을 반환 (빈 키 충돌 방지)
    return input.toLowerCase().replace(/[\s\-_·.,/&+]/g, '');
  }
  return s;
}

/** 전화번호에서 숫자만 추출. "010-1234-5678" → "01012345678" */
export function normalizePhone(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\D/g, '');
}

/** 이메일 로컬 파트 (@ 앞) 소문자. 검색 부분일치용. */
export function normalizeEmail(s: string | null | undefined): string {
  if (!s) return '';
  const at = s.indexOf('@');
  return (at === -1 ? s : s.slice(0, at)).toLowerCase();
}

/**
 * Levenshtein 거리 — 한글은 글자 단위 (Array.from 으로 surrogate pair 안전).
 * 짧은 문자열에는 충분히 빠름 (업체명 수십자 수준).
 */
export function levenshtein(a: string, b: string): number {
  const A = Array.from(a);
  const B = Array.from(b);
  if (A.length === 0) return B.length;
  if (B.length === 0) return A.length;
  const m = A.length;
  const n = B.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * 사용자 입력 검색어를 토큰화 + 정규화.
 * - 숫자가 4자 이상 포함되면 "전화번호 부분일치" 후보로 간주 (normalize 결과를 phoneNumeric 으로)
 * - @ 포함되면 이메일 검색 의도
 * - 그 외 일반 텍스트
 */
export interface ParsedQuery {
  raw: string;
  text: string; // 소문자, 공백 trim
  phoneNumeric: string | null; // 4자리 이상 숫자만 추출됐을 때
  emailLocal: string | null; // @ 포함 시 로컬 파트
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = (raw || '').trim();
  const text = trimmed.toLowerCase();
  const digits = trimmed.replace(/\D/g, '');
  const phoneNumeric = digits.length >= 4 ? digits : null;
  const emailLocal = trimmed.includes('@') ? trimmed.split('@')[0].toLowerCase() : null;
  return { raw: trimmed, text, phoneNumeric, emailLocal };
}

/**
 * 한글 음절 → 초성 추출 (한 글자만).
 * 예: '김' → 'ㄱ', '치' → 'ㅊ', '메' → 'ㅁ', 'a' → 'a'
 * 검색 키워드가 초성만일 때 매칭 보조용.
 */
const HANGUL_CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const JAMO_CYCLE = 21 * 28;

export function extractChoseong(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= HANGUL_START && code <= HANGUL_END) {
      const idx = Math.floor((code - HANGUL_START) / JAMO_CYCLE);
      out += HANGUL_CHOSEONG[idx];
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/**
 * `query` 가 `target` 에 substring 으로 포함되는지 + 초성 일치도 검사.
 * - 일반 substring match (case-insensitive)
 * - 한글 초성 substring match
 */
export function softIncludes(target: string | null | undefined, queryText: string): boolean {
  if (!target || !queryText) return false;
  const t = target.toLowerCase();
  const q = queryText.toLowerCase();
  if (t.includes(q)) return true;
  // 초성 매칭 — 사용자가 'ㄱㅁ' 으로 '김미현' 검색하는 케이스
  if (/^[ㄱ-ㅎ]+$/.test(q)) {
    return extractChoseong(target).includes(q);
  }
  return false;
}
