// 행사 편집기 본체 — 모달과 전용 페이지(/events/:id)가 공유하는 단일 소스.
// layout='modal' : 기존 '행사 수정' 모달 (빠른 수정)
// layout='page'  : 원스톱 워크스페이스 — 좌측 탭 본문 + 우측 액션 패널 (로드맵 A1)
// 저장·복제·삭제·충돌검사·탭 구성은 두 레이아웃이 100% 동일하게 동작한다.
import { weekdayKoOf, fmtDateTimeW } from '../lib/dateFmt';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { detectConflict } from '../lib/conflictCheck';
import {
  EVENT_STATUS_OPTIONS,
  HALL_OPTIONS,
  STATUS_DESC,
  USAGE_TYPE_DESC,
  USAGE_TYPE_OPTIONS,
  type Cancellation,
  type CustomerType,
  type Event,
  type EventCustomerLink,
  type EventStatus,
  type EventWithFood,
  type FoodItem,
  type Hall,
  type Invoice,
  type RevenueItem,
  type UsageType,
  type MiceCustomer,
  type WeddingCustomer,
  menuModeOf,
} from '../types';
import { type BeoSeedInput } from '../lib/beoDoc';
import BeoEditorModal from './BeoEditorModal';
import Modal from './Modal';
import ErrorBoundary from './ErrorBoundary';
import { Field } from './Field';
import FoodMenuInput from './FoodMenuInput';
import EventCustomerLinks from './EventCustomerLinks';
import RevenueTab, {
  type InvoiceDraft,
  type RevenueDraft,
  emptyInvoiceDraft,
  emptyRevenueDraft,
  toNum,
} from './RevenueTab';
import CancellationTab, {
  type CancellationDraft,
  emptyCancellationDraft,
} from './CancellationTab';
import FilesTab from './FilesTab';
import WeddingLandingTab from './WeddingLandingTab';
import ReviewTab from './ReviewTab';
import CollaborationTab from './CollaborationTab';
import ChangeLogPanel from './ChangeLogPanel';
import AutoExpandTextarea from './AutoExpandTextarea';
import { useAuth } from '../auth/AuthContext';
import { useActiveUsers } from '../lib/useActiveUsers';
import { canCreateEvent, canWriteReview, isAdmin } from '../auth/permissions';
import clsx from 'clsx';

type DraftFoodItem = Omit<FoodItem, 'event_id'>;
type DraftCustomerLink = Omit<EventCustomerLink, 'event_id'>;

// BEO 기능 노출 플래그 — 아직 보류(엉성). 엔티티화(로드맵 B2) 후 true 예정.
// 코드(openBeoEditor/BeoEditorModal/beoDoc)는 보존하고 진입 버튼만 숨긴다.
const BEO_ENABLED = false;

export type TabKey =
  | 'basic'
  | 'customer'
  | 'revenue'
  | 'files'
  | 'cancel'
  | 'review'
  | 'collaboration'
  | 'landing';

interface FormState {
  event_type: CustomerType;
  status: EventStatus;
  usage_type: UsageType | '';
  halls: Hall[];
  start_datetime: string;
  end_datetime: string;
  event_name: string;
  seats: number | null;
  food_gtd_contract: number | null;
  food_exp_contract: number | null;
  food_gtd_final: number | null;
  food_exp_final: number | null;
  memo: string;
  assigned_manager_id: string;
  assigned_manager_name: string;
  contract_date: string; // 계약일 (YYYY-MM-DD)
}

interface TabDef {
  key: TabKey;
  label: string;
  // 워크스페이스 우측 액션 패널에서 쓰는 짧은 설명
  hint: string;
  visible: (form: FormState) => boolean;
}

// 행사리뷰 탭은 항상 노출하고, 내부에서 권한/조건에 따라 작성/조회/안내를 분기.
const TABS: TabDef[] = [
  { key: 'basic', label: '기본정보', hint: '일시·홀·좌석·식음 메뉴', visible: () => true },
  { key: 'customer', label: '업체정보', hint: '고객 연결 · CONTACT POINT', visible: () => true },
  { key: 'revenue', label: '매출', hint: '계약금액·실매출·세부항목', visible: () => true },
  { key: 'files', label: '첨부파일', hint: '계약서·견적서·INVOICE', visible: () => true },
  { key: 'collaboration', label: '협업요청서', hint: '연회·주방 요청과 회신', visible: () => true },
  // 웨딩 가예약 고객용 공개 랜딩 링크 — WEDDING 행사에만 노출
  {
    key: 'landing',
    label: '💌 고객 랜딩',
    hint: '가예약 고객용 공개 링크 발행',
    visible: (f) => f.event_type === 'WEDDING',
  },
  { key: 'cancel', label: '취소정보', hint: '취소 사유·수수료', visible: (f) => f.status === 'LOS' },
  { key: 'review', label: '행사리뷰', hint: '연회팀 종료 후 리뷰', visible: () => true },
];

// 상태 뱃지 색 — 캘린더/목록과 같은 톤 유지
const STATUS_TONE: Record<string, string> = {
  DEF: 'bg-green-100 text-green-800',
  INQ: 'bg-yellow-100 text-yellow-800',
  LOS: 'bg-red-100 text-red-700',
};

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function emptyForm(allowed: CustomerType[], initialDate: string | null): FormState {
  const start = initialDate || `${todayStr()}T10:00`;
  const end = initialDate || `${todayStr()}T15:00`;
  return {
    event_type: allowed[0] || 'MICE',
    status: 'INQ',
    usage_type: '',
    halls: [],
    start_datetime: start,
    end_datetime: end,
    event_name: '',
    seats: null,
    food_gtd_contract: null,
    food_exp_contract: null,
    food_gtd_final: null,
    food_exp_final: null,
    memo: '',
    assigned_manager_id: '',
    assigned_manager_name: '',
    contract_date: '',
  };
}

