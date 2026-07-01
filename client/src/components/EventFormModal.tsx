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
import InvoiceTab, { type InvoiceDraft, emptyInvoiceDraft } from './InvoiceTab';
import CancellationTab, {
  type CancellationDraft,
  emptyCancellationDraft,
} from './CancellationTab';
import FilesTab from './FilesTab';
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

interface Props {
  open: boolean;
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
  // 모달 열릴 때 처음 보일 탭 — 미지정 시 '기본정보'.
  initialTab?: 'basic' | 'customer' | 'invoice' | 'files' | 'cancel' | 'review' | 'collaboration';
}

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

type TabKey = 'basic' | 'customer' | 'invoice' | 'files' | 'cancel' | 'review' | 'collaboration';

interface TabDef {
  key: TabKey;
  label: string;
  visible: (form: FormState, hasReview: boolean) => boolean;
}

// 행사리뷰 탭은 항상 노출하고, 내부에서 권한/조건에 따라 작성/조회/안내를 분기.
const TABS: TabDef[] = [
  { key: 'basic', label: '기본정보', visible: () => true },
  { key: 'customer', label: '업체정보', visible: () => true },
  { key: 'invoice', label: '가톨릭대관료', visible: () => true },
  { key: 'files', label: '첨부파일', visible: () => true },
  { key: 'collaboration', label: '협업요청서', visible: () => true },
  { key: 'cancel', label: '취소정보', visible: (f) => f.status === 'LOS' },
  { key: 'review', label: '행사리뷰', visible: () => true },
];

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

export default function EventFormModal({
  open,
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
}: Props) {
  const { user } = useAuth();
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
  const [cancellation, setCancellation] = useState<CancellationDraft>(
    emptyCancellationDraft()
  );
  const [saving, setSaving] = useState(false);
  const [beoBusy, setBeoBusy] = useState(false);
  const [beoOpen, setBeoOpen] = useState(false);
  const [beoSeed, setBeoSeed] = useState<BeoSeedInput | null>(null);
  const [beoPayload, setBeoPayload] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<TabKey>('basic');

  const isEdit = !!initialEvent;

  useEffect(() => {
    if (!open) return;
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
        contract_date: (initialEvent as unknown as Record<string,unknown>).contract_date as string || '',
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
    setTab(initialTab || 'basic');
  }, [
    open,
    initialEvent,
    initialFoodItems,
    initialCustomerLinks,
    initialInvoice,
    initialCancellation,
    initialDate,
    allowedTypes,
    initialTab,
  ]);

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
      if (
        !confirm(
          `같은 홀/시간에 DEF 행사와 겹칩니다:\n  ${names}\n그래도 저장하시겠습니까?`
        )
      )
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
          id: f.id.startsWith('tmp_') ? undefined : f.id,
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
          id: l.id.startsWith('tmp_') ? undefined : l.id,
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
      onSaved({ ...res.event, food_items: res.food_items }, res.customer_links);
      onClose();
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
      onClose();
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
    const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${wd})`;
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
              organizer = (isBride ? c.bride_name : c.groom_name) || c.bride_name || c.groom_name || '';
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
          gtd: f.gtd_final != null ? String(f.gtd_final) : f.gtd_contract != null ? String(f.gtd_contract) : '',
          exp: f.exp_final != null ? String(f.exp_final) : f.exp_contract != null ? String(f.exp_contract) : '',
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

  const visibleTabs = TABS.filter((t) => t.visible(form, false /* hasReview - phase 4 */));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '행사 수정' : '행사 신규 등록'}
      widthClass="max-w-5xl"
      footer={
        <>
          {/* 수정 모드 + onDeleted 콜백 + 작성 권한자만 노출. 뷰어(banquet/kitchen/h_kitchen) 제외. */}
          {isEdit && onDeleted && canCreateEvent(user?.role) && (
            <button
              onClick={deleteEvent}
              disabled={deleting || saving}
              className="btn-danger mr-auto"
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
          <button onClick={onClose} className="btn-secondary">
            취소
          </button>
          <button onClick={save} disabled={saving || deleting} className="btn-primary">
            {saving ? '저장중...' : '저장'}
          </button>
        </>
      }
    >
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
          <EventCustomerLinks
            eventType={form.event_type}
            links={links}
            onChange={setLinks}
          />
        </ErrorBoundary>
      )}
      {tab === 'invoice' && (
        <ErrorBoundary title="INVOICE 탭에서 오류가 발생했습니다">
          <InvoiceTab draft={invoice} onChange={setInvoice} />
        </ErrorBoundary>
      )}
      {tab === 'files' && (
        <ErrorBoundary title="첨부파일 탭에서 오류가 발생했습니다">
          <FilesTab eventId={initialEvent?.id || null} canWrite={canCreateEvent(user?.role)} />
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

      {/* 수정 이력 — 모든 탭에서 모달 하단에 노출. 모달 닫고 다시 열 때 fresh fetch. */}
      <ErrorBoundary title="수정 이력 패널에서 오류가 발생했습니다">
        <ChangeLogPanel entityType="event" entityId={initialEvent?.id || null} />
      </ErrorBoundary>

      {/* 중복안내·강한충돌 클릭 시 노출되는 충돌 행사 상세 모달 */}
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
                  <span className="font-medium text-gray-900">
                    {c.event_name || '(이름 없음)'}
                  </span>
                </div>
                <div className="text-xs text-gray-600">
                  {c.halls.join(' / ') || '홀 미지정'} · {c.start_datetime} ~ {c.end_datetime}
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
    </Modal>
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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
          <Field
            label={isWedding ? '담당자 (WEDDING 고객 연동)' : '담당자'}
            className="md:col-span-2"
          >
            {isWedding ? (
              <input
                className="input bg-gray-50"
                value={form.assigned_manager_name || '— 업체정보 탭에서 WEDDING 고객을 연결하면 자동 입력됩니다'}
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

function PlaceholderTab({ phase, hint }: { phase: string; hint: string }) {
  return (
    <div className="border rounded-md p-8 text-center bg-gray-50/50">
      <div className="text-sm text-gray-600 mb-1">{hint}</div>
      <div className="text-xs text-gray-400">Phase {phase}에서 구현 예정</div>
    </div>
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
