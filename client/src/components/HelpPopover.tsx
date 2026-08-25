// 헤더의 "?" 도움말 버튼 — hover 시 사용 가이드 팝오버 표시.
// 버튼/패널 사이를 오갈 때 사라지지 않도록 작은 닫기 지연을 둠.

import { useRef, useState } from 'react';

export default function HelpPopover() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  function handleEnter() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }
  function handleLeave() {
    // 버튼 → 패널 이동 시 깜빡임 방지를 위해 살짝 지연
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  }

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        type="button"
        aria-label="도움말"
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 hover:border-gray-400 hover:text-gray-900 font-bold text-sm shrink-0 transition"
      >
        ?
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="사용 가이드"
          className="absolute right-0 top-full mt-2 w-[min(92vw,28rem)] max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl z-50 text-sm"
        >
          <div className="sticky top-0 bg-white border-b px-4 py-2.5 flex items-center justify-between">
            <h3 className="font-bold text-gray-900">📖 사용 가이드</h3>
            <span className="text-[10px] text-gray-400">마우스를 떼면 닫힘</span>
          </div>

          <div className="px-4 py-3 space-y-4 text-gray-700">
            <Section title="🎯 공통 필터 (대시보드 최상단)">
              <ul className="space-y-1 text-xs leading-relaxed">
                <li>
                  <b>기간</b>: 오늘 / 금주 / 금월 / 직접선택 — 두 섹션 모두에 적용
                </li>
                <li>
                  <b>담당자</b>: 본인 선택 시 본인 담당 건만 — 관리자·기업·웨딩
                  세일즈만 노출
                </li>
              </ul>
            </Section>

            <Section title="📊 MICE 세일즈">
              <ul className="space-y-1 text-xs leading-relaxed">
                <li>
                  <b>{'{기간}'} 인콜 / 아웃콜</b> — 채널별 신규 유입 건수
                </li>
                <li>
                  <b>인콜·아웃콜 전환율</b> — 전체 중 INQ/DEF/LOS로 옮겨간 비율
                </li>
                <li>
                  <b>미처리 인콜 (3일+)</b> — 단순문의 상태로 방치 (누적, 기간 무관)
                </li>
                <li>
                  <b>퍼널</b> — 미처리 → INQ → DEF → LOS, 막대 클릭 시 리스트
                </li>
              </ul>
            </Section>

            <Section title="💍 WEDDING 세일즈">
              <ul className="space-y-1 text-xs leading-relaxed">
                <li>
                  <b>상담 전환율</b> — 인콜 중 상담 이상 도달 비율 (깔때기 첫 단계)
                </li>
                <li>
                  <b>상담→DEF 전환율</b> — 상담 도달 후 확정된 비율 (마지막 단계)
                </li>
                <li className="text-gray-500">
                  두 값을 함께 보면 어느 구간에서 떨어지는지 파악 가능
                </li>
                <li>
                  <b>장기 미전환 / 상담 예정</b> — 선택 기간 내 신규문의 기준
                </li>
              </ul>
            </Section>

            <Section title="🖱 숫자·막대 클릭">
              <p className="text-xs leading-relaxed">
                모든 KPI 카드와 퍼널 막대는 클릭 가능합니다. 클릭하면 해당 조건의
                건들이 리스트 모달로 열리고, 행을 클릭하면 그 고객 프로필로 바로
                이동합니다.
              </p>
            </Section>

            <Section title="📚 용어">
              <div className="text-xs leading-relaxed space-y-1">
                <div>
                  <b>MICE 문의</b>: 문의 → 입금확인중 → DEF(확정) / LOS(잃은건)
                </div>
                <div>
                  <b>WEDDING 단계</b>: 신규문의 → 상담 → INQ(가예약) → DEF / LOS (중간
                  상담취소 가능)
                </div>
                <div>
                  <b>INCALL</b> 📞 고객이 우리에게 / <b>OUTCALL</b> 📤 우리가 고객에게
                </div>
              </div>
            </Section>

            <Section title="💡 자주 쓰는 흐름">
              <ol className="space-y-1 text-xs leading-relaxed list-decimal list-inside">
                <li>이번 주 신규 유입 → 금주 클릭 → 인콜 숫자 클릭</li>
                <li>내 실적만 보기 → 담당자에서 본인 선택</li>
                <li>
                  상담 효율 점검 → 상담 전환율 vs 상담→DEF 전환율 비교
                </li>
                <li>방치 건 점검 → 미처리 인콜 / 장기 미전환 카드</li>
              </ol>
            </Section>

            <div className="pt-2 border-t text-[11px] text-gray-400">
              자세한 가이드는{' '}
              <code className="bg-gray-100 px-1 rounded">docs/SALES_DASHBOARD_GUIDE.md</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-bold text-gray-900 mb-1.5">{title}</div>
      {children}
    </div>
  );
}
