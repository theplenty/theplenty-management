// 웨딩 가예약 고객용 공개 랜딩 (/l/:token) — 모바일 세로형 최적화.
// 인증 없이 토큰만으로 접근. 데이터는 /api/public/landing/:token (견적은 서버 저장 스냅샷).
// 상태: active(전체 노출) · contracted(계약 감사 화면) · closed/expired(마감 안내).

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { QUOTE_CSS } from '../lib/weddingQuote';
import {
  WEDDING_PRIORITY_SENTENCE,
  type WeddingLandingMedia,
  type WeddingLandingState,
  type WeddingPriorityKey,
} from '../types';

interface LandingPayload {
  state: WeddingLandingState;
  groom_name: string;
  bride_name: string;
  wedding_datetime?: string;
  block_until?: string;
  priorities?: WeddingPriorityKey[];
  custom_note?: string;
  guest_count?: number | null;
  total_amount?: string;
  quote_html?: string;
  media?: WeddingLandingMedia | null;
}

const DEFAULT_KAKAO = 'https://pf.kakao.com/_xfGwxob';
// 브랜드 로고 (키컬러를 페이지 팔레트의 브라운으로 리컬러한 버전, 투명배경)
const LOGO_URL =
  'https://storage.googleapis.com/plenty-management.firebasestorage.app/wedding-landing/brand/logo_brown.png';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// "2026-08-15T13:00" → { date: '2026년 8월 15일 (토)', time: '오후 1시' }
function fmtDateTime(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: iso, time: '' };
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    date: `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`,
    time: `${ampm} ${h12}시${m ? ` ${m}분` : ''}`,
  };
}

// "2026-08-16" → "8월 16일 (일)"
function fmtShortDate(s?: string): string {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return s;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
}

const FAQ: { q: string; a: string }[] = [
  {
    q: '가블록 기간에는 다른 고객이 계약할 수 없나요?',
    a: '네. 가블록 기간 동안 해당 날짜와 시간은 두 분만을 위해 안전하게 블록되어 있으며, 해지 전까지 유지됩니다.',
  },
  {
    q: '계약금은 얼마이며, 환불 규정은 어떻게 되나요?',
    a: '계약금은 154만원입니다. 계약일로부터 30일 이내이면서 예식 예정일 180일 전 해제 시, 계약금 전액 환불이 가능합니다.',
  },
  {
    q: '보증 인원은 언제 확정하나요?',
    a: '예식일 기준 3주 전(D-3주)까지 확정해 주시면 됩니다.',
  },
  {
    q: '예상 하객 수가 변경되면 어떻게 하나요?',
    a: '예식일 3주 전까지 하객 수를 변경하실 수 있습니다. 다만 계약하신 보증인원보다 상향은 가능하나, 하향은 불가능한 점 양해 부탁드립니다.',
  },
  {
    q: '시식은 언제 가능한가요?',
    a: '예식일로부터 3개월 전부터 시식이 가능합니다.',
  },
  {
    q: '주차는 몇 시간 지원되나요?',
    a: '신랑·신부님과 혼주분 차량은 8시간, 하객분들은 4시간 지원됩니다.',
  },
  {
    q: '예식 시간과 홀 사용시간은 어떻게 되나요?',
    a: '두 분을 위한 홀 사용시간은 총 6시간 제공되며, 그중 예식은 평균 2시간 정도 소요됩니다.',
  },
  {
    q: '부모님과 함께 계약 전에 홀을 한 번 더 볼 수 있나요?',
    a: '네, 언제든지 재방문하셔서 홀을 둘러보시고 상담받아 보실 수 있습니다.',
  },
  {
    q: '견적 외에 추가될 수 있는 비용이 있나요?',
    a: '현장에서 추가로 드시는 음주류 비용 외에는 추가 비용이 없습니다.',
  },
];

