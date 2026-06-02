import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { canWriteMenu } from '../auth/permissions';
import { api, type ApiError } from '../lib/api';
import { nanoid } from '../lib/clientId';
import {
  type Menu,
  type MenuDetail,
  type MenuCategory,
  type MenuMode,
  MENU_CATEGORIES,
  MENU_CATEGORY_LABEL,
  MENU_CATEGORY_COLOR,
  MENU_MODE_LABEL,
  MENU_OPTIONS,
} from '../types';
import clsx from 'clsx';

// ── 서버 응답 타입 ────────────────────────────────────────────────────
interface MenusResponse {
  menus: Menu[];
  total: number;
}

// ── 폼 초기값 ────────────────────────────────────────────────────────
type MenuForm = {
  name_ko: string;
  category: MenuCategory;
  mode: MenuMode;
  serving_size_default: string;
  list_price: string;
  notes: string;
  is_active: boolean;
};

const EMPTY_FORM: MenuForm = {
  name_ko: '',
  category: '주식',
  mode: 'set',
  serving_size_default: '1',
  list_price: '',
  notes: '',
  is_active: true,
};

// ── 가격 포맷 헬퍼 ───────────────────────────────────────────────────
function fmtPrice(v: number | null) {
  if (v == null) return '—';
  return v.toLocaleString('ko-KR') + '원';
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function Menus() {
  const { user } = useAuth();
  const canWrite = canWriteMenu(user?.role);
  const isAdmin = user?.role === 'admin';

  // ── 상태 ──────────────────────────────────────────────────────────
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 필터 상태
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<MenuCategory | ''>('');
  const [showInactive, setShowInactive] = useState(false);

  // 모달 상태
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Menu | null>(null);
  const [form, setForm] = useState<MenuForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 세부내용 accordion 상태
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<MenuDetail[]>([]);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);

  // 토스트
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── 로드 ──────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<MenusResponse>('/api/menus');
      setMenus(res.menus);
    } catch {
      setError('메뉴 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // ── 토스트 헬퍼 ──────────────────────────────────────────────────
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // ── 필터된 목록 ──────────────────────────────────────────────────
  const visible = menus.filter((m) => {
    if (!showInactive && !m.is_active) return false;
    if (catFilter && m.category !== catFilter) return false;
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      if (!m.name_ko.toLowerCase().includes(kw)) return false;
    }
    return true;
  });

  // 카테고리별 건수
  const catCount: Partial<Record<MenuCategory | '', number>> = {
    '': menus.filter((m) => showInactive || m.is_active).length,
  };
  for (const cat of MENU_CATEGORIES) {
    catCount[cat] = menus.filter(
      (m) => m.category === cat && (showInactive || m.is_active)
    ).length;
  }

  // ── 모달 열기 ────────────────────────────────────────────────────
  function openAdd() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(m: Menu) {
    setEditTarget(m);
    setForm({
      name_ko: m.name_ko,
      category: m.category,
      mode: m.mode ?? 'set',
      serving_size_default: String(m.serving_size_default),
      list_price: m.list_price != null ? String(m.list_price) : '',
      notes: m.notes || '',
      is_active: m.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setFormError(null);
  }

  // ── 저장 ─────────────────────────────────────────────────────────
  async function handleSave() {
    const name = form.name_ko.trim();
    if (!name) { setFormError('메뉴명을 입력해주세요.'); return; }
    if (!form.category) { setFormError('카테고리를 선택해주세요.'); return; }

    const dup = menus.find(
      (m) => m.name_ko.trim() === name && m.id !== editTarget?.id
    );
    if (dup) {
      setFormError(`'${name}' 메뉴가 이미 존재합니다.`);
      return;
    }

    const price = form.list_price.trim();
    const payload = {
      name_ko: name,
      category: form.category,
      mode: form.mode,
      serving_size_default: Number(form.serving_size_default) || 1,
      list_price: price ? Number(price.replace(/,/g, '')) : null,
      notes: form.notes.trim(),
      is_active: form.is_active,
    };

    setSaving(true);
    setFormError(null);
    try {
      if (editTarget) {
        const res = await api.patch<{ menu: Menu }>(`/api/menus/${editTarget.id}`, payload);
        setMenus((prev) => prev.map((m) => (m.id === editTarget.id ? res.menu : m)));
        // 수정 중인 메뉴가 확장 상태이면 detailRows 유지 (details는 별도 저장)
        showToast('메뉴가 수정되었습니다.');
      } else {
        const res = await api.post<{ menu: Menu }>('/api/menus', payload);
        setMenus((prev) => [...prev, res.menu]);
        showToast('메뉴가 등록되었습니다.');
      }
      closeModal();
    } catch (e) {
      const ae = e as ApiError;
      const errPayload = ae.payload as { error?: string } | null;
      if (errPayload?.error === 'duplicate_name') {
        setFormError(`'${name}' 메뉴명이 이미 존재합니다.`);
      } else {
        setFormError('저장 중 오류가 발생했습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  // ── 비활성화 / 재활성화 ──────────────────────────────────────────
  async function toggleActive(m: Menu) {
    const action = m.is_active ? '비활성화' : '재활성화';
    if (!confirm(`'${m.name_ko}' 메뉴를 ${action}하시겠습니까?`)) return;

    try {
      const res = await api.patch<{ menu: Menu }>(`/api/menus/${m.id}`, {
        is_active: !m.is_active,
      });
      setMenus((prev) => prev.map((x) => (x.id === m.id ? res.menu : x)));
      showToast(`'${m.name_ko}' 메뉴가 ${action}되었습니다.`);
    } catch {
      showToast('오류가 발생했습니다.', false);
    }
  }

  // ── 세부내용 accordion ────────────────────────────────────────────
  function toggleExpand(m: Menu) {
    if (expandedId === m.id) {
      // 닫기
      if (detailDirty && !confirm('저장하지 않은 변경사항이 있습니다. 닫으시겠습니까?')) return;
      setExpandedId(null);
      setDetailRows([]);
      setDetailDirty(false);
    } else {
      // 다른 메뉴 열기
      if (expandedId && detailDirty) {
        if (!confirm('저장하지 않은 변경사항이 있습니다. 다른 메뉴로 이동하시겠습니까?')) return;
      }
      setExpandedId(m.id);
      setDetailRows((m.details ?? []).map((d) => ({ ...d })));
      setDetailDirty(false);
    }
  }

  function updateDetailRow(
    id: string,
    field: keyof Omit<MenuDetail, 'id'>,
    value: string
  ) {
    setDetailRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
    setDetailDirty(true);
  }

  function addDetailRow() {
    setDetailRows((prev) => [
      ...prev,
      { id: nanoid(), dish_name: '', quantity: '', notes: '' },
    ]);
    setDetailDirty(true);
  }

  function removeDetailRow(id: string) {
    setDetailRows((prev) => prev.filter((r) => r.id !== id));
    setDetailDirty(true);
  }

  async function saveDetails(menuId: string) {
    setDetailSaving(true);
    try {
      const res = await api.patch<{ menu: Menu }>(`/api/menus/${menuId}`, {
        details: detailRows,
      });
      setMenus((prev) => prev.map((m) => (m.id === menuId ? res.menu : m)));
      setDetailDirty(false);
      showToast('세부내용이 저장되었습니다.');
    } catch {
      showToast('저장 중 오류가 발생했습니다.', false);
    } finally {
      setDetailSaving(false);
    }
  }

  // 테이블 컬럼 수 (colSpan 계산용)
  // #, 메뉴명, 카테고리, 입력방식, 기본인분, 정가, 상태, 구성 = 8
  // + canWrite 액션 = 9
  const colCount = canWrite ? 9 : 8;

  // ── 렌더 ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">메뉴 마스터</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            판매 메뉴 카탈로그 — 행사 식음 항목 및 BOM 연결의 기준 데이터
          </p>
        </div>
        {canWrite && (
          <button onClick={openAdd} className="btn-primary shrink-0">
            + 메뉴 등록
          </button>
        )}
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-lg border p-3 space-y-3">
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            placeholder="메뉴명 검색…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field w-52"
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            비활성 메뉴 포함
          </label>
        </div>

        {/* 카테고리 탭 */}
        <div className="flex gap-1.5 flex-wrap">
          {([['', '전체'], ...MENU_CATEGORIES.map((c) => [c, c])] as [string, string][]).map(
            ([val, label]) => (
              <button
                key={val}
                onClick={() => setCatFilter(val as MenuCategory | '')}
                className={clsx(
                  'px-3 py-1 rounded-full text-xs font-medium transition',
                  catFilter === val
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                {label}
                <span className="ml-1 opacity-70">
                  {catCount[val as MenuCategory | ''] ?? 0}
                </span>
              </button>
            )
          )}
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중…</div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">{error}</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {menus.length === 0 ? '등록된 메뉴가 없습니다.' : '조건에 맞는 메뉴가 없습니다.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-8">#</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600">메뉴명</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-32">카테고리</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600 w-24">입력방식</th>
                <th className="px-4 py-2.5 text-right font-semibold text-gray-600 w-20">기본인분</th>
                <th className="px-4 py-2.5 text-right font-semibold text-gray-600 w-28">정가(1인)</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-600 w-16">상태</th>
                <th className="px-4 py-2.5 text-center font-semibold text-gray-600 w-20">구성</th>
                {canWrite && (
                  <th className="px-4 py-2.5 text-center font-semibold text-gray-600 w-28">
                    액션
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((m, idx) => (
                <Fragment key={m.id}>
                  {/* ── 메뉴 행 ── */}
                  <tr
                    className={clsx(
                      'transition hover:bg-gray-50',
                      !m.is_active && 'opacity-50'
                    )}
                  >
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={clsx(
                          'font-medium text-gray-900',
                          !m.is_active && 'line-through text-gray-400'
                        )}
                      >
                        {m.name_ko}
                      </span>
                      {isAdmin && m.notes && (
                        <span
                          className="ml-2 text-xs text-amber-600 cursor-default"
                          title={m.notes}
                        >
                          📝
                        </span>
                      )}
                      {/* 세부내용 건수 배지 */}
                      {(m.details?.length ?? 0) > 0 && (
                        <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 tabular-nums">
                          {m.details!.length}종
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={clsx(
                          'inline-block px-2 py-0.5 rounded-full text-xs font-medium',
                          MENU_CATEGORY_COLOR[m.category]
                        )}
                      >
                        {m.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-gray-500">
                        {m.mode === 'set'
                          ? 'GTD/EXP'
                          : m.mode === 'coffee'
                          ? '커피브레이크'
                          : '수량'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700">
                      {m.serving_size_default}인분
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">
                      {fmtPrice(m.list_price)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {m.is_active ? (
                        <span
                          className="inline-block w-2 h-2 rounded-full bg-green-500"
                          title="활성"
                        />
                      ) : (
                        <span
                          className="inline-block w-2 h-2 rounded-full bg-gray-300"
                          title="비활성"
                        />
                      )}
                    </td>
                    {/* ▶/▼ 세부내용 토글 */}
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => toggleExpand(m)}
                        className={clsx(
                          'text-xs px-2 py-1 rounded border transition font-medium',
                          expandedId === m.id
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-500 hover:bg-gray-100'
                        )}
                        title="세부 요리 구성 보기/편집"
                      >
                        {expandedId === m.id ? '▼' : '▶'}
                      </button>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(m)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => toggleActive(m)}
                            className={clsx(
                              'text-xs px-2 py-1 rounded border transition',
                              m.is_active
                                ? 'border-orange-300 text-orange-600 hover:bg-orange-50'
                                : 'border-green-300 text-green-600 hover:bg-green-50'
                            )}
                          >
                            {m.is_active ? '비활성화' : '재활성화'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>

                  {/* ── 세부내용 accordion 행 ── */}
                  {expandedId === m.id && (
                    <tr>
                      <td colSpan={colCount} className="p-0 bg-blue-50/20">
                        <DetailGrid
                          menu={m}
                          rows={detailRows}
                          dirty={detailDirty}
                          saving={detailSaving}
                          canWrite={canWrite}
                          onUpdate={updateDetailRow}
                          onAdd={addDetailRow}
                          onRemove={removeDetailRow}
                          onSave={() => saveDetails(m.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500 text-right">
            {visible.length}건 표시 / 전체 {menus.length}건
          </div>
        </div>
      )}

      {/* 모달 — 등록/수정 */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md space-y-4 p-6">
            <h2 className="text-base font-bold text-gray-900">
              {editTarget ? '메뉴 수정' : '메뉴 등록'}
            </h2>

            <div className="space-y-3">
              {/* 메뉴명 — 행사 식음메뉴와 동일한 목록 드롭다운 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  메뉴명 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.name_ko}
                  onChange={(e) => setForm((f) => ({ ...f, name_ko: e.target.value }))}
                  className="input-field w-full"
                  autoFocus
                >
                  <option value="">메뉴를 선택하세요…</option>
                  {MENU_OPTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 카테고리 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  카테고리 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value as MenuCategory }))
                  }
                  className="input-field w-full"
                >
                  {MENU_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {MENU_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>

              {/* 입력 모드 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  수량 입력 방식{' '}
                  <span className="text-xs font-normal text-gray-500">
                    (행사 식음 항목에 사용)
                  </span>
                </label>
                <select
                  value={form.mode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mode: e.target.value as MenuMode }))
                  }
                  className="input-field w-full"
                >
                  {(['set', 'coffee', 'qty'] as MenuMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MENU_MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>

              {/* 기본 인분 + 정가 (2-col) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    기본 인분
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.serving_size_default}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, serving_size_default: e.target.value }))
                    }
                    className="input-field w-full"
                    placeholder="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    정가 (1인, 원)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.list_price}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, list_price: e.target.value }))
                    }
                    className="input-field w-full"
                    placeholder="35000"
                  />
                </div>
              </div>

              {/* 메모 (admin only) */}
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    내부 메모{' '}
                    <span className="text-xs font-normal text-amber-600">
                      (관리자만 표시)
                    </span>
                  </label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="운영 참고 사항…"
                    className="input-field w-full resize-none"
                  />
                </div>
              )}

              {/* 수정 시: 활성 상태 변경 */}
              {editTarget && (
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, is_active: e.target.checked }))
                    }
                    className="rounded"
                  />
                  활성 상태로 유지 (체크 해제 = 비활성화)
                </label>
              )}
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeModal} className="btn-secondary">
                취소
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? '저장 중…' : editTarget ? '수정 저장' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div
          className={clsx(
            'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm text-white transition-opacity',
            toast.ok ? 'bg-green-600' : 'bg-red-600'
          )}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── 세부내용 그리드 (엑셀뷰어 스타일) ────────────────────────────────

interface DetailGridProps {
  menu: Menu;
  rows: MenuDetail[];
  dirty: boolean;
  saving: boolean;
  canWrite: boolean;
  onUpdate: (id: string, field: keyof Omit<MenuDetail, 'id'>, value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onSave: () => void;
}

function DetailGrid({
  menu,
  rows,
  dirty,
  saving,
  canWrite,
  onUpdate,
  onAdd,
  onRemove,
  onSave,
}: DetailGridProps) {
  return (
    <div className="px-5 py-3 border-t-2 border-blue-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-800">
            📋 {menu.name_ko} — 세부 요리 구성
          </span>
          {dirty && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
              미저장
            </span>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button
              onClick={onAdd}
              className="text-xs px-2.5 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition"
            >
              + 행 추가
            </button>
            <button
              onClick={onSave}
              disabled={saving || !dirty}
              className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        )}
      </div>

      {/* 엑셀 그리드 */}
      <div className="overflow-x-auto rounded border border-gray-300">
        <table
          className="text-sm border-collapse w-full"
          style={{ minWidth: '460px' }}
        >
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-gray-300 px-2 py-1.5 text-center text-xs font-semibold text-gray-600 w-9 select-none">
                #
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left text-xs font-semibold text-gray-600">
                요리명
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left text-xs font-semibold text-gray-600 w-28">
                수량/단위
              </th>
              <th className="border border-gray-300 px-2 py-1.5 text-left text-xs font-semibold text-gray-600 w-44">
                비고
              </th>
              {canWrite && (
                <th className="border border-gray-300 w-8 bg-slate-100"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canWrite ? 5 : 4}
                  className="border border-gray-300 px-3 py-5 text-center text-xs text-gray-400 italic"
                >
                  {canWrite
                    ? "+ 행 추가 버튼으로 세부 요리를 등록하세요."
                    : '등록된 세부 요리 구성이 없습니다.'}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={row.id} className="hover:bg-yellow-50/60 group">
                  {/* 번호 */}
                  <td className="border border-gray-300 px-2 py-0.5 text-center text-xs text-gray-400 select-none">
                    {i + 1}
                  </td>
                  {/* 요리명 */}
                  <td className="border border-gray-300 p-0">
                    {canWrite ? (
                      <input
                        type="text"
                        value={row.dish_name}
                        onChange={(e) => onUpdate(row.id, 'dish_name', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400"
                        placeholder="요리명"
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-sm">
                        {row.dish_name || '—'}
                      </span>
                    )}
                  </td>
                  {/* 수량/단위 */}
                  <td className="border border-gray-300 p-0">
                    {canWrite ? (
                      <input
                        type="text"
                        value={row.quantity}
                        onChange={(e) => onUpdate(row.id, 'quantity', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400"
                        placeholder="예: 1인분"
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-sm text-gray-600">
                        {row.quantity || '—'}
                      </span>
                    )}
                  </td>
                  {/* 비고 */}
                  <td className="border border-gray-300 p-0">
                    {canWrite ? (
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => onUpdate(row.id, 'notes', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400"
                        placeholder=""
                      />
                    ) : (
                      <span className="block px-2 py-1.5 text-sm text-gray-500">
                        {row.notes}
                      </span>
                    )}
                  </td>
                  {/* 삭제 */}
                  {canWrite && (
                    <td className="border border-gray-300 px-1 text-center">
                      <button
                        onClick={() => onRemove(row.id)}
                        className="text-gray-300 hover:text-red-500 transition text-sm group-hover:text-red-400"
                        title="행 삭제"
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 하단 힌트 */}
      <div className="mt-1.5 flex items-center justify-between">
        {dirty ? (
          <p className="text-xs text-amber-600">
            ● 변경사항이 있습니다. '저장' 버튼을 눌러 반영해주세요.
          </p>
        ) : (
          <p className="text-xs text-gray-400">
            {rows.length > 0
              ? `총 ${rows.length}개 요리 구성`
              : canWrite
              ? '구성 요리를 추가할 수 있습니다.'
              : ''}
          </p>
        )}
        {!canWrite && rows.length > 0 && (
          <p className="text-xs text-gray-400">세부내용 수정은 관리자·세일즈만 가능합니다.</p>
        )}
      </div>
    </div>
  );
}
