// 웨딩 가예약 고객용 공개 랜딩 (/l/:token) — 모바일 세로형 최적화.
// 인증 없이 토큰만으로 접근. 데이터는 /api/public/landing/:token (견적은 서버 저장 스냅샷).
// 상태: active(전체 노출) · contracted(계약 감사 화면) · closed/expired(마감 안내).

import { useEffect, useMemo, useRef, useState } from 'react';
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
  mode?: 'block' | 'consult'; // block=가블록(기본) / consult=상담만 하고 간 고객용
  groom_name: string;
  bride_name: string;
  wedding_datetime?: string;
  block_until?: string;
  priorities?: WeddingPriorityKey[];
  custom_note?: string;
  guest_count?: number | null;
  total_amount?: string;
  quote_html?: string;
  benefits?: { label: string; amount: number }[]; // 발행 시점 혜택 스냅샷
  media?: WeddingLandingMedia | null;
}

const DEFAULT_KAKAO = 'https://pf.kakao.com/_xfGwxob';
// 브랜드 로고 (키컬러를 페이지 팔레트의 브라운으로 리컬러한 버전, 투명배경)
const LOGO_URL =
  'https://storage.googleapis.com/plenty-management.firebasestorage.app/wedding-landing/brand/logo_brown.png';
// 히어로 배경 — 포토월+플라워 (상단은 크림 베일로 텍스트 가독성 확보)
const HERO_BG_URL =
  'https://storage.googleapis.com/plenty-management.firebasestorage.app/wedding-landing/brand/main_bg_v1.jpg';
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