// 플라워 등급별 안내 (탭 선택 시 노출)
const FLOWER_GRADE_INFO: Record<'basic' | 'luxury' | 'grand', { desc: string; includes: string[] }> = {
  basic: {
    desc: '베이직은 웨딩 공간의 핵심 포인트를 깔끔하게 완성하는 기본 구성입니다. 과하지 않으면서도 단정하고 세련된 분위기를 원하시는 분들께 추천드립니다.',
    includes: ['로드입구 장식', '신부 대기실', '포토 테이블', '테이블 센터피스'],
  },
  luxury: {
    desc: '럭셔리는 베이직 구성보다 한층 더 풍성한 사이즈와 디테일을 더한 업그레이드 구성입니다. 특히 버진로드와 단상 연출을 중요하게 생각하시는 신랑·신부님께 추천드리며, 전체 공간이 보다 풍성하고 화사하게 느껴지는 구성입니다.',
    includes: [
      '로드입구 장식 (Size Up)',
      '신부 대기실 (Size Up)',
      '포토 테이블 (Size Up)',
      '테이블 센터피스 (Size Up)',
      '버진로드 꽃길 조화 추가',
      '단상 조화 추가',
    ],
  },
  grand: {
    desc: '그랜드는 플렌티 웨딩 플라워의 가장 풍성한 프리미엄 구성입니다. 럭셔리 구성에 생화 디테일과 반달 아치, 포토월, 칵테일바 연출까지 더해져 홀 전체가 하나의 웨딩 콘셉트처럼 완성됩니다. 버진로드와 단상에는 조화와 생화가 함께 더해져 더욱 입체적이고 고급스러운 분위기를 만들고, 신부 대기실 반달 아치와 포토월은 사진에 남는 장면까지 풍성하게 채워줍니다. 하객에게 깊은 인상을 남기고, 사진과 영상에 남는 장면이 더욱더 아름답게 느껴지는 구성입니다.',
    includes: [
      '로드입구 장식 (Size Up)',
      '신부 대기실 (Size Up) + 반달 아치 추가',
      '포토 테이블 (Size Up)',
      '테이블 센터피스 (Size Up)',
      '버진로드 꽃길 조화&생화 추가',
      '단상 조화&생화 추가',
      '포토월 추가',
      '칵테일바 추가',
    ],
  },
};

// 섹션 공통 스타일
// 모바일 우선 + md(768px~) 이상 PC에서는 폭·글자·여백 확대
const S = {
  wrap: 'max-w-md md:max-w-2xl mx-auto px-5 md:px-8',
  h2: 'font-serif text-[19px] md:text-[25px] leading-snug font-bold text-[#3f342a] whitespace-pre-line',
  body: 'mt-3 md:mt-4 text-[14px] md:text-[15.5px] leading-relaxed text-[#6b6157] whitespace-pre-line',
  divider: 'w-8 h-[2px] bg-[#c9a96a] mx-auto my-10 md:my-14',
};

