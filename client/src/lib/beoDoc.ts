// BEO(Banquet Event Order) 문서 모델 + 빌더.
// 실제 플렌티 BEO(.docx) 구조를 반영: ① 헤더(고객/일시/담당) ② 일정 그리드 ③ 자유서술 섹션(Food/Set-up/Program/Billing).
// 본문 대부분이 행사별 수기 작성이라 "자동 시드 + 담당자 수동 편집 + 저장" 구조를 취한다.
// 순수 모듈 — React/API 의존 없음. 편집 UI(BeoEditorModal)와 인쇄(openBeoPrint)가 함께 사용.

export type BeoTemplate = 'MICE' | 'WEDDING';

// 일정 그리드 한 줄 (Date / Time / Room / Function / Setup / GTD / EXP)
export interface BeoScheduleRow {
  id: string;
  date: string;
  time: string;
  room: string;
  func: string;   // Function (Coffee Break / Meeting / Lunch / 본식 …)
  setup: string;  // Setup (Class / Coffee Station / Rounds …)
  gtd: string;
  exp: string;
}

// 자유서술 섹션 (FOOD / SET-UP / AV / PROGRAM / BILLING …) — 담당자가 본문을 직접 작성.
export interface BeoSection {
  id: string;
  title: string;
  body: string;
}

export interface BeoDoc {
  template: BeoTemplate;
  // ── 헤더 ──
  account_name: string;      // 고객/행사명
  catering_manager: string;  // 케이터링 담당
  organizer_name: string;    // 주최자 / (웨딩) 신부 등
  event_date: string;
  event_time: string;
  onsite_contact: string;    // 현장 연락처
  payment_method: string;
  signboard: string;         // 간판 문구
  customer_type: string;     // (웨딩) 고객 유형 — 가톨릭 동문 등. MICE는 빈값.
  // ── 본문 ──
  schedule: BeoScheduleRow[];
  sections: BeoSection[];
  // ── 메타 ──
  updated_at?: string;
  updated_by?: string;
}

// 브라우저 전역 crypto로 행 id 생성 (React key / 편집 추적용).
function rid(): string {
  try {
    return crypto.randomUUID().slice(0, 8);
  } catch {
    return 'r' + Math.abs(Date.now() % 1e8).toString(36);
  }
}

export function emptyScheduleRow(): BeoScheduleRow {
  return { id: rid(), date: '', time: '', room: '', func: '', setup: '', gtd: '', exp: '' };
}

// ===== 자동 시드 =====
// 행사/식음/업체 데이터로 BEO 초안을 생성한다. 담당자는 이후 자유롭게 편집.
export interface BeoSeedInput {
  template: BeoTemplate;
  account_name: string;
  organizer_name: string;
  onsite_contact: string;
  catering_manager: string;
  event_date: string;
  event_time: string;
  halls_text: string;
  payment_method: string;
  customer_type: string;
  signboard: string;
  // 식음 항목 — 일정 그리드 + FOOD 섹션 초안에 사용
  foods: {
    menu_name: string;
    mode: 'set' | 'coffee' | 'qty';
    time: string;     // 시간 라벨 (time_label 또는 service_time)
    gtd: string;
    exp: string;
    quantity: string;
    memo: string;
  }[];
}

export function seedBeoDoc(inp: BeoSeedInput): BeoDoc {
  const schedule: BeoScheduleRow[] = inp.foods.map((f) => ({
    id: rid(),
    date: inp.event_date,
    time: f.time,
    room: inp.halls_text,
    func: f.menu_name,
    setup: f.mode === 'coffee' ? 'Coffee Station' : f.mode === 'set' ? 'Class' : '',
    gtd: f.mode === 'set' ? f.gtd : f.quantity,
    exp: f.mode === 'set' ? f.exp : f.quantity,
  }));

  // FOOD 섹션 초안 — 메뉴 목록을 줄단위로 깔아두고 담당자가 상세(원산지·알러지·서비스)를 채운다.
  const foodLines = inp.foods.length
    ? inp.foods
        .map((f) => {
          const qty =
            f.mode === 'set'
              ? `GTD ${f.gtd || '-'} / EXP ${f.exp || '-'}`
              : `수량 ${f.quantity || '-'}`;
          return `[${f.menu_name}] ${f.time ? f.time + ' · ' : ''}${qty}${f.memo ? ' · ' + f.memo : ''}`;
        })
        .join('\n')
    : '';

  const sectionTitles =
    inp.template === 'WEDDING'
      ? ['FOOD', 'SET-UP', 'PROGRAM', 'BILLING']
      : ['FOOD', 'SET-UP', 'AV', 'BILLING'];

  const sections: BeoSection[] = sectionTitles.map((title) => ({
    id: rid(),
    title,
    body: title === 'FOOD' ? foodLines : '',
  }));

  return {
    template: inp.template,
    account_name: inp.account_name,
    catering_manager: inp.catering_manager,
    organizer_name: inp.organizer_name,
    event_date: inp.event_date,
    event_time: inp.event_time,
    onsite_contact: inp.onsite_contact,
    payment_method: inp.payment_method,
    signboard: inp.signboard,
    customer_type: inp.customer_type,
    schedule,
    sections,
  };
}

// 저장된 payload(JSON) → BeoDoc 복원. 깨졌거나 없으면 null.
export function parseBeoDoc(payload: string | undefined | null): BeoDoc | null {
  if (!payload) return null;
  try {
    const d = JSON.parse(payload) as BeoDoc;
    if (!d || typeof d !== 'object') return null;
    // 구조 보정 — 누락 필드 기본값
    d.schedule = Array.isArray(d.schedule) ? d.schedule : [];
    d.sections = Array.isArray(d.sections) ? d.sections : [];
    return d;
  } catch {
    return null;
  }
}

