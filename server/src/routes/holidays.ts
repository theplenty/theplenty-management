// 한국 공휴일 — 구글 공식 "대한민국 공휴일" 캘린더(ICS)를 서버에서 프록시.
// 구글 ICS 는 브라우저 직접 fetch 시 CORS 로 막히므로 서버를 경유한다.
// 대체공휴일·임시공휴일(선거일 등)까지 구글이 관리하는 그대로 내려준다. API 키 불필요.

import { Router } from 'express';

const router = Router();

// 구글 공개 한국 공휴일 캘린더 (ko.south_korea#holiday@group.v.calendar.google.com)
const ICS_URL =
  'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';

interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

// 메모리 캐시 — 공휴일은 자주 안 바뀌므로 12시간 유지
let cache: { at: number; data: Holiday[] } | null = null;
const TTL_MS = 12 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "20260101" → Date(2026, 0, 1) (로컬 자정)
function parseIcsDate(raw: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseIcs(ics: string): Holiday[] {
  // RFC5545 line unfolding (긴 줄은 CRLF + space/tab 으로 접힘)
  const unfolded = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/);

  const out: Holiday[] = [];
  const seen = new Set<string>();
  let cur: { start?: string; end?: string; summary?: string; desc?: string } | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
    } else if (line === 'END:VEVENT') {
      // 구글 캘린더는 DESCRIPTION 으로 공휴일/기념일을 구분.
      // "공휴일"(법정·대체·임시공휴일)만 표시하고 식목일·스승의날 등 기념일은 제외.
      const isPublic = (cur?.desc || '').includes('공휴일');
      if (cur && cur.start && cur.summary && isPublic) {
        const startD = parseIcsDate(cur.start);
        if (startD) {
          // DTEND 는 exclusive(다음날). 없으면 1일짜리.
          const endD = cur.end ? parseIcsDate(cur.end) : null;
          const last = endD && endD > startD ? endD : new Date(startD.getTime() + 86400000);
          for (let d = new Date(startD); d < last; d = new Date(d.getTime() + 86400000)) {
            const key = `${ymd(d)}|${cur.summary}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ date: ymd(d), name: cur.summary });
          }
        }
      }
      cur = null;
    } else if (cur) {
      // 속성 라인 — "DTSTART;VALUE=DATE:20260101" 또는 "SUMMARY:신정"
      if (line.startsWith('DTSTART')) {
        cur.start = line.slice(line.indexOf(':') + 1);
      } else if (line.startsWith('DTEND')) {
        cur.end = line.slice(line.indexOf(':') + 1);
      } else if (line.startsWith('SUMMARY')) {
        cur.summary = line.slice(line.indexOf(':') + 1).trim();
      } else if (line.startsWith('DESCRIPTION')) {
        cur.desc = line.slice(line.indexOf(':') + 1);
      }
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

async function loadHolidays(): Promise<Holiday[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = await res.text();
  const data = parseIcs(text);
  cache = { at: Date.now(), data };
  return data;
}

// GET /api/holidays — 구글 한국 공휴일 전체 (캘린더가 보이는 범위만큼 클라이언트에서 필터)
router.get('/', async (_req, res) => {
  try {
    const holidays = await loadHolidays();
    res.json({ holidays });
  } catch (e) {
    console.error('[holidays] 구글 공휴일 캘린더 로드 실패:', (e as Error).message);
    // 실패 시 빈 배열 — 캘린더 자체는 정상 동작해야 함
    res.status(200).json({ holidays: [], error: 'holiday_fetch_failed' });
  }
});

export default router;
