// 웨딩 고객 견적서 HTML 빌더 — 참조 HTML의 showQuote()/qrow() 마크업을 그대로 포팅.
// 미리보기(innerHTML)와 인쇄(새 창) 양쪽에서 동일한 마크업을 쓴다.

import {
  type CalcInputs, type MarginResult, type WeddingCalcSettings,
  flowerName, won,
} from './weddingCalc';

// 견적서 전용 스타일 (참조 HTML의 .q* 클래스)
export const QUOTE_CSS = `
.qbox{background:#fff;border:1px solid #ccc;max-width:840px;margin:0 auto;padding:26px 30px;color:#2b2b2b;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif}
.qhead{text-align:center;border-bottom:2px solid #5b4a3a;padding-bottom:8px;margin-bottom:12px}
.qhead .t{font-size:22px;font-weight:800;letter-spacing:.25em;color:#5b4a3a}
.qmeta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;font-size:12.5px;margin-bottom:10px}.qmeta b{color:#5b4a3a}
.qsec{font-size:13px;font-weight:800;color:#5b4a3a;margin:14px 0 4px;border-left:4px solid #5b4a3a;padding-left:7px}
.qt{width:100%;border-collapse:collapse;font-size:11.5px}
.qt th{background:#f4f1ec;border:1px solid #ddd;padding:5px 6px}
.qt td{border:1px solid #e4ded3;padding:5px 6px;vertical-align:top}
.qt td.n{text-align:right;white-space:nowrap}
.qrmk{color:#7a756c;font-size:10.5px;line-height:1.4;margin-top:2px}
.qtot{display:flex;justify-content:space-between;font-size:15px;font-weight:800;background:#5b4a3a;color:#fff;padding:10px 14px;border-radius:8px;margin-top:14px}
.qfoot{font-size:11px;color:#7a756c;margin-top:14px;text-align:center;border-top:1px solid #e4ded3;padding-top:8px}
`;

function qrow(name: string, rmk: string, list: number, cust: number, benLabel: string): string {
  const saved = list - cust;
  const custS = cust === 0 ? '<b style="color:#c0392b">SVC 무상</b>' : won(cust);
  const ben = saved > 0
    ? `<span style="color:#c0392b">▼${won(saved)}${benLabel ? '<br><span style="font-size:9.5px">' + benLabel + '</span>' : ''}</span>`
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
  const courseFull = { A: 'Western A Course', B: 'Western B Course', C: 'Western C Course' }[inp.course];
  const fb = qrow(
    `Food — ${courseFull} (${won(L.listMeal)} × ${L.guests}명)`,
    cfg.courseDesc[inp.course], L.mealList, L.mealRev,
    inp.mealDiscount > 0 ? `식대 ${inp.mealDiscount}% 할인` : ''
  );
  let bev = '';
  cfg.bevItems.forEach((it) => {
    bev += `<tr><td>${esc(it.n)}<div class="qrmk">${esc(it.rmk)}</div></td><td class="n" style="color:#999">${won(it.p)}</td><td class="n">–</td><td class="n">실수량 정산</td></tr>`;
  });
  const flowerLine = L.flowerBenefit > 0
    ? qrow(`Flower — ${flowerName(inp.flowerGive)} 제공 (${flowerName(inp.flowerBill)} 가격 적용)`, cfg.flowerDesc[inp.flowerGive], L.flowerGiveP, L.flowerRev, `${flowerName(inp.flowerGive)} 무료 업그레이드`)
    : qrow(`Flower — ${flowerName(inp.flowerGive)}`, cfg.flowerDesc[inp.flowerGive], L.flowerGiveP, L.flowerRev, '');
  const rentDetail = cfg.rentItems.map((it) => `<div class="qrmk">· <b>${esc(it.n)}</b> — ${esc(it.rmk)}</div>`).join('');
  const rentPkg = `<tr><td><b>RENTAL & DIRECTION 패키지</b> (전 고객 묶음 제공)${rentDetail}</td>` +
    `<td class="n" style="color:#999;text-decoration:line-through">${won(cfg.rentList)}</td>` +
    `<td class="n"><span style="color:#c0392b">▼${won(L.rentBenefit)}</span></td><td class="n"><b>${won(L.rentRev)}</b></td></tr>`;
  let optRows = '';
  L.optLines.forEach((it) => { optRows += qrow(it.n + ' (옵션)', it.rmk, it.p, it.p, ''); });
  let otherRows = '';
  L.otherLines.forEach((it) => { otherRows += qrow(it.n, it.rmk, it.p, it.svc ? 0 : it.p, it.svc ? '무상 제공 혜택' : ''); });

  return `
    <div class="qhead"><div class="t">PLENTY CONVENTION</div><div style="font-size:12px;color:#7a756c;letter-spacing:.2em">WEDDING ESTIMATE</div></div>
    <div class="qmeta">
      <div><b>Name of Event</b> : ${esc(inp.groom) || '_____'} & ${esc(inp.bride) || '_____'} 님</div>
      <div><b>Date & Time</b> : ${esc(inp.wdate) || '____'} (${esc(inp.time)})</div>
      <div><b>Guaranteed Min.</b> : ${won(L.guests)} 명 (+10% 추가 식사 제공 가능)</div>
      <div><b>Event Hall</b> : 플렌티 컨벤션 / L층</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;background:#fbe9e7;border:1px solid #f0b7ae;border-radius:9px;padding:11px 16px;margin-bottom:5px">
      <div style="font-size:13px;color:#7a2018">고객님께서 받으신 <b>총 혜택</b></div>
      <div style="font-size:22px;font-weight:800;color:#c0392b">₩ ${won(L.totalBenefit)} 할인</div></div>
    <div style="font-size:11px;color:#7a756c;text-align:right;margin-bottom:8px">정상가 ${won(L.listTotal)}원 → 최종 ${won(L.A)}원</div>
    <div class="qsec">1) FOOD & BEVERAGE <span style="font-size:10px;color:#7a756c">*Currency: KRW</span></div>
    <table class="qt"><tr><th>ITEM</th><th class="n">정상가</th><th class="n">혜택</th><th class="n">고객가</th></tr>${fb}${bev}</table>
    <div class="qsec">2) FLOWER</div>
    <table class="qt"><tr><th>ITEM</th><th class="n">정상가</th><th class="n">혜택</th><th class="n">고객가</th></tr>${flowerLine}</table>
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
