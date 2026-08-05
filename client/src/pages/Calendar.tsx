import { weekdayKoOf, fmtDateTimeW } from '../lib/dateFmt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';
import type { DateSelectArg, EventClickArg, EventInput } from '@fullcalendar/core';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { canCreateEvent, canShareCalendar, canSeeWedding } from '../auth/permissions';
import { useIsMobile } from '../lib/useIsMobile';
import { detectConflict } from '../lib/conflictCheck';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { buildSearchEntry, fuzzyMatchEntry, type SearchEntry } from '../lib/koreanSearch';
import { buildKoreanHolidays } from '../lib/koreanHolidays';
import {
  EVENT_STATUS_OPTIONS,
  STATUS_HEX,
  isCancelledStatus,
  isCancelledWeddingProgress,
  type Cancellation,
  type CustomerType,
  type Event,
  type EventCustomerLink,
  type EventStatus,
  type EventWithFood,
  type FoodItem,
  type Invoice,
  type WeddingCustomer,
} from '../types';
import EventFormModal from '../components/EventFormModal';
import ShareCalendarModal from '../components/ShareCalendarModal';
import Modal from '../components/Modal';

interface FetchResp {
  events: EventWithFood[];
}

const CONSULT_HEX = '#a855f7'; // 상담 — 보라
const CONSULT_CANCELLED_HEX = '#000000'; // 상담취소 — 블랙 (취소 계열 통일, strikethrough 로 구분)

function toFcConsultation(c: WeddingCustomer): EventInput {
  const dt = c.desired_consultation_date!;
  const hasTime = dt.includes('T');
  const start = dt;
  const baseDate = hasTime ? new Date(dt) : new Date(`${dt}T00:00:00`);
  const end = hasTime ? new Date(baseDate.getTime() + 60 * 60 * 1000).toISOString() : undefined;
  const cancelled = isCancelledWeddingProgress(c.progress_status);
  const labelPrefix = cancelled ? c.progress_status : '상담'; // '상담취소' 또는 'LOS' 로 표기
  const color = cancelled ? CONSULT_CANCELLED_HEX : CONSULT_HEX;
  return {
    id: `consult-${c.id}`,
    title: `${labelPrefix} — ${c.wedding_event_name || c.groom_name || c.bride_name || '(이름없음)'}`,
    start,
    end,
    allDay: !hasTime,
    // 시간이 있는 상담은 dayGrid에서 자동으로 "● 시간 제목" 형태 (list-item),
    // 시간 없는 상담은 기본적으로 색 블록(block)으로 표시되어 1월/2월 모양이 달라짐.
    // 모든 상담을 동일한 dot 스타일로 통일하기 위해 강제 list-item.
    display: 'list-item',
    backgroundColor: color,
    borderColor: color,
    textColor: '#ffffff',
    classNames: [
      'fc-event-consultation',
      // 취소 계열은 이벤트와 동일하게 줄긋기 + 흐림 처리.
      cancelled ? 'fc-event-cancelled' : '',
      cancelled ? 'opacity-40' : '',
    ].filter(Boolean) as string[],
    extendedProps: {
      consultation: c,
    },
  };
}

function toFcEvent(ev: EventWithFood, faded: boolean, hardConflict: boolean): EventInput {
  // 알 수 없는 상태값(레거시 TEN 등)에 대비해 회색 fallback
  const baseColor = STATUS_HEX[ev.status] || '#6b7280';
  const textColor = '#ffffff';
  const cancelled = isCancelledStatus(ev.status);
  return {
    id: ev.id,
    // 상태 + 행사명 병기 — 색상과 별개로 DEF/INQ/LOS 등을 한눈에 (예: "[DEF] 대한의학회")
    title: `[${ev.status}] ${ev.event_name || '(이름 없음)'}`,
    start: ev.start_datetime,
    end: ev.end_datetime,
    backgroundColor: baseColor,
    borderColor: hardConflict ? '#dc2626' : baseColor,
    textColor,
    classNames: [
      faded ? 'opacity-40' : '',
      // 취소 계열은 모두 streak through + 반투명. (LOS / 상담취소 / 미팅취소)
      cancelled ? 'fc-event-cancelled' : '',
      hardConflict ? 'fc-event-conflict' : '',
    ].filter(Boolean) as string[],
    extendedProps: {
      event: ev,
      foodItems: ev.food_items,
      hardConflict,
    },
  };
}

