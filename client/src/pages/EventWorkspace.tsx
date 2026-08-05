// 행사 원스톱 워크스페이스 (/events/:id) — 로드맵 A1.
// 한 행사 = 한 화면. 좌측 탭 본문 + 우측 액션 패널.
// 편집 로직은 EventEditor 를 그대로 쓰므로 모달과 동작이 100% 같다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import EventEditor, { type TabKey } from '../components/EventEditor';
import ErrorBoundary from '../components/ErrorBoundary';
import type {
  Cancellation,
  CustomerType,
  Event,
  EventCustomerLink,
  EventWithFood,
  FoodItem,
  Invoice,
} from '../types';

const TAB_KEYS: TabKey[] = [
  'basic',
  'customer',
  'revenue',
  'files',
  'cancel',
  'review',
  'collaboration',
  'landing',
];

interface Detail {
  event: Event;
  food_items: FoodItem[];
  customer_links: EventCustomerLink[];
  invoice: Invoice | null;
  cancellation: Cancellation | null;
}

export default function EventWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [otherEvents, setOtherEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ?tab=revenue 딥링크 — 링크 하나로 특정 탭까지 바로 열 수 있게.
  const tabParam = searchParams.get('tab') as TabKey | null;
  const initialTab: TabKey = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'basic';

  const loadDetail = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<Detail>(`/api/events/${id}`);
      setDetail(r);
      setError(null);
    } catch (e) {
      console.error('[EventWorkspace] 행사 조회 실패', e);
      setError('행사를 찾을 수 없거나 열람 권한이 없습니다.');
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    // 충돌 검사(같은 홀·시간 중복)를 하려면 전체 행사 목록이 필요하다.
    Promise.all([
      loadDetail(),
      api
        .get<{ events: EventWithFood[] }>('/api/events')
        .then((r) => {
          if (!cancelled) setOtherEvents(r.events as Event[]);
        })
        .catch((e) => console.error('[EventWorkspace] 행사 목록 조회 실패', e)),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDetail]);

  const allowedTypes: CustomerType[] = useMemo(() => {
    if (user?.role === 'admin' || user?.role === 'sales_mice' || user?.role === 'sales_wedding') {
      return ['MICE', 'WEDDING'];
    }
    // 뷰어(연회·주방)는 구분 변경 불가 — 현재 행사의 구분만 선택지로.
    return detail ? [detail.event.event_type] : ['MICE'];
  }, [user, detail]);

  // EventEditor 의 초기화 effect 는 이 prop 들의 '동일성'을 보고 돈다.
  // 매 렌더마다 새 배열을 만들면 편집 중 폼이 초기화되므로 detail 기준으로 고정한다.
  const foodItems = useMemo(() => detail?.food_items ?? [], [detail]);
  const customerLinks = useMemo(() => detail?.customer_links ?? [], [detail]);

  function handleTabChange(next: TabKey) {
    // 히스토리를 더럽히지 않도록 replace — 뒤로가기는 목록으로 돌아가야 자연스럽다.
    setSearchParams(next === 'basic' ? {} : { tab: next }, { replace: true });
  }

  if (loading) {
    return <div className="text-sm text-gray-500 p-4">불러오는 중...</div>;
  }

  if (error || !detail) {
    return (
      <div className="max-w-lg mx-auto mt-10 text-center">
        <div className="text-sm text-gray-700 mb-3">{error || '행사를 찾을 수 없습니다.'}</div>
        <button onClick={() => navigate('/events')} className="btn-secondary">
          ← 행사 목록으로
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary title="행사 워크스페이스에서 오류가 발생했습니다">
      <EventEditor
        layout="page"
        active
        onClose={() => navigate('/events')}
        initialEvent={detail.event}
        initialFoodItems={foodItems}
        initialCustomerLinks={customerLinks}
        initialInvoice={detail.invoice}
        initialCancellation={detail.cancellation}
        initialDate={null}
        allowedTypes={allowedTypes}
        otherEvents={otherEvents}
        // 저장 후에는 서버 기준으로 다시 읽어온다 (invoice·취소정보까지 최신으로).
        onSaved={() => {
          void loadDetail();
        }}
        // 노출 여부는 EventEditor 가 권한(canCreateEvent)으로 다시 판단한다.
        onDeleted={() => navigate('/events')}
        initialTab={initialTab}
        onTabChange={handleTabChange}
      />
    </ErrorBoundary>
  );
}
