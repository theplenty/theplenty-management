import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import koLocale from '@fullcalendar/core/locales/ko';
import type { EventInput } from '@fullcalendar/core';
import { STATUS_HEX, type EventStatus } from '../types';

interface PublicEvent {
  id: string;
  event_type: 'MICE' | 'WEDDING';
  status: EventStatus;
  halls: string[];
  start_datetime: string;
  end_datetime: string;
  event_name: string;
}

interface ShareInfo {
  year: number;
  month: number;
  label: string;
  event_type_filter: 'ALL' | 'MICE' | 'WEDDING';
}

export default function PublicCalendar() {
  const { token } = useParams<{ token: string }>();
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let aborted = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/public/calendar/${token}`);
        if (!res.ok) {
          setError('유효하지 않거나 만료된 공유 링크입니다.');
          return;
        }
        const data = (await res.json()) as { share: ShareInfo; events: PublicEvent[] };
        if (aborted) return;
        setShare(data.share);
        setEvents(data.events);
      } catch (e) {
        if (!aborted) setError('연결 오류가 발생했습니다.');
        console.error(e);
      } finally {
        if (!aborted) setLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [token]);

  const fcEvents: EventInput[] = useMemo(() => {
    return events.map((ev) => ({
      id: ev.id,
      title: ev.event_name || '(이름 없음)',
      start: ev.start_datetime,
      end: ev.end_datetime,
      backgroundColor: STATUS_HEX[ev.status],
      borderColor: STATUS_HEX[ev.status],
      textColor: ev.status === 'TEN' ? '#713f12' : '#ffffff',
    }));
  }, [events]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        불러오는 중...
      </div>
    );
  }
  if (error || !share) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-lg shadow p-8 max-w-md text-center">
          <div className="text-4xl mb-2">⚠️</div>
          <h1 className="font-bold text-lg mb-2">캘린더를 표시할 수 없습니다</h1>
          <p className="text-sm text-gray-600">{error || '알 수 없는 오류'}</p>
        </div>
      </div>
    );
  }

  // 해당 월 범위로 고정 — 화살표로 이동 못하도록 validRange 설정
  const startDate = `${share.year}-${String(share.month).padStart(2, '0')}-01`;
  const nextMonth = share.month === 12 ? 1 : share.month + 1;
  const nextYear = share.month === 12 ? share.year + 1 : share.year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-center justify-between mb-4 border-b pb-3">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">플렌티컨벤션 행사 일정</div>
              <h1 className="text-xl font-bold">
                {share.year}년 {share.month}월
                {share.event_type_filter !== 'ALL' && (
                  <span className="ml-2 text-sm text-gray-500">
                    ({share.event_type_filter})
                  </span>
                )}
              </h1>
              {share.label && <div className="text-xs text-gray-400 mt-0.5">{share.label}</div>}
            </div>
            <div className="flex gap-2 text-xs">
              <Legend label="INQ" color={STATUS_HEX.INQ} />
              <Legend label="TEN" color={STATUS_HEX.TEN} />
              <Legend label="DEF" color={STATUS_HEX.DEF} />
            </div>
          </div>

          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridMonth"
            initialDate={startDate}
            locale={koLocale}
            // 헤더 화살표 / 다른 뷰 버튼 모두 숨김 — 해당 월 고정
            headerToolbar={false}
            // 그래도 한 번 더 잠금: 이 범위 밖으로 navigate 시도 자체를 막음
            validRange={{ start: startDate, end: endDate }}
            height="auto"
            editable={false}
            selectable={false}
            dayMaxEvents
            events={fcEvents}
            eventClick={(info) => {
              // 외부 공유: 행사 상세 조회 차단
              info.jsEvent.preventDefault();
            }}
          />

          <div className="mt-4 text-[11px] text-gray-400 text-center">
            본 페이지는 외부 공유용 읽기 전용 화면입니다. 행사 상세 정보는 표시되지 않습니다.
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}
