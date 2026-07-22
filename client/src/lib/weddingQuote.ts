// 웨딩 고객 견적서 HTML 빌더 — 참조 HTML의 showQuote()/qrow() 마크업을 그대로 포팅.
// 미리보기(innerHTML)와 인쇄(새 창) 양쪽에서 동일한 마크업을 쓴다.

import {
  type CalcInputs, type CourseKey, type FlowerGrade, type MarginResult, type WeddingCalcSettings,
  flowerName, won,
} from './weddingCalc';

// 플렌티 키컬러 (그린) — 견적서 강조용
const QUOTE_GREEN = '#1f6b3f';

// 견적서 전용 스타일 (참조 HTML의 .q* 클래스)
export const QUOTE_CSS = `
.qbox,.qbox *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.qbox{background:#fff;border:1px solid #ccc;max-width:840px;margin:0 auto;padding:22px 28px;color:#2b2b2b;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif}
.qhead{text-align:center;border-bottom:2px solid #5b4a3a;padding-bottom:6px;margin-bottom:10px}
.qhead .t{font-size:22px;font-weight:800;letter-spacing:.25em;color:#5b4a3a}
.qmeta{display:grid;grid-template-columns:1fr 1fr;gap:2px 18px;font-size:12.5px;margin-bottom:8px}.qmeta b{color:#5b4a3a}
.qsec{font-size:13px;font-weight:800;color:#5b4a3a;margin:10px 0 3px;border-left:4px solid #5b4a3a;padding-left:7px}
.qt{width:100%;border-collapse:collapse;font-size:12px}
.qt th{background:#f4f1ec;border:1px solid #ddd;padding:4px 6px}
.qt td{border:1px solid #e4ded3;padding:4px 6px;vertical-align:top}
.qt td.n{text-align:right;white-space:nowrap}
.qrmk{color:#7a756c;font-size:11px;line-height:1.35;margin-top:1px}
.qtot{display:flex;justify-content:space-between;font-size:16.5px;font-weight:800;background:#1f6b3f;color:#fff;padding:10px 14px;border-radius:8px;margin-top:10px}
.qfoot{font-size:11px;color:#7a756c;margin-top:10px;text-align:center;border-top:1px solid #e4ded3;padding-top:6px}
.qban{display:flex;justify-content:space-between;align-items:center;background:#fbe9e7;border:1px solid #f0b7ae;border-radius:9px;padding:9px 14px;margin-bottom:5px}
.qban .l{font-size:13px;color:#7a2018}
.qban .amt{font-size:22px;font-weight:800;color:#c0392b}
.qsub{font-size:11px;color:#7a756c;text-align:right;margin-bottom:8px}
@media print{
  @page{size:A4;margin:9mm}
  .qbox{border:none;max-width:none;padding:0}
  .qhead{padding-bottom:4px;margin-bottom:6px}
  .qhead .t{font-size:18px}
  .qmeta{font-size:11px;gap:1px 14px;margin-bottom:5px}
  .qban{padding:5px 12px;border-radius:7px;margin-bottom:4px}
  .qban .l{font-size:11.5px}
  .qban .amt{font-size:16px}
  .qsub{font-size:9.5px;margin-bottom:4px}
  .qsec{font-size:11px;margin:5px 0 2px;padding-left:6px}
  .qt{font-size:10.5px}
  .qt th,.qt td{padding:1px 5px}
  .qrmk{font-size:9.3px;line-height:1.25;margin-top:0}
  .qtot{font-size:13.5px;padding:6px 12px;margin-top:6px;border-radius:6px}
  .qfoot{font-size:9px;margin-top:5px;padding-top:3px}
}
`;

function qrow(name: string, rmk: string, list: number, cust: number, benLabel: string): string {
  const saved = list - cust;
  const custS = cust === 0 ? '<b style="color:#c0392b">SVC 무상</b>' : won(cust);
  const ben = saved > 0
    ? `<span style="color:#c0392b">▼${won(saved)}${benLabel ? '<br><span style="font-size:10px">' + benLabel + '</span>' : ''}</span>`
    : '–';
  return `<tr><td>${esc(name)}${rmk ? `<div class="qrmk">${esc(rmk)}</div>` : ''}</td>` +
    `<td class="n" style="color:#999;${saved > 0 ? 'text-decoration:line-through' : ''}">${won(list)}</td>` +
    `<td class="n">${ben}</td><td class="n"><b>${custS}</b></td></tr>`;
}

