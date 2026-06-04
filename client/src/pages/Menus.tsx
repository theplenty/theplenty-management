import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { canWriteMenu } from '../auth/permissions';
import { api, type ApiError } from '../lib/api';
import { nanoid } from '../lib/clientId';
import {
  type Menu,
  type MenuDetail,
  type MenuEventType,
  type MenuMode,
  MENU_OPTIONS,
  MENU_MODE_LABEL,
  menuModeOf,
} from '../types';
import clsx from 'clsx';

interface MenusResponse { menus: Menu[]; total: number; }

type MenuForm = {
  name_ko: string;
  category: string;
  event_type: MenuEventType;
  mode: MenuMode;
  serving_size_default: string;
  list_price: string;
  notes: string;
  is_active: boolean;
};

const EMPTY_FORM: MenuForm = {
  name_ko: '', category: '', event_type: 'MICE', mode: 'set',
  serving_size_default: '1', list_price: '', notes: '', is_active: true,
};

const EVENT_TYPE_LABEL: Record<MenuEventType, string> = {
  MICE: '기업 (MICE)',
  WEDDING: '웨딩 (WEDDING)',
};
const EVENT_TYPE_COLOR: Record<MenuEventType, string> = {
  MICE: 'bg-blue-100 text-blue-700',
  WEDDING: 'bg-rose-100 text-rose-700',
};

function fmtPrice(v: number | null) {
  if (v == null) return '—';
  return v.toLocaleString('ko-KR') + '원';
}
function fmtCost(v: number | null) {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('ko-KR');
}