// ===== 인쇄(HTML) 렌더 =====
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export const BEO_CSS = `
.bbox{background:#fff;border:1px solid #ccc;max-width:900px;margin:0 auto;padding:24px 28px;color:#222;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif}
.bhead{text-align:center;border-bottom:2px solid #1f3a5f;padding-bottom:8px;margin-bottom:12px}
.bhead .t{font-size:20px;font-weight:800;letter-spacing:.16em;color:#1f3a5f}
.bhead .s{font-size:11px;color:#667;letter-spacing:.22em;margin-top:2px}
.bmeta{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0 4px}
.bmeta td{border:1px solid #d7dde6;padding:5px 8px}
.bmeta td.k{background:#eef2f7;color:#1f3a5f;font-weight:700;white-space:nowrap;width:120px}
.bsec{font-size:13px;font-weight:800;color:#1f3a5f;margin:16px 0 5px;border-left:4px solid #1f3a5f;padding-left:7px}
.bt{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
.bt th{background:#eef2f7;border:1px solid #d7dde6;padding:4px 5px;text-align:center}
.bt td{border:1px solid #e3e8ef;padding:4px 5px;vertical-align:top;word-break:break-word}
.bt td.c{text-align:center}
.bbody{white-space:pre-wrap;font-size:12px;line-height:1.65;background:#f7f9fb;border:1px solid #e3e8ef;border-radius:7px;padding:10px 12px}
.bempty{color:#aaa;font-style:italic}
.bfoot{font-size:10px;color:#8a8f98;margin-top:16px;text-align:center;border-top:1px solid #e3e8ef;padding-top:8px}
`;

function metaRows(d: BeoDoc): string {
  const r = (k1: string, v1: string, k2: string, v2: string) =>
    `<tr><td class="k">${esc(k1)}</td><td>${esc(v1) || '-'}</td><td class="k">${esc(k2)}</td><td>${esc(v2) || '-'}</td></tr>`;
  const rows = [
    r('Account Name', d.account_name, 'Catering Manager', d.catering_manager),
    r('Organizer', d.organizer_name, 'Event Date', d.event_date),
    r('Onsite Contact', d.onsite_contact, d.template === 'WEDDING' ? 'Event Time' : 'Event Time', d.event_time),
    r('Payment', d.payment_method, 'Signboard', d.signboard),
  ];
  if (d.template === 'WEDDING' && d.customer_type.trim()) {
    rows.push(`<tr><td class="k">Customer Type</td><td colspan="3">${esc(d.customer_type)}</td></tr>`);
  }
  return rows.join('');
}

function scheduleTable(rows: BeoScheduleRow[]): string {
  if (rows.length === 0) return '<div class="bempty">등록된 일정이 없습니다.</div>';
  const body = rows
    .map(
      (r) =>
        `<tr><td class="c">${esc(r.date)}</td><td class="c">${esc(r.time)}</td><td>${esc(r.room)}</td>` +
        `<td>${esc(r.func)}</td><td>${esc(r.setup)}</td><td class="c">${esc(r.gtd)}</td><td class="c">${esc(r.exp)}</td></tr>`
    )
    .join('');
  return `<table class="bt">
    <colgroup><col style="width:11%"><col style="width:12%"><col style="width:18%"><col style="width:21%"><col style="width:22%"><col style="width:8%"><col style="width:8%"></colgroup>
    <tr><th>Date</th><th>Time</th><th>Room</th><th>Function</th><th>Setup</th><th>GTD</th><th>EXP</th></tr>${body}</table>`;
}

export function buildBeoHtml(d: BeoDoc): string {
  const sections = d.sections
    .map(
      (s) =>
        `<div class="bsec">${esc(s.title)}</div>` +
        (s.body.trim() ? `<div class="bbody">${esc(s.body)}</div>` : '<div class="bempty">내용 없음</div>')
    )
    .join('');
  return `
    <div class="bhead"><div class="t">PLENTY CONVENTION</div><div class="s">BANQUET EVENT ORDER (BEO) · ${esc(d.template)}</div></div>
    <table class="bmeta">${metaRows(d)}</table>
    <div class="bsec">SCHEDULE</div>
    ${scheduleTable(d.schedule)}
    ${sections}
    <div class="bfoot">내부 운영 지시서 (BEO) · PLENTY CONVENTION · 본 문서는 행사 운영용 내부 자료입니다.${d.updated_by ? ' · 최종 편집: ' + esc(d.updated_by) : ''}</div>`;
}

export function openBeoPrint(d: BeoDoc): void {
  const w = window.open('', '_blank', 'width=960,height=1000');
  if (!w) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
  const title = `BEO_${d.account_name || '행사'}`.replace(/\s+/g, '_');
  w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title)}</title>
    <style>body{margin:0;background:#fff;padding:16px}${BEO_CSS}
    @media print{body{padding:0}.bbox{border:none;max-width:none}
      /* !important — 인라인 스타일이 붙어도 인쇄물에 버튼이 찍히지 않도록 */
      .no-print{display:none !important}}</style></head>
    <body><div class="no-print" style="max-width:900px;margin:0 auto 10px"><button onclick="window.print()" style="width:100%;background:#1f3a5f;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;cursor:pointer">🖨 인쇄 / PDF 저장</button></div>
    <div class="bbox">${buildBeoHtml(d)}</div></body></html>`);
  w.document.close();
}