export default function WeddingLandingPublic() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<LandingPayload | null>(null);
  const [error, setError] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false); // 풀 영상 (mp4) 오버레이 플레이어
  const [flowerTab, setFlowerTab] = useState<'basic' | 'luxury' | 'grand'>('basic');
  const [flowerLoc, setFlowerLoc] = useState(''); // 소분류(위치) 필터 — 빈 값이면 첫 위치
  const [ctaSent, setCtaSent] = useState<'contract' | 'call' | null>(null);
  const [ctaSending, setCtaSending] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/landing/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  const media = data?.media || null;
  const kakao = media?.kakao_url || DEFAULT_KAKAO;
  const dt = useMemo(() => fmtDateTime(data?.wedding_datetime), [data?.wedding_datetime]);

  async function clickCta(action: 'contract' | 'call') {
    if (ctaSent || ctaSending || !token) return;
    setCtaSending(true);
    try {
      await fetch(`/api/public/landing/${token}/cta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      setCtaSent(action);
    } catch {
      alert('전송에 실패했습니다. 카카오톡 채널로 문의해주세요.');
    } finally {
      setCtaSending(false);
    }
  }

  // ── 로딩 / 오류 / 마감 상태 ──
  if (error) {
    return (
      <Shell>
        <NoticeCard emoji="🌸" title="유효하지 않은 링크입니다" body={'링크 주소를 다시 확인해 주세요.\n궁금하신 점은 카카오톡 채널로 편하게 문의해 주세요.'} kakao={kakao} />
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <div className="py-40 text-center text-[#a99e90] text-sm tracking-widest">LOADING…</div>
      </Shell>
    );
  }
  if (data.state === 'closed' || data.state === 'expired') {
    return (
      <Shell>
        <NoticeCard
          emoji="🌙"
          title={data.state === 'expired' ? '가블록 기간이 종료되었습니다' : '이 페이지는 마감되었습니다'}
          body={
            '보내주신 관심에 진심으로 감사드립니다.\n날짜 확인이나 새로운 상담을 원하시면\n카카오톡 채널로 편하게 문의해 주세요.'
          }
          kakao={kakao}
        />
      </Shell>
    );
  }
  if (data.state === 'contracted') {
    return (
      <Shell>
        <div className={`${S.wrap} pt-24 pb-20 text-center`}>
          <img src={LOGO_URL} alt="PLENTY CONVENTION" className="mx-auto w-44 md:w-56" />
          <div className="mt-8 text-3xl">💍</div>
          <h1 className="mt-6 font-serif text-[22px] md:text-[28px] font-bold text-[#3f342a] leading-relaxed">
            {data.groom_name} 신랑님 & {data.bride_name} 신부님
          </h1>
          <p className="mt-6 text-[14px] md:text-[16px] leading-relaxed text-[#6b6157]">
            두 분의 소중한 예식을
            <br />
            PLENTY와 함께해 주셔서 진심으로 감사드립니다.
            <br />
            <br />
            예식일까지 담당자가 준비 과정 하나하나
            <br />
            정성을 다해 함께 하겠습니다.
            <br />
            궁금하신 점은 언제든 편하게 연락 주세요.
          </p>
          <a href={kakao} target="_blank" rel="noreferrer" className="inline-block mt-10 px-8 py-3.5 rounded-full bg-[#3f342a] text-white text-sm font-semibold">
            💬 담당자에게 문의하기
          </a>
          <Footer />
        </div>
      </Shell>
    );
  }

  // ── active — 본 랜딩 ──
  const priorities = data.priorities || [];
  // 자유 추가 문구 — 쉼표(,)로 구분하면 각각 별도 번호 줄로 노출
  const customNotes = (data.custom_note || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasQuote = Boolean(data.quote_html);
  // 플라워: 현재 등급의 사진 → 위치(소분류) 목록 → 선택된 위치만 필터
  const gradePhotos = media?.flower_photos?.[flowerTab] || [];
  const flowerLocs = [...new Set(gradePhotos.map((p) => p.loc).filter(Boolean))] as string[];
  const activeLoc = flowerLoc && flowerLocs.includes(flowerLoc) ? flowerLoc : flowerLocs[0] || '';
  const flowerPhotos = activeLoc ? gradePhotos.filter((p) => p.loc === activeLoc) : gradePhotos;
  const gradeInfo = FLOWER_GRADE_INFO[flowerTab];

  return (
    <Shell>
      {/* 1. Hero */}
      <header className={`${S.wrap} pt-14 md:pt-20 pb-4 text-center`}>
        <img src={LOGO_URL} alt="PLENTY CONVENTION" className="mx-auto w-48 md:w-64" />
        <div className="text-[10px] md:text-[11.5px] tracking-[0.5em] text-[#b7ab9b] mt-3">WEDDING</div>
        <p className="mt-10 text-[14px] md:text-[16px] text-[#8a7f71]">안녕하세요.</p>
        <h1 className="mt-3 font-serif text-[22px] md:text-[30px] font-bold text-[#3f342a] leading-relaxed">
          {data.groom_name} 신랑님
          <span className="mx-1.5 text-[#d76a77]">💗</span>
          {data.bride_name} 신부님
        </h1>
        <p className="mt-8 font-serif text-[17px] md:text-[22px] leading-relaxed text-[#5d5245]">
          두 분이 꿈꾸는 결혼식이
          <br />
          PLENTY에서는 어떤 모습으로 완성될까요?
        </p>
      </header>

      {/* 2. 가블록 카드 */}
      <section className={`${S.wrap} mt-8`}>
        <div className="rounded-2xl border border-[#e8ddc9] bg-gradient-to-b from-[#fdfaf4] to-[#f8f1e4] px-6 py-7 md:px-10 md:py-10 text-center shadow-sm">
          <div className="text-[11px] md:text-[12.5px] tracking-[0.25em] text-[#b0956a] font-semibold">RESERVED FOR YOU</div>
          <div className="mt-3 font-serif text-[19px] md:text-[26px] font-bold text-[#3f342a]">{dt.date}</div>
          <div className="mt-0.5 font-serif text-[17px] md:text-[21px] text-[#3f342a]">{dt.time}</div>
          <p className="mt-4 text-[13px] md:text-[15px] leading-relaxed text-[#8a7461]">
            이 날짜와 시간은 지금,
            <br />두 분만을 위해 <b className="text-[#a3541f]">안전하게 가블록</b> 되어 있습니다.
          </p>
          {data.block_until && (
            <div className="mt-4 inline-block rounded-full bg-white/80 border border-[#e8ddc9] px-4 py-1.5 text-[12px] md:text-[14px] text-[#8a7461]">
              두 분을 위한 가블록 기간 : <b className="text-[#3f342a]">~ {fmtShortDate(data.block_until)}까지</b>
            </div>
          )}
        </div>
      </section>

      {/* 3. 홀 영상 + 퀵 버튼 */}
      <section className={`${S.wrap} mt-6`}>
        {media?.hall_video_url && (
          // 자동재생(무음 루프) + 컨트롤 — 멈추거나 되감아 다시 볼 수 있음
          <video
            className="mb-6 w-full rounded-2xl shadow-md"
            src={media.hall_video_url}
            poster={media.hall_video_poster || undefined}
            controls
            autoPlay
            muted
            loop
            playsInline
          />
        )}
        <div className="grid grid-cols-3 gap-2">
          {hasQuote ? (
            <button onClick={() => setQuoteOpen(true)} className="rounded-xl bg-[#3f342a] text-white py-3.5 md:py-5 text-[12.5px] md:text-[15px] font-semibold leading-tight">
              📋<br />맞춤 견적 보기
            </button>
          ) : (
            <a href={kakao} target="_blank" rel="noreferrer" className="rounded-xl bg-[#3f342a] text-white py-3.5 md:py-5 text-[12.5px] md:text-[15px] font-semibold leading-tight text-center">
              📋<br />견적 문의하기
            </a>
          )}
          {media?.full_video_url ? (
            /\.mp4($|\?)/i.test(media.full_video_url) ? (
              // mp4 → 페이지 안 오버레이 플레이어로 재생
              <button onClick={() => setVideoOpen(true)} className="rounded-xl border border-[#d9cdb9] bg-white text-[#3f342a] py-3.5 md:py-5 text-[12.5px] md:text-[15px] font-semibold leading-tight text-center">
                ▶<br />영상 시청하기
              </button>
            ) : (
              // YouTube 등 외부 링크 → 새 탭
              <a href={media.full_video_url} target="_blank" rel="noreferrer" className="rounded-xl border border-[#d9cdb9] bg-white text-[#3f342a] py-3.5 md:py-5 text-[12.5px] md:text-[15px] font-semibold leading-tight text-center">
                ▶<br />영상 시청하기
              </a>
            )
          ) : (
            <a href={kakao} target="_blank" rel="noreferrer" className="rounded-xl border border-[#d9cdb9] bg-white text-[#3f342a] py-3.5 md:py-5 text-[12.5px] md:text-[15px] font-semibold leading-tight text-center">
              ▶<br />영상 요청하기
            </a>
          )}
          <a href={kakao} target="_blank" rel="noreferrer" className="rounded-xl border border-[#d9cdb9] bg-white text-[#3f342a] py-3.5 md:py-5 text-[12.5px] md:text-[15px] font-semibold leading-tight text-center">
            💬<br />담당자에게 질문
          </a>
        </div>
      </section>

      {/* 4. 상담 중시항목 */}
      {(priorities.length > 0 || data.custom_note) && (
        <section className={`${S.wrap} mt-12`}>
          <p className="text-[13px] md:text-[15px] text-[#8a7f71] text-center leading-relaxed">
            상담에서 나눴던 내용을 바탕으로
            <br />
            공간, 플라워, 음식, 진행과 예상 비용까지
            <br />두 분의 결혼식을 조금 더 구체적으로 준비해 두었습니다.
          </p>
          <div className="mt-6 rounded-2xl bg-white border border-[#eee5d5] px-6 py-6 md:px-10 md:py-8 shadow-sm">
            <div className="text-[12px] md:text-[13.5px] font-semibold tracking-wide text-[#b0956a] text-center mb-4">
              상담에서 두 분이 중요하게 생각하신 것
            </div>
            <ol className="space-y-2.5">
              {priorities.map((k, i) => (
                <li key={k} className="flex gap-2.5 text-[14px] md:text-[16px] leading-relaxed text-[#4d4237]">
                  <span className="font-serif font-bold text-[#c9a96a]">{i + 1}.</span>
                  <span>{WEDDING_PRIORITY_SENTENCE[k]}</span>
                </li>
              ))}
              {customNotes.map((note, i) => (
                <li key={`c${i}`} className="flex gap-2.5 text-[14px] md:text-[16px] leading-relaxed text-[#4d4237]">
                  <span className="font-serif font-bold text-[#c9a96a]">{priorities.length + i + 1}.</span>
                  <span>{note}</span>
                </li>
              ))}
            </ol>
            <p className="mt-5 pt-4 border-t border-[#f1e9da] text-[13.5px] md:text-[15px] leading-relaxed text-[#8a7461] text-center">
              PLENTY의 <b>단독홀 운영 방식</b>과 웨딩 연출은
              <br />두 분이 말씀하신 결혼식과 잘 맞습니다.
            </p>
          </div>
        </section>
      )}

      <div className={S.divider} />

      {/* 5. 단독홀 */}
      <section className={`${S.wrap} text-center`}>
        <h2 className={S.h2}>{'하객이 입장하는 순간부터,\n두 분의 예식만을 위한 공간'}</h2>
        <p className={S.body}>
          {'한 시간 단위로 여러 예식이 교차하는 공간이 아닌,\n두 분의 예식과 하객에게만 집중할 수 있도록 운영됩니다.\n\n웅장한 미디어월과 긴 버진로드, 높은 층고는\n신부 입장의 순간을 더욱 선명하게 만들어 줍니다.'}
        </p>
      </section>

      <div className={S.divider} />

      {/* 6. 플라워 */}
      <section className={`${S.wrap} text-center`}>
        <h2 className={S.h2}>{'같은 공간도 어떤 꽃과 색을\n선택하느냐에 따라,\n전혀 다른 결혼식으로 완성됩니다'}</h2>
        <p className={S.body}>
          {'PLENTY의 웨딩 플라워는 정해진 장식을\n그대로 사용하는 방식이 아닙니다.\n두 분의 취향과 계절, 드레스와 예식 분위기까지 고려해\n가장 어울리는 연출을 제안합니다.'}
        </p>
        <p className="mt-3 text-[12px] md:text-[13px] leading-relaxed text-[#a89a86]">
          ※ 플라워의 기본 컬러는 화이트 베이스에 그린 소재 약 20%가 기본 구성이며, 신랑신부님이
          원하시는 웨딩 무드에 맞는 유색 플라워를 선택하여 포인트 컬러로 연출하실 수 있습니다.
        </p>
        {media?.flower_photos && (
          <div className="mt-6">
            {/* 대분류 탭 */}
            <div className="flex justify-center gap-1.5">
              {(['basic', 'luxury', 'grand'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setFlowerTab(t);
                    setFlowerLoc(''); // 등급 바꾸면 소분류는 첫 위치로
                  }}
                  className={
                    'px-4 py-1.5 md:px-5 md:py-2 rounded-full text-[11px] md:text-[12.5px] tracking-[0.15em] font-semibold border transition ' +
                    (flowerTab === t
                      ? 'bg-[#3f342a] text-white border-[#3f342a]'
                      : 'bg-white text-[#8a7f71] border-[#d9cdb9]')
                  }
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>

            {/* 등급 안내 설명 */}
            <div className="mt-4 rounded-xl bg-white/80 border border-[#eee5d5] px-5 py-4 md:px-7 md:py-5 text-left">
              <p className="text-[13px] md:text-[14.5px] leading-relaxed text-[#5d5245]">
                {gradeInfo.desc}
              </p>
              <div className="mt-2.5 pt-2.5 border-t border-[#f1e9da] text-[11.5px] md:text-[12.5px] leading-relaxed text-[#a3906f]">
                <b className="text-[#b0956a]">포함 구성</b> · {gradeInfo.includes.join(' · ')}
              </div>
            </div>

            {/* 소분류(위치) 버튼 */}
            {flowerLocs.length > 0 && (
              <div className="mt-4 flex justify-center gap-1.5 flex-wrap">
                {flowerLocs.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setFlowerLoc(loc)}
                    className={
                      'px-3.5 py-1 md:px-4 md:py-1.5 rounded-full text-[11.5px] md:text-[13px] border transition ' +
                      (activeLoc === loc
                        ? 'bg-[#c9a96a] text-white border-[#c9a96a] font-semibold'
                        : 'bg-white text-[#8a7f71] border-[#e4d9c4]')
                    }
                  >
                    {loc}
                  </button>
                ))}
              </div>
            )}

            {flowerPhotos.length > 0 ? (
              <div className="mt-4 flex gap-2.5 overflow-x-auto pb-2 -mx-5 px-5 snap-x">
                {flowerPhotos.map((p, i) => (
                  <img
                    key={`${activeLoc}${i}`}
                    src={p.url}
                    alt={`${p.loc || flowerTab} ${i + 1}`}
                    loading="lazy"
                    className="h-64 md:h-96 rounded-xl shadow-sm snap-center shrink-0 object-cover"
                  />
                ))}
              </div>
            ) : (
              <div className="mt-4 text-[12px] text-[#b7ab9b]">사진 준비 중입니다.</div>
            )}
          </div>
        )}
      </section>

      {/* 7. 견적 */}
      {hasQuote && (
        <>
          <div className={S.divider} />
          <section className={`${S.wrap}`}>
            <div className="rounded-2xl bg-[#3f342a] text-white px-6 py-7 md:px-10 md:py-10 text-center shadow-md">
              <div className="text-[11px] md:text-[12.5px] tracking-[0.3em] text-[#d8c49a] font-semibold">ESTIMATE</div>
              <p className="mt-4 text-[13.5px] md:text-[15.5px] leading-relaxed text-[#e8e0d3]">
                두 분의 상담 내용을 기준으로 산출한 견적입니다.
              </p>
              <div className="mt-4 text-[14px] md:text-[16px]">
                {data.guest_count != null && (
                  <>
                    예상 하객 <b className="font-serif text-[17px] md:text-[20px]">{data.guest_count.toLocaleString()}명</b> 기준
                    <br />
                  </>
                )}
                총 예상 비용{' '}
                <b className="font-serif text-[20px] md:text-[26px] text-[#f0d9a8]">{data.total_amount}원</b>
              </div>
              <button
                onClick={() => setQuoteOpen(true)}
                className="mt-5 px-8 py-3 md:py-3.5 rounded-full bg-white text-[#3f342a] text-[13.5px] md:text-[15px] font-bold"
              >
                견적서 자세히 보기
              </button>
            </div>
          </section>
        </>
      )}

      <div className={S.divider} />

      {/* 8. 다이닝 */}
      <section className={`${S.wrap} text-center`}>
        <h2 className={S.h2}>{'예식이 끝난 뒤 하객들이\n가장 오래 이야기하는 것은,\n결국 식사와 대접받았다는 기억입니다'}</h2>
        <p className={S.body}>
          {'PLENTY는 식사가 예식과 분리되어 흐름이 끊기는 방식이 아니라,\n두 분의 예식을 함께 즐기며 식사할 수 있도록 운영됩니다.\n\n음식의 온도, 제공 속도, 테이블 서비스까지\n하객의 만족도를 기준으로 준비합니다.'}
        </p>
        {media?.menu_photos && (
          <div className="mt-6 space-y-5">
            {(['a', 'b', 'c', 'option'] as const).map((c) =>
              media.menu_photos?.[c]?.length ? (
                <div key={c}>
                  <div className="text-[11px] md:text-[13px] tracking-[0.25em] font-semibold text-[#b0956a] mb-2">
                    {c === 'option' ? 'OPTION · 잔치국수' : `${c.toUpperCase()} COURSE`}
                  </div>
                  {media.menu_photos[c]!.map((src, i) => (
                    <img
                      key={i}
                      src={src}
                      alt={c === 'option' ? '잔치국수 (추가메뉴)' : `${c} course`}
                      loading="lazy"
                      className="w-full rounded-xl shadow-sm object-cover"
                    />
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}
      </section>

      <div className={S.divider} />

      {/* 9. 오시는길 */}
      <section className={`${S.wrap} text-center`}>
        <h2 className={S.h2}>{'서울 어느 지역에서 출발하더라도,\n설명하기 쉬운 위치는\n하객 초대의 부담을 줄여줍니다'}</h2>
        <p className={S.body}>
          {'고속터미널과 가까워 서울 하객뿐 아니라,\n지방에서 오시는 하객도 편리하게 방문할 수 있습니다.'}
        </p>
        {media?.directions_image && (
          <img
            src={media.directions_image}
            alt="오시는 길"
            loading="lazy"
            className="mt-6 w-full rounded-2xl shadow-sm"
          />
        )}
      </section>

      <div className={S.divider} />

      {/* 10. 최종 CTA */}
      <section className={`${S.wrap}`}>
        <div className="rounded-2xl border border-[#e8ddc9] bg-gradient-to-b from-[#fdfaf4] to-[#f8f1e4] px-6 py-8 md:px-12 md:py-10 text-center shadow-sm">
          {ctaSent ? (
            <div className="py-4">
              <div className="text-2xl">🕊️</div>
              <div className="mt-3 font-serif text-[17px] font-bold text-[#3f342a]">
                담당자에게 전달되었습니다
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-[#8a7461]">
                계약 절차와 결제 방법을 곧 안내드리겠습니다.
                <br />
                조금만 기다려 주세요 :)
              </p>
              <a
                href={kakao}
                target="_blank"
                rel="noreferrer"
                className="inline-block mt-4 px-6 py-2.5 rounded-full bg-white border border-[#d9cdb9] text-[#3f342a] text-[12.5px] font-semibold"
              >
                💬 담당자와 카카오톡 상담하기
              </a>
            </div>
          ) : (
            <>
              <p className="font-serif text-[16.5px] md:text-[21px] leading-relaxed text-[#3f342a] font-bold">
                두 분이 선택하신 날짜와 시간,
                <br />
                PLENTY에서 확정하고 싶으시다면
              </p>
              <p className="mt-3 text-[12.5px] md:text-[14.5px] leading-relaxed text-[#8a7461]">
                담당자가 계약 절차와 결제 방법을 안내드립니다.
                <br />
                아직 고민이 남아 있다면, 결정 전에 편하게 질문해 주세요.
              </p>
              <div className="mt-5 space-y-2.5">
                <button
                  onClick={() => clickCta('contract')}
                  disabled={ctaSending}
                  className="w-full py-4 md:py-5 rounded-xl bg-[#a3541f] text-white text-[14.5px] md:text-[16.5px] font-bold shadow disabled:opacity-60"
                >
                  💍 이 날짜로 계약하고 싶어요
                </button>
                <a
                  href={kakao}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full py-4 md:py-5 rounded-xl bg-white border border-[#d9cdb9] text-[#3f342a] text-[14.5px] md:text-[16.5px] font-bold text-center"
                >
                  💬 담당자와 카카오톡 상담하기
                </a>
              </div>
            </>
          )}
        </div>
      </section>

      {/* 11. FAQ */}
      <section className={`${S.wrap} mt-12`}>
        <div className="text-center">
          <div className="text-[11px] tracking-[0.3em] text-[#b0956a] font-semibold">FAQ</div>
          <h2 className={`${S.h2} mt-2`}>자주 묻는 질문</h2>
        </div>
        <div className="mt-5 divide-y divide-[#eee5d5] border-y border-[#eee5d5]">
          {FAQ.map((f, i) => (
            <div key={i}>
              <button
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                className="w-full flex items-start justify-between gap-3 py-3.5 text-left"
              >
                <span className="text-[13.5px] md:text-[15.5px] font-semibold text-[#4d4237] leading-snug">
                  Q{i + 1}. {f.q}
                </span>
                <span className="text-[#b0956a] text-sm shrink-0 mt-0.5">{faqOpen === i ? '−' : '+'}</span>
              </button>
              {faqOpen === i && (
                <p className="pb-4 text-[13px] md:text-[14.5px] leading-relaxed text-[#8a7f71]">{f.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <Footer />

      {/* 풀 영상 오버레이 플레이어 (mp4) */}
      {videoOpen && media?.full_video_url && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            <div className="text-sm font-semibold tracking-[0.25em] text-[#d8c49a]">PLENTY FILM</div>
            <button onClick={() => setVideoOpen(false)} className="text-sm px-3 py-1 rounded-full bg-white/15 text-white">
              닫기 ✕
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-2">
            <video src={media.full_video_url} controls autoPlay playsInline className="max-h-full w-full rounded-lg" />
          </div>
        </div>
      )}

      {/* 견적서 전체보기 오버레이 */}
      {quoteOpen && data.quote_html && (
        <div className="fixed inset-0 z-50 bg-black/60 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-[#3f342a] text-white shrink-0">
            <div className="text-sm font-semibold tracking-wide">WEDDING ESTIMATE</div>
            <button onClick={() => setQuoteOpen(false)} className="text-sm px-3 py-1 rounded-full bg-white/15">
              닫기 ✕
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-[#f2eee7] p-3">
            <style>{QUOTE_CSS}</style>
            <div
              className="qbox !px-4 !py-5"
              style={{ fontSize: '12px' }}
              dangerouslySetInnerHTML={{ __html: data.quote_html }}
            />
          </div>
        </div>
      )}
    </Shell>
  );
}

// 페이지 셸 — 배경/폰트. 세리프는 시스템 명조 계열 폴백.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#faf7f1]" style={{ wordBreak: 'keep-all' }}>
      <style>{`
        .font-serif { font-family: 'Noto Serif KR', 'Nanum Myeongjo', 'Apple SD Gothic Neo', serif; }
      `}</style>
      {children}
    </div>
  );
}

function NoticeCard({ emoji, title, body, kakao }: { emoji: string; title: string; body: string; kakao: string }) {
  return (
    <div className="max-w-md md:max-w-xl mx-auto px-5 pt-28 pb-20 text-center">
      <img src={LOGO_URL} alt="PLENTY CONVENTION" className="mx-auto w-44 md:w-56" />
      <div className="mt-10 text-3xl md:text-4xl">{emoji}</div>
      <h1 className="mt-5 font-serif text-[19px] md:text-[24px] font-bold text-[#3f342a]">{title}</h1>
      <p className="mt-4 text-[13.5px] md:text-[15.5px] leading-relaxed text-[#8a7f71] whitespace-pre-line">{body}</p>
      <a
        href={kakao}
        target="_blank"
        rel="noreferrer"
        className="inline-block mt-8 px-8 py-3.5 rounded-full bg-[#3f342a] text-white text-sm font-semibold"
      >
        💬 카카오톡 채널 문의
      </a>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-16 pb-12 text-center">
      <div className="text-[10px] md:text-[11.5px] tracking-[0.35em] text-[#c2b7a5] font-semibold">PLENTY CONVENTION</div>
      <div className="mt-1.5 text-[10.5px] md:text-[12px] text-[#c2b7a5]">
        09:00–18:00 · 일/월/공휴일 휴무 · 카카오톡채널 PLENTY
      </div>
      <div className="mt-1 text-[10.5px] md:text-[12px] text-[#c2b7a5]">
        <a href="mailto:rsvn@h-kitchen.co.kr">E-mail. rsvn@h-kitchen.co.kr</a>
        {' · '}
        <a href="tel:010-6575-1598">Phone. 010-6575-1598</a>
      </div>
    </footer>
  );
}
