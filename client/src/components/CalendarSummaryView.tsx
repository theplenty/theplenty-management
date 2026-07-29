// 캘린더 요약 — 월 그리드(FullCalendar) 뷰. 인증 페이지/공개 페이지 공용.
// 셀의 행사를 클릭하면 상세(사용홀·메뉴·GTD/EXP·메뉴 비고)를 모달로 표시.
// 모바일: 셀당 2건 + 날짜 탭 시 하단에 그날 요약 카드 리스트.

import { useEffect, useMemo, useState } from 'react';
import { insertWeekday } from '../lib/dateFmt';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';
import type { EventClickArg, EventInput } from '@fullcalendar/core';
import { buildKoreanHolidays } from '../lib/koreanHolidays';
import {
  type CustomerType,
  type EventStatus,
  type FoodItem,
  STATUS_HEX,
} from '../types';
import { useIsMobile } from '../lib/useIsMobile';
import Modal from './Modal';

export interface SummaryEvent {
  id: string;
  event_type: CustomerType;
  status: EventStatus;
  halls: string[];
  start_datetime: string;
  end_datetime: string;
  event_name: string;
  food_items: FoodItem[];
}

const EXCLUDED_STATUSES = new Set<EventStatus>(['상담취소', '미팅', '미팅취소', 'LOS']);

type GtdExpSource = 'final' | 'contract' | null;

function aggregateGtdExp(ev: SummaryEvent): {
  gtd: number | null;
  exp: number | null;
  gtdSource: GtdExpSource;
  expSource: GtdExpSource;
} {
  let gtdFinal = 0;
  let gtdContract = 0;
  let expFinal = 0;
  let expContract = 0;
  let hasFinalGtd = false;
  let hasContractGtd = false;
  let hasFinalExp = false;
  let hasContractExp = false;
  for (const it of ev.food_items || []) {
    if (it.gtd_final != null) {
      gtdFinal += it.gtd_final;
      hasFinalGtd = true;
    }
    if (it.gtd_contract != null) {
      gtdContract += it.gtd_contract;
      hasContractGtd = true;
    }
    if (it.exp_final != null) {
      expFinal += it.exp_final;
      hasFinalExp = true;
    }
    if (it.exp_contract != null) {
      expContract += it.exp_contract;
      hasContractExp = true;
    }
  }
  const legacy = ev as unknown as Record<string, number | null>;
  if (!hasFinalGtd && legacy.food_gtd_final != null) {
    gtdFinal = legacy.food_gtd_final;
    hasFinalGtd = true;
  }
  if (!hasContractGtd && legacy.food_gtd_contract != null) {
    gtdContract = legacy.food_gtd_contract;
    hasContractGtd = true;
  }
  if (!hasFinalExp && legacy.food_exp_final != null) {
    expFinal = legacy.food_exp_final;
    hasFinalExp = true;
  }
  if (!hasContractExp && legacy.food_exp_contract != null) {
    expContract = legacy.food_exp_contract;
    hasContractExp = true;
  }
  return {
    gtd: hasFinalGtd ? gtdFinal : hasContractGtd ? gtdContract : null,
    exp: hasFinalExp ? expFinal : hasContractExp ? expContract : null,
    gtdSource: hasFinalGtd ? 'final' : hasContractGtd ? 'contract' : null,
    expSource: hasFinalExp ? 'final' : hasContractExp ? 'contract' : null,
  };
}

function gtdExpLabel(gtdSource: GtdExpSource, expSource: GtdExpSource): string {
  const sources: GtdExpSource[] = [];
  if (gtdSource) sources.push(gtdSource);
  if (expSource) sources.push(expSource);
  if (sources.length === 0) return '확정 GTD/EXP';
  return sources.every((s) => s === 'final') ? '확정 GTD/EXP' : '계약 GTD/EXP';
}

function timeOnly(s: string): string {
  return (s || '').slice(11, 16);
}
function dateKey(s: string): string {
  return (s || '').slice(0, 10);
}

