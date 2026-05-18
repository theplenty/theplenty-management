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
import { detectConflict } from '../lib/conflictCheck';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { buildSearchEntry, fuzzyMatchEntry, type SearchEntry } from '../lib/koreanSearch';
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
const CONSULT_CANCELLED_HEX = '#ef4444'; // 상담취소·LOS — 빨강 (이벤트 취소 색과 동일)

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
  const baseColor = STATUS_HEX[ev.status];
  const textColor = ev.status === 'LOS' ? '#7f1d1d' : '#ffffff';
  const cancelled = isCancelledStatus(ev.status);
  return {
    id: ev.id,
    title: ev.event_name || '(이름 없음)',
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

  const fcEvents: EventInput[] = useMemo(() => {
    const q = debouncedQuery.trim();
    const filtered = events.filter((e) => {
      if (filterType !== 'ALL' && e.event_type !== filterType) return false;
      if (!statusVisible[e.status]) return false;
      if (q) {
        const entry = eventSearchIndex.get(e.id);
        if (!entry || !fuzzyMatchEntry(entry, q)) return false;
      }
      return true;
    });
    // === 중복 행사 감지 ===
    // 같은 시작시간 + 행사명(대소문자/공백 무시) 이면 중복으로 간주 — 사용자가 실수로 두 번
    // 등록한 케이스를 잡기 위해 키를 느슨하게. 홀이나 종료시간이 살짝 달라도 묶임.
    // 표시용 id 에 시퀀스 suffix + 제목 앞에 [중복 N/M] 라벨을 붙여 시각적으로 분리.
    const dupKeyOf = (e: EventWithFood) =>
      `${(e.event_name || '').trim().toLowerCase()}|${e.start_datetime}`;
    const dupGroups = new Map<string, EventWithFood[]>();
    for (const e of filtered) {
      if (!e.event_name) continue; // 이름 없는 행사는 중복 검출 대상 외
      const k = dupKeyOf(e);
      if (!dupGroups.has(k)) dupGroups.set(k, []);
      dupGroups.get(k)!.push(e);
    }
    const dupSeqOf = new Map<string, { idx: number; total: number }>();
    for (const [, arr] of dupGroups) {
      if (arr.length > 1) {
        // 생성 시간 오래된 순으로 정렬하여 #1 이 가장 먼저 만든 행사가 되도록.
        arr.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        arr.forEach((ev, i) => dupSeqOf.set(ev.id, { idx: i + 1, total: arr.length }));
      }
    }
    if (dupSeqOf.size > 0 && typeof window !== 'undefined') {
      // 디버그용 — DevTools 콘솔에서 중복 검출 결과를 사용자가 확인 가능
      console.log('[캘린더] 중복 행사 감지', dupSeqOf.size, '건', Array.from(dupSeqOf.entries()));
    }
    const out = filtered.map((ev) => {
      const conflict = detectConflict(ev as Event, filtered as Event[]);
      // 취소 계열은 모두 faded (LOS / 상담취소 / 미팅취소)
      const fcEv = toFcEvent(ev, isCancelledStatus(ev.status), conflict.level === 'hard');
      const dup = dupSeqOf.get(ev.id);
      if (dup) {
        // 내부 식별자도 분리 — FullCalendar 가 동일 id를 자동 dedupe 하더라도 안전하게.
        // 실제 클릭 시에는 extendedProps.event.id 로 원본 행사를 식별하므로 영향 없음.
        fcEv.id = `${ev.id}__dup${dup.idx}`;
        fcEv.title = `🔴 [중복 ${dup.idx}/${dup.total}] ${fcEv.title}`;
        // 색상도 강제로 빨강 계열 — 시각적 강조
        fcEv.borderColor = '#dc2626';
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
  ]);

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
    const consult = info.event.extendedProps.consultation as WeddingCustomer | undefined;
    if (consult) {
      if (canSeeWedding(user?.role)) {
        navigate(`/customers/wedding#consult-${consult.id}`);
      } else {
        alert(
          `[상담]\n행사명: ${consult.wedding_event_name}\n신랑: ${consult.groom_name} ${consult.groom_phone}\n신부: ${consult.bride_name} ${consult.bride_phone}\n희망상담일자: ${consult.desired_consultation_date}`
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
    setModalOpen(true);
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

        {hardConflictPairs.length > 0 && (
          <button
            type="button"
            onClick={() => setConflictListOpen(true)}
            className="ml-auto text-red-600 underline decoration-dotted hover:text-red-700 hover:decoration-solid focus:outline-none"
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
          // dayMaxEvents=false — 한 날짜에 행사가 여러 건이어도 모두 표시 (중복·다중 행사 누락 방지).
          // 셀이 길어지는 단점은 있지만 사용자가 모든 일정을 한눈에 볼 수 있게 우선.
          dayMaxEvents={false}
          events={fcEvents}
          eventClick={handleEventClick}
          eventDidMount={(arg) => {
            const consult = arg.event.extendedProps.consultation as WeddingCustomer | undefined;
            if (consult) {
              arg.el.title = `[상담] ${consult.wedding_event_name}\n신랑: ${consult.groom_name} ${consult.groom_phone}\n신부: ${consult.bride_name} ${consult.bride_phone}\n희망상담일자: ${consult.desired_consultation_date}\n진행단계: ${consult.progress_status}`;
              return;
            }
            const ev = arg.event.extendedProps.event as EventWithFood | undefined;
            if (!ev) return;
            const halls = ev.halls.join(' / ') || '홀 미지정';
            const foods = (ev.food_items || []).map((f) => f.menu_name).join(', ');
            // 메뉴 행 합계로 표시 — 없으면 옛 이벤트 단위 값으로 fallback
            const gtd = `${sumField(ev, 'gtd_contract')}/${sumField(ev, 'gtd_final')}`;
            const exp = `${sumField(ev, 'exp_contract')}/${sumField(ev, 'exp_final')}`;
            arg.el.title = `[${ev.status}] ${ev.event_name}\n${halls}\nGTD ${gtd} (계약/최종) · EXP ${exp}\n${foods}`;
          }}
          loading={(isLoading) => setLoading(isLoading)}
        />
        {loading && <div className="text-xs text-gray-400 mt-2">불러오는 중...</div>}
      </div>

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
      />

      <ShareCalendarModal open={shareOpen} onClose={() => setShareOpen(false)} />

      <Modal
        open={conflictListOpen}
        onClose={() => setConflictListOpen(false)}
        title={`강한 충돌 ${hardConflictPairs.length}쌍 — DEF·TEN 같은 홀/시간 겹침`}
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
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
