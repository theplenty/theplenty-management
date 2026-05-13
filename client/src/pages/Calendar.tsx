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
import {
  EVENT_STATUS_OPTIONS,
  STATUS_HEX,
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

interface FetchResp {
  events: EventWithFood[];
}

const CONSULT_HEX = '#a855f7'; // 상담 — 보라

function toFcConsultation(c: WeddingCustomer): EventInput {
  const dt = c.desired_consultation_date!;
  const hasTime = dt.includes('T');
  const start = dt;
  const baseDate = hasTime ? new Date(dt) : new Date(`${dt}T00:00:00`);
  const end = hasTime ? new Date(baseDate.getTime() + 60 * 60 * 1000).toISOString() : undefined;
  return {
    id: `consult-${c.id}`,
    title: `상담 — ${c.wedding_event_name || c.groom_name || c.bride_name || '(이름없음)'}`,
    start,
    end,
    allDay: !hasTime,
    // 시간이 있는 상담은 dayGrid에서 자동으로 "● 시간 제목" 형태 (list-item),
    // 시간 없는 상담은 기본적으로 색 블록(block)으로 표시되어 1월/2월 모양이 달라짐.
    // 모든 상담을 동일한 dot 스타일로 통일하기 위해 강제 list-item.
    display: 'list-item',
    backgroundColor: CONSULT_HEX,
    borderColor: CONSULT_HEX,
    textColor: '#ffffff',
    classNames: ['fc-event-consultation'],
    extendedProps: {
      consultation: c,
    },
  };
}

function toFcEvent(ev: EventWithFood, faded: boolean, hardConflict: boolean): EventInput {
  const baseColor = STATUS_HEX[ev.status];
  const textColor = ev.status === 'LOS' ? '#7f1d1d' : ev.status === 'TEN' ? '#713f12' : '#ffffff';
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
      ev.status === 'LOS' ? 'fc-event-los' : '',
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

  // 4가지 상태 각각에 대한 표시 여부 + 상담
  const [statusVisible, setStatusVisible] = useState<Record<EventStatus, boolean>>({
    INQ: true,
    TEN: true,
    DEF: true,
    LOS: true,
  });
  const [showConsultations, setShowConsultations] = useState(true);
  const [filterType, setFilterType] = useState<'ALL' | 'MICE' | 'WEDDING'>('ALL');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editingFoods, setEditingFoods] = useState<FoodItem[]>([]);
  const [editingLinks, setEditingLinks] = useState<EventCustomerLink[]>([]);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editingCancellation, setEditingCancellation] = useState<Cancellation | null>(null);
  const [draftDate, setDraftDate] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);

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

  const fcEvents: EventInput[] = useMemo(() => {
    const filtered = events.filter((e) => {
      if (filterType !== 'ALL' && e.event_type !== filterType) return false;
      if (!statusVisible[e.status]) return false;
      return true;
    });
    const out = filtered.map((ev) => {
      const conflict = detectConflict(ev as Event, filtered as Event[]);
      return toFcEvent(ev, ev.status === 'LOS', conflict.level === 'hard');
    });
    if (showConsultations && (filterType === 'ALL' || filterType === 'WEDDING')) {
      for (const c of weddingCustomers) {
        if (c.desired_consultation_date) out.push(toFcConsultation(c));
      }
    }
    return out;
  }, [events, weddingCustomers, filterType, statusVisible, showConsultations]);

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

  const conflictCount = useMemo(() => {
    const arr = events as Event[];
    let c = 0;
    for (const ev of arr) {
      const r = detectConflict(ev, arr);
      if (r.level === 'hard') c++;
    }
    return Math.floor(c / 2);
  }, [events]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">행사정보 캘린더</h1>
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
            <span className={s === 'LOS' ? 'line-through text-gray-500' : ''}>{s}</span>
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

        {conflictCount > 0 && (
          <span className="ml-auto text-red-600">
            ⚠️ 강한 충돌 {conflictCount}쌍 감지됨 (DEF·TEN 같은 홀/시간 겹침)
          </span>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg p-4 shadow-sm">
        <FullCalendar
          ref={fcRef}
          plugins={[
            multiMonthPlugin,
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          initialView="multiMonthYear"
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
          dayMaxEvents
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
    </div>
  );
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