export default function Menus() {
  const { user } = useAuth();
  const canWrite = canWriteMenu(user?.role);
  const isAdmin = user?.role === 'admin';

  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [evtFilter, setEvtFilter] = useState<MenuEventType | ''>('');
  const [nameFilter, setNameFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Menu | null>(null);
  const [form, setForm] = useState<MenuForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<MenuDetail[]>([]);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await api.get<MenusResponse>('/api/menus');
      setMenus(res.menus);
    } catch { setError('메뉴 목록을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3000);
  }

  const visible = menus.filter((m) => {
    if (!showInactive && !m.is_active) return false;
    if (evtFilter && m.event_type !== evtFilter) return false;
    if (nameFilter && m.name_ko !== nameFilter) return false;
    if (search.trim()) {
      const kw = search.trim().toLowerCase();
      if (!m.name_ko.toLowerCase().includes(kw) && !m.category.toLowerCase().includes(kw)) return false;
    }
    return true;
  });

  // 메뉴명별 카운트 (현재 evtFilter 기준)
  const nameCount: Record<string, number> = {};
  for (const m of menus) {
    if (!showInactive && !m.is_active) continue;
    if (evtFilter && m.event_type !== evtFilter) continue;
    nameCount[m.name_ko] = (nameCount[m.name_ko] ?? 0) + 1;
  }
  const totalCount = Object.values(nameCount).reduce((s, v) => s + v, 0);

  // event_type별 카운트
  const evtCount: Record<string, number> = {};
  for (const m of menus) {
    if (!showInactive && !m.is_active) continue;
    evtCount[m.event_type] = (evtCount[m.event_type] ?? 0) + 1;
  }

  function openAdd() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, event_type: (evtFilter as MenuEventType) || 'MICE', name_ko: nameFilter || '' });
    setFormError(null); setModalOpen(true);
  }
  function openEdit(m: Menu) {
    setEditTarget(m);
    setForm({
      name_ko: m.name_ko, category: m.category,
      event_type: m.event_type || 'MICE',
      mode: m.mode ?? menuModeOf(m.name_ko),
      serving_size_default: String(m.serving_size_default),
      list_price: m.list_price != null ? String(m.list_price) : '',
      notes: m.notes || '', is_active: m.is_active,
    });
    setFormError(null); setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditTarget(null); setFormError(null); }

  async function handleSave() {
    const name = form.name_ko.trim();
    const cat = form.category.trim();
    if (!name) { setFormError('메뉴명을 선택해주세요.'); return; }
    if (!cat) { setFormError('코스 카테고리를 입력해주세요.'); return; }
    const dup = menus.find(
      (m) => m.name_ko === name && m.category === cat && m.event_type === form.event_type && m.id !== editTarget?.id
    );
    if (dup) { setFormError(`'${name} — ${cat} (${form.event_type})' 조합이 이미 존재합니다.`); return; }

    const price = form.list_price.trim();
    const payload = {
      name_ko: name, category: cat, event_type: form.event_type,
      mode: form.mode,
      serving_size_default: Number(form.serving_size_default) || 1,
      list_price: price ? Number(price.replace(/,/g, '')) : null,
      notes: form.notes.trim(), is_active: form.is_active,
    };
    setSaving(true); setFormError(null);
    try {
      if (editTarget) {
        const res = await api.patch<{ menu: Menu }>(`/api/menus/${editTarget.id}`, payload);
        setMenus((prev) => prev.map((m) => (m.id === editTarget.id ? res.menu : m)));
        showToast('수정되었습니다.');
      } else {
        const res = await api.post<{ menu: Menu }>('/api/menus', payload);
        setMenus((prev) => [...prev, res.menu]);
        showToast('등록되었습니다.');
      }
      closeModal();
    } catch (e) {
      const ae = e as ApiError;
      const ep = ae.payload as { error?: string } | null;
      if (ep?.error === 'duplicate_entry') setFormError(`'${name} — ${cat}' 조합이 이미 존재합니다.`);
      else setFormError('저장 중 오류가 발생했습니다.');
    } finally { setSaving(false); }
  }

  async function toggleActive(m: Menu) {
    const action = m.is_active ? '비활성화' : '재활성화';
    if (!confirm(`'${m.name_ko} — ${m.category}' 을 ${action}하시겠습니까?`)) return;
    try {
      const res = await api.patch<{ menu: Menu }>(`/api/menus/${m.id}`, { is_active: !m.is_active });
      setMenus((prev) => prev.map((x) => (x.id === m.id ? res.menu : x)));
      showToast(`${action}되었습니다.`);
    } catch { showToast('오류가 발생했습니다.', false); }
  }

  function toggleExpand(m: Menu) {
    if (expandedId === m.id) {
      if (detailDirty && !confirm('저장하지 않은 변경사항이 있습니다. 닫으시겠습니까?')) return;
      setExpandedId(null); setDetailRows([]); setDetailDirty(false);
    } else {
      if (expandedId && detailDirty) {
        if (!confirm('저장하지 않은 변경사항이 있습니다. 다른 항목으로 이동하시겠습니까?')) return;
      }
      setExpandedId(m.id);
      setDetailRows((m.details ?? []).map((d) => ({ ...d })));
      setDetailDirty(false);
    }
  }

  function updateDetailRow(id: string, field: keyof Omit<MenuDetail, 'id'>, value: string) {
    setDetailRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDetailDirty(true);
  }
  function addDetailRow() {
    setDetailRows((prev) => [...prev, { id: nanoid(), dish_name: '', quantity: '', unit: '', unit_price: null, portion_cost: null, notes: '' }]);
    setDetailDirty(true);
  }
  function removeDetailRow(id: string) {
    setDetailRows((prev) => prev.filter((r) => r.id !== id)); setDetailDirty(true);
  }
  async function saveDetails(menuId: string) {
    setDetailSaving(true);
    try {
      const res = await api.patch<{ menu: Menu }>(`/api/menus/${menuId}`, { details: detailRows });
      setMenus((prev) => prev.map((m) => (m.id === menuId ? res.menu : m)));
      setDetailDirty(false); showToast('원가 구성이 저장되었습니다.');
    } catch { showToast('저장 중 오류가 발생했습니다.', false); }
    finally { setDetailSaving(false); }
  }

  const colCount = canWrite ? 9 : 8;

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">메뉴 마스터</h1>
          <p className="text-sm text-gray-500 mt-0.5">메뉴별 코스 구성 및 BOM 원가 데이터</p>
        </div>
        {canWrite && (
          <button onClick={openAdd} className="btn-primary shrink-0">+ 코스 추가</button>
        )}
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-lg border p-3 space-y-3">
        {/* 검색 + 비활성 */}
        <div className="flex gap-3 items-center flex-wrap">
          <input type="text" placeholder="메뉴명 / 카테고리 검색…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="input-field w-56" />
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
            비활성 포함
          </label>
        </div>

        {/* 기업/웨딩 탭 */}
        <div className="flex gap-1.5 flex-wrap">
          {([['', '전체', menus.filter(m => showInactive || m.is_active).length],
            ['MICE', '기업 (MICE)', evtCount['MICE'] ?? 0],
            ['WEDDING', '웨딩 (WEDDING)', evtCount['WEDDING'] ?? 0]] as [string, string, number][]).map(
            ([val, label, count]) => (
              <button key={val} onClick={() => { setEvtFilter(val as MenuEventType | ''); setNameFilter(''); }}
                className={clsx('px-3 py-1 rounded-full text-xs font-medium transition',
                  evtFilter === val ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                {label} <span className="ml-1 opacity-70">{count}</span>
              </button>
            )
          )}
        </div>

        {/* 메뉴명 탭 */}
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setNameFilter('')}
            className={clsx('px-3 py-1 rounded-full text-xs font-medium transition',
              nameFilter === '' ? 'bg-slate-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
            전체 <span className="ml-1 opacity-70">{totalCount}</span>
          </button>
          {MENU_OPTIONS.map((name) => (
            <button key={name} onClick={() => setNameFilter(name)}
              className={clsx('px-3 py-1 rounded-full text-xs font-medium transition',
                nameFilter === name ? 'bg-slate-600 text-white'
                  : (nameCount[name] ?? 0) > 0 ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100')}>
              {name} <span className="ml-1 opacity-70">{nameCount[name] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중…</div>
      ) : error ? (
        <div className="text-center py-16 text-red-500">{error}</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          {menus.length === 0 ? '등록된 항목이 없습니다.' : '조건에 맞는 항목이 없습니다.'}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-8">#</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-20">구분</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-40">메뉴명</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600">코스 카테고리</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-20">입력방식</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600 w-28">판매단가</th>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-600 w-16">상태</th>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-600 w-20">원가구성</th>
                {canWrite && <th className="px-3 py-2.5 text-center font-semibold text-gray-600 w-28">액션</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((m, idx) => (
                <Fragment key={m.id}>
                  <tr className={clsx('transition hover:bg-gray-50', !m.is_active && 'opacity-50')}>
                    <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <span className={clsx('text-[11px] px-1.5 py-0.5 rounded font-medium', EVENT_TYPE_COLOR[m.event_type || 'MICE'])}>
                        {m.event_type || 'MICE'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={clsx('font-medium text-gray-900 text-sm', !m.is_active && 'line-through text-gray-400')}>
                        {m.name_ko}
                      </span>
                      {isAdmin && m.notes && <span className="ml-1 text-xs text-amber-600 cursor-default" title={m.notes}>📝</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700">{m.category || '—'}</span>
                        {(m.details?.length ?? 0) > 0 && (
                          <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 tabular-nums">
                            {m.details!.length}항목
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-gray-400">
                        {m.mode === 'set' ? 'GTD/EXP' : m.mode === 'coffee' ? '커피' : '수량'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 text-sm">
                      {fmtPrice(m.list_price)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {m.is_active
                        ? <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="활성" />
                        : <span className="inline-block w-2 h-2 rounded-full bg-gray-300" title="비활성" />}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => toggleExpand(m)}
                        className={clsx('text-xs px-2 py-1 rounded border transition font-medium',
                          expandedId === m.id ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-100')}>
                        {expandedId === m.id ? '▼' : '▶'}
                      </button>
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openEdit(m)}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 transition">
                            수정
                          </button>
                          <button onClick={() => toggleActive(m)}
                            className={clsx('text-xs px-2 py-1 rounded border transition',
                              m.is_active ? 'border-orange-300 text-orange-600 hover:bg-orange-50' : 'border-green-300 text-green-600 hover:bg-green-50')}>
                            {m.is_active ? '비활성화' : '재활성화'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>

                  {/* BOM 원가 accordion */}
                  {expandedId === m.id && (
                    <tr>
                      <td colSpan={colCount} className="p-0 bg-blue-50/20">
                        <CostGrid
                          menu={m} rows={detailRows} dirty={detailDirty} saving={detailSaving}
                          canWrite={canWrite}
                          onUpdate={updateDetailRow} onAdd={addDetailRow} onRemove={removeDetailRow}
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

      {/* 등록/수정 모달 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md space-y-4 p-6">
            <h2 className="text-base font-bold text-gray-900">
              {editTarget ? '코스 수정' : '코스 추가'}
            </h2>
            <p className="text-xs text-gray-500 -mt-2">메뉴명 아래 코스 항목을 등록합니다.</p>

            <div className="space-y-3">
              {/* 구분 (MICE/WEDDING) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  구분 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {(['MICE', 'WEDDING'] as MenuEventType[]).map((et) => (
                    <button key={et} type="button"
                      onClick={() => setForm((f) => ({ ...f, event_type: et }))}
                      className={clsx('flex-1 py-2 rounded border text-sm font-medium transition',
                        form.event_type === et ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
                      {EVENT_TYPE_LABEL[et]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 메뉴명 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  메뉴명 <span className="text-red-500">*</span>
                </label>
                <select value={form.name_ko}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({ ...f, name_ko: name, mode: name ? menuModeOf(name) : f.mode }));
                  }}
                  className="input-field w-full" autoFocus>
                  <option value="">메뉴를 선택하세요…</option>
                  {MENU_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>

              {/* 코스 카테고리 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  코스 카테고리 <span className="text-red-500">*</span>
                  <span className="ml-1 text-xs font-normal text-gray-400">(예: Appetizer, Soup, Main, Dessert)</span>
                </label>
                <input type="text" value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Appetizer" className="input-field w-full" list="cat-suggestions" />
                <datalist id="cat-suggestions">
                  <option value="Appetizer" /><option value="Soup" /><option value="Main" />
                  <option value="Fish Main" /><option value="Meat Main" /><option value="Dessert" />
                  <option value="샐러드" /><option value="메인" /><option value="디저트" />
                  <option value="반찬" /><option value="밥" /><option value="스프" />
                  <option value="떡 구성" /><option value="쿠키 구성" />
                </datalist>
              </div>

              {/* 판매단가 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  판매 단가 (원)
                  <span className="ml-1 text-xs font-normal text-gray-400">(원가율 계산 기준)</span>
                </label>
                <input type="number" min={0} value={form.list_price}
                  onChange={(e) => setForm((f) => ({ ...f, list_price: e.target.value }))}
                  className="input-field w-full" placeholder="83636" />
              </div>

              {/* 수량 입력 방식 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  수량 입력 방식
                  <span className="ml-1 text-xs font-normal text-gray-400">(메뉴명 선택 시 자동)</span>
                </label>
                <select value={form.mode}
                  onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as MenuMode }))}
                  className="input-field w-full">
                  {(['set', 'coffee', 'qty'] as MenuMode[]).map((m) => (
                    <option key={m} value={m}>{MENU_MODE_LABEL[m]}</option>
                  ))}
                </select>
              </div>

              {/* 내부 메모 (admin only) */}
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    내부 메모<span className="ml-1 text-xs font-normal text-amber-600">(관리자만)</span>
                  </label>
                  <textarea rows={2} value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="input-field w-full resize-none" />
                </div>
              )}

              {editTarget && (
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                  활성 상태 유지
                </label>
              )}
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeModal} className="btn-secondary">취소</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? '저장 중…' : editTarget ? '수정 저장' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={clsx('fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm text-white',
          toast.ok ? 'bg-green-600' : 'bg-red-600')}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── BOM 원가 구성 그리드 ──────────────────────────────────────────────

interface CostGridProps {
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

function CostGrid({ menu, rows, dirty, saving, canWrite, onUpdate, onAdd, onRemove, onSave }: CostGridProps) {
  const totalCost = rows.reduce((s, r) => s + (r.portion_cost ?? 0), 0);
  const costPct = menu.list_price && totalCost > 0
    ? ((totalCost / menu.list_price) * 100).toFixed(1) + '%'
    : null;

  return (
    <div className="px-5 py-3 border-t-2 border-blue-200">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-800">
            📋 {menu.name_ko} / {menu.category}
          </span>
          {dirty && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">미저장</span>
          )}
          {totalCost > 0 && (
            <span className="text-xs text-gray-600 bg-gray-100 rounded px-2 py-0.5">
              원가 합계: <strong>{Math.round(totalCost).toLocaleString('ko-KR')}원</strong>
              {costPct && <span className="ml-1 text-blue-600">({costPct})</span>}
            </span>
          )}
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            <button onClick={onAdd}
              className="text-xs px-2.5 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition">
              + 항목 추가
            </button>
            <button onClick={onSave} disabled={saving || !dirty}
              className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-gray-300">
        <table className="text-sm border-collapse w-full" style={{ minWidth: '660px' }}>
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-gray-300 px-2 py-1.5 text-center text-xs font-semibold text-gray-600 w-9 select-none">#</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left text-xs font-semibold text-gray-600">식재료명</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right text-xs font-semibold text-gray-600 w-20">수량</th>
              <th className="border border-gray-300 px-2 py-1.5 text-center text-xs font-semibold text-gray-600 w-16">단위</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right text-xs font-semibold text-gray-600 w-24">단가(원)</th>
              <th className="border border-gray-300 px-2 py-1.5 text-right text-xs font-semibold text-gray-600 w-28">부분원가(원)</th>
              <th className="border border-gray-300 px-2 py-1.5 text-left text-xs font-semibold text-gray-600 w-32">비고</th>
              {canWrite && <th className="border border-gray-300 w-8 bg-slate-100"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 8 : 7}
                  className="border border-gray-300 px-3 py-5 text-center text-xs text-gray-400 italic">
                  {canWrite ? "'+항목 추가' 버튼으로 식재료 원가를 입력하세요." : '등록된 원가 구성 항목이 없습니다.'}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={row.id} className="hover:bg-yellow-50/60 group">
                  <td className="border border-gray-300 px-2 py-0.5 text-center text-xs text-gray-400 select-none">{i + 1}</td>
                  {/* 식재료명 */}
                  <CostCell canWrite={canWrite} value={row.dish_name} placeholder="식재료명"
                    onChange={(v) => onUpdate(row.id, 'dish_name', v)} />
                  {/* 수량 */}
                  <CostCell canWrite={canWrite} value={row.quantity} placeholder="71.5"
                    align="right" onChange={(v) => onUpdate(row.id, 'quantity', v)} />
                  {/* 단위 */}
                  <CostCell canWrite={canWrite} value={row.unit} placeholder="G"
                    align="center" onChange={(v) => onUpdate(row.id, 'unit', v)} />
                  {/* 단가 */}
                  <CostCell canWrite={canWrite}
                    value={row.unit_price != null ? String(row.unit_price) : ''}
                    placeholder="37.8" align="right" mono
                    onChange={(v) => onUpdate(row.id, 'unit_price', v)}
                    display={row.unit_price != null ? fmtCost(row.unit_price) : ''}
                  />
                  {/* 부분원가 */}
                  <CostCell canWrite={canWrite}
                    value={row.portion_cost != null ? String(row.portion_cost) : ''}
                    placeholder="2703" align="right" mono
                    onChange={(v) => onUpdate(row.id, 'portion_cost', v)}
                    display={row.portion_cost != null ? fmtCost(row.portion_cost) : ''}
                  />
                  {/* 비고 */}
                  <CostCell canWrite={canWrite} value={row.notes} placeholder=""
                    onChange={(v) => onUpdate(row.id, 'notes', v)} />
                  {canWrite && (
                    <td className="border border-gray-300 px-1 text-center">
                      <button onClick={() => onRemove(row.id)}
                        className="text-gray-300 hover:text-red-500 transition text-sm group-hover:text-red-400" title="삭제">
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
            {/* 합계 행 */}
            {rows.length > 0 && (
              <tr className="bg-slate-50 font-semibold">
                <td colSpan={5} className="border border-gray-300 px-2 py-1.5 text-right text-xs text-gray-600">합계</td>
                <td className="border border-gray-300 px-2 py-1.5 text-right text-xs tabular-nums text-gray-800">
                  {Math.round(totalCost).toLocaleString('ko-KR')}
                </td>
                <td colSpan={canWrite ? 2 : 1} className="border border-gray-300 px-2 py-1.5 text-xs text-gray-400">
                  {costPct && <span>원가율 <strong className="text-blue-600">{costPct}</strong></span>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dirty && (
        <p className="text-xs text-amber-600 mt-1.5">● 변경사항이 있습니다. '저장' 버튼을 눌러주세요.</p>
      )}
    </div>
  );
}

function CostCell({
  canWrite, value, placeholder, align = 'left', mono = false, display, onChange,
}: {
  canWrite: boolean; value: string; placeholder: string;
  align?: 'left' | 'right' | 'center'; mono?: boolean;
  display?: string;
  onChange: (v: string) => void;
}) {
  const textAlign = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  if (!canWrite) {
    return (
      <td className="border border-gray-300 p-0">
        <span className={clsx('block px-2 py-1.5 text-sm', textAlign, mono && 'tabular-nums font-mono')}>
          {display ?? (value || '—')}
        </span>
      </td>
    );
  }
  return (
    <td className="border border-gray-300 p-0">
      <input type="text" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'w-full px-2 py-1.5 text-sm bg-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-blue-400',
          textAlign, mono && 'tabular-nums font-mono'
        )}
      />
    </td>
  );
}