export default function Calendar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fcRef = useRef<FullCalendar>(null);

  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [weddingCustomers, setWeddingCustomers] = useState<WeddingCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 상태별 표시 여부 (체크박스). 모든 상태 기본 ON.
  const [statusVisible, setStatusVisible] = useState<Record<EventStatus, boolean>>(() => {
    const init = {} as Record<EventStatus, boolean>;
    for (const s of EVENT_STATUS_OPTIONS) init[s] = true;
    return init;
  });
  const [showConsultations, setShowConsultations] = useState(true);
  const [filterType, setFilterType] = useState<'ALL' | 'MICE' | 'WEDDING'>('ALL');
  // 한국 공휴일 — 항상 표시. 보이는 범위(datesSet)에 맞춰 비동기 로드.
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const [holidays, setHolidays] = useState<EventInput[]>([]);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editingFoods, setEditingFoods] = useState<FoodItem[]>([]);
  const [editingLinks, setEditingLinks] = useState<EventCustomerLink[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingCancellation, setEditingCancellation] = useState<Cancellation | null>(null);
  const [draftDate, setDraftDate] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [conflictListOpen, setConflictListOpen] = useState(false);
  const [dupListOpen, setDupListOpen] = useState(false);
  // 모바일 — 셀당 행사 2건만 표시, 선택한 날짜의 전체 행사를 하단 리스트로
  const isMobile = useIsMobile();
  const [selectedDate, setSelectedDate] = useState<string | null>(null); // YYYY-MM-DD

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<FetchResp>('/api/events');
      setEvents(res.events);
    } catch (e) {
      setError('행사 목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
    // WEDDING 고객 — 상담일자 표시용. 권한 없으면 조용히 무시.
    try {
      const wres = await api.get<{ customers: WeddingCustomer[] }>('/api/customers/wedding');
      setWeddingCustomers(wres.customers);
    } catch {
      setWeddingCustomers([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // 세일즈팀 통합: 양쪽 모두 MICE/WEDDING 행사 등록 가능
  const allowedTypes: CustomerType[] = useMemo(() => {
    if (!user) return [];
    if (
      user.role === 'admin' ||
      user.role === 'sales_mice' ||
      user.role === 'sales_wedding'
    ) {
      return ['MICE', 'WEDDING'];
    }
    return [];
  }, [user]);

  // 검색 인덱스 — 이벤트별 (행사명/상태/구분/홀/메모/담당자), 상담은 별도 인덱스
  const eventSearchIndex = useMemo(() => {
    const map = new Map<string, SearchEntry>();
    for (const e of events) {
      map.set(
        e.id,
        buildSearchEntry([
          e.event_name,
          e.event_type,
          e.status,
          e.assigned_manager_name,
          e.memo,
          ...e.halls,
        ])
      );
    }
    return map;
  }, [events]);

  const consultSearchIndex = useMemo(() => {
    const map = new Map<string, SearchEntry>();
    for (const c of weddingCustomers) {
      map.set(
        c.id,
        buildSearchEntry([
          c.wedding_event_name,
          c.groom_name,
          c.bride_name,
          c.groom_phone,
          c.bride_phone,
          '상담',
        ])
      );
    }
    return map;
  }, [weddingCustomers]);

  // === 중복 행사 감지 — 별도 useMemo 로 분리해서 배너/모달에서도 재사용 ===
  const dupAnalysis = useMemo(() => {
    const normDt = (s: string | null | undefined) => (s || '').slice(0, 16);
    const dupKeyOf = (e: EventWithFood) =>
      `${(e.event_name || '').trim().toLowerCase()}|${normDt(e.start_datetime)}`;
    const groups = new Map<string, EventWithFood[]>();
    for (const e of events) {
      if (!e.event_name) continue;
      const k = dupKeyOf(e);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(e);
    }
    const seqOf = new Map<string, { idx: number; total: number }>();
    const dupGroups: EventWithFood[][] = [];
    for (const [, arr] of groups) {
      if (arr.length > 1) {
        arr.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        arr.forEach((ev, i) => seqOf.set(ev.id, { idx: i + 1, total: arr.length }));
        dupGroups.push(arr);
      }
    }
    if (seqOf.size > 0 && typeof window !== 'undefined') {
      console.log(
        '[캘린더] 중복 행사 감지',
        seqOf.size,
        '건 /',
        dupGroups.length,
        '그룹',
        dupGroups
      );
    }
    return { seqOf, dupGroups, totalDupEvents: seqOf.size };
  }, [events]);

  const fcEvents: EventInput[] = useMemo(() => {
    const q = debouncedQuery.trim();
    // 알려진 상태(체크박스가 있는 상태)와 알 수 없는 상태(레거시 TEN, 오타 등)를 분리.
    // 알 수 없는 상태는 체크박스가 없으니까 무조건 표시 (안 그러면 데이터에 있는데 캘린더에서 사라짐).
    const unknownStatuses = new Set<string>();
    const filtered = events.filter((e) => {
      if (filterType !== 'ALL' && e.event_type !== filterType) return false;
      const statusIsKnown = (e.status as string) in statusVisible;
      if (statusIsKnown) {
        if (!statusVisible[e.status]) return false;
      } else {
        unknownStatuses.add(String(e.status));
        // 알 수 없는 상태 — 일단 표시 (체크박스 없이 무조건 표시)
      }
      if (q) {
        const entry = eventSearchIndex.get(e.id);
        if (!entry || !fuzzyMatchEntry(entry, q)) return false;
      }
      return true;
    });
    if (unknownStatuses.size > 0 && typeof window !== 'undefined') {
      console.warn(
        '[캘린더] 알 수 없는 상태값 행사 감지 — 체크박스 없이 무조건 표시 중. 정책상 폐기된 status 또는 오타일 가능성:',
        Array.from(unknownStatuses)
      );
    }
    const out = filtered.map((ev) => {
      const conflict = detectConflict(ev as Event, filtered as Event[]);
      // 취소 계열은 모두 faded (LOS / 상담취소 / 미팅취소)
      const fcEv = toFcEvent(ev, isCancelledStatus(ev.status), conflict.level === 'hard');
      const dup = dupAnalysis.seqOf.get(ev.id);
      if (dup) {
        // 내부 식별자도 분리 — FullCalendar 가 동일 id를 자동 dedupe 하더라도 안전하게.
        // 실제 클릭 시에는 extendedProps.event.id 로 원본 행사를 식별하므로 영향 없음.
        fcEv.id = `${ev.id}__dup${dup.idx}`;
        fcEv.title = `🔴 [중복 ${dup.idx}/${dup.total}] ${fcEv.title}`;
        // 색상도 강제로 빨강 계열 — 시각적 강조
        fcEv.borderColor = '#dc2626';
        fcEv.backgroundColor = '#fee2e2';
        fcEv.textColor = '#991b1b';
      }
      return fcEv;
    });
    if (showConsultations && (filterType === 'ALL' || filterType === 'WEDDING')) {
      for (const c of weddingCustomers) {
        if (!c.desired_consultation_date) continue;
        if (q) {
          const entry = consultSearchIndex.get(c.id);
          if (!entry || !fuzzyMatchEntry(entry, q)) continue;
        }
        out.push(toFcConsultation(c));
      }
    }
    // 공휴일은 필터·검색과 무관하게 항상 표시
    out.push(...holidays);
    return out;
  }, [
    events,
    weddingCustomers,
    filterType,
    statusVisible,
    showConsultations,
    debouncedQuery,
    eventSearchIndex,
    consultSearchIndex,
    dupAnalysis,
    holidays,
  ]);

  // 보이는 범위가 바뀌면 그 범위의 한국 공휴일을 비동기 로드
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

  function handleSelect(info: DateSelectArg) {
    if (!canCreateEvent(user?.role)) {
      info.view.calendar.unselect();
      return;
    }
    const startStr = formatLocalInput(info.start);
    setDraftDate(startStr);
    setEditingEvent(null);
    setEditingFoods([]);
    setEditingLinks([]);
    setEditingInvoice(null);
    setEditingCancellation(null);
    setModalOpen(true);
    info.view.calendar.unselect();
  }

  async function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps.holiday) return; // 공휴일은 클릭 무시
    const consult = info.event.extendedProps.consultation as WeddingCustomer | undefined;
    if (consult) {
      if (canSeeWedding(user?.role)) {
        navigate(`/customers/wedding#consult-${consult.id}`);
      } else {
        alert(
          `[상담]\n행사명: ${consult.wedding_event_name}\n신랑: ${consult.groom_name} ${consult.groom_phone}\n신부: ${consult.bride_name} ${consult.bride_phone}\n희망상담일자: ${fmtDateTimeW(consult.desired_consultation_date)}`
        );
      }
      return;
    }
    const ev = info.event.extendedProps.event as Event;
    const foods = (info.event.extendedProps.foodItems as FoodItem[]) || [];
    setEditingEvent(ev);
    setEditingFoods(foods);
    setDraftDate(null);
    // 업체정보 / INVOICE / 취소 정보를 함께 fetch
    try {
      const res = await api.get<{
        customer_links: EventCustomerLink[];
        invoice: Invoice | null;
        cancellation: Cancellation | null;
      }>(`/api/events/${ev.id}`);
      setEditingLinks(res.customer_links || []);
      setEditingInvoice(res.invoice);
      setEditingCancellation(res.cancellation);
    } catch (e) {
      console.error(e);
      setEditingLinks([]);
      setEditingInvoice(null);
      setEditingCancellation(null);
    }
    setModalOpen(true);
  }

  function handleSaved(saved: EventWithFood, _links: EventCustomerLink[]) {
    void _links;
    setEvents((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx === -1) return [...prev, saved];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
  }

  // 강한 충돌 쌍 목록 — 중복 제거 (A↔B = B↔A)
  const hardConflictPairs = useMemo(() => {
    const arr = events as Event[];
    const byId = new Map(events.map((e) => [e.id, e]));
    const seen = new Set<string>();
    const pairs: Array<[EventWithFood, EventWithFood]> = [];
    for (const ev of arr) {
      const r = detectConflict(ev, arr);
      if (r.level !== 'hard') continue;
      for (const other of r.with) {
        const hardWithOther = ev.status === 'DEF' && other.status === 'DEF';
        if (!hardWithOther) continue;
        const k = [ev.id, other.id].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        const a = byId.get(ev.id);
        const b = byId.get(other.id);
        if (a && b) pairs.push([a, b]);
      }
    }
    pairs.sort((x, y) => x[0].start_datetime.localeCompare(y[0].start_datetime));
    return pairs;
  }, [events]);

  async function openEventFromList(evId: string) {
    const target = events.find((e) => e.id === evId);
    if (!target) return;
    setEditingEvent(target);
    setEditingFoods(target.food_items || []);
    setDraftDate(null);
    try {
      const res = await api.get<{
        customer_links: EventCustomerLink[];
        invoice: Invoice | null;
        cancellation: Cancellation | null;
      }>(`/api/events/${target.id}`);
      setEditingLinks(res.customer_links || []);
      setEditingInvoice(res.invoice);
      setEditingCancellation(res.cancellation);
    } catch (e) {
      console.error(e);
      setEditingLinks([]);
      setEditingInvoice(null);
      setEditingCancellation(null);
    }
    setConflictListOpen(false);
    setDupListOpen(false);
    setModalOpen(true);
  }

  // 캘린더 요약 — 공개 링크를 새 창으로 연다. 그 창의 주소를 복사해 공유하면
  // 링크만으로 로그인 없이 열람 가능. (팝업 차단 회피: 창을 먼저 열고 주소를 채움)
  async function openSummaryWindow() {
    const w = window.open('', '_blank');
    try {
      const { token } = await api.get<{ token: string }>('/api/calendar-summary/share');
      const url = `${window.location.origin}/public/summary/${token}`;
      if (w) w.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      console.error(e);
      if (w) w.close();
      // 폴백 — 사내 인증 페이지로 이동
      navigate('/calendar/summary');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl md:text-2xl font-bold">행사정보 캘린더</h1>
        <div className="flex gap-2">
          {canShareCalendar(user?.role) && (
            <button onClick={() => setShareOpen(true)} className="btn-secondary">
              🔗 월별 공유 링크
            </button>
          )}
          <button
            onClick={openSummaryWindow}
            className="btn-secondary"
            title="새 창으로 열기 — 주소를 복사해 공유하면 링크만으로 열람 가능"
          >
            📊 캘린더 요약
          </button>
          {canCreateEvent(user?.role) && (
            <button
              onClick={() => {
                setEditingEvent(null);
                setEditingFoods([]);
                setEditingLinks([]);
                setEditingInvoice(null);
                setEditingCancellation(null);
                setDraftDate(null);
                setModalOpen(true);
              }}
              className="btn-primary"
            >
              + 행사 등록
            </button>
          )}
        </div>
      </div>

      {/* 상태별 체크박스 + MICE/WEDDING 드롭다운 */}
      <div className="bg-white border rounded-lg p-3 mb-4 flex flex-wrap items-center gap-3 text-xs">
        {/* ALL 토글 — 한 번 누르면 전체 체크/해제 (상담 포함). 현재 상태에 따라 동작 결정. */}
        <button
          type="button"
          onClick={() => {
            const allOn =
              EVENT_STATUS_OPTIONS.every((s) => statusVisible[s]) && showConsultations;
            const next = !allOn;
            const map = {} as Record<EventStatus, boolean>;
            for (const s of EVENT_STATUS_OPTIONS) map[s] = next;
            setStatusVisible(map);
            setShowConsultations(next);
          }}
          className="px-2 py-0.5 rounded border text-[11px] font-semibold border-gray-300 hover:bg-gray-50 active:bg-gray-100"
          title="모든 상태 체크/해제"
        >
          ALL
        </button>
        {EVENT_STATUS_OPTIONS.map((s) => (
          <label key={s} className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={statusVisible[s]}
              onChange={(e) =>
                setStatusVisible((prev) => ({ ...prev, [s]: e.target.checked }))
              }
            />
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: STATUS_HEX[s] }}
            />
            <span className={isCancelledStatus(s) ? 'line-through text-gray-500' : ''}>{s}</span>
          </label>
        ))}
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showConsultations}
            onChange={(e) => setShowConsultations(e.target.checked)}
          />
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: CONSULT_HEX }}
          />
          <span>상담</span>
        </label>
        <span className="flex items-center gap-1.5 text-gray-400 select-none" title="공휴일은 항상 표시됩니다">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#fecaca' }} />
          <span>공휴일</span>
        </span>

        <div className="h-5 w-px bg-gray-200 mx-1" />

        <select
          className="input !py-1 !text-xs !w-auto"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as typeof filterType)}
        >
          <option value="ALL">전체</option>
          <option value="MICE">MICE만</option>
          <option value="WEDDING">WEDDING만</option>
        </select>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="검색: 행사명 / 담당자 / 구분 / 메모 / 홀 (초성 'ㅇ' 검색 가능)"
          className="input !py-1 !text-xs flex-1 min-w-[12rem]"
        />

        {dupAnalysis.dupGroups.length > 0 && (
          <button
            type="button"
            onClick={() => setDupListOpen(true)}
            className="ml-auto text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5 hover:bg-red-100 focus:outline-none"
            title="클릭하여 중복 행사 목록 보기"
          >
            🔴 중복 행사 {dupAnalysis.totalDupEvents}건 / {dupAnalysis.dupGroups.length}쌍 (같은 시간·이름)
          </button>
        )}
        {hardConflictPairs.length > 0 && (
          <button
            type="button"
            onClick={() => setConflictListOpen(true)}
            className={
              (dupAnalysis.dupGroups.length > 0 ? '' : 'ml-auto ') +
              'text-red-600 underline decoration-dotted hover:text-red-700 hover:decoration-solid focus:outline-none'
            }
            title="클릭하여 충돌 목록 보기"
          >
            ⚠️ 강한 충돌 {hardConflictPairs.length}쌍 감지됨 (DEF 같은 홀/시간 겹침)
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg p-2 md:p-4 shadow-sm overflow-x-auto">
        <FullCalendar
          ref={fcRef}
          plugins={[
            multiMonthPlugin,
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          initialView="dayGridMonth"
          locale={koLocale}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'multiMonthYear,dayGridMonth,timeGridWeek,timeGridDay,listMonth',
          }}
          buttonText={{ today: '오늘', month: '월', week: '주', day: '일', list: '리스트' }}
          views={{
            multiMonthYear: { buttonText: '연' },
            listMonth: { buttonText: '리스트' },
          }}
          height="auto"
          editable={false}
          selectable={canCreateEvent(user?.role)}
          selectMirror
          select={handleSelect}
          // 모바일: 셀당 2건까지만 표시 (그 이상은 +more, 하단 리스트로 확인 가능)
          // PC: 모든 행사 표시 (셀 자동 확장)
          dayMaxEvents={isMobile ? 2 : false}
          // 모바일에서 날짜 셀 탭 → 하단 리스트가 해당 날짜로 갱신
          dateClick={(info) => {
            if (isMobile) setSelectedDate(info.dateStr);
          }}
          events={fcEvents}
          datesSet={(arg) => setVisibleRange({ start: arg.start, end: arg.end })}
          eventClick={handleEventClick}
          eventDidMount={(arg) => {
            if (arg.event.extendedProps.holiday) {
              arg.el.title = arg.event.title;
              return;
            }
            const consult = arg.event.extendedProps.consultation as WeddingCustomer | undefined;
            if (consult) {
              arg.el.title = `[상담] ${consult.wedding_event_name}\n신랑: ${consult.groom_name} ${consult.groom_phone}\n신부: ${consult.bride_name} ${consult.bride_phone}\n희망상담일자: ${fmtDateTimeW(consult.desired_consultation_date)}\n진행단계: ${consult.progress_status}`;
              return;
            }
            const ev = arg.event.extendedProps.event as EventWithFood | undefined;
            if (!ev) return;
            const hallStr = ev.halls.join(' / ') || '홀 미지정';
            const foodStr = (ev.food_items || []).map((f) => f.menu_name).join(', ');
            const gtdC = sumField(ev, 'gtd_contract');
            const gtdF = sumField(ev, 'gtd_final');
            const expC = sumField(ev, 'exp_contract');
            const expF = sumField(ev, 'exp_final');
            // 마우스 오버 툴팁
            arg.el.title = `[${ev.status}] ${ev.event_name}\n${hallStr}\nGTD ${gtdC}/${gtdF} (계약/최종) · EXP ${expC}/${expF}\n${foodStr}`;
            // 리스트 뷰: 행사명 셀 아래에 홀·GTD/EXP·메뉴를 DOM 추가
            if (arg.view.type.startsWith('list')) {
              const titleCell = arg.el.querySelector('.fc-list-event-title');
              if (!titleCell) return;
              const extra = document.createElement('div');
              extra.style.cssText = 'margin-top:2px;line-height:1.4';
              const lines: string[] = [];
              if (ev.halls.length > 0) {
                lines.push(`<div style="font-size:11px;color:#6b7280">${ev.halls.join(' / ')}</div>`);
              }
              const hasNums = [gtdC, gtdF, expC, expF].some((v) => v !== '-');
              if (hasNums) {
                lines.push(`<div style="font-size:11px;color:#9ca3af;font-variant-numeric:tabular-nums">GTD ${gtdC} / ${gtdF} · EXP ${expC} / ${expF}</div>`);
              }
              if (foodStr) {
                lines.push(`<div style="font-size:11px;color:#9ca3af">${foodStr}</div>`);
              }
              if (lines.length > 0) {
                extra.innerHTML = lines.join('');
                titleCell.appendChild(extra);
              }
            }
          }}
          loading={(isLoading) => setLoading(isLoading)}
        />
        {loading && <div className="text-xs text-gray-400 mt-2">불러오는 중...</div>}
      </div>

      {/* 모바일 전용 — 선택한 날짜의 전체 행사·상담을 리스트로. 셀당 2건 제한으로 안 보이는 일정도 여기서 확인. */}
      {isMobile && (
        <SelectedDayList
          date={selectedDate}
          events={events}
          consultations={weddingCustomers}
          onEventClick={(ev) => {
            const fakeArg = { event: { extendedProps: { event: ev } } } as unknown as Parameters<
              typeof handleEventClick
            >[0];
            handleEventClick(fakeArg);
          }}
          onConsultClick={(c) => {
            if (canSeeWedding(user?.role)) {
              navigate(`/customers/wedding#consult-${c.id}`);
            } else {
              alert(
                `[상담]\n행사명: ${c.wedding_event_name}\n신랑: ${c.groom_name} ${c.groom_phone}\n신부: ${c.bride_name} ${c.bride_phone}\n희망상담일자: ${fmtDateTimeW(c.desired_consultation_date)}`
              );
            }
          }}
        />
      )}

      <EventFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialEvent={editingEvent}
        initialFoodItems={editingFoods}
        initialCustomerLinks={editingLinks}
        initialInvoice={editingInvoice}
        initialCancellation={editingCancellation}
        initialDate={draftDate}
        allowedTypes={allowedTypes.length ? allowedTypes : ['MICE']}
        otherEvents={events as Event[]}
        onSaved={handleSaved}
        onDeleted={(eventId) => setEvents((prev) => prev.filter((p) => p.id !== eventId))}
        onOpenFullscreen={
          editingEvent
            ? () => {
                setModalOpen(false);
                navigate(`/events/${editingEvent.id}`);
              }
            : undefined
        }
      />

      <ShareCalendarModal open={shareOpen} onClose={() => setShareOpen(false)} />

      <Modal
        open={conflictListOpen}
        onClose={() => setConflictListOpen(false)}
        // 실제 판정(conflictCheck.detectConflict)은 DEF 끼리만 hard 로 본다. 행사 상태에 TEN 은 없음.
        title={`강한 충돌 ${hardConflictPairs.length}쌍 — DEF 끼리 같은 홀/시간 겹침`}
        widthClass="max-w-4xl"
      >
        {hardConflictPairs.length === 0 ? (
          <div className="text-sm text-gray-500">현재 충돌이 없습니다.</div>
        ) : (
          <ul className="divide-y">
            {hardConflictPairs.map(([a, b], i) => (
              <li key={`${a.id}|${b.id}`} className="py-3 text-sm">
                <div className="text-xs text-gray-500 mb-1">#{i + 1}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <ConflictRow ev={a} onOpen={() => openEventFromList(a.id)} />
                  <ConflictRow ev={b} onOpen={() => openEventFromList(b.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* 중복 행사 목록 모달 — 같은 이름·시작시간으로 둘 이상 등록된 행사들 */}
      <Modal
        open={dupListOpen}
        onClose={() => setDupListOpen(false)}
        title={`🔴 중복 행사 ${dupAnalysis.dupGroups.length}쌍 — 클릭하면 해당 행사 수정 화면으로`}
        widthClass="max-w-4xl"
      >
        {dupAnalysis.dupGroups.length === 0 ? (
          <div className="text-sm text-gray-500">중복 행사가 없습니다.</div>
        ) : (
          <ul className="divide-y">
            {dupAnalysis.dupGroups.map((grp, i) => (
              <li key={grp.map((g) => g.id).join('|')} className="py-3 text-sm">
                <div className="text-xs text-gray-500 mb-2">
                  #{i + 1} · {grp[0].event_name} · {fmtDateTimeW(grp[0].start_datetime)} ({grp.length}건)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {grp.map((ev) => (
                    <ConflictRow key={ev.id} ev={ev} onOpen={() => openEventFromList(ev.id)} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

function ConflictRow({ ev, onOpen }: { ev: EventWithFood; onOpen: () => void }) {
  const halls = ev.halls.join(' / ') || '홀 미지정';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left w-full border rounded p-2 hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-300"
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
          style={{ background: STATUS_HEX[ev.status] }}
        >
          {ev.status}
        </span>
        <span className="font-medium truncate">{ev.event_name || '(이름 없음)'}</span>
      </div>
      <div className="text-xs text-gray-600">{halls}</div>
      <div className="text-xs text-gray-500">
        {formatRange(ev.start_datetime, ev.end_datetime)}
      </div>
    </button>
  );
}

function formatRange(start: string, end: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (s: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return `${fmt(start)} ~ ${fmt(end)}`;
}

function formatLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 한 행사의 메뉴 행 GTD/EXP 합계 — 없으면 옛 이벤트 단위 값 fallback, 그것도 없으면 '-'.
function sumField(
  ev: EventWithFood,
  field: 'gtd_contract' | 'gtd_final' | 'exp_contract' | 'exp_final'
): string {
  let sum = 0;
  let any = false;
  for (const it of ev.food_items || []) {
    const v = it[field];
    if (v != null) {
      sum += v;
      any = true;
    }
  }
  if (any) return String(sum);
  const legacy = (ev as unknown as Record<string, number | null>)[`food_${field}`];
  return legacy != null ? String(legacy) : '-';
}

// ===== 모바일 전용: 선택한 날짜의 행사·상담 리스트 =====
// 캘린더 셀에서 2건 제한 때문에 안 보이는 일정을 여기서 확인.
function SelectedDayList({
  date,
  events,
  consultations,
  onEventClick,
  onConsultClick,
}: {
  date: string | null;
  events: EventWithFood[];
  consultations: WeddingCustomer[];
  onEventClick: (ev: EventWithFood) => void;
  onConsultClick: (c: WeddingCustomer) => void;
}) {
  if (!date) {
    return (
      <div className="mt-3 bg-white border rounded-lg p-4 text-center text-xs text-gray-400">
        날짜를 탭하면 해당일의 모든 일정을 여기서 확인할 수 있어요.
      </div>
    );
  }
  // 행사 — 시작일이 해당 날짜인 것 + 시작 시간순
  const dayEvents = events
    .filter((e) => (e.start_datetime || '').slice(0, 10) === date)
    .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1));
  // 상담 — desired_consultation_date 가 해당 날짜인 것
  const dayConsults = consultations.filter(
    (c) => (c.desired_consultation_date || '').slice(0, 10) === date
  );

  const dayLabel = (() => {
    const d = new Date(date + 'T00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} (${days[d.getDay()]})`;
  })();

  return (
    <div className="mt-3 bg-white border rounded-lg p-3">
      <div className="text-sm font-semibold text-gray-900 mb-2">
        📅 {dayLabel} — 총 {dayEvents.length + dayConsults.length}건
      </div>
      {dayEvents.length === 0 && dayConsults.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-3">이 날짜에 등록된 일정이 없습니다.</div>
      ) : (
        <ul className="space-y-1.5">
          {dayEvents.map((ev) => {
            const color = STATUS_HEX[ev.status] || '#6b7280';
            return (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => onEventClick(ev)}
                  className="w-full text-left border rounded p-2.5 hover:bg-blue-50 active:bg-blue-100"
                >
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span className="badge bg-gray-100 text-gray-700 text-[10px]">
                      {ev.event_type}
                    </span>
                    <span className="badge text-white text-[10px]" style={{ background: color }}>
                      {ev.status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {ev.start_datetime.slice(11, 16)} ~ {ev.end_datetime.slice(11, 16)}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-gray-900 truncate">
                    {ev.event_name || '(이름 없음)'}
                  </div>
                  <div className="text-[11px] text-gray-600 mt-0.5">
                    {(ev.halls || []).join(' / ') || '홀 미지정'}
                  </div>
                </button>
              </li>
            );
          })}
          {dayConsults.map((c) => (
            <li key={`c-${c.id}`}>
              <button
                type="button"
                onClick={() => onConsultClick(c)}
                className="w-full text-left border rounded p-2.5 hover:bg-purple-50 active:bg-purple-100"
              >
                <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                  <span className="badge bg-purple-100 text-purple-800 text-[10px]">상담</span>
                  <span className="badge bg-gray-100 text-gray-700 text-[10px]">
                    {c.progress_status}
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {c.wedding_event_name || `${c.groom_name} ♥ ${c.bride_name}` || '(이름 없음)'}
                </div>
                <div className="text-[11px] text-gray-600 mt-0.5">
                  {c.groom_phone || c.bride_phone || ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
