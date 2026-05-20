// 한국 공휴일·명절 — 서버(/api/holidays)를 통해 구글 공식 공휴일 캘린더를 가져온다.
// 대체공휴일·임시공휴일(선거일 등)까지 구글이 관리하는 그대로 표시. API 키 불필요.

import { api } from './api';
import type { EventInput } from '@fullcalendar/core';

interface RawHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

const HOLIDAY_BG = '#fee2e2'; // 옅은 빨강
const HOLIDAY_BORDER = '#fecaca';
const HOLIDAY_TEXT = '#dc2626';

// 한 번 받아서 캐시 (캘린더 내 여러 뷰가 공유)
let cache: RawHoliday[] | null = null;
let inflight: Promise<RawHoliday[]> | null = null;

async function fetchHolidays(): Promise<RawHoliday[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = api
    .get<{ holidays: RawHoliday[] }>('/api/holidays')
    .then((r) => {
      cache = r.holidays || [];
      return cache;
    })
    .catch(() => {
      // 실패해도 캘린더 자체는 동작해야 함
      cache = [];
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function makeHolidayEvent(dateStr: string, name: string): EventInput {
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
  const list = await fetchHolidays();
  const out: EventInput[] = [];
  for (const h of list) {
    const d = new Date(`${h.date}T00:00:00`);
    if (isNaN(d.getTime())) continue;
    if (d < start || d >= end) continue;
    out.push(makeHolidayEvent(h.date, h.name));
  }
  return out;
}
