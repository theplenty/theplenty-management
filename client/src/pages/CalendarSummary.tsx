// 캘린더 요약 (인증 페이지) — 월 캘린더 그리드에 행사 1건의 요약(사용홀·메뉴·GTD/EXP·비고)을
// 셀에 그대로 펼쳐 보여주고, 보이는 화면 그대로 출력(window.print)한다.
// 공개 공유 링크(로그인 없이 열람)도 발급/복사 가능.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { type EventWithFood, type EventStatus } from '../types';
import CalendarSummaryView from '../components/CalendarSummaryView';

// 요약 제외: 상담취소 / 미팅 / 미팅취소 / LOS (+ WEDDING 상담은 행사가 아니므로 자동 미포함)
const EXCLUDED_STATUSES = new Set<EventStatus>(['상담취소', '미팅', '미팅취소', 'LOS']);

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CalendarSummary() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<{ events: EventWithFood[] }>('/api/events')
      .then((res) => setEvents(res.events))
      .catch((e) => {
        setError('행사 목록을 불러오지 못했습니다.');
        console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      events
        .filter((e) => !EXCLUDED_STATUSES.has(e.status))
        .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1)),
    [events]
  );

  async function copyShareLink() {
    try {
      const { token } = await api.get<{ token: string }>('/api/calendar-summary/share');
      const url = `${window.location.origin}/public/summary/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareMsg('공유 링크가 복사되었습니다. 링크만 있으면 로그인 없이 열람할 수 있습니다.');
      } catch {
        setShareMsg(url);
      }
      setTimeout(() => setShareMsg(null), 6000);
    } catch {
      setShareMsg('공유 링크 생성에 실패했습니다.');
      setTimeout(() => setShareMsg(null), 4000);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">불러오는 중...</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <div className="max-w-6xl mx-auto pb-8">
      <div className="no-print">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1 text-xs text-gray-500">
              <button onClick={() => navigate('/calendar')} className="hover:underline">
                ← 캘린더로
              </button>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">📊 캘린더 요약</h1>
            <p className="text-xs text-gray-500 mt-1">
              상담·미팅·LOS·취소 행사는 자동 제외 · 각 행사의 사용홀·메뉴·GTD/EXP·비고를 셀에 표시 ·
              보이는 그대로 출력 가능
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyShareLink}
              className="btn-secondary"
              title="링크만으로 열람 가능한 공유 주소 복사"
            >
              🔗 공유 링크 복사
            </button>
            <button onClick={() => window.print()} className="btn-secondary" title="보이는 화면 그대로 인쇄">
              🖨️ 출력
            </button>
          </div>
        </div>

        {shareMsg && (
          <div className="mb-4 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 break-all">
            {shareMsg}
          </div>
        )}
      </div>

      <CalendarSummaryView events={filtered} />

      {/* 인쇄 시 바닥글 */}
      <div className="print-footer hidden">
        <hr className="my-4 border-gray-300" />
        <div className="text-xs text-gray-600 text-center py-2">
          출력일시 {nowStamp()} · 플렌티컨벤션 운영관리 시스템
        </div>
      </div>
    </div>
  );
}
