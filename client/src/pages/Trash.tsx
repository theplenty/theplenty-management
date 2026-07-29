import { weekdayKoOf } from '../lib/dateFmt';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TRASH_TYPE_LABEL, type TrashItem, type TrashType } from '../types';

function fmt(ts: string | null): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekdayKoOf(d)}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TYPE_BADGE: Record<TrashType, string> = {
  wedding: 'bg-pink-100 text-pink-800 border-pink-200',
  mice: 'bg-blue-100 text-blue-800 border-blue-200',
  event: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export default function Trash() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: TrashItem[]; count: number }>('/api/admin/trash');
      setItems(res.items);
    } catch (e) {
      setError('휴지통 목록을 불러오지 못했습니다.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function restore(it: TrashItem) {
    if (!confirm(`[${it.label}] 항목을 복구합니다.\n복구 후 원래 위치(${TRASH_TYPE_LABEL[it.type]})에서 다시 보입니다.\n계속하시겠습니까?`))
      return;
    setBusyId(it.id);
    try {
      await api.post(`/api/admin/trash/${it.type}/${it.id}/restore`, {});
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (e) {
      alert('복구 실패');
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function purge(it: TrashItem) {
    if (
      !confirm(
        `[${it.label}] 항목을 영구 삭제합니다.\n이 작업은 되돌릴 수 없습니다.${
          it.type === 'event' ? '\n행사의 식음·INVOICE·첨부파일·취소·리뷰도 함께 삭제됩니다.' : ''
        }\n계속하시겠습니까?`
      )
    )
      return;
    setBusyId(it.id);
    try {
      await api.delete(`/api/admin/trash/${it.type}/${it.id}`);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (e) {
      alert('영구 삭제 실패');
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function emptyAll() {
    if (items.length === 0) return;
    const first = prompt(
      `휴지통을 전체 비웁니다. 현재 ${items.length}건이 영구 삭제됩니다.\n행사의 자식 데이터(식음/INVOICE/첨부파일/취소/리뷰)도 모두 함께 삭제됩니다.\n\n계속하려면 "비우기" 라고 입력하세요.`
    );
    if (first !== '비우기') return;
    setBusyId('__ALL__');
    try {
      const res = await api.delete<{ ok: boolean; purged: number }>('/api/admin/trash');
      alert(`${res.purged}건을 영구 삭제했습니다.`);
      setItems([]);
    } catch (e) {
      alert('전체 비우기 실패');
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">🗑️ 휴지통</h1>
          <p className="text-xs text-gray-500 mt-1">
            삭제된 고객·행사를 모아둡니다. 영구 삭제하지 않으면 언제든 복구 가능합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary text-xs" disabled={loading}>
            새로고침
          </button>
          <button
            onClick={emptyAll}
            disabled={items.length === 0 || busyId === '__ALL__'}
            className="btn-danger text-xs disabled:opacity-50"
          >
            {busyId === '__ALL__' ? '삭제 중...' : `전체 비우기 (${items.length})`}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
          {error}
        </div>
      )}

      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-xs text-yellow-900 mb-4">
        <div className="font-semibold mb-1">⚠️ 동작 안내</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>고객·행사 삭제 버튼을 누르면 즉시 영구 삭제가 아니라 <strong>휴지통으로 이동</strong>합니다.</li>
          <li>휴지통의 항목은 캘린더·고객목록·검색 등 모든 화면에서 보이지 않습니다.</li>
          <li><strong>복구</strong>를 누르면 원래 위치로 되돌아갑니다 (행사의 경우 식음/INVOICE 등 자식 데이터도 그대로 복구).</li>
          <li><strong>영구 삭제</strong> 또는 <strong>전체 비우기</strong>는 되돌릴 수 없습니다.</li>
        </ul>
      </div>

      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-auto [&_th]:whitespace-nowrap">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-3 py-2 font-semibold border-b w-24">종류</th>
                <th className="text-left px-3 py-2 font-semibold border-b">이름</th>
                <th className="text-left px-3 py-2 font-semibold border-b">세부</th>
                <th className="text-left px-3 py-2 font-semibold border-b">삭제일시</th>
                <th className="text-left px-3 py-2 font-semibold border-b">삭제자</th>
                <th className="text-left px-3 py-2 font-semibold border-b w-44" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 py-8">
                    불러오는 중...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 py-8">
                    휴지통이 비어 있습니다.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={`${it.type}-${it.id}`} className="border-t">
                    <td className="px-3 py-2">
                      <span
                        className={
                          'inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ' +
                          TYPE_BADGE[it.type]
                        }
                      >
                        {TRASH_TYPE_LABEL[it.type]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">{it.label}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{it.detail}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{fmt(it.deleted_at)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {it.deleted_by_name || '-'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => restore(it)}
                          disabled={busyId === it.id}
                          className="btn-secondary !py-1 !px-2 text-xs disabled:opacity-50"
                        >
                          {busyId === it.id ? '...' : '↩ 복구'}
                        </button>
                        <button
                          onClick={() => purge(it)}
                          disabled={busyId === it.id}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          영구삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
