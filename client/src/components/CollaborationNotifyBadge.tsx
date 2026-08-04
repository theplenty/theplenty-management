// 헤더 인앱 알림 배지 — 협업요청서 중 "내가 처리해야 할 건"을 폴링으로 파악.
//  - 주방/연회: 우리 팀이 대상인데 아직 회신 안 한 건 (회신대기)
//  - 세일즈/대표: 내가 만든(또는 전체) '회신완료' 건 = 결정 대기
// 모바일 푸시·자동 리마인드는 범위 외 — 접속 시 상황 파악용.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { canSeeCollaboration } from '../auth/permissions';
import {
  computeAttention,
  countdown,
  listCollaborations,
  type CollabAttention,
  collabEventName,
} from '../lib/collaboration';

const POLL_MS = 45_000;

export default function CollaborationNotifyBadge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [attn, setAttn] = useState<CollabAttention>({
    total: 0,
    needMyReply: [],
    needDecision: [],
  });
  const closeTimer = useRef<number | null>(null);

  const enabled = canSeeCollaboration(user?.role);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function poll() {
      try {
        const reqs = await listCollaborations();
        if (!cancelled) setAttn(computeAttention(reqs, user?.role, user?.id));
      } catch {
        /* 폴링 실패는 조용히 무시 */
      }
    }
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, user?.role, user?.id]);

  if (!enabled) return null;

  function handleEnter() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }
  function handleLeave() {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  }

  const count = attn.total;

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        type="button"
        aria-label="협업요청서 알림"
        onClick={() => navigate('/collaborations')}
        className="relative w-8 h-8 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400 transition flex items-center justify-center"
      >
        <span aria-hidden className="text-base leading-none">🤝</span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(92vw,22rem)] max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl z-50 text-sm">
          <div className="sticky top-0 bg-white border-b px-4 py-2.5 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">🤝 협업요청 알림</h3>
            <button
              onClick={() => navigate('/collaborations')}
              className="text-[11px] text-blue-600 hover:underline"
            >
              전체 보기 →
            </button>
          </div>

          {count === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-xs">
              처리할 협업요청이 없습니다. 👍
            </div>
          ) : (
            <div className="py-1">
              {attn.needMyReply.length > 0 && (
                <Section title={`회신 필요 (${attn.needMyReply.length})`} tone="amber">
                  {attn.needMyReply.map((r) => {
                    const cd = countdown(r.reply_due_at);
                    return (
                      <Item
                        key={r.id}
                        name={collabEventName(r)}
                        sub={`${r.created_by_name} 요청 · ${cd.expired ? cd.label : `${cd.label} 남음`}`}
                        urgent={cd.urgent}
                        onClick={() => {
                          setOpen(false);
                          navigate('/collaborations');
                        }}
                      />
                    );
                  })}
                </Section>
              )}
              {attn.needDecision.length > 0 && (
                <Section title={`결정 필요 (${attn.needDecision.length})`} tone="blue">
                  {attn.needDecision.map((r) => (
                    <Item
                      key={r.id}
                      name={collabEventName(r)}
                      sub="회신 완료 — 최종 결정 대기"
                      onClick={() => {
                        setOpen(false);
                        navigate('/collaborations');
                      }}
                    />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'amber' | 'blue';
  children: React.ReactNode;
}) {
  const cls = tone === 'amber' ? 'text-amber-700' : 'text-blue-700';
  return (
    <div className="mb-1">
      <div className={`px-4 py-1 text-[11px] font-semibold ${cls}`}>{title}</div>
      {children}
    </div>
  );
}

function Item({
  name,
  sub,
  urgent,
  onClick,
}: {
  name: string;
  sub: string;
  urgent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-2 hover:bg-gray-50 border-t first:border-t-0"
    >
      <div className="font-medium text-gray-900 truncate">{name}</div>
      <div className={`text-[11px] ${urgent ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
        {sub}
      </div>
    </button>
  );
}