export default function CalendarSummaryView({ events }: { events: SummaryEvent[] }) {
  const isMobile = useIsMobile();
  const [selected, setSelected] = useState<SummaryEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 한국 공휴일 — 메인 캘린더와 동일하게 표시(공개 요약 페이지 포함). 보이는 범위에 맞춰 로드.
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const [holidays, setHolidays] = useState<EventInput[]>([]);

  useEffect(() => {
    if (!visibleRange) return;
    let cancelled = false;
    buildKoreanHolidays(visibleRange.start, visibleRange.end).then((hs) => {
      if (!cancelled) setHolidays(hs);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleRange]);

  const summaryEvents = useMemo(
    () => events.filter((e) => !EXCLUDED_STATUSES.has(e.status)),
    [events]
  );

  const fcEvents = useMemo<EventInput[]>(
    () =>
      summaryEvents.map((e) => {
        const color = STATUS_HEX[e.status] || '#6b7280';
        return {
          id: e.id,
          title: e.event_name || '(이름없음)',
          start: e.start_datetime,
          end: e.end_datetime,
          // 셀 안에 상세를 직접 렌더하므로 블록은 흰 배경 + 상태색 테두리
          backgroundColor: '#ffffff',
          borderColor: color,
          textColor: '#111827',
          extendedProps: { summary: e },
        };
      }),
    [summaryEvents]
  );

  const dayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return summaryEvents.filter((e) => dateKey(e.start_datetime) === selectedDate);
  }, [selectedDate, summaryEvents]);

  function handleEventClick(arg: EventClickArg) {
    const ev = arg.event.extendedProps.summary as SummaryEvent | undefined;
    if (ev) setSelected(ev);
  }

  return (
    <div>
      <div className="bg-white border rounded-lg p-2 md:p-4 shadow-sm overflow-x-auto fc-summary">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale={koLocale}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          buttonText={{ today: '오늘' }}
          height="auto"
          editable={false}
          // PC: 셀에 모든 행사 상세를 펼쳐 한눈에 + 그대로 출력 / 모바일: 2건만, 탭하면 하단 리스트
          dayMaxEvents={isMobile ? 2 : false}
          events={[...fcEvents, ...holidays]}
          datesSet={(arg) => setVisibleRange({ start: arg.start, end: arg.end })}
          eventClick={handleEventClick}
          dateClick={(info) => {
            if (isMobile) setSelectedDate(info.dateStr);
          }}
          eventContent={(arg) => {
            const ev = arg.event.extendedProps.summary as SummaryEvent | undefined;
            // 공휴일 등 요약 외 이벤트: 제목(🇰🇷 이름)을 그대로 표시.
            // (eventContent에서 undefined를 반환하면 FullCalendar가 빈 블록을 그림)
            if (!ev) {
              return (
                <div className="px-1 py-0.5 text-[11px] font-semibold" style={{ color: '#dc2626' }}>
                  {arg.event.title}
                </div>
              );
            }
            return <SummaryEventBlock ev={ev} compact={isMobile} />;
          }}
        />
      </div>

      {/* 모바일: 선택한 날짜의 요약 카드 리스트 */}
      {isMobile && selectedDate && (
        <div className="mt-3">
          <div className="text-sm font-semibold text-gray-700 mb-2">
            {insertWeekday(selectedDate)} 요약 ({dayEvents.length}건)
          </div>
          {dayEvents.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-4 bg-white border rounded">
              이 날 요약 대상 행사가 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {dayEvents.map((ev) => (
                <SummaryCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 행사 클릭 시 상세 모달 */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? selected.event_name || '(이름 없음)' : ''}
        widthClass="max-w-lg"
        footer={
          <button onClick={() => setSelected(null)} className="btn-secondary">
            닫기
          </button>
        }
      >
        {selected && <SummaryCard ev={selected} expanded />}
      </Modal>
    </div>
  );
}

// 캘린더 셀 안에 직접 렌더되는 행사 1건 요약 블록.
// PC(compact=false): 홀·GTD/EXP·메뉴·비고까지 한눈에. 모바일(compact=true): 시간·행사명만.
function SummaryEventBlock({ ev, compact }: { ev: SummaryEvent; compact: boolean }) {
  const color = STATUS_HEX[ev.status] || '#6b7280';

  if (compact) {
    return (
      <div className="px-1 py-0.5 leading-tight overflow-hidden" style={{ borderLeft: `3px solid ${color}` }}>
        <span className="text-[10px] text-gray-500">{timeOnly(ev.start_datetime)}</span>{' '}
        <span className="text-[11px] font-semibold text-gray-900">{ev.event_name || '(이름없음)'}</span>
      </div>
    );
  }

  const halls = (ev.halls || []).join(' / ') || '홀 미지정';
  const { gtd, exp, gtdSource, expSource } = aggregateGtdExp(ev);
  const label = gtdExpLabel(gtdSource, expSource);
  const foodItems = ev.food_items || [];
  const menuNames = Array.from(new Set(foodItems.map((f) => f.menu_name).filter(Boolean)));
  const menuMemos = foodItems.filter((f) => (f.memo || '').trim()).map((f) => ({ menu: f.menu_name, memo: f.memo }));

  return (
    <div
      className="summary-block whitespace-normal px-1.5 py-1 leading-snug w-full"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center gap-1 flex-wrap mb-0.5">
        <span className="badge text-white text-[9px] px-1" style={{ background: color }}>
          {ev.status}
        </span>
        <span className="text-[9px] text-gray-500">{ev.event_type}</span>
        <span className="text-[10px] text-gray-600 tabular-nums">
          {timeOnly(ev.start_datetime)}~{timeOnly(ev.end_datetime)}
        </span>
      </div>
      <div className="text-[11px] font-bold text-gray-900 break-words">
        {ev.event_name || '(이름 없음)'}
      </div>
      <div className="text-[10px] text-gray-700 break-words">
        <span className="text-gray-400">홀</span> {halls}
      </div>
      <div className="text-[10px] text-gray-700 tabular-nums">
        <span className="text-gray-400">{label}</span> {gtd ?? '-'}/{exp ?? '-'}
      </div>
      {menuNames.length > 0 && (
        <div className="text-[10px] text-gray-700 break-words">
          <span className="text-gray-400">메뉴</span> {menuNames.join(', ')}
        </div>
      )}
      {menuMemos.length > 0 && (
        <div className="text-[10px] text-gray-600 break-words">
          {menuMemos.map((m, i) => (
            <div key={i}>
              <span className="text-gray-400">·</span> <strong>{m.menu}</strong>: {m.memo}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SummaryCard({ ev, expanded }: { ev: SummaryEvent; expanded?: boolean }) {
  const halls = (ev.halls || []).join(' / ') || '홀 미지정';
  const { gtd, exp, gtdSource, expSource } = aggregateGtdExp(ev);
  const label = gtdExpLabel(gtdSource, expSource);
  const color = STATUS_HEX[ev.status] || '#6b7280';
  const foodItems = ev.food_items || [];
  const menuNames = Array.from(new Set(foodItems.map((f) => f.menu_name).filter(Boolean)));
  const menuMemos = foodItems
    .filter((f) => (f.memo || '').trim())
    .map((f) => ({ menu: f.menu_name, memo: f.memo }));

  return (
    <div className={expanded ? '' : 'border rounded p-2.5 bg-white'}>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="badge bg-gray-100 text-gray-700 text-[10px]">{ev.event_type}</span>
        <span className="badge text-white text-[10px]" style={{ background: color }}>
          {ev.status}
        </span>
        <span className="text-xs text-gray-500">
          {timeOnly(ev.start_datetime)} ~ {timeOnly(ev.end_datetime)}
        </span>
      </div>
      {!expanded && (
        <div className="font-semibold text-sm text-gray-900">{ev.event_name || '(이름 없음)'}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5 text-xs">
        <div>
          <span className="text-gray-500">사용홀:</span>{' '}
          <span className="text-gray-900">{halls}</span>
        </div>
        <div>
          <span className="text-gray-500">{label}:</span>{' '}
          <span className="text-gray-900 font-mono">
            {gtd ?? '-'} / {exp ?? '-'}
          </span>
        </div>
        {menuNames.length > 0 && (
          <div className="sm:col-span-2">
            <span className="text-gray-500">메뉴:</span>{' '}
            <span className="text-gray-900">{menuNames.join(', ')}</span>
          </div>
        )}
      </div>
      {menuMemos.length > 0 && (
        <div className="mt-1.5 text-xs">
          <div className="text-gray-500 mb-0.5">메뉴 비고:</div>
          <ul className="space-y-0.5 pl-3">
            {menuMemos.map((m, i) => (
              <li key={i} className="text-gray-800">
                · <strong>{m.menu}</strong>: {m.memo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