function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface EventEditorProps {
  // 'modal' 은 기존 동작, 'page' 는 /events/:id 워크스페이스
  layout: 'modal' | 'page';
  // 모달은 open 상태, 페이지는 항상 true. false 면 초기화 effect 가 돌지 않는다.
  active: boolean;
  // 모달: 닫기 / 페이지: 뒤로가기
  onClose: () => void;
  initialEvent?: Event | null;
  initialFoodItems?: FoodItem[];
  initialCustomerLinks?: EventCustomerLink[];
  initialInvoice?: Invoice | null;
  initialCancellation?: Cancellation | null;
  initialDate?: string | null;
  allowedTypes: CustomerType[];
  otherEvents: Event[];
  onSaved: (saved: EventWithFood, links: EventCustomerLink[]) => void;
  // 관리자 삭제 콜백 — 부모가 목록에서 제거 처리. 미제공 시 삭제 버튼 미노출.
  onDeleted?: (eventId: string) => void;
  // 처음 보일 탭 — 미지정 시 '기본정보'.
  initialTab?: TabKey;
  // 페이지에서 ?tab= 동기화용
  onTabChange?: (t: TabKey) => void;
  // 모달에서만 — '⤢ 전체화면' 버튼. 미제공 시 미노출.
  onOpenFullscreen?: () => void;
}

