// 공개 캘린더 요약 — 로그인 없이 토큰 링크만으로 열람.
// /public/summary/:token. 데이터는 비인증 엔드포인트 /api/public/summary/:token.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CalendarSummaryView, { type SummaryEvent } from '../components/CalendarSummaryView';

export default function PublicSummary() {
  const { token } = useParams<{ token: string }>();
  const [events, setEvents] = useState<SummaryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`/api/public/summary/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json() as Promise<{ events: SummaryEvent[] }>;
      })
      .then((data) => setEvents(data.events || []))
      .catch((e) => {
        setError(
          e.message === '404'
            ? '유효하지 않은 링크입니다. 공유한 사람에게 새 링크를 요청해주세요.'
            : '요약을 불러오지 못했습니다.'
        );
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <span className="text-lg font-bold text-gray-900">📊 캘린더 요약</span>
          <span className="text-xs text-gray-400">플렌티컨벤션</span>
          {!loading && !error && (
            <button
              onClick={() => window.print()}
              className="ml-auto btn-secondary !py-1.5"
              title="보이는 화면 그대로 인쇄"
            >
              🖨️ 출력
            </button>
          )}
        </div>
      </header>
      <div className="max-w-5xl mx-auto p-3 md:p-6">
        {loading ? (
          <div className="text-sm text-gray-400 py-12 text-center">불러오는 중...</div>
        ) : error ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-4 text-center">
            {error}
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              상담·미팅·LOS·취소 행사는 자동 제외 · 행사를 클릭하면 사용홀·메뉴·GTD/EXP·비고 표시
            </p>
            <CalendarSummaryView events={events} />
          </>
        )}
      </div>
    </div>
  );
}
