import { weekdayKoOf } from '../lib/dateFmt';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Modal from '../components/Modal';
import { API_KEY_SCOPE_DESC, type ApiKeyScope, type ApiKeySafe } from '../types';

const SCOPES: ApiKeyScope[] = ['all', 'summary', 'wedding', 'mice'];

function fmt(ts: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminApiKeys() {
  const [keys, setKeys] = useState<ApiKeySafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 발급 모달
  const [createOpen, setCreateOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftScope, setDraftScope] = useState<ApiKeyScope>('summary');
  const [creating, setCreating] = useState(false);

  // 발급 직후 평문 토큰을 한 번만 보여주는 모달
  const [showToken, setShowToken] = useState<{ label: string; token: string } | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ api_keys: ApiKeySafe[] }>('/api/admin/api-keys');
      setKeys(res.api_keys);
    } catch (e) {
      setError('API 키 목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!draftLabel.trim()) {
      alert('이름을 입력해주세요.');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post<{ api_key: ApiKeySafe; full_token: string }>(
        '/api/admin/api-keys',
        { label: draftLabel.trim(), scope: draftScope }
      );
      setKeys((prev) => [res.api_key, ...prev]);
      setCreateOpen(false);
      setDraftLabel('');
      setDraftScope('summary');
      setShowToken({ label: res.api_key.label, token: res.full_token });
    } catch (e) {
      alert('발급 실패');
      console.error(e);
    } finally {
      setCreating(false);
    }
  }

  async function patchKey(id: string, patch: Partial<{ scope: ApiKeyScope; active: boolean; label: string }>) {
    try {
      const res = await api.patch<{ api_key: ApiKeySafe }>(`/api/admin/api-keys/${id}`, patch);
      setKeys((prev) => prev.map((k) => (k.id === id ? res.api_key : k)));
    } catch (e) {
      alert('변경 실패');
      console.error(e);
    }
  }

  async function revoke(k: ApiKeySafe) {
    if (!confirm(`[${k.label}] API 키를 영구 삭제합니다. 이 토큰을 사용하는 외부 시스템은 즉시 401 오류를 받습니다.\n계속하시겠습니까?`))
      return;
    try {
      await api.delete(`/api/admin/api-keys/${k.id}`);
      setKeys((prev) => prev.filter((x) => x.id !== k.id));
    } catch (e) {
      alert('삭제 실패');
      console.error(e);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      alert('토큰이 복사되었습니다.');
    } catch {
      window.prompt('수동으로 복사하세요:', token);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">외부 API 키</h1>
          <p className="text-xs text-gray-500 mt-1">
            외부 랜딩페이지/파트너 서비스가 캘린더를 가져갈 때 사용할 키. 발급 시 권한(scope) 을 지정하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/api-docs"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary text-xs"
          >
            📘 API 문서 열기
          </a>
          <button onClick={() => setCreateOpen(true)} className="btn-primary">
            + API 키 발급
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto [&_th]:whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-3 py-2 font-semibold border-b">이름</th>
                <th className="text-left px-3 py-2 font-semibold border-b">토큰</th>
                <th className="text-left px-3 py-2 font-semibold border-b">권한 (scope)</th>
                <th className="text-left px-3 py-2 font-semibold border-b">발급자</th>
                <th className="text-left px-3 py-2 font-semibold border-b">발급일</th>
                <th className="text-left px-3 py-2 font-semibold border-b">최근 사용</th>
                <th className="text-left px-3 py-2 font-semibold border-b">상태</th>
                <th className="text-left px-3 py-2 font-semibold border-b w-16" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-8">
                    불러오는 중...
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-8">
                    발급된 API 키가 없습니다.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id} className="border-t">
                    <td className="px-3 py-2 font-medium text-gray-900">{k.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{k.masked_token}</td>
                    <td className="px-3 py-2">
                      <select
                        className="input !py-1 !text-xs !w-auto"
                        value={k.scope}
                        onChange={(e) => patchKey(k.id, { scope: e.target.value as ApiKeyScope })}
                      >
                        {SCOPES.map((s) => (
                          <option key={s} value={s}>
                            {API_KEY_SCOPE_DESC[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{k.created_by_name}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{fmt(k.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{fmt(k.last_used_at)}</td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={k.active}
                          onChange={(e) => patchKey(k.id, { active: e.target.checked })}
                        />
                        <span className={'text-xs ' + (k.active ? 'text-green-700' : 'text-gray-400')}>
                          {k.active ? '활성' : '중지'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => revoke(k)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 발급 모달 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="API 키 발급"
        widthClass="max-w-lg"
        footer={
          <>
            <button onClick={() => setCreateOpen(false)} className="btn-secondary">
              취소
            </button>
            <button onClick={create} disabled={creating} className="btn-primary">
              {creating ? '발급중...' : '발급'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">이름 *</label>
            <input
              className="input"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="예: 플렌티 랜딩페이지, ABC 케이터링"
            />
            <p className="text-[11px] text-gray-500 mt-1">사용 용도/소유자를 알아볼 수 있는 이름</p>
          </div>
          <div>
            <label className="label">권한 (scope) *</label>
            <div className="space-y-1.5">
              {SCOPES.map((s) => (
                <label
                  key={s}
                  className={
                    'flex items-start gap-2 p-2.5 border rounded cursor-pointer transition ' +
                    (draftScope === s ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50')
                  }
                >
                  <input
                    type="radio"
                    name="scope"
                    value={s}
                    checked={draftScope === s}
                    onChange={() => setDraftScope(s)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s}</div>
                    <div className="text-xs text-gray-600">{API_KEY_SCOPE_DESC[s]}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="text-[11px] text-gray-500 bg-yellow-50 border border-yellow-200 p-2 rounded">
            ⚠️ 발급된 토큰은 발급 직후 한 번만 표시됩니다. 안전한 곳에 보관하세요.<br />
            잃어버린 경우 이 키를 삭제하고 새로 발급해야 합니다.
          </div>
        </div>
      </Modal>

      {/* 발급 직후 평문 토큰 노출 */}
      <Modal
        open={!!showToken}
        onClose={() => setShowToken(null)}
        title="새 API 키 발급 완료"
        widthClass="max-w-xl"
        footer={
          <button onClick={() => setShowToken(null)} className="btn-primary">
            확인 (다시 표시되지 않습니다)
          </button>
        }
      >
        {showToken && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">이름</div>
              <div className="font-medium">{showToken.label}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">토큰</div>
              <div className="flex gap-2">
                <input
                  className="input font-mono text-xs"
                  value={showToken.token}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button onClick={() => copyToken(showToken.token)} className="btn-secondary shrink-0">
                  복사
                </button>
              </div>
            </div>
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 p-3 rounded">
              ⚠️ <strong>이 화면을 닫으면 토큰을 다시 볼 수 없습니다.</strong>
              <br />지금 외부 시스템에 등록하거나 안전한 곳에 보관하세요. 잃어버린 경우 이 키를 삭제하고 새로
              발급해야 합니다.
            </div>
            <div className="text-xs text-gray-600">
              사용 방법은{' '}
              <a
                href="/api-docs"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 underline"
              >
                API 문서
              </a>{' '}
              참고.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
