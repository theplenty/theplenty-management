// 주간/월간 "신규 INQ·DEF·LOS" 표 — 서버의 상태 전이 목록(/api/stats/status-transitions)을 기간 칸에 담는다.
// 기준은 **상태가 바뀐 시점**이다 (접수월 코호트인 월별 세일즈 표와 다르다).

export interface StatusTransition {
  kind: 'event' | 'mice' | 'wedding';
  sub: 'MICE' | 'WEDDING';
  id: string;
  name: string;
  to: string;
  at: string | null; // null = 시각 미상 (이력 도입 전 MICE 문의 등)
}

export interface Bucket {
  key: string;
  label: string; // 열 머리글
  fromIso: string; // inclusive
  toIso: string; // exclusive
  isCurrent: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 최근 n주 — 월요일 시작, 이번 주가 마지막 열. */
export function weekBuckets(n = 12, now = new Date()): Bucket[] {
  const day = now.getDay();
  const monOffset = (day + 6) % 7;
  const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - monOffset);
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(thisMon.getTime() - i * 7 * 86400_000);
    const to = new Date(from.getTime() + 7 * 86400_000);
    const last = new Date(to.getTime() - 86400_000);
    out.push({
      key: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      label: `${from.getMonth() + 1}/${from.getDate()}~${last.getMonth() + 1}/${last.getDate()}`,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      isCurrent: i === 0,
    });
  }
  return out;
}

/** 한 해의 12개월. */
export function monthBuckets(year: number, now = new Date()): Bucket[] {
  return Array.from({ length: 12 }, (_, i) => {
    const from = new Date(year, i, 1);
    const to = new Date(year, i + 1, 1);
    return {
      key: `${year}-${pad(i + 1)}`,
      label: `${i + 1}월`,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      isCurrent: year === now.getFullYear() && i === now.getMonth(),
    };
  });
}

export interface TrendRow<T = StatusTransition> {
  key: string;
  label: string;
  strong?: boolean;
  indent?: boolean;
  match: (t: T) => boolean;
}

export interface TrendCell<T = StatusTransition> {
  items: T[];
}

export interface TrendLine<T = StatusTransition> {
  row: TrendRow<T>;
  cells: TrendCell<T>[]; // buckets 순서
  total: number;
  unknown: number; // 시각 미상이라 어느 칸에도 못 넣은 건
}

/** 아무 항목이나 "언제" 를 꺼내는 함수만 주면 기간 칸에 담는다 — 상태 전이 외에 고객 유입(마케팅 KPI)에도 쓴다. */
export function buildTrendLinesBy<T>(
  items: T[],
  getAt: (t: T) => string | null,
  buckets: Bucket[],
  rows: TrendRow<T>[]
): TrendLine<T>[] {
  return rows.map((row) => {
    const cells: TrendCell<T>[] = buckets.map(() => ({ items: [] }));
    let unknown = 0;
    let total = 0;
    for (const t of items) {
      if (!row.match(t)) continue;
      const at = getAt(t);
      if (!at) {
        unknown++;
        continue;
      }
      const idx = buckets.findIndex((b) => at >= b.fromIso && at < b.toIso);
      if (idx === -1) continue;
      cells[idx].items.push(t);
      total++;
    }
    return { row, cells, total, unknown };
  });
}

export function buildTrendLines(transitions: StatusTransition[], buckets: Bucket[], rows: TrendRow[]): TrendLine[] {
  return buildTrendLinesBy(transitions, (t) => t.at, buckets, rows);
}

// ── 표 정의 ──
// 행사: 캘린더 행사의 상태가 INQ/DEF/LOS 로 바뀐 건. MICE·WEDDING 합계 + 각각.
export const EVENT_TREND_ROWS: TrendRow[] = (['INQ', 'DEF', 'LOS'] as const).flatMap((st) => [
  { key: `ev-${st}`, label: `신규 ${st}`, strong: true, match: (t) => t.kind === 'event' && t.to === st },
  { key: `ev-${st}-M`, label: 'MICE', indent: true, match: (t) => t.kind === 'event' && t.to === st && t.sub === 'MICE' },
  { key: `ev-${st}-W`, label: 'WEDDING', indent: true, match: (t) => t.kind === 'event' && t.to === st && t.sub === 'WEDDING' },
]);

// 고객 문의: MICE 문의 진행상황 · 웨딩 고객 진행단계
export const CUSTOMER_TREND_ROWS: TrendRow[] = [
  { key: 'mice-new', label: 'MICE 신규 문의 (인콜+아웃콜)', strong: true, match: (t) => t.kind === 'mice' && t.to === '문의' },
  { key: 'mice-DEF', label: 'MICE DEF', indent: true, match: (t) => t.kind === 'mice' && t.to === 'DEF' },
  { key: 'mice-LOS', label: 'MICE LOS', indent: true, match: (t) => t.kind === 'mice' && t.to === 'LOS' },
  { key: 'wd-new', label: 'WEDDING 신규문의', strong: true, match: (t) => t.kind === 'wedding' && t.to === '신규문의' },
  { key: 'wd-consult', label: 'WEDDING 상담', indent: true, match: (t) => t.kind === 'wedding' && t.to === '상담' },
  { key: 'wd-INQ', label: 'WEDDING INQ', indent: true, match: (t) => t.kind === 'wedding' && t.to === 'INQ' },
  { key: 'wd-DEF', label: 'WEDDING DEF', indent: true, match: (t) => t.kind === 'wedding' && t.to === 'DEF' },
  { key: 'wd-LOS', label: 'WEDDING LOS', indent: true, match: (t) => t.kind === 'wedding' && t.to === 'LOS' },
];