// FAQ — 카테고리별 그룹. 질문 번호는 전체 통합 번호(Q1~)로 표시.
const FAQ_GROUPS: { title: string; items: { q: string; a: string }[] }[] = [
  {
    title: '계약 · 일정',
    items: [
      {
        q: '가블록 기간에는 다른 고객이 계약할 수 없나요?',
        a: '네. 가블록 기간 동안 해당 날짜와 시간은 두 분만을 위해 안전하게 블록되어 있으며, 해지 전까지 유지됩니다.',
      },
      {
        q: '웨딩 계약 최소 인원은 몇 명인가요?',
        a: '기본 최소 보증인원은 250명이며, 잔여 일정 또는 비수기 일정의 경우 200명까지 유연하게 조정 가능합니다.',
      },
      {
        q: '계약금은 얼마이며, 환불 규정은 어떻게 되나요?',
        a: '계약금은 154만원입니다. 계약일로부터 30일 이내이면서 예식 예정일 180일 전 해제 시, 계약금 전액 환불이 가능합니다.',
      },
      {
        q: '계약 후 예식일 변경이 가능한가요?',
        a: '예식일로부터 6개월 이내 1회에 한하여 예식 연기가 가능하며, 날짜에 따라 예식 비용은 변경될 수 있습니다.',
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
        q: '부모님과 함께 계약 전에 홀을 한 번 더 볼 수 있나요?',
        a: '네, 언제든지 재방문하셔서 홀을 둘러보시고 상담받아 보실 수 있습니다.',
      },
    ],
  },
  {
    title: '예식 진행',
    items: [
      {
        q: '예식 시간과 홀 사용시간은 어떻게 되나요?',
        a: '단독 예식으로 예식 시간은 토요일 12시·18시 / 일요일 12시, 주 최대 3팀으로 진행되며 6시간 간격, 2시간 예식으로 진행됩니다.\n신랑·신부님과 혼주님은 예식 2시간 전부터 5시간 이용 가능합니다. (12시 예식: 10시~15시 / 18시 예식: 16시~21시)',
      },
      {
        q: '예식 순서는 어떻게 진행되나요?',
        a: '12시 예식 기준, 1부(본식)는 12:00~12:30 (약 30~40분 소요)이며 예배식·뮤지컬 웨딩은 10~20분 추가 소요됩니다.\n2부 예식은 13:30~13:40 (약 10~15분 소요), 재입장 → 케익 커팅 → 축배 제의 순으로 진행됩니다.',
      },
      {
        q: '주례식, 예배식도 진행 가능한가요?',
        a: '주례식, 주례 없는 식, 예배식, 뮤지컬 예식 모두 진행 가능하며 진행팀은 별도 섭외 부탁드립니다.',
      },
      {
        q: '전문 사회자가 필수인가요?',
        a: '전문 사회자 또는 지인 사회자로 섭외 부탁드리며, 전문 사회자 섭외 문의 시 추천 업체를 안내드립니다.',
      },
      {
        q: '본식 촬영 필수 업체가 있나요?',
        a: '제휴 업체 또는 외부 섭외 업체 모두 진행 가능하며, 별도 반입비는 발생하지 않습니다.',
      },
      {
        q: '식전 영상, 식중 영상 재생이 가능한가요?',
        a: '식전·식중 영상 모두 재생 가능하며, 미디어월 풀사이즈 제작 희망 시 규격을 별도 안내드립니다.',
      },
      {
        q: '무빙포스터, 미디어월 그래픽 영상 제작 시 재생 가능한가요?',
        a: '제작 영상 재생 가능합니다. 미디어월 규격·해상도 등 사전 확인이 필요하니, 제작 전 업체측 샘플을 공유해 주시면 확인 후 안내드립니다.',
      },
      {
        q: '예식 음악은 어떻게 진행하나요?',
        a: '예식 진행곡은 BGM으로 진행하고 있으며, 라이브 연주 희망 시 별도 섭외를 안내드립니다.',
      },
      {
        q: '홀 내 중계화면이 있나요?',
        a: '메인홀 빔스크린 2대, 신부대기실 중계TV 1대를 보유하고 있으며, 서브홀은 빔스크린 1대 또는 중계TV 최대 2대로 중계됩니다.',
      },
      {
        q: '지정석 진행이 가능한가요?',
        a: '원활한 진행을 위해 테이블명에 한하여 지정 가능하며, 각 좌석명 지정은 어렵습니다.',
      },
    ],
  },
  {
    title: '식사 · 정산',
    items: [
      {
        q: '시식은 언제 가능한가요?',
        a: '예식일로부터 3개월 전부터 시식이 가능합니다.',
      },
      {
        q: '선식사가 가능한가요?',
        a: '메인홀은 1부 종료 후 식사가 시작되며, 서브홀에 한하여 선식사가 제공됩니다.',
      },
      {
        q: '소인 코스가 따로 있나요?',
        a: '대인/소인 동일한 코스로 준비됩니다.',
      },
      {
        q: '비건 하객 메뉴 제공이 가능한가요?',
        a: '비건 전용 메뉴를 구성하여 비건 식사하실 하객 테이블에 제공해드립니다.',
      },
      {
        q: '신랑·신부, 혼주 식사는 제공되나요?',
        a: '신랑·신부 식사는 진행되지 않으며, 혼주 식사는 메인홀 내 가족석에서 제공해드립니다.\n정산 시 혼주님 식사를 포함하여 집계됩니다.',
      },
      {
        q: '식사 집계는 어떤 식으로 하나요?',
        a: '메인 식사 제공 수량을 기준으로 산정되며, 보증 인원 미달 시에는 최종 보증 인원으로 정산됩니다.',
      },
      {
        q: '식권 집계도 가능한가요?',
        a: '동시 예식의 경우 별도의 식권은 제공되지 않으며, 하객 인원 파악·결제 비율 확인 등이 필요한 경우 개별적으로 준비 부탁드립니다.\n개인 식권은 홀 입장 시 회수되거나 실 결제 인원에 반영되지 않습니다.',
      },
      {
        q: '최종 보증인원보다 하객 수가 적을 경우, 정산은 어떻게 되나요?',
        a: '예식 당일 참석 인원이 최종 확정 보증 인원보다 적을 경우 최종 확정 보증 인원 기준으로 식대가 정산되며,\n보증인원 초과 시 제공된 식대 초과분에 대해서도 추가 정산됩니다.',
      },
      {
        q: '식사 제공 수량이 넘어도 하객 식사 준비가 가능한가요?',
        a: '최종 보증인원 +10%까지 식사 준비 및 하객석이 세팅되며, 10% 이상 하객 방문을 고려하여 개인 답례품을 사전 준비 부탁드립니다.\n개인 답례품을 준비하지 않았을 경우 현장에서 답례용 와인 준비가 가능하며, 정산 시 합산하여 정산됩니다.',
      },
      {
        q: '예식 후 결제 방식은 어떻게 진행되나요?',
        a: '예식 종료 후 결제가 진행되며, 양가 반반·신랑측 또는 신부측 전액·비율 정산이 가능합니다. 카드·계좌이체·현금 결제 모두 가능합니다.',
      },
      {
        q: '견적 외에 추가될 수 있는 비용이 있나요?',
        a: '현장에서 추가로 드시는 음주류 비용 외에는 추가 비용이 없습니다.',
      },
    ],
  },
  {
    title: '시설 · 편의',
    items: [
      {
        q: '홀 수용 인원은 몇 명인가요?',
        a: '메인홀 최대 300석, 서브홀 50~100석까지 수용 가능합니다.',
      },
      {
        q: '혼주 대기실이 있나요?',
        a: '혼주 대기실을 보유하고 있으며, 12시 예식에 한하여 출장 메이크업 진행이 가능합니다.',
      },
      {
        q: '대기실에 화장실이 있나요?',
        a: '신부 대기실·혼주 대기실 내 전용 화장실을 보유하고 있습니다.',
      },
      {
        q: '의상 탈의실이 있나요?',
        a: '혼주 대기실 내에 신부님 2부 드레스, 혼주님 한복 환복이 가능한 드레스룸을 보유하고 있습니다.',
      },
      {
        q: '아기의자 준비가 가능한가요?',
        a: '아기의자를 보유하고 있으며 요청 시 준비해드립니다.',
      },
      {
        q: '폐백실이 있나요?',
        a: '폐백실은 준비되어 있지 않아 진행이 어렵습니다.',
      },
      {
        q: '화환 반입이 가능한가요?',
        a: '화환 반입 가능하며, 예식 종료 후 리본을 커팅하여 전달드립니다.',
      },
      {
        q: 'ATM 기기가 있나요?',
        a: '웨딩홀 같은 층에 우리은행 ATM 기기를 보유하고 있습니다.',
      },
      {
        q: '개인 락커함이 있나요?',
        a: '개인 락커함은 보유하고 있지 않아, 예식 물품은 혼주 대기실 내 보관 부탁드립니다.',
      },
      {
        q: '주차는 몇 시간 지원되나요?',
        a: '신랑·신부님과 혼주분 차량은 8시간, 하객분들은 4시간 지원됩니다.',
      },
      {
        q: '대절 버스 주차가 가능한가요?',
        a: '대절 버스는 5대까지 주차 가능하며, 4시간 무료 주차 가능합니다.',
      },
      {
        q: '셔틀버스를 운영하나요?',
        a: '셔틀버스는 운영하지 않으며, 자차 및 도보 방문을 권장드립니다.',
      },
    ],
  },
];

