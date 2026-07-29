// 날짜 표시 공용 유틸 — 앱 전체에서 날짜가 화면에 보일 때는 항상 "YYYY-MM-DD (요일)" 형태로 통일.
// 저장 포맷(YYYY-MM-DD / ISO)은 건드리지 않고 표시 시점에만 요일을 붙인다.

export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 'YYYY-MM-DD...' 문자열에서 요일 한 글자를 얻는다. 날짜가 아니면 ''.
export function weekdayKo(s?: string | null): string {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return '';
  return WEEKDAYS_KO[d.getDay()];
}

// 문자열 맨 앞의 YYYY-MM-DD 바로 뒤에 ' (요일)'을 끼워 넣는다.
// 날짜로 시작하지 않거나 이미 요일이 붙어 있으면 원문 그대로.
// 예: '2026-07-29' → '2026-07-29 (수)' / '2026-07-29 14:00' → '2026-07-29 (수) 14:00'
export function insertWeekday(s?: string | null): string {
  if (!s) return '';
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}\s*\([일월화수목금토]\)/.test(str)) return str; // 중복 방지
  const wd = weekdayKo(str);
  if (!wd) return str;
  return str.replace(/^(\d{4}-\d{2}-\d{2})/, `$1 (${wd})`);
}

// Date 객체용 — toLocaleDateString 계열을 쓰던 자리에서 사용.
export function weekdayKoOf(d: Date): string {
  return isNaN(d.getTime()) ? '' : WEEKDAYS_KO[d.getDay()];
}

// 'YYYY-MM-DD (수)' — 날짜만 (ISO면 시간부 제거)
export function fmtDateW(s?: string | null): string {
  if (!s) return '';
  return insertWeekday(String(s).slice(0, 10));
}

// 'YYYY-MM-DD (수) HH:mm' — ISO datetime용
export function fmtDateTimeW(s?: string | null): string {
  if (!s) return '';
  const str = String(s);
  const date = str.slice(0, 10);
  const time = str.length > 10 ? str.slice(11, 16) : '';
  return time ? `${insertWeekday(date)} ${time}` : insertWeekday(date);
}

// 날짜만이면 날짜만, T 포함이면 날짜+시간 (기존 fmtDateOrDateTime 대체)
export function fmtDateOrDateTimeW(s?: string | null): string {
  if (!s) return '';
  return String(s).includes('T') ? fmtDateTimeW(s) : fmtDateW(s);
}

// 파싱(엑셀 재업로드 등)용 — 표시용으로 붙인 '(요일)' 토큰 제거
export function stripWeekday(s: string): string {
  return s.replace(/\s*\([일월화수목금토]\)/g, '');
}
