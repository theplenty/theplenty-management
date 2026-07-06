// 내부 통지 메일 발송 — 회사 메일 SMTP 사용 (.env 설정).
// SMTP 미설정 상태에서도 앱이 죽지 않도록: 발송 실패/미설정이면 {sent:false}만 반환.
// 랜딩 CTA 클릭은 항상 landing.cta_clicks 에 먼저 기록되므로 메일은 보조 채널.
//
// .env 키:
//   SMTP_HOST / SMTP_PORT(기본 587) / SMTP_SECURE(true=465 SSL) / SMTP_USER / SMTP_PASS
//   SMTP_FROM (기본 SMTP_USER) / LANDING_NOTIFY_TO (수신자, 예: 예약팀 메일)

import nodemailer from 'nodemailer';

// SMTP_PASS / SMTP_PASSWORD 둘 다 허용 (입력 실수 방지)
function smtpPass(): string | undefined {
  return process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && smtpPass());
}

export async function sendNotifyMail(opts: {
  subject: string;
  html: string;
  to?: string; // 생략 시 LANDING_NOTIFY_TO
}): Promise<{ sent: boolean; reason?: string }> {
  const to = opts.to || process.env.LANDING_NOTIFY_TO;
  if (!smtpConfigured()) return { sent: false, reason: 'smtp_not_configured' };
  if (!to) return { sent: false, reason: 'no_recipient' };
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: smtpPass() },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: opts.subject,
      html: opts.html,
    });
    return { sent: true };
  } catch (e) {
    console.error('[mailer] 발송 실패:', (e as Error).message);
    return { sent: false, reason: 'send_failed' };
  }
}
