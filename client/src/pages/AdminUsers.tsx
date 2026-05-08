import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ROLE_LABEL, type Role, type Team, type User } from '../types';
import { invalidateActiveUsers } from '../lib/useActiveUsers';

const ROLE_OPTIONS: Role[] = [
  'pending',
  'sales_mice',
  'sales_wedding',
  'banquet',
  'kitchen',
  'admin',
  'disabled',
];

const TEAM_BY_ROLE: Record<Role, Team> = {
  admin: 'admin',
  sales_mice: 'sales_mice',
  sales_wedding: 'sales_wedding',
  banquet: 'banquet',
  kitchen: 'kitchen',
  pending: null,
  disabled: null,
};

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  // 이름 편집 중인 row의 임시 값
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ users: User[] }>('/api/users');
      setUsers(res.users);
      setNameDrafts({});
    } catch (e) {
      setError('사용자 목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function changeRole(u: User, role: Role) {
    setSavingId(u.id);
    try {
      const team = TEAM_BY_ROLE[role];
      const res = await api.patch<{ user: User }>(`/api/users/${u.id}`, { role, team });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
      invalidateActiveUsers();
    } catch (e) {
      alert('변경 실패');
      console.error(e);
    } finally {
      setSavingId(null);
    }
  }

  async function commitName(u: User) {
    const draft = nameDrafts[u.id];
    if (draft === undefined || draft === u.name) {
      setNameDrafts((p) => {
        const n = { ...p };
        delete n[u.id];
        return n;
      });
      return;
    }
    if (!draft.trim()) {
      alert('이름은 비워둘 수 없습니다.');
      return;
    }
    setSavingId(u.id);
    try {
      const res = await api.patch<{ user: User }>(`/api/users/${u.id}`, { name: draft.trim() });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
      setNameDrafts((p) => {
        const n = { ...p };
        delete n[u.id];
        return n;
      });
      invalidateActiveUsers();
    } catch (e) {
      alert('이름 변경 실패');
      console.error(e);
    } finally {
      setSavingId(null);
    }
  }

  async function deleteUser(u: User) {
    if (!confirm(`${u.name}(${u.email}) 사용자를 삭제하시겠습니까?`)) return;
    setSavingId(u.id);
    try {
      await api.delete(`/api/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      invalidateActiveUsers();
    } catch (e) {
      alert('삭제 실패 (마지막 관리자는 삭제할 수 없습니다)');
      console.error(e);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">사용자 관리</h1>
        <button onClick={load} className="btn-secondary">
          새로고침
        </button>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        Google 로그인으로 가입한 사용자에게 권한과 팀을 부여하거나 회수합니다. 퇴사자는{' '}
        <strong>비활성</strong>으로 변경하면 시스템에 더 이상 접근할 수 없습니다.
      </p>
      <p className="text-xs text-gray-500 mb-4">
        💡 <strong>이름</strong> 칸을 클릭하면 직접 수정 가능합니다. 여기서 부여한 이름이 작성자 / 담당지배인 등 시스템 전반에 표시됩니다.
      </p>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">이름 (편집 가능)</th>
              <th className="text-left px-4 py-2 font-semibold">이메일</th>
              <th className="text-left px-4 py-2 font-semibold">현재 권한</th>
              <th className="text-left px-4 py-2 font-semibold">권한 변경</th>
              <th className="text-left px-4 py-2 font-semibold">가입일</th>
              <th className="text-left px-4 py-2 font-semibold">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8">
                  불러오는 중...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-8">
                  사용자가 없습니다.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const draft = nameDrafts[u.id];
                const editing = draft !== undefined;
                return (
                  <tr key={u.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={editing ? draft : u.name}
                        onChange={(e) =>
                          setNameDrafts((p) => ({ ...p, [u.id]: e.target.value }))
                        }
                        onBlur={() => commitName(u)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape')
                            setNameDrafts((p) => {
                              const n = { ...p };
                              delete n[u.id];
                              return n;
                            });
                        }}
                        disabled={savingId === u.id}
                        className={
                          'w-full px-2 py-1 rounded border text-sm transition ' +
                          (editing
                            ? 'border-blue-400 bg-blue-50 outline-none ring-1 ring-blue-300'
                            : 'border-transparent hover:border-gray-300 bg-transparent')
                        }
                      />
                    </td>
                    <td className="px-4 py-2 text-gray-600">{u.email}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          'badge ' +
                          (u.role === 'admin'
                            ? 'bg-purple-100 text-purple-800'
                            : u.role === 'pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : u.role === 'disabled'
                                ? 'bg-gray-200 text-gray-600'
                                : 'bg-blue-100 text-blue-800')
                        }
                      >
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        className="input !py-1 !text-xs w-44"
                        value={u.role}
                        disabled={savingId === u.id}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(u.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        className="text-red-600 hover:underline text-xs disabled:text-gray-300"
                        disabled={savingId === u.id}
                        onClick={() => deleteUser(u)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
