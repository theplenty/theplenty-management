// Slack Incoming Webhook 발송.
// URL 은 비밀값이므로 코드에 두지 않고 env(SLACK_WEBHOOK_URL)에서만 읽는다.
// 미설정이면 조용히 skip — 웹훅을 아직 안 만들었어도 서버가 죽지 않게.

export interface SlackBlock {
  type: string;
  [k: string]: unknown;
}

export function slackConfigured(): boolean {
  return !!process.env.SLACK_WEBHOOK_URL;
}

/** 웹훅 URL 을 로그·응답에 그대로 노출하지 않기 위한 마스킹 */
export function slackTargetHint(): string | null {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return null;
  const tail = url.slice(-6);
  return `hooks.slack.com/...${tail}`;
}

export interface SlackSendResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

export async function sendSlack(text: string, blocks?: SlackBlock[]): Promise<SlackSendResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true, error: 'SLACK_WEBHOOK_URL 미설정' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // text 는 알림(푸시) 미리보기용 — blocks 가 있어도 같이 보낸다.
      body: JSON.stringify(blocks ? { text, blocks } : { text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 응답 본문에 URL 이 실릴 일은 없지만, 길게 남기지 않는다.
      console.error('[slack] 발송 실패', res.status, body.slice(0, 200));
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    console.error('[slack] 발송 예외', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
