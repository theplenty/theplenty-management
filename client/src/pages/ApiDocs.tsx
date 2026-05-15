// 외부 개발자용 공개 API 문서. 인증 불필요 — App.tsx 에서 보호되지 않는 경로로 등록.

const BASE_URL_PROD = 'https://plenty-management.web.app';

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-900 text-gray-100 text-xs leading-relaxed p-3 rounded overflow-x-auto">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16">
      <h2 className="text-xl font-bold border-b pb-2 mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-gray-700">{children}</div>
    </section>
  );
}

export default function ApiDocs() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">플렌티컨벤션 운영관리</div>
            <h1 className="text-lg md:text-xl font-bold">공식 API 문서 (v1)</h1>
          </div>
          <a
            href="/"
            className="text-xs text-blue-600 hover:underline"
          >
            ← 관리 시스템으로
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-8">
        <Section id="overview" title="개요">
          <p>
            플렌티컨벤션의 행사 캘린더를 외부 시스템(랜딩페이지, 파트너 서비스 등)에서 조회할 수 있는
            JSON API입니다. 모든 호출에 발급받은 <strong>API 키</strong>가 필요합니다.
          </p>
          <p>
            발급 권한(scope)에 따라 보이는 데이터 범위가 달라집니다. 키 발급은 플렌티컨벤션 관리자에게
            요청하세요.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
            <div className="font-semibold mb-1">Base URL</div>
            <code className="block font-mono">{BASE_URL_PROD}</code>
          </div>
        </Section>

        <Section id="auth" title="인증">
          <p>모든 요청은 두 가지 방식 중 하나로 인증할 수 있습니다.</p>
          <p>
            <strong>1) X-API-Key 헤더 (권장)</strong>
          </p>
          <CodeBlock>{`X-API-Key: pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
          <p>
            <strong>2) Authorization Bearer</strong>
          </p>
          <CodeBlock>{`Authorization: Bearer pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</CodeBlock>
          <p>
            인증 실패 시 <code>401</code>, 비활성 키로 호출 시 <code>403</code> 응답.
          </p>
        </Section>

        <Section id="scopes" title="권한 (Scope)">
          <p>키 발급 시 4가지 권한 중 하나로 지정됩니다.</p>
          <table className="w-full text-xs border">
            <thead className="bg-gray-50">
              <tr>
                <th className="border px-2 py-1.5 text-left w-24">scope</th>
                <th className="border px-2 py-1.5 text-left">설명</th>
                <th className="border px-2 py-1.5 text-left">노출 필드</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border px-2 py-1.5 font-mono">all</td>
                <td className="border px-2 py-1.5">모든 행사 + 전체 디테일</td>
                <td className="border px-2 py-1.5">id, event_type, status, 일시, 행사명, 홀, 좌석, 담당자</td>
              </tr>
              <tr>
                <td className="border px-2 py-1.5 font-mono">summary</td>
                <td className="border px-2 py-1.5">
                  종류만 — 디테일 가려진 응답. 어떤 종류의 행사가 있는지만 확인 가능.
                </td>
                <td className="border px-2 py-1.5">id, event_type, status, 일시, 홀 (행사명/고객 미노출)</td>
              </tr>
              <tr>
                <td className="border px-2 py-1.5 font-mono">wedding</td>
                <td className="border px-2 py-1.5">WEDDING 행사만 + 전체 디테일</td>
                <td className="border px-2 py-1.5">all 과 동일 (event_type === 'WEDDING' 만)</td>
              </tr>
              <tr>
                <td className="border px-2 py-1.5 font-mono">mice</td>
                <td className="border px-2 py-1.5">MICE 행사만 + 전체 디테일</td>
                <td className="border px-2 py-1.5">all 과 동일 (event_type === 'MICE' 만)</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-gray-500">
            취소된 행사 (LOS / 상담취소 / 미팅취소) 는 모든 응답에서 자동 제외됩니다.
          </p>
        </Section>

        <Section id="endpoint-events" title="GET /api/public/v1/calendar/events">
          <p>지정한 기간의 행사 목록을 조회합니다.</p>
          <p>
            <strong>쿼리 파라미터 (선택)</strong>
          </p>
          <ul className="list-disc pl-5 text-xs">
            <li>
              <code>from</code> — 시작일 (YYYY-MM-DD). 기본: 이번 달 1일
            </li>
            <li>
              <code>to</code> — 종료일 (YYYY-MM-DD). 기본: 향후 1년
            </li>
          </ul>
          <p>
            <strong>요청 예시</strong>
          </p>
          <CodeBlock>{`curl -H "X-API-Key: pk_..." \\
  "${BASE_URL_PROD}/api/public/v1/calendar/events?from=2026-05-01&to=2026-05-31"`}</CodeBlock>
          <p>
            <strong>응답 (scope: all)</strong>
          </p>
          <CodeBlock>{`{
  "scope": "all",
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "count": 2,
  "events": [
    {
      "id": "ev_abc123",
      "event_type": "WEDDING",
      "status": "DEF",
      "start_datetime": "2026-05-10T11:00",
      "end_datetime": "2026-05-10T15:00",
      "event_name": "김OO ♥ 박OO 결혼식",
      "halls": ["Hall A+B"],
      "usage_type": "AH",
      "seats": 200,
      "assigned_manager_name": "Sarah"
    },
    {
      "id": "ev_def456",
      "event_type": "MICE",
      "status": "INQ",
      "start_datetime": "2026-05-22T09:00",
      "end_datetime": "2026-05-22T18:00",
      "event_name": "OO그룹 워크숍",
      "halls": ["Leaf Room"],
      "usage_type": "AD",
      "seats": 50,
      "assigned_manager_name": null
    }
  ]
}`}</CodeBlock>
          <p>
            <strong>응답 (scope: summary)</strong>
          </p>
          <CodeBlock>{`{
  "scope": "summary",
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "count": 2,
  "events": [
    {
      "id": "ev_abc123",
      "event_type": "WEDDING",
      "status": "DEF",
      "start_datetime": "2026-05-10T11:00",
      "end_datetime": "2026-05-10T15:00",
      "halls": ["Hall A+B"]
    },
    {
      "id": "ev_def456",
      "event_type": "MICE",
      "status": "INQ",
      "start_datetime": "2026-05-22T09:00",
      "end_datetime": "2026-05-22T18:00",
      "halls": ["Leaf Room"]
    }
  ]
}`}</CodeBlock>
        </Section>

        <Section id="endpoint-me" title="GET /api/public/v1/me">
          <p>본인 키의 권한을 확인합니다 (introspection).</p>
          <CodeBlock>{`curl -H "X-API-Key: pk_..." "${BASE_URL_PROD}/api/public/v1/me"`}</CodeBlock>
          <CodeBlock>{`{
  "label": "플렌티 랜딩페이지",
  "scope": "summary",
  "active": true,
  "created_at": "2026-05-14T10:30:00.000Z"
}`}</CodeBlock>
        </Section>

        <Section id="status-values" title="상태값 (status) 참고">
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            <li>
              <code>INQ</code> — 문의/견적 단계
            </li>
            <li>
              <code>DEF</code> — 확정 (예약 확정)
            </li>
            <li>
              <code>미팅</code> / <code>시식</code> — 미팅·시식 일정 (행사로 가지 않음)
            </li>
            <li>
              취소 계열 (<code>LOS</code> / <code>상담취소</code> / <code>미팅취소</code>) — 응답에 포함 안 됨
            </li>
          </ul>
        </Section>

        <Section id="errors" title="에러 응답">
          <table className="w-full text-xs border">
            <thead className="bg-gray-50">
              <tr>
                <th className="border px-2 py-1.5 text-left w-20">코드</th>
                <th className="border px-2 py-1.5 text-left">에러</th>
                <th className="border px-2 py-1.5 text-left">의미</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border px-2 py-1.5 font-mono">401</td>
                <td className="border px-2 py-1.5 font-mono">missing_api_key</td>
                <td className="border px-2 py-1.5">헤더에 API 키가 없음</td>
              </tr>
              <tr>
                <td className="border px-2 py-1.5 font-mono">401</td>
                <td className="border px-2 py-1.5 font-mono">invalid_api_key</td>
                <td className="border px-2 py-1.5">존재하지 않는 토큰</td>
              </tr>
              <tr>
                <td className="border px-2 py-1.5 font-mono">403</td>
                <td className="border px-2 py-1.5 font-mono">api_key_disabled</td>
                <td className="border px-2 py-1.5">관리자가 비활성화한 키</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section id="security" title="보안 안내">
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            <li>토큰은 발급 직후 한 번만 평문으로 표시됩니다. 안전한 곳에 보관하세요.</li>
            <li>
              토큰을 클라이언트(브라우저, 모바일 앱)에 직접 노출하지 말고, 백엔드 프록시를 통해 호출하세요.
            </li>
            <li>토큰이 유출되었다면 즉시 관리자에게 알려 해당 키를 삭제하고 새로 발급받으세요.</li>
            <li>scope 는 최소 권한 원칙으로 선택하세요. 디테일이 필요 없으면 <code>summary</code> 가 가장 안전합니다.</li>
          </ul>
        </Section>

        <div className="text-xs text-gray-400 text-center pt-6 border-t">
          플렌티컨벤션 운영관리 — API v1 · 문의: 관리자에게 연락
        </div>
      </main>
    </div>
  );
}
