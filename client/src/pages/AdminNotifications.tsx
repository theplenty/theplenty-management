// 알림 자동화 점검 화면 (로드맵 A4) — 관리자 전용.
// 평일 아침 8시에 자동 발송되는 내용을 미리 보고, 필요하면 지금 바로 보낼 수 있다.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDateTimeW } from '../lib/dateFmt';

interface Config {
  slack_configured: boolean;
  slack_target: string | null;
  app_base_url: string;
  sent_log_count: number;
}

interface RunResult {
  as_of: string;
  slack_configured: boolean;
  sent: boolean;
  skipped_reason?: string;
  groups: Array<{ rule: string; title: string; total: number; new: number }>;
  total_new: number;
  text?: string;
}

export default function AdminNotifications() {
  const [config, setConfig] = useState<Config | null>(null);
  const [preview, setPreview] = useState<RunResult | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [cfg, pv] = await Promise.all([
        api.get<Config>('/api/notifications/config'),
        api.get<RunResult>('/api/notifications/preview'),
      ]);
      setConfig(cfg);
      setPreview(pv);
    } catch (e) {
      console.error(e);
      setError('알림 설정을 불러오지 못했습니다. (관리자 권한 필요)');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runNow(force: boolean) {
    const msg = force
      ? '중복 방지를 무시하고 지금 전부 Slack 으로 보냅니다. 계속할까요?'
      : '지금 Slack 으로 알림을 보냅니다. (이미 보낸 건은 제외) 계속할까요?';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const res = await api.post<RunResult>(`/api/notifications/run${force ? '?force=1' : ''}`, {});
      setLastRun(res);
      await load();
    } catch (e) {
      console.error(e);
      alert('발송에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-500">불러오는 중...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl md:text-2xl font-bold mb-1">🔔 알림 자동화</h1>
      <p className="text-sm text-gray-600 mb-5">
        평일 아침 <b>8시</b>에 아래 항목을 Slack 으로 자동 발송합니다. 같은 건이 매일 반복되지 않도록
        규칙별 재알림 주기가 적용됩니다.
      </p>

      {/* 연결 상태 */}
      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-3">
          연결 상태
        </div>
        {config?.slack_configured ? (
          <div className="text-sm text-green-700">
            ✅ Slack 웹훅 연결됨 <span className="text-gray-400">({config.slack_target})</span>
          </div>
        ) : (
          <div className="text-sm text-amber-700">
            ⚠️ Slack 웹훅이 설정되지 않았습니다. 발송은 건너뛰고 있어요.
            <div className="text-xs text-gray-600 mt-1.5 leading-relaxed">
              Slack 앱에서 <b>Incoming Webhooks</b> 를 켜고 발급받은 URL 을 서버 환경변수{' '}
              <code className="bg-gray-100 px-1 rounded">SLACK_WEBHOOK_URL</code> 에 넣은 뒤 재배포하면
              활성화됩니다.
            </div>
          </div>
        )}
        <div className="text-xs text-gray-500 mt-2">
          링크 기준 주소: {config?.app_base_url} · 발송 이력 {config?.sent_log_count ?? 0}건 보관 중
        </div>
      </div>

      {/* 지금 보낼 내용 */}
      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-xs uppercase tracking-wider font-semibold text-gray-500">
            현재 감지된 항목 (미리보기)
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="btn-secondary !py-1 !px-2 text-xs" disabled={busy}>
              새로고침
            </button>
            <button
              onClick={() => runNow(false)}
              className="btn-primary !py-1 !px-3 text-xs"
              disabled={busy || !config?.slack_configured}
              title={config?.slack_configured ? '' : 'Slack 웹훅 설정 후 사용 가능합니다'}
            >
              {busy ? '발송중...' : '지금 발송'}
            </button>
            <button
              onClick={() => runNow(true)}
              className="btn-secondary !py-1 !px-2 text-xs"
              disabled={busy || !config?.slack_configured}
              title="중복 방지를 무시하고 전부 다시 보냅니다 (테스트용)"
            >
              전부 재발송
            </button>
          </div>
        </div>

        {preview && preview.total_new > 0 ? (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              {preview.groups.map((g) => (
                <span
                  key={g.rule}
                  className="badge bg-blue-50 text-blue-800 border border-blue-100"
                >
                  {g.title} {g.new}건
                </span>
              ))}
            </div>
            <pre className="text-xs bg-gray-50 border rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {preview.text}
            </pre>
          </>
        ) : (
          <div className="text-sm text-gray-500">현재 알릴 항목이 없습니다. 👍</div>
        )}
      </div>

      {/* 마지막 발송 결과 */}
      {lastRun && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2">
            마지막 발송 결과
          </div>
          <div className="text-sm">
            {lastRun.sent ? (
              <span className="text-green-700">
                ✅ {fmtDateTimeW(lastRun.as_of)} — {lastRun.total_new}건 발송
              </span>
            ) : (
              <span className="text-gray-600">
                발송하지 않음 — {lastRun.skipped_reason || '사유 없음'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 규칙 설명 */}
      <div className="bg-white border rounded-lg p-4">
        <div className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-3">
          발송 규칙
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-500 text-left">
            <tr className="border-b">
              <th className="py-1.5 pr-3 font-medium">항목</th>
              <th className="py-1.5 pr-3 font-medium">조건</th>
              <th className="py-1.5 font-medium whitespace-nowrap">재알림</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {[
              ['🤝 협업요청 회신 대기', '회신 기한을 넘긴 요청 (팀 회신 또는 세일즈 결정)', '매일'],
              ['💳 카드사 입금 지연', '카드사 입금 예정일(영업일 기준)을 넘겼는데 입금 미확인', '매일'],
              ['💰 정산 미완', '종료된 확정 행사인데 매출 ≠ 결제', '7일'],
              ['📅 D-7 행사 준비 시작', '정확히 7일 뒤 열리는 확정 행사', '30일'],
              ['📝 매출 미입력', '끝난 확정 행사인데 매출·결제가 모두 비어 있음 (90일 이내)', '7일'],
            ].map(([a, b, c]) => (
              <tr key={a} className="border-b last:border-0">
                <td className="py-1.5 pr-3 whitespace-nowrap">{a}</td>
                <td className="py-1.5 pr-3">{b}</td>
                <td className="py-1.5 whitespace-nowrap text-gray-500">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