// XSS 방지 — 신랑/신부명 등 사용자 입력이 들어가므로 이스케이프.
function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// 견적서 본문 HTML (qbox 내부). 참조 HTML showQuote() 포팅.
export function buildQuoteHtml(inp: CalcInputs, cfg: WeddingCalcSettings, L: MarginResult): string {
  // ── FOOD: A/B/C 코스 전부 표기 — 선택 코스만 고객가·합계 포함, 나머지는 단가·할인만 보여줌
  //    (고객이 돌아가서 코스를 바꿀 수 있으므로 비교 기준 제공)
  const selMark = ` <b style="color:${QUOTE_GREEN}">✓ 선택</b>`;
  const courseRows = (['A', 'B', 'C'] as CourseKey[])
    .map((ck) => {
      const unit = ck === 'A' ? L.pr.A : ck === 'B' ? L.pr.B : L.pr.C;
      const list = unit * L.guests;
      const saved = list * (inp.mealDiscount / 100);
      const benCell =
        saved > 0
          ? `<span style="color:#c0392b">▼${won(saved)}<br><span style="font-size:10px">식대 ${inp.mealDiscount}% 할인</span></span>`
          : '–';
      if (ck === inp.course) {
        return (
          `<tr><td>Food — Western ${ck} Course (${won(unit)} × ${L.guests}명)${selMark}` +
          `<div class="qrmk">${esc(cfg.courseDesc[ck])}</div></td>` +
          `<td class="n" style="color:#999;${saved > 0 ? 'text-decoration:line-through' : ''}">${won(L.mealList)}</td>` +
          `<td class="n">${benCell}</td><td class="n"><b>${won(L.mealRev)}</b></td></tr>`
        );
      }
      // 미선택 코스 — 고객가 빈칸 (합계 미포함)
      return (
        `<tr><td style="color:#8a8478">Food — Western ${ck} Course (${won(unit)} × ${L.guests}명)` +
        `<div class="qrmk">${esc(cfg.courseDesc[ck])} · 코스 변경 선택 가능 — 합계 미포함</div></td>` +
        `<td class="n" style="color:#999;${saved > 0 ? 'text-decoration:line-through' : ''}">${won(list)}</td>` +
        `<td class="n">${benCell}</td><td class="n"></td></tr>`
      );
    })
    .join('');
  let bev = '';
  cfg.bevItems.forEach((it) => {
    bev += `<tr><td>${esc(it.n)}<div class="qrmk">${esc(it.rmk)}</div></td><td class="n" style="color:#999">${won(it.p)}</td><td class="n">–</td><td class="n">실수량 정산</td></tr>`;
  });
  // ── FLOWER: Basic/Luxury/Grand 전부 표기 — 제공 등급만 고객가·합계 포함
  const gradeDefs: { g: FlowerGrade; label: string; price: number }[] = [
    { g: 'basic', label: 'Basic', price: L.pr.fB },
    { g: 'lux', label: 'Luxury', price: L.pr.fL },
    { g: 'grand', label: 'Grand', price: L.pr.fG },
  ];
  const flowerRows = gradeDefs
    .map(({ g, label, price }) => {
      if (g === inp.flowerGive) {
        const name =
          L.flowerBenefit > 0
            ? `Flower — ${label} 제공 (${flowerName(inp.flowerBill)} 가격 적용)`
            : `Flower — ${label}`;
        const benCell =
          L.flowerBenefit > 0
            ? `<span style="color:#c0392b">▼${won(L.flowerBenefit)}<br><span style="font-size:10px">${label} 무료 업그레이드</span></span>`
            : '–';
        return (
          `<tr><td>${name}${selMark}<div class="qrmk">${esc(cfg.flowerDesc[g])}</div></td>` +
          `<td class="n" style="color:#999;${L.flowerBenefit > 0 ? 'text-decoration:line-through' : ''}">${won(L.flowerGiveP)}</td>` +
          `<td class="n">${benCell}</td><td class="n"><b>${won(L.flowerRev)}</b></td></tr>`
        );
      }
      // 미선택 등급 — 고객가 빈칸 (합계 미포함)
      return (
        `<tr><td style="color:#8a8478">Flower — ${label}` +
        `<div class="qrmk">${esc(cfg.flowerDesc[g])} · 업그레이드 선택 가능 — 합계 미포함</div></td>` +
        `<td class="n" style="color:#999">${won(price)}</td>` +
        `<td class="n">–</td><td class="n"></td></tr>`
      );
    })
    .join('');
  // 패키지 구성 — 2단 컬럼으로 압축 (한 줄짜리 항목 8개가 세로로 길어지는 것 방지)
  const rentDetail = `<div style="columns:2;column-gap:18px;margin-top:2px">` +
    cfg.rentItems.map((it) => `<div class="qrmk" style="break-inside:avoid">· <b>${esc(it.n)}</b> — ${esc(it.rmk)}</div>`).join('') +
    `</div>`;
  const rentPkg = `<tr><td><b>RENTAL & DIRECTION 패키지</b> (전 고객 묶음 제공)${rentDetail}</td>` +
    `<td class="n" style="color:#999;text-decoration:line-through">${won(cfg.rentList)}</td>` +
    `<td class="n"><span style="color:#c0392b">▼${won(L.rentBenefit)}</span></td><td class="n"><b>${won(L.rentRev)}</b></td></tr>`;
  // ── 추가옵션 노출 — 미선택이어도 정상가를 보여주고 고객가는 'option' (합계 미포함)
  //    대상: 서브홀 대관료 · 중계TV 추가 · 웨딩 스냅 현수막 · 포토백월 현수막
  const exposeOpt = /서브홀 대관료|중계TV/;
  const exposeOther = /현수막/;
  const optionRow = (name: string, rmk: string, p: number): string =>
    `<tr><td style="color:#8a8478">${esc(name)}` +
    `<div class="qrmk">${rmk ? esc(rmk) + ' · ' : ''}선택 가능 — 합계 미포함</div></td>` +
    `<td class="n" style="color:#999">${won(p)}</td>` +
    `<td class="n">–</td><td class="n" style="color:#8a8478">option</td></tr>`;
  // 웨딩국수 — 식사 추가 옵션 (1인 단가 × 보증인원). 미선택도 금액 노출, 선택 시 합계 포함
  const noodleP = cfg.noodleP ?? 5000;
  const noodleName = `웨딩국수 (${won(noodleP)} × ${L.guests}명)`;
  const noodleRow = inp.noodle
    ? `<tr><td>${noodleName}${selMark}</td>` +
      `<td class="n" style="color:#999">${won(L.noodleRev)}</td>` +
      `<td class="n">–</td><td class="n"><b>${won(L.noodleRev)}</b></td></tr>`
    : optionRow(noodleName, '', noodleP * L.guests);
  let optRows = '';
  cfg.optItems.forEach((it, i) => {
    if (inp.opt[i]) optRows += qrow(it.n + ' (옵션)', it.rmk, it.p, it.p, '');
    else if (exposeOpt.test(it.n)) optRows += optionRow(it.n + ' (옵션)', it.rmk, it.p);
  });
  let otherRows = '';
  cfg.otherItems.forEach((it, i) => {
    if (inp.otherOn[i]) {
      const q = it.qtyMode ? (inp.otherQty[i] || 0) : 1;
      const value = it.p * q;
      const isSvc = inp.otherSvc[i];
      otherRows += qrow(it.n + (it.qtyMode ? ` (${q}병/개)` : ''), it.rmk, value, isSvc ? 0 : value, isSvc ? '무상 제공 혜택' : '');
    } else if (exposeOther.test(it.n)) {
      otherRows += optionRow(it.n, it.rmk, it.p);
    }
  });

  return `
    <div class="qhead"><div class="t">PLENTY CONVENTION</div><div style="font-size:12px;color:#7a756c;letter-spacing:.2em">WEDDING ESTIMATE</div></div>
    <div class="qmeta">
      <div><b>Name of Event</b> : ${esc(inp.groom) || '_____'} & ${esc(inp.bride) || '_____'} 님</div>
      <div><b>Date & Time</b> : ${esc(inp.wdate) || '____'}${inp.wtime ? ` ${esc(inp.wtime)}` : ` (${esc(inp.time)})`}</div>
      <div><b>Guaranteed Min.</b> : ${won(L.guests)} 명 (+10% 추가 식사 제공 가능)</div>
      <div><b>Event Hall</b> : 플렌티 컨벤션 / L층</div>
    </div>
    <div class="qban">
      <div class="l">고객님께서 받으신 <b>총 혜택</b>${(() => {
        // 가톨릭 동문 / 성모병원 임직원 — 특별 혜택 대상임을 명시
        const ctName = cfg.ctypes[inp.ctype]?.name || '';
        return /가톨릭|성모/.test(ctName)
          ? ` <span style="font-weight:800;color:${QUOTE_GREEN}">(${esc(ctName)} 혜택 포함)</span>`
          : '';
      })()}</div>
      <div class="amt">₩ ${won(L.totalBenefit)} 할인</div></div>
    <div class="qsub">정상가 ${won(L.listTotal)}원 → 최종 ${won(L.A)}원</div>
    <div class="qsec">1) FOOD & BEVERAGE <span style="font-size:10px;color:#7a756c">*Currency: KRW</span></div>
    <table class="qt"><tr><th>ITEM</th><th class="n">정상가</th><th class="n">혜택</th><th class="n">고객가</th></tr>${courseRows}${noodleRow}${bev}</table>
    <div class="qsec">2) FLOWER</div>
    <table class="qt"><tr><th>ITEM</th><th class="n">정상가</th><th class="n">혜택</th><th class="n">고객가</th></tr>${flowerRows}</table>
    <div class="qsec">3) RENTAL FEE & DIRECTION</div>
    <table class="qt"><tr><th>ITEM</th><th class="n">정상가</th><th class="n">혜택</th><th class="n">고객가</th></tr>${rentPkg}${optRows}</table>
    <div class="qsec">4) OTHERS / SPECIAL GIFT</div>
    <table class="qt"><tr><th>ITEM</th><th class="n">정상가</th><th class="n">혜택</th><th class="n">고객가</th></tr>${otherRows || '<tr><td colspan=4 style="color:#999">선택 항목 없음</td></tr>'}</table>
    <div class="qtot"><span>최종 제안 (1+2+3+4) · 총 ${won(L.totalBenefit)}원 혜택</span><span>₩ ${won(L.A)}</span></div>
    <div class="qfoot">Incl. 10% VAT · 본 견적은 상담 기준이며 옵션·인원에 따라 변동될 수 있습니다.<br>PLENTY CONVENTION · 카카오톡채널 PLENTY · 09:00–18:00 (일·월·공휴일 휴무)</div>`;
}

// 새 창 인쇄용 전체 문서
export function openQuotePrint(inp: CalcInputs, cfg: WeddingCalcSettings, L: MarginResult): void {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
  const title = `견적서_${inp.groom || ''}_${inp.bride || ''}`.replace(/_+$/, '');
  w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title)}</title>
    <style>body{margin:0;background:#fff;padding:16px}${QUOTE_CSS}
    @media print{body{padding:0}.qbox{border:none;max-width:none}.no-print{display:none}}</style></head>
    <body><div class="no-print" style="max-width:840px;margin:0 auto 10px"><button onclick="window.print()" style="width:100%;background:#5b4a3a;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;cursor:pointer">🖨 인쇄 / PDF 저장</button></div>
    <div class="qbox">${buildQuoteHtml(inp, cfg, L)}</div></body></html>`);
  w.document.close();
}
