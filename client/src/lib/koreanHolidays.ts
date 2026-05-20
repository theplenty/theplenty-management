// 한국 공휴일·명절 — date-holidays 기반으로 FullCalendar 이벤트 생성.
// 외부 API/키 불필요, 음력 명절(설날/추석)은 라이브러리가 자동 계산.
//
// 보정:
//  - 제헌절은 2008년부터 공휴일이 아니므로 제외 (라이브러리가 public 으로 잘못 분류)
//  - 설날/추석은 라이브러리가 당일 하나만 주므로 ±1일(총 3일) 연휴로 확장
//  ※ 주말과 겹칠 때의 대체공휴일까지 정확히 반영하지는 않음 — 참고용 표시.

import type Holidays from 'date-holidays';
import type { EventInput } from '@fullcalendar/core';

// date-holidays 는 전 세계 데이터를 포함해 번들이 큼 → 동적 import 로 분리.
// 캘린더에서 공휴일을 처음 켤 때만 로드되고, 초기 번들에는 포함되지 않음.
let hd: Holidays | null = null;
async function getHd(): Promise<Holidays> {
  if (!hd) {
    const mod = await import('date-holidays');
    const HolidaysCtor = mod.default;
    hd = new HolidaysCtor('KR');
  }
  return hd;
}

const EXCLUDE_NAMES = new Set<string>(['제헌절']);
const LUNAR_FESTIVALS = new Set<string>(['설날', '추석']);

const HOLIDAY_BG = '#fee2e2'; // 옅은 빨강
const HOLIDAY_BORDER = '#fecaca';
const HOLIDAY_TEXT = '#dc2626';

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function makeHolidayEvent(date: Date, name: string): EventInput {
  const dateStr = ymd(date);
  return {
    id: `holiday-${dateStr}-${name}`,
    title: `🇰🇷 ${name}`,
    start: dateStr,
    allDay: true,
    display: 'block',
    backgroundColor: HOLIDAY_BG,
    borderColor: HOLIDAY_BORDER,
    textColor: HOLIDAY_TEXT,
    classNames: ['fc-event-holiday'],
    editable: false,
    extendedProps: { holiday: true },
  };
}

// FullCalendar 가 요청한 [start, end) 범위에 들어오는 공휴일만 생성.
export async function buildKoreanHolidays(start: Date, end: Date): Promise<EventInput[]> {
  const h = await getHd();
  const out: EventInput[] = [];
  const seen = new Set<string>();

  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const list = h.getHolidays(y);
    for (const item of list) {
      if (item.type !== 'public') continue;
      if (EXCLUDE_NAMES.has(item.name)) continue;

      // 명절은 ±1일 연휴로 확장, 그 외는 당일만
      const offsets = LUNAR_FESTIVALS.has(item.name) ? [-1, 0, 1] : [0];
      for (const off of offsets) {
        const d = new Date(item.start.getFullYear(), item.start.getMonth(), item.start.getDate() + off);
        if (d < start || d >= end) continue;
        const label =
          LUNAR_FESTIVALS.has(item.name) && off !== 0 ? `${item.name} 연휴` : item.name;
        const key = `${ymd(d)}-${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(makeHolidayEvent(d, label));
      }
    }
  }
  return out;
}