// 그룹별 시작 번호 (전체 통합 Q번호 계산용)
const FAQ_OFFSETS = FAQ_GROUPS.map((_, gi) =>
  FAQ_GROUPS.slice(0, gi).reduce((s, g) => s + g.items.length, 0)
);

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
// 실제 고객(신랑신부) 후기 — 네이버 블로그 링크. 썸네일은 자체 Storage 호스팅(핫링크 차단 대비).
const REVIEW_THUMB_BASE =
  'https://storage.googleapis.com/plenty-management.firebasestorage.app/wedding-landing/reviews';
const REVIEW_LINKS: { url: string; title: string; thumb: string }[] = [
  {
    url: 'https://blog.naver.com/km25jung/224251187744',
    title: '플렌티컨벤션에서 결혼식 올린 신부의 찐만족 후기(단점은?)',
    thumb: `${REVIEW_THUMB_BASE}/rv_01.jpg`,
  },
  {
    url: 'https://blog.naver.com/boy2on_/224241082106',
    title: '[결혼준비 #13] 플렌티컨벤션 웨딩홀 시식 후기ㅣ음식·양·구성 솔직 리뷰',
    thumb: `${REVIEW_THUMB_BASE}/rv_02.jpg`,
  },
  {
    url: 'https://blog.naver.com/soom__p/224117306086',
    title: '[플렌티 컨벤션] 예뻤던 웨딩홀 본식 후기: 동시예식, 어두운 홀',
    thumb: `${REVIEW_THUMB_BASE}/rv_03.jpg`,
  },
];

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
  // 메뉴 코스 아코디언 — 기본 전체 접힘, 하나만 펼침. menuIdx: 펼친 코스의 사진 번호
  const [openCourse, setOpenCourse] = useState<'a' | 'b' | 'c' | 'option' | null>(null);
  const [menuIdx, setMenuIdx] = useState(0);
  const flowerStripRef = useRef<HTMLDivElement>(null); // 플라워 가로 스트립 — 방향키 스크롤용
  const reviewStripRef = useRef<HTMLDivElement>(null); // 고객 후기 썸네일 스트립
  const menuTouchX = useRef<number | null>(null); // 메뉴 사진 스와이프 시작 X좌표
  const [ctaSent, setCtaSent] = useState<'contract' | 'call' | null>(null);
  const [ctaSending, setCtaSending] = useState(false);
  const [faqOpen, setFaqOpen] = useState<string | null>(null); // `${그룹}-${항목}` 키
  const [faqGroup, setFaqGroup] = useState<number | null>(null); // 펼친 FAQ 카테고리 (기본 전체 접힘)

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
          title={
            data.state === 'expired'
              ? data.mode === 'consult'
                ? '페이지 열람 기간이 종료되었습니다'
                : '가블록 기간이 종료되었습니다'
              : '이 페이지는 마감되었습니다'
          }
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
  const isConsult = data.mode === 'consult'; // 상담만 하고 간 고객 — 가블록 문구 대신 '열람 기한' 톤
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
      {/* 1. Hero — 포토월 배경 + 크림 베일(위는 진하게=가독성, 아래로 옅어져 꽃이 비침) */}
      <header className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${HERO_BG_URL})` }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(250,247,241,0.96) 0%, rgba(250,247,241,0.93) 55%, rgba(250,247,241,0.8) 72%, rgba(250,247,241,0.45) 88%, rgba(250,247,241,0.3) 96%, #faf7f1 100%)',
          }}
        />
        <div className={`${S.wrap} relative pt-14 md:pt-20 pb-32 md:pb-44 text-center`}>
          <img src={LOGO_URL} alt="PLENTY CONVENTION" className="mx-auto w-48 md:w-64" />
          <div className="text-[10px] md:text-[11.5px] tracking-[0.5em] text-[#b7ab9b] mt-3">WEDDING</div>
          <p className="mt-10 text-[14px] md:text-[16px] text-[#8a7f71]">안녕하세요.</p>
          <h1 className="mt-3 font-serif text-[22px] md:text-[30px] font-bold text-[#3f342a] leading-relaxed">
            {data.groom_name} 신랑님
            <span className="mx-2 text-[#c9a96a]">♡</span>
            {data.bride_name} 신부님
          </h1>
          <p className="mt-8 font-serif text-[17px] md:text-[22px] leading-relaxed text-[#5d5245]">
            두 분이 꿈꾸는 결혼식이
            <br />
            PLENTY에서는 어떤 모습으로 완성될까요?
          </p>
        </div>
      </header>

      {/* 2. 가블록 카드 (block) / 상담 안내 카드 (consult) */}
      <section className={`${S.wrap} mt-8`}>
        <div className="rounded-2xl border border-[#e8ddc9] bg-gradient-to-b from-[#fdfaf4] to-[#f8f1e4] px-6 py-7 md:px-10 md:py-10 text-center shadow-sm">
          <div className="text-[11px] md:text-[12.5px] tracking-[0.25em] text-[#b0956a] font-semibold">
            {isConsult ? 'PREPARED FOR YOU' : 'RESERVED FOR YOU'}
          </div>
          {dt.date && (
            <>
              <div className="mt-3 font-serif text-[19px] md:text-[26px] font-bold text-[#3f342a]">{dt.date}</div>
              <div className="mt-0.5 font-serif text-[17px] md:text-[21px] text-[#3f342a]">{dt.time}</div>
            </>
          )}
          {isConsult ? (
            <>
              <p className="mt-4 text-[13px] md:text-[15px] leading-relaxed text-[#8a7461]">
                예식일은 두 분께 오래 기억될 중요한 선택이기에,
                <br />오늘 상담에서 나눈 내용을 이 페이지에 담아
                <br />
                <b className="text-[#a3541f]">
                  {data.block_until ? `${fmtShortDate(data.block_until)}까지 ` : ''}열어 두었습니다
                </b>
                .
              </p>
              <p className="mt-3 text-[13px] md:text-[15px] leading-relaxed text-[#8a7461]">
                돌아가신 뒤에도 찬찬히 살펴보시고,
                <br />두 분께 가장 좋은 선택을 하실 수 있기를 바랍니다.
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-[13px] md:text-[15px] leading-relaxed text-[#8a7461]">
                예식일은 두 분께 오래 기억될 중요한 선택이기에,
                <br />서두르지 않고 충분히 고민하실 수 있도록
                <br />해당 날짜와 시간은{' '}
                <b className="text-[#a3541f]">
                  {data.block_until ? `${fmtShortDate(data.block_until)}까지 ` : ''}우선 예약
                </b>
                해 두었습니다.
              </p>
              <p className="mt-3 text-[13px] md:text-[15px] leading-relaxed text-[#8a7461]">
                충분히 비교해보시고,
                <br />두 분께 가장 좋은 선택을 하실 수 있기를 바랍니다.
              </p>
            </>
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
              <div className="relative mt-4">
                <div ref={flowerStripRef} className="flex gap-2.5 overflow-x-auto pb-2 -mx-5 px-5 snap-x">
                  {flowerPhotos.map((p, i) => (
                    // min-w: 로드 전 폭 0으로 전부 뷰포트에 들어와 12장이 동시 다운로드되는 것 방지
                    // (화면에 보이는 2~3장만 먼저 로드, 나머지는 스크롤 시 lazy 로드)
                    <img
                      key={`${activeLoc}${i}`}
                      src={p.url}
                      alt={`${p.loc || flowerTab} ${i + 1}`}
                      loading={i < 2 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="h-64 md:h-96 min-w-[200px] md:min-w-[300px] rounded-xl shadow-sm snap-center shrink-0 object-cover"
                    />
                  ))}
                </div>
                {/* 좌우 방향키 — 폰에서는 스와이프로 넘기므로 PC(md+)에서만 노출 */}
                {flowerPhotos.length > 1 && (
                  <>
                    <button
                      aria-label="이전 사진"
                      onClick={() =>
                        flowerStripRef.current?.scrollBy({
                          left: -flowerStripRef.current.clientWidth * 0.8,
                          behavior: 'smooth',
                        })
                      }
                      className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md border border-[#e4d9c4] items-center justify-center text-[#8a7f71] text-lg hover:bg-white"
                    >
                      ‹
                    </button>
                    <button
                      aria-label="다음 사진"
                      onClick={() =>
                        flowerStripRef.current?.scrollBy({
                          left: flowerStripRef.current.clientWidth * 0.8,
                          behavior: 'smooth',
                        })
                      }
                      className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md border border-[#e4d9c4] items-center justify-center text-[#8a7f71] text-lg hover:bg-white"
                    >
                      ›
                    </button>
                  </>
                )}
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
              {/* 혜택 내역 — 발행 시점 스냅샷. 받으신 혜택을 한 번 더 상기 */}
              {(data.benefits?.length ?? 0) > 0 && (
                <div className="mt-5 pt-4 border-t border-white/15 text-left max-w-[340px] md:max-w-[420px] mx-auto">
                  <div className="text-center text-[11px] md:text-[12.5px] tracking-[0.25em] text-[#d8c49a] font-semibold">
                    두 분이 받으신 혜택
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {data.benefits!.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-baseline justify-between gap-3 text-[12.5px] md:text-[14px] text-[#e8e0d3]"
                      >
                        <span>🎁 {b.label}</span>
                        <span className="tabular-nums shrink-0 text-[#d8c49a]">
                          {b.amount.toLocaleString('ko-KR')}원
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 pt-2.5 border-t border-white/15 flex items-baseline justify-between text-[13px] md:text-[15px] font-bold">
                    <span className="text-[#d8c49a]">총 혜택</span>
                    <span className="tabular-nums text-[#f0d9a8]">
                      {data.benefits!.reduce((s, b) => s + b.amount, 0).toLocaleString('ko-KR')}원
                    </span>
                  </div>
                </div>
              )}
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
          <div className="mt-6 space-y-2.5 text-left">
            {(['a', 'b', 'c', 'option'] as const).map((c) => {
              const photos = media.menu_photos?.[c] || [];
              if (!photos.length) return null;
              const isOpen = openCourse === c;
              const idx = isOpen ? Math.min(menuIdx, photos.length - 1) : 0;
              return (
                <div key={c} className="rounded-xl border border-[#eee5d5] bg-white/70 overflow-hidden">
                  {/* 코스 헤더 — 클릭해서 펼치기/접기 */}
                  <button
                    onClick={() => {
                      setOpenCourse(isOpen ? null : c);
                      setMenuIdx(0);
                    }}
                    className="w-full flex items-center justify-between px-5 py-3.5 md:px-6 md:py-4"
                  >
                    <span className="text-[12px] md:text-[13.5px] tracking-[0.25em] font-semibold text-[#b0956a]">
                      {c === 'option' ? 'OPTION · 잔치국수' : `${c.toUpperCase()} COURSE`}
                    </span>
                    <span className="text-[#b0956a] text-sm">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && (
                    <div className="px-3 pb-4 md:px-4">
                      <div
                        className="relative"
                        onTouchStart={(e) => (menuTouchX.current = e.touches[0].clientX)}
                        onTouchEnd={(e) => {
                          if (menuTouchX.current == null) return;
                          const dx = e.changedTouches[0].clientX - menuTouchX.current;
                          menuTouchX.current = null;
                          if (Math.abs(dx) < 40) return; // 짧은 터치는 무시 (스크롤과 구분)
                          setMenuIdx(Math.max(0, Math.min(photos.length - 1, idx + (dx < 0 ? 1 : -1))));
                        }}
                      >
                        <img
                          src={photos[idx]}
                          alt={`${c === 'option' ? '잔치국수' : c + ' course'} ${idx + 1}`}
                          className="w-full rounded-lg shadow-sm object-cover"
                        />
                        {photos.length > 1 && idx > 0 && (
                          <button
                            aria-label="이전 사진"
                            onClick={() => setMenuIdx(idx - 1)}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center text-[#8a7f71] text-lg hover:bg-white"
                          >
                            ‹
                          </button>
                        )}
                        {photos.length > 1 && idx < photos.length - 1 && (
                          <button
                            aria-label="다음 사진"
                            onClick={() => setMenuIdx(idx + 1)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center text-[#8a7f71] text-lg hover:bg-white"
                          >
                            ›
                          </button>
                        )}
                      </div>
                      {/* 번호 페이지네이션 */}
                      {photos.length > 1 && (
                        <div className="mt-3 flex justify-center gap-1.5 flex-wrap">
                          {photos.map((_, i) => (
                            <button
                              key={i}
                              onClick={() => setMenuIdx(i)}
                              className={
                                'w-7 h-7 md:w-8 md:h-8 rounded-full text-[11.5px] md:text-[13px] border transition ' +
                                (idx === i
                                  ? 'bg-[#c9a96a] text-white border-[#c9a96a] font-semibold'
                                  : 'bg-white text-[#8a7f71] border-[#e4d9c4]')
                              }
                            >
                              {i + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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

      {/* 9-1. 고객 후기 — 네이버 블로그 링크 */}
      <section className={`${S.wrap} text-center`}>
        <div className="text-[11px] tracking-[0.3em] text-[#b0956a] font-semibold">REAL REVIEW</div>
        <h2 className={`${S.h2} mt-2`}>
          {'먼저 PLENTY에서 결혼식을 올린\n신랑신부님의 이야기를 확인해보세요'}
        </h2>
        <p className={S.body}>
          {'사진으로 보는 공간도 좋지만,\n직접 결혼식을 준비하고 하루를 보낸 분들의 후기는\n두 분의 선택에 조금 더 현실적인 도움이 될 수 있습니다.\n\n예식 전 고민했던 부분부터\n당일의 분위기, 하객 반응, 음식과 진행 만족도까지\n실제 고객님의 시선으로 남겨진 이야기를 준비해두었습니다.'}
        </p>
        {/* 썸네일 캐러셀 — 사진+제목, 좌우 방향키(PC)·스와이프(모바일) */}
        <div className="relative mt-6">
          <div ref={reviewStripRef} className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 snap-x text-left">
            {REVIEW_LINKS.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="w-44 md:w-56 shrink-0 snap-center"
              >
                <span className="relative block">
                  <img
                    src={r.thumb}
                    alt={r.title}
                    loading="lazy"
                    className="w-full aspect-square object-cover rounded-xl shadow-sm"
                  />
                  <span className="absolute top-2 left-2 w-6 h-6 md:w-7 md:h-7 rounded-md bg-[#03c75a] text-white text-[12px] md:text-[13px] font-extrabold flex items-center justify-center shadow">
                    N
                  </span>
                </span>
                <span
                  className="block mt-2 text-[12.5px] md:text-[14px] font-semibold text-[#4d4237] leading-snug"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {r.title}
                </span>
                <span className="block mt-1 text-[10.5px] md:text-[11.5px] text-[#b7ab9b]">네이버 블로그 후기 ›</span>
              </a>
            ))}
          </div>
          {REVIEW_LINKS.length > 1 && (
            <>
              <button
                aria-label="이전 후기"
                onClick={() =>
                  reviewStripRef.current?.scrollBy({
                    left: -reviewStripRef.current.clientWidth * 0.8,
                    behavior: 'smooth',
                  })
                }
                className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md border border-[#e4d9c4] items-center justify-center text-[#8a7f71] text-lg hover:bg-white"
              >
                ‹
              </button>
              <button
                aria-label="다음 후기"
                onClick={() =>
                  reviewStripRef.current?.scrollBy({
                    left: reviewStripRef.current.clientWidth * 0.8,
                    behavior: 'smooth',
                  })
                }
                className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-10 h-10 rounded-full bg-white/95 shadow-md border border-[#e4d9c4] items-center justify-center text-[#8a7f71] text-lg hover:bg-white"
              >
                ›
              </button>
            </>
          )}
        </div>
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
                {isConsult ? '두 분이 상담하신 날짜와 조건,' : '두 분이 선택하신 날짜와 시간,'}
                <br />
                PLENTY에서 확정하고 싶으시다면
              </p>
              <p className="mt-3 text-[12.5px] md:text-[14.5px] leading-relaxed text-[#8a7461]">
                담당자가 계약 절차와 결제 방법을 안내드립니다.
                <br />
                아직 고민이 남아 있다면, 결정 전에 편하게 질문해 주세요.
              </p>
              {data.block_until && (
                <div className="mt-4 inline-block rounded-full bg-white/80 border border-[#e8ddc9] px-4 py-1.5 text-[12px] md:text-[14px] text-[#8a7461]">
                  {isConsult ? '페이지 열람 기간' : '두 분을 위한 우선예약 기간'} :{' '}
                  <b className="text-[#3f342a]">~ {fmtShortDate(data.block_until)}까지</b>
                </div>
              )}
              <div className="mt-5 space-y-2.5">
                <button
                  onClick={() => clickCta('contract')}
                  disabled={ctaSending}
                  className="w-full py-4 md:py-5 rounded-xl bg-[#a3541f] text-white text-[14.5px] md:text-[16.5px] font-bold shadow disabled:opacity-60"
                >
                  {isConsult ? '💍 이 조건으로 계약하고 싶어요' : '💍 이 날짜로 계약하고 싶어요'}
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
        <div className="mt-5 space-y-2.5">
          {FAQ_GROUPS.map((g, gi) => {
            const groupOpen = faqGroup === gi;
            return (
              <div key={g.title} className="rounded-xl border border-[#eee5d5] bg-white/70 overflow-hidden">
                {/* 카테고리 헤더 — 클릭해서 펼치기/접기 */}
                <button
                  onClick={() => {
                    setFaqGroup(groupOpen ? null : gi);
                    setFaqOpen(null);
                  }}
                  className="w-full flex items-center justify-between px-5 py-3.5 md:px-6 md:py-4"
                >
                  <span className="text-[12px] md:text-[13.5px] tracking-[0.25em] font-semibold text-[#b0956a]">
                    {g.title}
                    <span className="ml-2 tracking-normal text-[#cfc5b4]">{g.items.length}</span>
                  </span>
                  <span className="text-[#b0956a] text-sm">{groupOpen ? '−' : '+'}</span>
                </button>
                {groupOpen && (
                  <div className="px-5 md:px-6 pb-2 divide-y divide-[#eee5d5] border-t border-[#eee5d5]">
                    {g.items.map((f, i) => {
                      const key = `${gi}-${i}`;
                      const isOpen = faqOpen === key;
                      return (
                        <div key={key}>
                          <button
                            onClick={() => setFaqOpen(isOpen ? null : key)}
                            className="w-full flex items-start justify-between gap-3 py-3.5 text-left"
                          >
                            <span className="text-[13.5px] md:text-[15.5px] font-semibold text-[#4d4237] leading-snug">
                              Q{FAQ_OFFSETS[gi] + i + 1}. {f.q}
                            </span>
                            <span className="text-[#b0956a] text-sm shrink-0 mt-0.5">{isOpen ? '−' : '+'}</span>
                          </button>
                          {isOpen && (
                            <p className="pb-4 text-[13px] md:text-[14.5px] leading-relaxed text-[#8a7f71] whitespace-pre-line">
                              {f.a}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
      {/* 워터마크 — 캡처·유포물에 출처가 남도록 최상단 레이어에 로고 반복 (인터랙션 방해 없음) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[70]"
        style={{
          backgroundImage: `url(${LOGO_URL})`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px auto',
          backgroundPosition: 'center',
          opacity: 0.03,
          transform: 'rotate(-14deg) scale(1.5)',
        }}
      />
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
      <div className="mt-3 text-[9.5px] md:text-[11px] text-[#cfc5b4]">
        © {new Date().getFullYear()} PLENTY CONVENTION. All rights reserved.
        <br />본 페이지의 구성·문구·이미지의 무단 복제 및 전재를 금합니다.
      </div>
    </footer>
  );
}
