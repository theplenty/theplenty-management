import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  type MiceCustomer,
  type MiceInquiry,
  type EventStatus,
  STATUS_HEX,
} from '../types';

// 통합 고객 프로필 — MICE.
// 풀스크린 읽기-친화적 뷰. 편집은 "수정" 버튼 → 기존 리스트 모달 흐름.

interface LinkedEvent {
  id: string;
  event_type: string;
  status: EventStatus;
  start_datetime: string;
  end_datetime: string;
  event_name: string;
  halls: string[];
  customer_role: string | null;
  is_contact_point: boolean;
  invoice_payment_status: string | null;
  cancellation: { reason: string } | null;
  has_review: boolean;
}

interface ChangeLog {
  id: string;
  entity_type: string;
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  summary: string;
  changed_by_id: string;
  changed_by_name: string;
  changed_at: string;
}

interface FullProfile {
  customer: MiceCustomer;
  linked_events: LinkedEvent[];
  change_logs: ChangeLog[];
}

function fmt(s: string | null | undefined): string {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtPhone(p: string | null | undefined): string {
  if (!p) return '';
  return p.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1-$2-$3');
}

const ACTION_LABEL: Record<string, string> = {
  create: '생성',
  update: '수정',
  delete: '삭제',
};
const ENTITY_LABEL: Record<string, string> = {
  wedding_customer: '고객',
  mice_customer: '고객',
  event: '행사',
};

export default function MiceProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api
      .get<FullProfile>(`/api/customers/mice/${id}/full`)
      .then(setProfile)
      .catch((e) => {
        const status = (e as { status?: number }).status;
        if (status === 404) setError('고객을 찾을 수 없습니다. 휴지통으로 이동했을 수 있습니다.');
        else setError('고객 정보를 불러오지 못했습니다.');
        console.error(e);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-sm text-gray-400">불러오는 중...</div>;
  if (error)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          {error}
        </div>
        <button onClick={() => navigate(-1)} className="btn-secondary mt-4 text-xs">
          ← 뒤로
        </button>
      </div>
    );
  if (!profile) return null;

  const c = profile.customer;

  return (
    <div className="max-w-5xl mx-auto pb-8">
      {/* 상단 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 text-xs text-gray-500">
            <button onClick={() => navigate(-1)} className="hover:underline">
              ← 뒤로
            </button>
            <span>·</span>
            <span>🏢 MICE 고객</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 truncate">
            {c.organization_name || '(업체명 없음)'}
          </h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap text-sm">
            <span className="badge bg-blue-100 text-blue-800">{c.mice_category}</span>
            {profile.linked_events.length > 0 && (
              <span className="badge bg-emerald-100 text-emerald-800">
                행사 {profile.linked_events.length}건
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate(`/customers/mice?focus=${c.id}`)}
            className="btn-primary"
          >
            ✎ 수정
          </button>
        </div>
      </div>

      {/* 1. 기본 정보 */}
      <Section title="기본 정보">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KV label="공식 연락처">
            {c.official_phone ? (
              <a
                href={`tel:${c.official_phone.replace(/\D/g, '')}`}
                className="text-blue-600 hover:underline"
              >
                📞 {fmtPhone(c.official_phone)}
              </a>
            ) : (
              '-'
            )}
          </KV>
          <KV label="공식 이메일">
            {c.official_email ? (
              <a href={`mailto:${c.official_email}`} className="text-blue-600 hover:underline">
                ✉ {c.official_email}
              </a>
            ) : (
              '-'
            )}
          </KV>
          <KV label="공식 홈페이지">
            {c.official_website ? (
              <a
                href={c.official_website.startsWith('http') ? c.official_website : `https://${c.official_website}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline break-all"
              >
                🌐 {c.official_website}
              </a>
            ) : (
              '-'
            )}
          </KV>
        </div>
        {c.memo && (
          <div className="mt-3">
            <div className="text-[11px] text-gray-500 mb-0.5">메모</div>
            <div className="text-sm text-gray-900 bg-amber-50 border border-amber-200 rounded p-2 whitespace-pre-wrap">
              {c.memo}
            </div>
          </div>
        )}
      </Section>

      {/* 2. 문의 목록 */}
      <Section title={`문의 이력 (${c.inquiries.length}건)`}>
        {c.inquiries.length === 0 ? (
          <EmptyState>등록된 문의가 없습니다.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {c.inquiries.map((inq, idx) => (
              <MiceInquiryCard key={inq.id} inq={inq} idx={idx} />
            ))}
          </ul>
        )}
      </Section>

      {/* 3. 플렌티에서 진행한 행사 */}
      <Section title={`플렌티에서 진행한 행사 (${profile.linked_events.length}건)`}>
        {profile.linked_events.length === 0 ? (
          <EmptyState>이 업체와 연결된 행사가 아직 없습니다.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {profile.linked_events.map((ev) => (
              <LinkedEventCard
                key={ev.id}
                ev={ev}
                onOpen={() => navigate(`/events?focus=${ev.id}`)}
              />
            ))}
          </ul>
        )}
      </Section>

      {/* 4. 활동 타임라인 */}
      <Section title={`활동 타임라인 (${profile.change_logs.length}건)`}>
        {profile.change_logs.length === 0 ? (
          <EmptyState>기록이 없습니다.</EmptyState>
        ) : (
          <ActivityTimeline logs={profile.change_logs} />
        )}
      </Section>
    </div>
  );
}

// ===== 하위 컴포넌트들 =====

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border rounded-lg p-4 md:p-5 mb-4">
      <h2 className="text-base font-semibold text-gray-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 break-all">{children || <span className="text-gray-300">-</span>}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-400 italic py-3 text-center">{children}</div>;
}

function MiceInquiryCard({ inq, idx }: { inq: MiceInquiry; idx: number }) {
  return (
    <li className="border rounded p-3 text-sm">
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-900">#{idx + 1}</span>
          <span className="badge bg-gray-100 text-gray-700">{inq.progress_status}</span>
          {inq.inquiry_event_date_text && (
            <span className="text-xs text-gray-600">행사일정: {inq.inquiry_event_date_text}</span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {inq.assigned_manager_name && `담당: ${inq.assigned_manager_name}`}
        </div>
      </div>
      {/* 담당자 contacts */}
      {inq.contacts.length > 0 && (
        <div className="space-y-1 mb-2">
          {inq.contacts.map((ct, ci) => (
            <div key={ct.id} className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">담당 {ci + 1}.</span>
              <span className="font-medium text-gray-900">{ct.name || '(이름 없음)'}</span>
              {ct.phone && (
                <a
                  href={`tel:${ct.phone.replace(/\D/g, '')}`}
                  className="text-blue-600 hover:underline"
                >
                  📞 {ct.phone}
                </a>
              )}
              {ct.email && (
                <a href={`mailto:${ct.email}`} className="text-blue-600 hover:underline">
                  ✉ {ct.email}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {inq.event_memo && (
        <div className="text-xs">
          <div className="text-gray-500 mb-0.5">메모</div>
          <div className="text-gray-900 whitespace-pre-wrap bg-gray-50 border rounded p-1.5">
            {inq.event_memo}
          </div>
        </div>
      )}
      {inq.call_date && (
        <div className="text-[11px] text-gray-500 mt-1">최근 통화: {inq.call_date}</div>
      )}
    </li>
  );
}

function LinkedEventCard({ ev, onOpen }: { ev: LinkedEvent; onOpen: () => void }) {
  const halls = ev.halls.join(' / ') || '홀 미지정';
  const color = STATUS_HEX[ev.status] || '#6b7280';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left border rounded p-3 hover:bg-blue-50 active:bg-blue-100 transition"
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="badge bg-gray-100 text-gray-700">{ev.event_type}</span>
          <span className="badge text-white" style={{ background: color }}>
            {ev.status}
          </span>
          {ev.customer_role && (
            <span className="badge bg-purple-100 text-purple-800">{ev.customer_role}</span>
          )}
          {ev.is_contact_point && (
            <span className="badge bg-blue-100 text-blue-800">CONTACT POINT</span>
          )}
          {ev.has_review && (
            <span className="badge bg-emerald-100 text-emerald-800">리뷰 작성</span>
          )}
        </div>
        <div className="font-semibold text-gray-900 truncate">
          {ev.event_name || '(이름 없음)'}
        </div>
        <div className="text-xs text-gray-600 mt-0.5">
          {fmt(ev.start_datetime)} ~ {fmt(ev.end_datetime)} · {halls}
        </div>
        {ev.invoice_payment_status && (
          <div className="text-xs text-gray-500 mt-0.5">결제: {ev.invoice_payment_status}</div>
        )}
        {ev.cancellation?.reason && (
          <div className="text-xs text-red-600 mt-0.5">취소사유: {ev.cancellation.reason}</div>
        )}
      </button>
    </li>
  );
}

function ActivityTimeline({ logs }: { logs: ChangeLog[] }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {logs.slice(0, 50).map((log) => (
        <li key={log.id} className="flex items-start gap-2 border-l-2 border-gray-200 pl-3 py-1">
          <span className="text-gray-400 shrink-0 w-32">{fmt(log.changed_at)}</span>
          <span className="font-medium text-gray-800 shrink-0">{log.changed_by_name}</span>
          <span
            className={
              'badge shrink-0 ' +
              (log.action === 'create'
                ? 'bg-green-100 text-green-800'
                : log.action === 'delete'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-blue-100 text-blue-800')
            }
          >
            {ENTITY_LABEL[log.entity_type] || log.entity_type} {ACTION_LABEL[log.action] || log.action}
          </span>
          <span className="text-gray-600 flex-1 break-words">{log.summary}</span>
        </li>
      ))}
      {logs.length > 50 && (
        <li className="text-center text-gray-400 pt-2">… 그 외 {logs.length - 50}건</li>
      )}
    </ul>
  );
}
