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
} from '../types';
import Modal from './Modal';
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
import ChangeLogPanel from './ChangeLogPanel';
import AutoExpandTextarea from './AutoExpandTextarea';
import { useAuth } from '../auth/AuthContext';
import { useActiveUsers } from '../lib/useActiveUsers';
import { canCreateEvent, canWriteReview, isAdmin } from '../auth/permissions';
import clsx from 'clsx';

type DraftFoodItem = Omit<FoodItem, 'event_id'>;
type DraftCustomerLink = Omit<EventCustomerLink, 'event_id'>;

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
  initialTab?: 'basic' | 'customer' | 'invoice' | 'files' | 'cancel' | 'review';
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
}

type TabKey = 'basic' | 'customer' | 'invoice' | 'files' | 'cancel' | 'review';

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
  const admin = isAdmin(user?.role);
  const activeUsers = useActiveUsers();
  // MICE 행사 담당자 드롭다운 — 기업세일즈 + 관리자만 노출
  const miceManagerOptions = useMemo(
    () => activeUsers.filter((u) => u.role === 'sales_mice' || u.role === 'admin'),
    [activeUsers]
  );
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(allowedTypes, initialDate || null));
  const [foods, setFoods] = useState<DraftFoodItem[]>([]);
  const [links, setLinks] = useState<DraftCustomerLink[]>([]);
  const [invoice, setInvoice] = useState<InvoiceDraft>(emptyInvoiceDraft());
  const [cancellation, setCancellation] = useState<CancellationDraft>(
    emptyCancellationDraft()
  );
  const [saving, setSaving] = useState(false);
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
      });
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

  async function deleteEvent() {
    if (!initialEvent || !onDeleted) return;
    if (
      !confirm(
        `[${initialEvent.event_name}] 행사를 삭제하시겠습니까?\n식음 메뉴, 업체 연결, 가톨릭대관료, 첨부파일, 행사리뷰가 모두 함께 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`
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

  const visibleTabs = TABS.filter((t) => t.visible(form, false /* hasReview - phase 4 */));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '행사 수정' : '행사 신규 등록'}
      widthClass="max-w-5xl"
      footer={
        <>
          {/* 관리자 + 수정 모드 + onDeleted 콜백 제공 시에만 노출 */}
          {admin && isEdit && onDeleted && (
            <button
              onClick={deleteEvent}
              disabled={deleting || saving}
              className="btn-danger mr-auto"
            >
              {deleting ? '삭제중...' : '🗑 행사 삭제'}
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
      {/* 충돌 경고 (모든 탭에서 보이도록 상단 고정) */}
      {conflict.level !== 'none' && (
        <div
          className={
            'mb-3 rounded-md p-2.5 text-xs border ' +
            (conflict.level === 'hard'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-yellow-50 border-yellow-200 text-yellow-800')
          }
        >
          <strong>
            {conflict.level === 'hard' ? '⚠️ 강한 충돌' : 'ℹ️ 중복 안내'} —{' '}
          </strong>
          같은 홀·시간 행사: {conflict.with.map((c) => `[${c.status}] ${c.event_name}`).join(', ')}
        </div>
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

      {/* 탭 본문 */}
      {tab === 'basic' && (
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
      )}
      {tab === 'customer' && (
        <EventCustomerLinks
          eventType={form.event_type}
          links={links}
          onChange={setLinks}
        />
      )}
      {tab === 'invoice' && <InvoiceTab draft={invoice} onChange={setInvoice} />}
      {tab === 'files' && (
        <FilesTab
          eventId={initialEvent?.id || null}
          canWrite={canCreateEvent(user?.role)}
        />
      )}
      {tab === 'cancel' && form.status === 'LOS' && (
        <CancellationTab draft={cancellation} onChange={setCancellation} />
      )}
      {tab === 'review' && (
        <ReviewTab
          eventId={initialEvent?.id || null}
          canWrite={canWriteReview(user?.role)}
          eventEndDatetime={initialEvent?.end_datetime || form.end_datetime}
          eventStatus={form.status}
        />
      )}

      {/* 수정 이력 — 모든 탭에서 모달 하단에 노출. 모달 닫고 다시 열 때 fresh fetch. */}
      <ChangeLogPanel entityType="event" entityId={initialEvent?.id || null} />
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
          {/* 메모 — 가장 먼저 확인할 수 있도록 상단 배치. 1줄에서 시작해 입력 길이에 따라 확장. */}
          <Field label="메모 (내부 운영 참고용)" className="md:col-span-2">
            <AutoExpandTextarea
              className="input"
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              placeholder="여러 줄 입력 가능 — 내부 참고용 메모"
            />
          </Field>
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
          <Field label="행사 시작일시" required>
            <input
              type="datetime-local"
              className="input"
              value={form.start_datetime}
              onChange={(e) => setForm({ ...form, start_datetime: e.target.value })}
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
          <Field label="행사명" required className="md:col-span-2">
            <input
              className="input"
              value={form.event_name}
              onChange={(e) => setForm({ ...form, event_name: e.target.value })}
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
