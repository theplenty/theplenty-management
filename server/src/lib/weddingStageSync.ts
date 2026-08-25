/**
 * 웨딩 진행단계 ↔ 행사 상태 통합. (W2, 2026-08-25)
 *
 * 왜: 같은 사실("이 딜이 어디까지 갔나")이 고객 DB와 캘린더 두 곳에 따로 저장돼 있어,
 * 직원이 두 번 적어야 했고 한 번 빼먹으면 조용히 어긋났다. 실제로 행사가 연결된
 * 웨딩 고객 220명 중 67명(30%)이 어긋나 있었다 (대부분 "홀딩 놓쳐 행사는 LOS인데
 * 고객은 상담", 그리고 "계약했는데 고객 단계가 안 올라감").
 *
 * 원칙 — 웨딩은 고객 1명 = 행사 1건(홀딩 1건·계약 1건)이라 1:1 이 성립한다:
 *  - **행사가 생기기 전**: 고객 진행단계가 진실 (신규문의 · 상담 · 상담취소)
 *  - **행사가 생긴 뒤**: 행사 상태가 진실 (INQ · DEF · LOS)
 *  → INQ·DEF·LOS 는 행사 없이 존재할 수 없는 단계다.
 *
 * 그래서 양쪽 어디서 바꾸든 반대편이 따라간다. 두 번 적을 일 자체를 없앤다.
 * 일부러 다르게 둬야 할 때(그 날짜는 놓쳤지만 다른 날짜로 재상담 중)는 고객 단계를
 * 직접 바꾸면 stage_manual_at 이 찍히고 화면에 "행사와 다름 · 수동 지정" 배지가 붙는다.
 * 조용한 불일치 대신 보이는 예외로 만든다.
 */
import { store, persistDoc } from '../store/mockStore.js';
import type { Event, EventStatus, WeddingCustomer, WeddingProgressStatus } from '../types.js';

/** 행사 상태 → 고객 진행단계. 미팅·미팅취소·시식은 딜 단계가 아니라 전파하지 않는다. */
const EVENT_TO_STAGE: Partial<Record<EventStatus, WeddingProgressStatus>> = {
  INQ: 'INQ',
  DEF: 'DEF',
  LOS: 'LOS',
  상담취소: '상담취소',
};

/** 고객 진행단계 → 행사 상태. 신규문의·상담은 행사에 대응이 없어 전파하지 않는다. */
const STAGE_TO_EVENT: Partial<Record<WeddingProgressStatus, EventStatus>> = {
  INQ: 'INQ',
  DEF: 'DEF',
  LOS: 'LOS',
  상담취소: '상담취소',
};

/** 행사 없이는 성립할 수 없는 단계 — 가예약·계약은 홀을 잡았다는 뜻이다. */
export const REQUIRES_EVENT: WeddingProgressStatus[] = ['INQ', 'DEF'];

const CANCELLED: EventStatus[] = ['LOS', '상담취소', '미팅취소'];

/** 이 고객에 연결된 웨딩 행사들 (휴지통 제외) */
export function weddingEventsOf(customerId: string): Event[] {
  const ids = new Set(
    store.event_customers.filter((l) => l.customer_id === customerId).map((l) => l.event_id)
  );
  return store.events.filter((e) => ids.has(e.id) && !e.deleted_at && e.event_type === 'WEDDING');
}

/**
 * 대표 행사 — 웨딩은 1건이 원칙이지만 취소 후 재예약 등으로 2건 이상인 고객이 실제로 있다.
 * 살아있는(취소 아닌) 행사를 우선하고, 그중 예식일이 늦은 것을 대표로 본다.
 */
export function representativeEvent(customerId: string): Event | null {
  const list = weddingEventsOf(customerId).filter((e) => EVENT_TO_STAGE[e.status]);
  if (!list.length) return null;
  const live = list.filter((e) => !CANCELLED.includes(e.status));
  const pool = live.length ? live : list;
  return [...pool].sort((a, b) => ((a.start_datetime || '') < (b.start_datetime || '') ? 1 : -1))[0];
}

export interface StageMismatch {
  eventId: string;
  eventName: string;
  eventStatus: EventStatus;
  eventDate: string;
  /** 행사 상태를 따르면 되어야 할 단계 */
  shouldBe: WeddingProgressStatus;
  /** 사람이 일부러 다르게 지정한 흔적 */
  manual: boolean;
}

