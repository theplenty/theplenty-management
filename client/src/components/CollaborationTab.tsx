// 행사 모달의 "협업요청서" 탭.
// 세일즈: 새 요청서 작성 + 이 행사의 요청 목록 확인/결정.
// 주방/연회: 이 행사 중 자기 팀이 대상인 요청에 회신.

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { canCreateCollaboration } from '../auth/permissions';
import {
  COLLAB_DEVIATIONS,
  COLLAB_TEAM_LABEL,
  type CollabDeviation,
  type CollabTeam,
  type CollaborationRequest,
} from '../types';
import { createCollaboration, listCollaborations } from '../lib/collaboration';
import { formatKoreanCommas } from '../lib/numberFormat';
import CollaborationDetailCard from './CollaborationDetailCard';

interface Props {
  eventId: string | null;
  defaultEventName: string;
  defaultEventDate: string; // ISO or local input
}

const TEAMS: CollabTeam[] = ['kitchen', 'banquet'];

function toDateOnly(s: string): string {
  if (!s) return '';
  return s.slice(0, 10);
}

export default function CollaborationTab({ eventId, defaultEventName, defaultEventDate }: Props) {
  const { user } = useAuth();
  const canCreate = canCreateCollaboration(user?.role);
  const [requests, setRequests] = useState<CollaborationRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setRequests([]);
      return;
    }
    setLoading(true);
    listCollaborations(eventId)
      .then(setRequests)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [eventId]);

  if (!eventId) {
    return (
      <div className="border rounded-md p-6 text-center bg-gray-50/50">
        <div className="text-sm text-gray-600">
          행사를 먼저 저장한 뒤 협업요청서를 작성할 수 있습니다.
        </div>
      </div>
    );
  }

  function upsert(updated: CollaborationRequest) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }
  function removeOne(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-gray-600">
          비표준 고객 요청에 대해 주방·연회와 협업 가능 여부를 합의합니다.
        </div>
        {canCreate && !creating && (
          <button onClick={() => setCreating(true)} className="btn-primary !py-1 text-xs">
            + 새 협업요청서
          </button>
        )}
      </div>

      {creating && (
        <CreateForm
          eventId={eventId}
          defaultName={defaultEventName}
          defaultDate={toDateOnly(defaultEventDate)}
          onCancel={() => setCreating(false)}
          onCreated={(cr) => {
            setRequests((prev) => [cr, ...prev]);
            setCreating(false);
          }}
        />
      )}

      {loading ? (
        <div className="text-sm text-gray-400 py-4">불러오는 중...</div>
      ) : requests.length === 0 && !creating ? (
        <div className="border rounded-md p-6 text-center bg-gray-50/50 text-sm text-gray-500">
          작성된 협업요청서가 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r, i) => (
            <CollaborationDetailCard
              key={r.id}
              request={r}
              onChange={upsert}
              onDeleted={removeOne}
              defaultExpanded={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateForm({
  eventId,
  defaultName,
  defaultDate,
  onCancel,
  onCreated,
}: {
  eventId: string;
  defaultName: string;
  defaultDate: string;
  onCancel: () => void;
  onCreated: (cr: CollaborationRequest) => void;
}) {
  const [name, setName] = useState(defaultName || '');
  const [date, setDate] = useState(defaultDate || '');
  const [request, setRequest] = useState('');
  const [deviations, setDeviations] = useState<CollabDeviation[]>([]);
  const [other, setOther] = useState('');
  const [revenue, setRevenue] = useState('');
  const [revenueMemo, setRevenueMemo] = useState('');
  const [teams, setTeams] = useState<CollabTeam[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleDev(d: CollabDeviation) {
    setDeviations((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function toggleTeam(t: CollabTeam) {
    setTeams((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function submit() {
    if (!name.trim()) return alert('고객사/행사명은 필수입니다.');
    if (!date) return alert('행사 예정일은 필수입니다.');
    if (!request.trim()) return alert('고객 요청 사항은 필수입니다.');
    if (!revenue) return alert('예상 매출(숫자)은 필수입니다.');
    if (teams.length === 0) return alert('협업 요청 받는 팀을 1개 이상 선택하세요.');
    setSaving(true);
    try {
      const cr = await createCollaboration({
        event_id: eventId,
        customer_event_name: name.trim(),
        event_date: date || null,
        customer_request: request.trim(),
        deviations,
        deviation_other: deviations.includes('기타') ? other : '',
        expected_revenue: Number(revenue.replace(/[^\d]/g, '')),
        expected_revenue_memo: revenueMemo,
        target_teams: teams,
        sales_comment: comment,
      });
      onCreated(cr);
    } catch (e) {
      alert('작성 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-lg p-3 bg-blue-50/40 border-blue-200 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <L label="고객사/행사명 *">
          <input className="input !py-1.5" value={name} onChange={(e) => setName(e.target.value)} />
        </L>
        <L label="행사 예정일 *">
          <input
            type="date"
            className="input !py-1.5"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </L>
      </div>

      <L label="고객 요청 사항 * (최대 100자)">
        <input
          className="input !py-1.5"
          maxLength={100}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="한 줄로 핵심만"
        />
      </L>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">표준 운영 대비 다른 부분</div>
        <div className="flex flex-wrap gap-1.5">
          {COLLAB_DEVIATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDev(d)}
              className={
                'px-2.5 py-1 rounded border text-xs ' +
                (deviations.includes(d)
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white border-gray-300 hover:bg-gray-50')
              }
            >
              {d}
            </button>
          ))}
        </div>
        {deviations.includes('기타') && (
          <input
            className="input !py-1 mt-2 text-sm"
            placeholder="기타 — 직접 입력"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">예상 매출 * (숫자 필수, 메모 선택)</div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <input
              className="input !py-1.5 !w-36 text-right tabular-nums"
              inputMode="numeric"
              value={revenue}
              placeholder="0"
              onChange={(e) => setRevenue(formatKoreanCommas(e.target.value))}
            />
            <span className="text-xs text-gray-500">원</span>
          </div>
          <input
            className="input !py-1.5 flex-1 min-w-[12rem] text-sm"
            placeholder="예) 옵션 포함 추정치 / 확정 매출 등"
            value={revenueMemo}
            onChange={(e) => setRevenueMemo(e.target.value)}
          />
        </div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-600 mb-1">협업 요청 받는 팀 * (1개 이상)</div>
        <div className="flex gap-1.5">
          {TEAMS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTeam(t)}
              className={
                'px-3 py-1.5 rounded border text-sm ' +
                (teams.includes(t)
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white border-gray-300 hover:bg-gray-50')
              }
            >
              {COLLAB_TEAM_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <L label="세일즈 의견 (최대 200자) — 수용 시 효과 또는 거절 시 손실">
        <textarea
          className="input !py-1.5 text-sm"
          maxLength={200}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </L>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary !py-1 text-xs">
          취소
        </button>
        <button onClick={submit} disabled={saving} className="btn-primary !py-1 text-xs">
          {saving ? '제출 중...' : '협업요청 제출'}
        </button>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
      {children}
    </div>
  );
}
