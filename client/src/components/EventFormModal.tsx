// 행사 수정/등록 모달 — 껍데기만 담당한다.
// 실제 폼·저장·탭 로직은 EventEditor 가 갖고 있고, 전용 페이지(/events/:id)와 공유한다.
// (로드맵 A1 — 모달은 '빠른 수정', 페이지는 '원스톱 워크스페이스')
import Modal from './Modal';
import EventEditor, { type TabKey } from './EventEditor';
import type {
  Cancellation,
  CustomerType,
  Event,
  EventCustomerLink,
  EventWithFood,
  FoodItem,
  Invoice,
} from '../types';

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
  initialTab?: TabKey;
  // '⤢ 전체화면' — 전용 페이지로 이동. 미제공 시 버튼 미노출.
  onOpenFullscreen?: () => void;
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
  onOpenFullscreen,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initialEvent ? '행사 수정' : '행사 신규 등록'}
      widthClass="max-w-5xl"
    >
      <EventEditor
        layout="modal"
        active={open}
        onClose={onClose}
        initialEvent={initialEvent}
        initialFoodItems={initialFoodItems}
        initialCustomerLinks={initialCustomerLinks}
        initialInvoice={initialInvoice}
        initialCancellation={initialCancellation}
        initialDate={initialDate}
        allowedTypes={allowedTypes}
        otherEvents={otherEvents}
        onSaved={onSaved}
        onDeleted={onDeleted}
        initialTab={initialTab}
        onOpenFullscreen={onOpenFullscreen}
      />
    </Modal>
  );
}