/** 고객 단계가 대표 행사와 어긋나 있으면 그 내용을 돌려준다 (일치하면 null) */
export function stageMismatchOf(c: WeddingCustomer): StageMismatch | null {
  const ev = representativeEvent(c.id);
  if (!ev) return null;
  const shouldBe = EVENT_TO_STAGE[ev.status];
  if (!shouldBe || shouldBe === c.progress_status) return null;
  return {
    eventId: ev.id,
    eventName: ev.event_name || '',
    eventStatus: ev.status,
    eventDate: (ev.start_datetime || '').slice(0, 10),
    shouldBe,
    manual: !!c.stage_manual_at,
  };
}

export interface StageSyncResult {
  customerId: string;
  customerName: string;
  from: WeddingProgressStatus;
  to: WeddingProgressStatus;
}

/**
 * 행사 상태 변경 → 연결된 웨딩 고객의 진행단계를 따라 바꾼다.
 * 캘린더에서 취소·확정 처리한 것이 고객 DB 에 저절로 반영되게 하는 쪽 방향.
 */
export function syncStageFromEvent(ev: Event): StageSyncResult[] {
  if (ev.event_type !== 'WEDDING' || ev.deleted_at) return [];
  const want = EVENT_TO_STAGE[ev.status];
  if (!want) return [];

  const out: StageSyncResult[] = [];
  const custIds = new Set(
    store.event_customers.filter((l) => l.event_id === ev.id).map((l) => l.customer_id)
  );
  for (const c of store.wedding_customers) {
    if (!custIds.has(c.id) || c.deleted_at) continue;
    // 이 행사가 그 고객의 대표가 아니면(다른 살아있는 행사가 있으면) 건드리지 않는다
    const rep = representativeEvent(c.id);
    if (!rep || rep.id !== ev.id) continue;
    if (c.progress_status === want) continue;
    out.push({ customerId: c.id, customerName: c.wedding_event_name, from: c.progress_status, to: want });
    c.progress_status = want;
    // 행사 쪽에서 새로 정해줬으므로 예전 수동 지정 흔적은 지운다
    c.stage_manual_at = null;
    c.stage_manual_by_name = '';
    c.updated_at = new Date().toISOString();
    persistDoc('wedding_customers', c.id);
  }
  return out;
}

export interface EventSyncResult {
  eventId: string;
  eventName: string;
  from: EventStatus;
  to: EventStatus;
}

/**
 * 고객 진행단계 변경 → 대표 행사 상태를 따라 바꾼다.
 * 고객 DB 에서 확정·취소 처리한 것이 캘린더에 저절로 반영되게 하는 쪽 방향.
 *
 * 대응되는 행사 상태가 없는 단계(신규문의·상담)로 내리면 행사는 그대로 두고,
 * 대신 "수동 지정" 으로 표시해 화면에서 예외임이 드러나게 한다.
 */
export function syncEventFromStage(c: WeddingCustomer, userName: string): EventSyncResult | null {
  const ev = representativeEvent(c.id);
  if (!ev) return null;

  const want = STAGE_TO_EVENT[c.progress_status];
  if (!want) {
    // 신규문의·상담 — 행사에 대응 값이 없다. 행사와 달라졌다면 사람이 일부러 그런 것으로 본다.
    if (EVENT_TO_STAGE[ev.status] && EVENT_TO_STAGE[ev.status] !== c.progress_status) {
      c.stage_manual_at = new Date().toISOString();
      c.stage_manual_by_name = userName;
    }
    return null;
  }
  if (ev.status === want) {
    c.stage_manual_at = null;
    c.stage_manual_by_name = '';
    return null;
  }
  const from = ev.status;
  ev.status = want;
  c.stage_manual_at = null;
  c.stage_manual_by_name = '';
  persistDoc('events', ev.id);
  return { eventId: ev.id, eventName: ev.event_name || '', from, to: want };
}

/** 목록 화면용 — 고객 id → 대표 행사 요약 + 불일치 여부 */
export interface WeddingStageRow {
  eventId: string;
  eventName: string;
  eventStatus: EventStatus;
  eventDate: string;
  mismatch: boolean;
  shouldBe: WeddingProgressStatus | null;
  manual: boolean;
}

export function weddingStageSummary(): Record<string, WeddingStageRow> {
  const out: Record<string, WeddingStageRow> = {};
  for (const c of store.wedding_customers) {
    if (c.deleted_at) continue;
    const ev = representativeEvent(c.id);
    if (!ev) continue;
    const shouldBe = EVENT_TO_STAGE[ev.status] ?? null;
    out[c.id] = {
      eventId: ev.id,
      eventName: ev.event_name || '',
      eventStatus: ev.status,
      eventDate: (ev.start_datetime || '').slice(0, 10),
      mismatch: !!shouldBe && shouldBe !== c.progress_status,
      shouldBe,
      manual: !!c.stage_manual_at,
    };
  }
  return out;
}
