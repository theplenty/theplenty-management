// 한국 시각 기준 날짜 계산 — 단일 소스.
//
// 왜 필요한가:
//   Cloud Functions 는 **UTC** 로 돈다. 그래서 `new Date().toISOString().slice(0,10)` 는
//   한국 시각 오전 9시 이전에 **하루 전 날짜**를 준다(KST = UTC+9).
//   매일 08:00 KST 에 도는 알림 스케줄러가 정확히 이 구간에 걸려 있어서,
//   "오늘" 기준 판정(D-7·종료 여부·기간 범위)이 하루씩 밀렸다.
//
// 날짜 문자열(YYYY-MM-DD)만 다루고, 시각·타임존은 여기 밖으로 내보내지 않는다.

const KST_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 한국 시각 기준 날짜 (YYYY-MM-DD). 인자를 주면 그 시점 기준. */
export function todayKst(at: Date = new Date()): string {
  const parts = KST_PARTS.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 날짜 문자열에 일수를 더하고 뺀다.
 * UTC 로만 계산해서 서버 타임존과 무관하게 같은 결과가 나오게 한다
 * (로컬 타임존으로 계산하면 자정 근처에서 하루가 밀린다).
 */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** 한국 시각 기준 오늘에서 N일 이동한 날짜 */
export function daysFromTodayKst(days: number): string {
  return shiftDate(todayKst(), days);
}

/** 개월 단위 이동 (기간 기본값용) */
export function monthsFromTodayKst(months: number): string {
  const [y, m, d] = todayKst().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return t.toISOString().slice(0, 10);
}

/** YYYY-MM-DD 로 자르기 (datetime 문자열 대응) */
export function dateOnly(s: string | null | undefined): string {
  return (s || '').slice(0, 10);
}