export default function EventEditor({
  layout,
  active,
  onClose,
  initialEvent,
  initialFoodItems,
  initialCustomerLinks,
  initialInvoice,
  initialCancellation,
  initialDate,
  allowedTypes,
  otherEvents,
  onSaved,
  onDeleted,
  initialTab,
  onTabChange,
  onOpenFullscreen,
}: EventEditorProps) {
  const { user } = useAuth();
  const isPage = layout === 'page';
  // 중복안내 클릭 시 충돌 행사 상세 목록을 모달로 노출
  const [conflictDetailOpen, setConflictDetailOpen] = useState(false);
  const admin = isAdmin(user?.role);
  const activeUsers = useActiveUsers();
  // MICE 행사 담당자 드롭다운 — 기업세일즈 + 관리자만 노출
  const miceManagerOptions = useMemo(
    () => activeUsers.filter((u) => u.role === 'sales_mice' || u.role === 'admin'),
    [activeUsers]
  );
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(allowedTypes, initialDate || null));
  const [foods, setFoods] = useState<DraftFoodItem[]>([]);
  const [links, setLinks] = useState<DraftCustomerLink[]>([]);
  const [invoice, setInvoice] = useState<InvoiceDraft>(emptyInvoiceDraft());
  // 매출 — 행사 PATCH 와 별도 API(admin 전용)를 쓰므로 상태도 분리해서 관리
  const [revenue, setRevenue] = useState<RevenueDraft>(emptyRevenueDraft());
  const [revenueItems, setRevenueItems] = useState<RevenueItem[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [revenueLoaded, setRevenueLoaded] = useState(false);
  // 대관료 출처 (S2 · W1) — 계약금이 MICE 문의 / 웨딩 예식후보 중 어디서 흘러왔는지 매출탭에 밝힌다
  const [depositSource, setDepositSource] = useState<{
    type?: 'mice' | 'wedding';
    customerId: string;
    customerName: string;
    inquiryNo: number;
    amount: number | null;
    pushedAt: string | null;
  } | null>(null);
  const [cancellation, setCancellation] = useState<CancellationDraft>(emptyCancellationDraft());
  const [saving, setSaving] = useState(false);
  const [beoBusy, setBeoBusy] = useState(false);
  const [beoOpen, setBeoOpen] = useState(false);
  const [beoSeed, setBeoSeed] = useState<BeoSeedInput | null>(null);
  const [beoPayload, setBeoPayload] = useState<string | undefined>(undefined);
  const [tab, setTabState] = useState<TabKey>(initialTab || 'basic');

  const isEdit = !!initialEvent;

  function setTab(next: TabKey) {
    setTabState(next);
    onTabChange?.(next);
  }

  useEffect(() => {
    if (!active) return;
    if (initialEvent) {
      setForm({
        event_type: initialEvent.event_type,
        status: initialEvent.status,
        usage_type: initialEvent.usage_type || '',
        halls: initialEvent.halls,
        start_datetime: toLocalInput(initialEvent.start_datetime),
        end_datetime: toLocalInput(initialEvent.end_datetime),
        event_name: initialEvent.event_name,
        seats: initialEvent.seats,
        food_gtd_contract: initialEvent.food_gtd_contract,
        food_exp_contract: initialEvent.food_exp_contract,
        food_gtd_final: initialEvent.food_gtd_final,
        food_exp_final: initialEvent.food_exp_final,
        memo: initialEvent.memo || '',
        assigned_manager_id: initialEvent.assigned_manager_id || '',
        assigned_manager_name: initialEvent.assigned_manager_name || '',
        contract_date:
          ((initialEvent as unknown as Record<string, unknown>).contract_date as string) || '',
      });
      setBeoPayload(initialEvent.beo_payload);
      setFoods(
        (initialFoodItems || []).map((f) => ({
          id: f.id,
          menu_name: f.menu_name,
          gtd_contract: f.gtd_contract,
          exp_contract: f.exp_contract,
          gtd_final: f.gtd_final,
          exp_final: f.exp_final,
          time_label: f.time_label,
          service_time: f.service_time,
          quantity: f.quantity,
          memo: f.memo,
        }))
      );
      setLinks(
        (initialCustomerLinks || []).map((l) => ({
          id: l.id,
          customer_id: l.customer_id,
          customer_role: l.customer_role,
          is_contact_point: l.is_contact_point,
          contact_point_contact_id: l.contact_point_contact_id || '',
        }))
      );
      if (initialInvoice) {
        const { id: _i, event_id: _e, ...rest } = initialInvoice;
        void _i;
        void _e;
        setInvoice(rest);
      } else {
        setInvoice(emptyInvoiceDraft());
      }
      if (initialCancellation) {
        const { id: _i, event_id: _e, ...rest } = initialCancellation;
        void _i;
        void _e;
        setCancellation(rest);
      } else {
        setCancellation(emptyCancellationDraft());
      }
    } else {
      setForm(emptyForm(allowedTypes, initialDate || null));
      setFoods([]);
      setLinks([]);
      setInvoice(emptyInvoiceDraft());
      setCancellation(emptyCancellationDraft());
      setBeoPayload(undefined);
    }
    // 매출은 별도 API 로 가져온다 — 다시 열 때마다 초기화
    setRevenue(emptyRevenueDraft());
    setRevenueLoaded(false);
  }, [
    active,
    initialEvent,
    initialFoodItems,
    initialCustomerLinks,
    initialInvoice,
    initialCancellation,
    initialDate,
    allowedTypes,
  ]);

  // 탭 초기화는 '다른 행사를 열었을 때'만. 저장 후 부모가 데이터를 갱신해도
  // 보고 있던 탭이 기본정보로 튀지 않도록 위 effect 와 분리한다.
  useEffect(() => {
    if (!active) return;
    setTabState(initialTab || 'basic');
  }, [active, initialEvent?.id, initialTab]);

  // 매출 조회 — 모달은 탭을 처음 열 때만(lazy), 페이지는 우측 요약에 쓰므로 바로.
  useEffect(() => {
    const want = isPage || tab === 'revenue';
    if (!want || revenueLoaded || !initialEvent?.id) return;
    let cancelled = false;
    setRevenueLoading(true);
    setRevenueLoaded(true);
    api
      .get<{ source: typeof depositSource }>(`/api/events/${initialEvent.id}/deposit-source`)
      .then((r) => { if (!cancelled) setDepositSource(r.source); })
      .catch(() => { /* 출처 표시는 부가 정보 — 실패해도 매출탭은 그대로 */ });
    api
      .get<{
        event: Event;
        revenue_lines: { revenue_item_id: string; amount: number | null }[];
        revenue_items: RevenueItem[];
      }>(`/api/events/${initialEvent.id}/revenue`)
      .then((res) => {
        if (cancelled) return;
        const ev = res.event as unknown as Record<string, unknown>;
        const amounts: Record<string, string> = {};
        for (const l of res.revenue_lines || []) {
          if (l.amount != null) amounts[l.revenue_item_id] = Number(l.amount).toLocaleString('ko-KR');
        }
        const numStr = (v: unknown) =>
          typeof v === 'number' && v ? Number(v).toLocaleString('ko-KR') : '';
        setRevenueItems(res.revenue_items || []);
        setRevenue({
          contract_amount: numStr(ev.contract_amount),
          sales_total_amount: numStr(ev.sales_total_amount),
          // 서버는 비율(0.07)로 보관 — 화면은 % 로 표시
          discount_rate:
            typeof ev.discount_rate === 'number' && ev.discount_rate
              ? String(Number((ev.discount_rate * 100).toFixed(2)))
              : '',
          discount_reason: (ev.discount_reason as string) || '',
          gateway_fee: numStr(ev.gateway_fee),
          amounts,
        });
      })
      .catch(() => {
        if (!cancelled) setRevenueLoaded(false); // 실패 시 재시도 가능하게
      })
      .finally(() => {
        if (!cancelled) setRevenueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPage, tab, revenueLoaded, initialEvent?.id]);

  const conflict = useMemo(() => {
    if (!form.start_datetime || !form.end_datetime || form.halls.length === 0) {
      return { level: 'none' as const, with: [] };
    }
    const fake: Event = {
      id: initialEvent?.id || 'draft',
      event_type: form.event_type,
      created_by: '',
      created_by_name: '',
      status: form.status,
      usage_type: form.usage_type || null,
      halls: form.halls,
      start_datetime: form.start_datetime,
      end_datetime: form.end_datetime,
      event_name: form.event_name,
      seats: form.seats,
      food_gtd_contract: form.food_gtd_contract,
      food_exp_contract: form.food_exp_contract,
      food_gtd_final: form.food_gtd_final,
      food_exp_final: form.food_exp_final,
      memo: form.memo,
      contract_date: form.contract_date || null,
      assigned_manager_id: form.assigned_manager_id,
      assigned_manager_name: form.assigned_manager_name,
      created_at: '',
      updated_at: '',
    };
    return detectConflict(fake, otherEvents);
  }, [form, otherEvents, initialEvent]);

  function toggleHall(h: Hall) {
    setForm((prev) =>
      prev.halls.includes(h)
        ? { ...prev, halls: prev.halls.filter((x) => x !== h) }
        : { ...prev, halls: [...prev.halls, h] }
    );
  }

  // event_type을 바꾸면 연결된 customer_links를 비워야 함 (서로 다른 DB)
  function changeEventType(t: CustomerType) {
    if (t === form.event_type) return;
    if (links.length > 0) {
      if (!confirm('구분을 변경하면 현재 연결된 업체정보가 모두 초기화됩니다. 계속하시겠습니까?'))
        return;
      setLinks([]);
    }
    setForm((p) => ({ ...p, event_type: t }));
  }

  async function save() {
    if (!form.event_name.trim()) {
      alert('행사명은 필수입니다.');
      setTab('basic');
      return;
    }
    if (form.halls.length === 0) {
      if (!confirm('사용홀이 선택되지 않았습니다. 그래도 저장하시겠습니까?')) return;
    }
    if (form.start_datetime > form.end_datetime) {
      alert('종료일시는 시작일시보다 늦어야 합니다.');
      setTab('basic');
      return;
    }
    if (conflict.level === 'hard') {
      const names = conflict.with.map((c) => c.event_name).join(', ');
      if (!confirm(`같은 홀/시간에 DEF 행사와 겹칩니다:\n  ${names}\n그래도 저장하시겠습니까?`))
        return;
    }

    setSaving(true);
    try {
      const payload = {
        event_type: form.event_type,
        status: form.status,
        usage_type: form.usage_type || null,
        halls: form.halls,
        start_datetime: form.start_datetime,
        end_datetime: form.end_datetime,
        event_name: form.event_name,
        seats: form.seats,
        food_gtd_contract: form.food_gtd_contract,
        food_exp_contract: form.food_exp_contract,
        food_gtd_final: form.food_gtd_final,
        food_exp_final: form.food_exp_final,
        memo: form.memo,
        contract_date: form.contract_date || null,
        // WEDDING 은 서버에서 연결된 고객의 담당지배인으로 덮어쓰므로 그대로 전송해도 무해.
        assigned_manager_id: form.assigned_manager_id,
        assigned_manager_name: form.assigned_manager_name,
        food_items: foods.map((f) => ({
          // id 가 없는 레코드(과거 일괄 스크립트가 id 필드 없이 넣은 건)에도 죽지 않게.
          // 빈 id 는 서버가 새로 발급한다 — 저장 자체가 막히는 것보다 낫다.
          id: !f.id || f.id.startsWith('tmp_') ? undefined : f.id,
          menu_name: f.menu_name,
          gtd_contract: f.gtd_contract,
          exp_contract: f.exp_contract,
          gtd_final: f.gtd_final,
          exp_final: f.exp_final,
          time_label: f.time_label,
          service_time: f.service_time,
          quantity: f.quantity,
          memo: f.memo,
        })),
        customer_links: links.map((l) => ({
          id: !l.id || l.id.startsWith('tmp_') ? undefined : l.id,
          customer_id: l.customer_id,
          customer_role: l.customer_role,
          is_contact_point: l.is_contact_point,
          contact_point_contact_id: l.contact_point_contact_id || '',
        })),
        invoice,
        // 상태가 LOS일 때만 cancellation 전송. 그 외엔 null로 전송 → 서버가 정리
        cancellation: form.status === 'LOS' ? cancellation : null,
      };

      let res: {
        event: Event;
        food_items: FoodItem[];
        customer_links: EventCustomerLink[];
        invoice: Invoice | null;
        cancellation: Cancellation | null;
      };
      if (isEdit) {
        res = await api.patch(`/api/events/${initialEvent!.id}`, payload);
      } else {
        res = await api.post('/api/events', payload);
      }

      // 매출은 권한(admin)이 다른 별도 API. 실제로 조회한 경우에만 저장한다
      // (조회 전 상태의 빈 draft 를 그대로 PUT 하면 기존 매출을 지워버리므로).
      if (admin && revenueLoaded && !revenueLoading) {
        const pct = revenue.discount_rate ? Number(revenue.discount_rate) : null;
        try {
          const saved = await api.put<{ event: Event }>(`/api/events/${res.event.id}/revenue`, {
            contract_amount: toNum(revenue.contract_amount) || null,
            sales_total_amount: toNum(revenue.sales_total_amount) || null,
            // 화면은 % — 서버는 비율(0.07)로 보관
            discount_rate: pct != null && !Number.isNaN(pct) ? pct / 100 : null,
            discount_reason: revenue.discount_reason,
            gateway_fee: toNum(revenue.gateway_fee) || null,
            lines: revenueItems
              .map((it) => ({ revenue_item_id: it.id, amount: toNum(revenue.amounts[it.id] || '') }))
              .filter((l) => l.amount > 0),
          });
          if (saved?.event) res.event = saved.event;
        } catch (e) {
          console.error(e);
          alert('행사는 저장되었지만 매출 저장에 실패했습니다. 매출 탭에서 다시 시도해 주세요.');
        }
      }

      onSaved({ ...res.event, food_items: res.food_items }, res.customer_links);
      // 모달은 저장 후 닫는다. 페이지는 계속 작업할 수 있게 그대로 머문다.
      if (!isPage) onClose();
      alert('저장되었습니다.');
    } catch (e) {
      alert('저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  // 행사 복제 — 반복/유사 행사 재입력 감소. 서버가 기본정보+식음+업체를 복사(상태 INQ).
  async function duplicateEvent() {
    if (!initialEvent) return;
    if (
      !confirm(
        `[${initialEvent.event_name || '(이름 없음)'}] 행사를 복제합니다.\n` +
          `· 기본정보·식음 메뉴·업체 연결이 복사됩니다 (상태는 INQ로 초기화).\n` +
          `· INVOICE·취소·리뷰·첨부·BEO는 복사되지 않습니다.\n` +
          `복제 후 새로 생긴 '(복사)' 행사를 열어 날짜 등을 수정하세요. 계속하시겠습니까?`
      )
    )
      return;
    setDuplicating(true);
    try {
      const res = await api.post<{
        event: Event;
        food_items: FoodItem[];
        customer_links: EventCustomerLink[];
      }>(`/api/events/${initialEvent.id}/duplicate`, {});
      onSaved({ ...res.event, food_items: res.food_items }, res.customer_links);
      if (!isPage) onClose();
      alert(`복제되었습니다: ${res.event.event_name}\n캘린더/목록에서 열어 날짜·정보를 수정하세요.`);
    } catch (e) {
      alert('복제 실패');
      console.error(e);
    } finally {
      setDuplicating(false);
    }
  }

  async function deleteEvent() {
    if (!initialEvent || !onDeleted) return;
    if (
      !confirm(
        `[${initialEvent.event_name}] 행사를 휴지통으로 이동합니다.\n식음 메뉴, 업체 연결, INVOICE, 첨부파일, 행사리뷰는 그대로 보존되며 복구 시 모두 함께 돌아옵니다.\n관리자가 /admin/trash 에서 복구하거나 영구 삭제할 수 있습니다.\n계속하시겠습니까?`
      )
    )
      return;
    setDeleting(true);
    try {
      await api.delete(`/api/events/${initialEvent.id}`);
      onDeleted(initialEvent.id);
      onClose();
    } catch (e) {
      alert('삭제 실패 (관리자 권한이 필요합니다)');
      console.error(e);
    } finally {
      setDeleting(false);
    }
  }

  // 일시 → 날짜/시간 분리 포맷 (BEO 헤더 시드용)
  function fmtDate(local: string): string {
    if (!local) return '';
    const d = new Date(local);
    if (isNaN(d.getTime())) return local;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)})`;
  }
  function fmtTime(local: string): string {
    if (!local) return '';
    const d = new Date(local);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // BEO 편집기 열기 — 행사/식음/업체 데이터로 시드를 구성한 뒤 모달을 연다.
  // 저장(PATCH)에는 행사 id가 필요하므로 수정(저장된) 행사에서만 노출.
  async function openBeoEditor() {
    if (!initialEvent) return;
    if (!form.event_name.trim()) {
      alert('행사명을 입력/저장한 뒤 BEO를 작성하세요.');
      setTab('basic');
      return;
    }
    setBeoBusy(true);
    try {
      let accountName = form.event_name;
      let organizer = '';
      let onsite = '';
      // CONTACT POINT(없으면 첫 업체) 담당자 해석을 위해 고객 목록 조회. 실패해도 시드는 진행.
      if (links.length > 0) {
        try {
          const url = form.event_type === 'MICE' ? '/api/customers/mice' : '/api/customers/wedding';
          const res = await api.get<{ customers: (MiceCustomer | WeddingCustomer)[] }>(url);
          const byId = new Map(res.customers.map((c) => [c.id, c]));
          const cp = links.find((l) => l.is_contact_point) || links[0];
          const c = byId.get(cp.customer_id);
          if (c) {
            if (c.customer_type === 'MICE') {
              accountName = c.organization_name || form.event_name;
              const all = c.inquiries.flatMap((i) => i.contacts);
              const ct = all.find((x) => x.id === cp.contact_point_contact_id) || all[0];
              organizer = ct?.name || '';
              onsite = ct?.phone || '';
            } else {
              accountName = c.wedding_event_name || form.event_name;
              const isBride = cp.contact_point_contact_id === 'bride';
              organizer =
                (isBride ? c.bride_name : c.groom_name) || c.bride_name || c.groom_name || '';
              onsite = (isBride ? c.bride_phone : c.groom_phone) || '';
            }
          }
        } catch (e) {
          console.error('[BEO] 고객 조회 실패', e);
        }
      }

      const seed: BeoSeedInput = {
        template: form.event_type,
        account_name: accountName,
        organizer_name: organizer,
        onsite_contact: onsite,
        catering_manager: form.assigned_manager_name,
        event_date: fmtDate(form.start_datetime),
        event_time: `${fmtTime(form.start_datetime)} - ${fmtTime(form.end_datetime)}`,
        halls_text: form.halls.join(', '),
        payment_method: invoice.payment_status || '',
        customer_type: '',
        signboard: form.event_name,
        foods: foods.map((f) => ({
          menu_name: f.menu_name,
          mode: menuModeOf(f.menu_name),
          time: f.time_label || f.service_time || '',
          gtd:
            f.gtd_final != null
              ? String(f.gtd_final)
              : f.gtd_contract != null
                ? String(f.gtd_contract)
                : '',
          exp:
            f.exp_final != null
              ? String(f.exp_final)
              : f.exp_contract != null
                ? String(f.exp_contract)
                : '',
          quantity: f.quantity != null ? String(f.quantity) : '',
          memo: f.memo || '',
        })),
      };
      setBeoSeed(seed);
      setBeoOpen(true);
    } finally {
      setBeoBusy(false);
    }
  }

  const visibleTabs = TABS.filter((t) => t.visible(form));

  // ── 액션 버튼 (모달 footer / 페이지 헤더 공용) ──────────────────────────
  const actionButtons = (
    <>
      {/* 수정 모드 + onDeleted 콜백 + 작성 권한자만 노출. 뷰어(banquet/kitchen/h_kitchen) 제외. */}
      {isEdit && onDeleted && canCreateEvent(user?.role) && (
        <button
          onClick={deleteEvent}
          disabled={deleting || saving}
          className={clsx('btn-danger', !isPage && 'mr-auto')}
          title="휴지통으로 이동 (복구 가능)"
        >
          {deleting ? '삭제중...' : '🗑 행사 삭제'}
        </button>
      )}
      {/* BEO(행사 운영 지시서) — 자동 시드 + 담당자 수동 편집. 저장이 필요해 수정 모드에서만 노출.
          현재 BEO_ENABLED=false 로 노출 보류 (로드맵 B2 엔티티화 후 활성화). */}
      {isEdit && BEO_ENABLED && (
        <button
          onClick={openBeoEditor}
          disabled={beoBusy || saving || deleting}
          className="btn-secondary"
          title="행사·식음·업체 데이터로 BEO 초안을 만들고 직접 편집/저장합니다 (인쇄/PDF)"
        >
          {beoBusy ? 'BEO 여는 중...' : '📄 BEO'}
        </button>
      )}
      {/* 행사 복제 — 반복·유사 행사 재입력 감소. 수정 모드 + 작성권한자만. */}
      {isEdit && canCreateEvent(user?.role) && (
        <button
          onClick={duplicateEvent}
          disabled={duplicating || saving || deleting}
          className="btn-secondary"
          title="이 행사를 복제 (기본정보·식음·업체 복사, 상태 INQ)"
        >
          {duplicating ? '복제중...' : '📋 복제'}
        </button>
      )}
      {/* 모달 → 전용 페이지(워크스페이스)로 확대 */}
      {!isPage && isEdit && onOpenFullscreen && (
        <button
          onClick={onOpenFullscreen}
          className="btn-secondary"
          title="이 행사를 전용 페이지에서 크게 보기 (링크 공유 가능)"
        >
          ⤢ 전체화면
        </button>
      )}
      <button onClick={onClose} className="btn-secondary">
        {isPage ? '← 목록으로' : '취소'}
      </button>
      <button onClick={save} disabled={saving || deleting} className="btn-primary">
        {saving ? '저장중...' : '저장'}
      </button>
    </>
  );

  // ── 공통 본문 (충돌 배너 + 탭 헤더 + 탭 본문 + 수정이력) ────────────────
  const body = (
    <>
      {/* 충돌 경고 (모든 탭에서 보이도록 상단 고정) — 클릭하면 충돌 행사 상세 모달 */}
      {conflict.level !== 'none' && (
        <button
          type="button"
          onClick={() => setConflictDetailOpen(true)}
          className={
            'w-full text-left mb-3 rounded-md p-2.5 text-xs border hover:brightness-95 cursor-pointer ' +
            (conflict.level === 'hard'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-yellow-50 border-yellow-200 text-yellow-800')
          }
          title="클릭하여 충돌 행사 상세 보기"
        >
          <strong>
            {conflict.level === 'hard' ? '⚠️ 강한 충돌' : 'ℹ️ 중복 안내'} ({conflict.with.length}건) —{' '}
          </strong>
          같은 홀·시간 행사: {conflict.with.map((c) => `[${c.status}] ${c.event_name}`).join(', ')}
          <span className="ml-2 underline decoration-dotted">자세히 보기</span>
        </button>
      )}

      {/* 탭 헤더 */}
      <div className="flex border-b mb-4 -mt-1 overflow-x-auto">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition',
              tab === t.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 본문 — 각 탭을 ErrorBoundary 로 격리해 어느 탭이 깨지는지 진단 + 다른 탭은 보존 */}
      {tab === 'basic' && (
        <ErrorBoundary title="행사정보 탭에서 오류가 발생했습니다">
          <BasicInfoTab
            form={form}
            setForm={setForm}
            foods={foods}
            setFoods={setFoods}
            isEdit={isEdit}
            allowedTypes={allowedTypes}
            changeEventType={changeEventType}
            toggleHall={toggleHall}
            initialEvent={initialEvent || null}
            authorName={user?.name || ''}
            managerOptions={miceManagerOptions}
          />
        </ErrorBoundary>
      )}
      {tab === 'customer' && (
        <ErrorBoundary title="업체정보 탭에서 오류가 발생했습니다">
          <EventCustomerLinks eventType={form.event_type} links={links} onChange={setLinks} />
        </ErrorBoundary>
      )}
      {tab === 'revenue' && (
        <ErrorBoundary title="매출 탭에서 오류가 발생했습니다">
          <RevenueTab
            invoice={invoice}
            onInvoiceChange={setInvoice}
            revenue={revenue}
            onRevenueChange={setRevenue}
            revenueItems={revenueItems}
            canWriteRevenue={admin}
            isNewEvent={!isEdit}
            loading={revenueLoading}
            depositSource={depositSource}
          />
        </ErrorBoundary>
      )}
      {tab === 'files' && (
        <ErrorBoundary title="첨부파일 탭에서 오류가 발생했습니다">
          <FilesTab
            eventId={initialEvent?.id || null}
            canWrite={canCreateEvent(user?.role)}
            eventType={initialEvent?.event_type ?? form.event_type}
          />
        </ErrorBoundary>
      )}
      {tab === 'landing' && (
        <ErrorBoundary title="고객 랜딩 탭에서 오류가 발생했습니다">
          <WeddingLandingTab
            eventId={initialEvent?.id || null}
            startDatetime={form.start_datetime}
            customerIds={[...links]
              .sort((a, b) => Number(b.is_contact_point) - Number(a.is_contact_point))
              .map((l) => l.customer_id)}
            canManage={user?.role === 'admin' || user?.role === 'sales_wedding'}
          />
        </ErrorBoundary>
      )}
      {tab === 'collaboration' && (
        <ErrorBoundary title="협업요청서 탭에서 오류가 발생했습니다">
          <CollaborationTab
            eventId={initialEvent?.id || null}
            defaultEventName={form.event_name}
            defaultEventDate={form.start_datetime}
          />
        </ErrorBoundary>
      )}
      {tab === 'cancel' && form.status === 'LOS' && (
        <ErrorBoundary title="취소정보 탭에서 오류가 발생했습니다">
          <CancellationTab draft={cancellation} onChange={setCancellation} />
        </ErrorBoundary>
      )}
      {tab === 'review' && (
        <ErrorBoundary title="행사리뷰 탭에서 오류가 발생했습니다">
          <ReviewTab
            eventId={initialEvent?.id || null}
            canWrite={canWriteReview(user?.role)}
            eventStartDatetime={initialEvent?.start_datetime || form.start_datetime}
            eventStatus={form.status}
          />
        </ErrorBoundary>
      )}

      {/* 수정 이력 — 모든 탭 하단에 노출. 다시 열 때 fresh fetch. */}
      <ErrorBoundary title="수정 이력 패널에서 오류가 발생했습니다">
        <ChangeLogPanel entityType="event" entityId={initialEvent?.id || null} />
      </ErrorBoundary>
    </>
  );

  // ── 부속 모달 (충돌 상세 / BEO) — 두 레이아웃 공통 ──────────────────────
  const subModals = (
    <>
      <Modal
        open={conflictDetailOpen}
        onClose={() => setConflictDetailOpen(false)}
        title={
          conflict.level === 'hard'
            ? `⚠️ 강한 충돌 — ${conflict.with.length}건`
            : `중복 안내 — ${conflict.with.length}건`
        }
        widthClass="max-w-3xl"
        footer={
          <button onClick={() => setConflictDetailOpen(false)} className="btn-primary">
            닫기
          </button>
        }
      >
        {conflict.with.length === 0 ? (
          <div className="text-sm text-gray-500">충돌 행사가 없습니다.</div>
        ) : (
          <ul className="divide-y">
            {conflict.with.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="badge bg-gray-100 text-gray-700">{c.event_type}</span>
                  <span className="badge bg-blue-100 text-blue-700">{c.status}</span>
                  <span className="font-medium text-gray-900">{c.event_name || '(이름 없음)'}</span>
                </div>
                <div className="text-xs text-gray-600">
                  {c.halls.join(' / ') || '홀 미지정'} · {fmtDateTimeW(c.start_datetime)} ~{' '}
                  {fmtDateTimeW(c.end_datetime)}
                </div>
                {c.assigned_manager_name && (
                  <div className="text-xs text-gray-500">담당: {c.assigned_manager_name}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* BEO 편집기 — 자동 시드 + 수동 편집 + 저장(PATCH). 저장된 행사에서만 사용. */}
      {beoOpen && initialEvent && beoSeed && (
        <BeoEditorModal
          open={beoOpen}
          onClose={() => setBeoOpen(false)}
          eventId={initialEvent.id}
          canWrite={canCreateEvent(user?.role)}
          seedInput={beoSeed}
          savedPayload={beoPayload}
          onSaved={(payload) => setBeoPayload(payload)}
          editorName={user?.name || ''}
        />
      )}
    </>
  );

  // ── 모달 레이아웃 ───────────────────────────────────────────────────────
  if (!isPage) {
    return (
      <>
        {body}
        {/* Modal 의 footer 슬롯 대신 본문 하단에 sticky 로 고정 — 페이지와 코드 경로를 하나로 유지 */}
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 px-5 py-3 border-t bg-gray-50 flex justify-end gap-2">
          {actionButtons}
        </div>
        {subModals}
      </>
    );
  }

  // ── 페이지(워크스페이스) 레이아웃 ───────────────────────────────────────
  const summary = revenueSummary(revenue);
  return (
    <div>
      {/* 헤더 — 행사 한 줄 요약 + 액션. 스크롤해도 상단 고정. */}
      <div className="sticky top-0 z-20 bg-white border rounded-lg px-4 py-3 mb-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={clsx(
                  'badge',
                  STATUS_TONE[form.status] || 'bg-gray-100 text-gray-700'
                )}
              >
                {STATUS_DESC[form.status] || form.status}
              </span>
              <span className="badge bg-gray-100 text-gray-700">{form.event_type}</span>
              <h1 className="text-lg font-semibold text-gray-900 truncate">
                {form.event_name || '(이름 없음)'}
              </h1>
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {fmtDateTimeW(form.start_datetime)} ~ {form.end_datetime.slice(11, 16)}
              {form.halls.length > 0 && ` · ${form.halls.join(' / ')}`}
              {form.seats != null && ` · ${form.seats}석`}
              {form.assigned_manager_name && ` · 담당 ${form.assigned_manager_name}`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">{actionButtons}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* 좌측 — 탭 본문 */}
        <div className="min-w-0 bg-white border rounded-lg p-4">{body}</div>

        {/* 우측 — 액션 패널 */}
        <aside className="lg:sticky lg:top-24 space-y-3">
          <PanelCard title="매출 요약">
            {revenueLoading ? (
              <div className="text-xs text-gray-400">불러오는 중...</div>
            ) : (
              <dl className="text-xs space-y-1.5">
                <PanelRow label="계약금액" value={summary.contract} />
                <PanelRow label="실매출" value={summary.sales} />
                <PanelRow label="할인율" value={summary.discount} />
                <PanelRow label="세부항목 합" value={summary.lines} />
              </dl>
            )}
            <button
              type="button"
              onClick={() => setTab('revenue')}
              className="mt-2 w-full text-xs text-blue-700 hover:underline text-left"
            >
              매출 탭에서 수정 →
            </button>
          </PanelCard>

          <PanelCard title="바로가기">
            <div className="space-y-1">
              {visibleTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={clsx(
                    'w-full text-left px-2 py-1.5 rounded-md text-xs transition',
                    tab === t.key
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : 'hover:bg-gray-50 text-gray-700'
                  )}
                >
                  <div>{t.label}</div>
                  <div className="text-[11px] text-gray-400">{t.hint}</div>
                </button>
              ))}
            </div>
          </PanelCard>

          <PanelCard title="행사 정보">
            <dl className="text-xs space-y-1.5">
              <PanelRow label="계약일" value={form.contract_date || '-'} />
              <PanelRow
                label="이용시간"
                value={form.usage_type ? USAGE_TYPE_DESC[form.usage_type] : '-'}
              />
              <PanelRow label="식음 메뉴" value={`${foods.length}건`} />
              <PanelRow label="연결 업체" value={`${links.length}곳`} />
              <PanelRow label="작성자" value={initialEvent?.created_by_name || '-'} />
            </dl>
          </PanelCard>
        </aside>
      </div>

      {subModals}
    </div>
  );
}

// 우측 패널에 보여줄 매출 요약값 — 입력 문자열(콤마 포함)을 그대로 표시용으로 정리.
function revenueSummary(r: RevenueDraft) {
  const lineSum = Object.values(r.amounts || {}).reduce((s, v) => s + toNum(v), 0);
  const won = (n: number) => (n > 0 ? `${n.toLocaleString('ko-KR')}원` : '-');
  return {
    contract: won(toNum(r.contract_amount)),
    sales: won(toNum(r.sales_total_amount)),
    discount: r.discount_rate ? `${r.discount_rate}%` : '-',
    lines: won(lineSum),
  };
}

function PanelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-gray-500 shrink-0">{label}</dt>
      <dd className="text-gray-900 font-medium text-right truncate">{value}</dd>
    </div>
  );
}

interface BasicProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  foods: DraftFoodItem[];
  setFoods: React.Dispatch<React.SetStateAction<DraftFoodItem[]>>;
  isEdit: boolean;
  allowedTypes: CustomerType[];
  changeEventType: (t: CustomerType) => void;
  toggleHall: (h: Hall) => void;
  initialEvent: Event | null;
  authorName: string;
  managerOptions: Array<{ id: string; name: string }>;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BasicInfoTab({
  form,
  setForm,
  foods,
  setFoods,
  isEdit,
  allowedTypes,
  changeEventType,
  toggleHall,
  initialEvent,
  authorName,
  managerOptions,
}: BasicProps) {
  const isWedding = form.event_type === 'WEDDING';

  // 이용시간 변경 시 — AD 선택하면 09:00~18:00 으로 시간만 자동 세팅 (날짜는 유지).
  function changeUsageType(next: UsageType | '') {
    if (next === 'AD' && form.start_datetime && form.end_datetime) {
      const startDate = form.start_datetime.slice(0, 10);
      const endDate = form.end_datetime.slice(0, 10) || startDate;
      setForm({
        ...form,
        usage_type: next,
        start_datetime: `${startDate}T09:00`,
        end_datetime: `${endDate}T18:00`,
      });
      return;
    }
    setForm({ ...form, usage_type: next });
  }

  return (
    <>
      <Section title="A. 행사 기본정보">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1) 상태 + 행사명 (한 줄 — 캘린더뷰의 [상태] 행사명 순서와 동일하게 상태를 왼쪽에) */}
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
            <Field label="상태" required>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as EventStatus })}
              >
                {EVENT_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_DESC[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="행사명" required>
              <input
                className="input"
                value={form.event_name}
                onChange={(e) => setForm({ ...form, event_name: e.target.value })}
              />
            </Field>
          </div>
          {/* 2) 행사 시작일시 / 종료일시 — 한 줄에 나란히.
              시작일시의 '일자'가 바뀌면 종료 일자를 같은 날로 자동 동기화(당일행사 기본, 시간은 유지). */}
          <Field label="행사 시작일시" required>
            <input
              type="datetime-local"
              className="input"
              value={form.start_datetime}
              onChange={(e) => {
                const value = e.target.value;
                const oldDate = form.start_datetime.slice(0, 10);
                const newDate = value.slice(0, 10);
                let end = form.end_datetime;
                if (newDate && (newDate !== oldDate || !end)) {
                  const endTime =
                    (end && end.length >= 16 ? end.slice(11) : '') || value.slice(11) || '15:00';
                  end = `${newDate}T${endTime}`;
                }
                setForm({ ...form, start_datetime: value, end_datetime: end });
              }}
            />
          </Field>
          <Field label="행사 종료일시" required>
            <input
              type="datetime-local"
              className="input"
              value={form.end_datetime}
              onChange={(e) => setForm({ ...form, end_datetime: e.target.value })}
            />
          </Field>
          {/* 3) 사용홀 */}
          <Field label="사용홀 (중복 선택)" className="md:col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {HALL_OPTIONS.map((h) => {
                const on = form.halls.includes(h);
                return (
                  <button
                    type="button"
                    key={h}
                    onClick={() => toggleHall(h)}
                    className={
                      'px-2.5 py-1 rounded-full border text-xs transition ' +
                      (on
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50')
                    }
                  >
                    {h}
                  </button>
                );
              })}
            </div>
          </Field>
          {/* 4) 메모 */}
          <Field label="메모 (내부 운영 참고용)" className="md:col-span-2">
            <AutoExpandTextarea
              className="input"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="여러 줄 입력 가능 — 내부 참고용 메모"
            />
          </Field>
          {/* 5) 계약일 */}
          <Field label="계약일">
            <input
              type="date"
              className="input"
              value={form.contract_date}
              onChange={(e) => setForm({ ...form, contract_date: e.target.value })}
            />
          </Field>
          {/* 6) 이하는 기존 순서 유지 — 구분 / 이용시간 / 좌석수 / 작성일자 / 작성자 / 담당자
                 (상태는 운영 편의상 상단 행사명 옆으로 이동) */}
          <Field label="구분" required>
            <select
              className="input"
              value={form.event_type}
              onChange={(e) => changeEventType(e.target.value as CustomerType)}
              disabled={isEdit}
            >
              {allowedTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="이용시간">
            <select
              className="input"
              value={form.usage_type}
              onChange={(e) => changeUsageType((e.target.value as UsageType) || '')}
            >
              <option value="">선택 안 함</option>
              {USAGE_TYPE_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {USAGE_TYPE_DESC[u]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="좌석수">
            <input
              type="number"
              className="input"
              value={form.seats ?? ''}
              onChange={(e) =>
                setForm({ ...form, seats: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          </Field>
          <Field label="작성일자">
            <input
              className="input bg-gray-50"
              value={isEdit ? fmtDateTime(initialEvent?.created_at) : '저장 시 자동 입력'}
              readOnly
              tabIndex={-1}
            />
          </Field>
          <Field label="작성자">
            <input
              className="input bg-gray-50"
              value={isEdit ? initialEvent?.created_by_name || '-' : authorName || '-'}
              readOnly
              tabIndex={-1}
            />
          </Field>
          <Field label={isWedding ? '담당자 (WEDDING 고객 연동)' : '담당자'} className="md:col-span-2">
            {isWedding ? (
              <input
                className="input bg-gray-50"
                value={
                  form.assigned_manager_name ||
                  '— 업체정보 탭에서 WEDDING 고객을 연결하면 자동 입력됩니다'
                }
                readOnly
                tabIndex={-1}
              />
            ) : (
              <select
                className="input"
                value={form.assigned_manager_id || ''}
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) {
                    setForm({ ...form, assigned_manager_id: '', assigned_manager_name: '' });
                    return;
                  }
                  const u = managerOptions.find((x) => x.id === id);
                  if (u) {
                    setForm({
                      ...form,
                      assigned_manager_id: u.id,
                      assigned_manager_name: u.name,
                    });
                  }
                }}
              >
                <option value="">선택...</option>
                {/* 현재 담당자가 목록에 없으면 fallback 옵션 */}
                {form.assigned_manager_id &&
                  !managerOptions.find((x) => x.id === form.assigned_manager_id) &&
                  form.assigned_manager_name && (
                    <option value={form.assigned_manager_id}>
                      {form.assigned_manager_name} (현재)
                    </option>
                  )}
                {managerOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="식음 메뉴">
        <FoodMenuInput items={foods} onChange={setFoods} />
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2 border-b pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}
