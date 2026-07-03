// 고객 발송용 Outlook 메일 초안(.eml) 생성 유틸.
// 브라우저 mailto:는 첨부가 불가능하므로, 받는사람·제목·본문·첨부가 모두 채워진
// .eml 파일을 만들어 내려준다. 설치형(클래식) Outlook에서 .eml을 열면
// `X-Unsent: 1` 헤더 덕분에 "편집·전송 가능한 새 메일"로 열린다.

const CRLF = '\r\n';
const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO/日시 문자열 → {yy:2자리, m, d} (파싱 실패 시 빈 값) */
export function ymd(iso: string | null | undefined): { yy: string; m: number; d: number } {
  if (!iso) return { yy: '', m: 0, d: 0 };
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return { yy: '', m: 0, d: 0 };
  return { yy: String(dt.getFullYear()).slice(-2), m: dt.getMonth() + 1, d: dt.getDate() };
}

/** Date → "26년 7월 2일(수)" */
export function ymdDow(dt: Date): string {
  const yy = String(dt.getFullYear()).slice(-2);
  return `${yy}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일(${KO_DOW[dt.getDay()]})`;
}

/** 오늘 + n일 */
export function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 파일명 → MIME 타입 추정 */
export function guessMime(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    hwp: 'application/x-hwp',
    hwpx: 'application/haansofthwpx',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    zip: 'application/zip',
    txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

/** RFC2047 encoded-word (UTF-8, Base64) — 한글 제목/파일명용 */
function encodeWord(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

/** base64를 76자 라인으로 접어 CRLF로 연결 */
function foldBase64(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join(CRLF);
}

export interface MailContent {
  to: string;
  subject: string;
  html: string;
}

export interface Attachment {
  filename: string;
  mime: string;
  buffer: Buffer;
}

/** 받는사람·제목·HTML본문·첨부 → .eml 문자열 (설치형 Outlook 편집 초안) */
export function buildEml(content: MailContent, attachment: Attachment): string {
  const boundary = '----=_PlentyMailBoundary_5f3a9c';
  const htmlB64 = foldBase64(Buffer.from(content.html, 'utf8').toString('base64'));
  const fileB64 = foldBase64(attachment.buffer.toString('base64'));
  const encodedName = encodeWord(attachment.filename);
  const pctName = encodeURIComponent(attachment.filename);

  const lines = [
    'X-Unsent: 1',
    `To: ${content.to || ''}`,
    `Subject: ${encodeWord(content.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
    `--${boundary}`,
    `Content-Type: ${attachment.mime}; name="${encodedName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename*=UTF-8''${pctName}`,
    '',
    fileB64,
    `--${boundary}--`,
    '',
  ];
  return lines.join(CRLF);
}

// ─────────────────────────────────────────────────────────────
// 본문 템플릿 (고객 확정 문구)
// ─────────────────────────────────────────────────────────────

function wrapHtml(inner: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:14px;color:#222;line-height:1.6;">${inner}</body></html>`;
}

export interface MiceParams {
  orgName: string;
  contactName: string;
  senderName: string;
  docLabel: string; // 견적서 | 계약서
  eventName: string;
  eventDate: { yy: string; m: number; d: number };
}

export function buildMiceMail(p: MiceParams): MailContent {
  const dateStr = p.eventDate.yy ? `${p.eventDate.yy}년 ${p.eventDate.m}월 ${p.eventDate.d}일 ` : '';
  const subject = `[PLENTY] ${dateStr}${p.eventName} '${p.docLabel}' 송부의 건`;
  const inner =
    `<div>안녕하세요 ${escapeHtml(p.orgName)} ${escapeHtml(p.contactName)}님, 플렌티컨벤션 ${escapeHtml(p.senderName)}입니다.</div>` +
    `<div>요청하신 ${escapeHtml(p.docLabel)}를 송부 드리오니 확인 부탁드립니다.</div>` +
    `<div>기타 궁금하신 내용 있으신 경우 언제든지 연락 주시기 바랍니다.</div>` +
    `<div>감사합니다.</div>` +
    `<div style="margin-top:12px;">${escapeHtml(p.senderName)} 드림</div>`;
  return { to: '', subject, html: wrapHtml(inner) };
}

export interface WeddingParams {
  groomName: string;
  brideName: string;
  replyDeadline: string; // "26년 7월 2일(수)"
}

export function buildWeddingMail(p: WeddingParams): MailContent {
  const subject = `[PLENTY] ${p.groomName}신랑님 & ${p.brideName} 신부님 웨딩 계약서 발송 드립니다.`;
  const inner =
    `<div>${escapeHtml(p.groomName)} 신랑님 &amp; ${escapeHtml(p.brideName)} 신부님 : )</div>` +
    `<div>&nbsp;</div>` +
    `<div>안녕하세요.</div>` +
    `<div>플렌티 컨벤션입니다.</div>` +
    `<div>&nbsp;</div>` +
    `<div>먼저, 두 분의 소중한 예식을 저희 플렌티 컨벤션으로 선택해 주셔서 진심으로 감사드립니다.</div>` +
    `<div>&nbsp;</div>` +
    `<div>요청하신 웨딩 계약서를 첨부드리오니 확인 부탁드리며,</div>` +
    `<div>아래 항목을 작성하신 후 계약서와 함께 회신 부탁드립니다.</div>` +
    `<div style="margin-top:8px;font-weight:bold;">계약서 필수 기재 사항</div>` +
    `<ul style="margin:4px 0 0 0;padding-left:20px;">` +
    `<li>계약서 암호: 신부님 전체 전화번호 (하이픈(-)포함 13자리)</li>` +
    `<li>1페이지: 신랑·신부님 현 주소 기재</li>` +
    `<li>2페이지: 신랑·신부님 자필 서명</li>` +
    `<li>계약서 회신 기한: <strong>${escapeHtml(p.replyDeadline)}</strong> 까지</li>` +
    `</ul>` +
    `<div>&nbsp;</div>` +
    `<div>※ 계약금은 예식 비용의 선수금으로, 예식 당일 총 결제 금액에서 차감됩니다.</div>` +
    `<div>&nbsp;</div>` +
    `<div>예식일까지 두 분의 아름다운 웨딩 여정에 진심을 다해 함께 하겠습니다.</div>` +
    `<div>문의사항은 편하게 연락 부탁드립니다.^^</div>` +
    `<div>&nbsp;</div>` +
    `<div>감사합니다.</div>`;
  return { to: '', subject, html: wrapHtml(inner) };
}
