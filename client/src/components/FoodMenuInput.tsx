import { nanoid } from '../lib/clientId';
import {
  MENU_OPTIONS,
  menuModeOf,
  type FoodItem,
  type MenuName,
} from '../types';

// 식음 메뉴 입력 — 스펙의 3가지 입력 규칙을 한 번에 표현
//   1) set/lunchbox 메뉴: 메뉴 1행, gtd/exp 입력
//   2) Coffee Break: N행, time_label/service_time/quantity
//   3) dessert/rice cake: 메뉴 1행, quantity만

type DraftItem = Omit<FoodItem, 'event_id'>;

interface Props {
  items: DraftItem[];
  onChange: (next: DraftItem[]) => void;
}

export default function FoodMenuInput({ items, onChange }: Props) {
  // 메뉴 종류별로 들어 있는지 여부 (chip 토글)
  const selectedMenus = new Set<MenuName>(items.map((i) => i.menu_name));

  function toggleMenu(name: MenuName) {
    if (selectedMenus.has(name)) {
      onChange(items.filter((i) => i.menu_name !== name));
      return;
    }
    // 신규 추가 — 메뉴 모드별 기본 행 1개
    const id = nanoid();
    const base: DraftItem = {
      id,
      menu_name: name,
      gtd: null,
      exp: null,
      time_label: '',
      service_time: '',
      quantity: null,
      memo: '',
    };
    if (menuModeOf(name) === 'coffee') base.time_label = '1time';
    onChange([...items, base]);
  }

  function updateRow(id: string, patch: Partial<DraftItem>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function deleteRow(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }

  function addCoffeeRow() {
    const existing = items.filter((i) => i.menu_name === 'Coffee Break');
    const nextLabel = `${existing.length + 1}time`;
    onChange([
      ...items,
      {
        id: nanoid(),
        menu_name: 'Coffee Break',
        gtd: null,
        exp: null,
        time_label: nextLabel,
        service_time: '',
        quantity: null,
        memo: '',
      },
    ]);
  }

  // 그룹별로 정렬해서 렌더 — Coffee Break는 묶어서, 나머지는 메뉴별로
  const grouped: Record<string, DraftItem[]> = {};
  for (const it of items) {
    grouped[it.menu_name] = grouped[it.menu_name] || [];
    grouped[it.menu_name].push(it);
  }

  return (
    <div>
      {/* 메뉴 토글 칩 */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MENU_OPTIONS.map((m) => {
          const on = selectedMenus.has(m);
          return (
            <button
              key={m}
              type="button"
              onClick={() => toggleMenu(m)}
              className={
                'px-2.5 py-1 rounded-full border text-xs transition ' +
                (on
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50')
              }
            >
              {m}
            </button>
          );
        })}
      </div>

      {/* 메뉴별 입력 행 */}
      {Object.keys(grouped).length === 0 && (
        <div className="text-xs text-gray-400 italic py-2">선택된 메뉴가 없습니다.</div>
      )}

      {Object.entries(grouped).map(([menuName, rows]) => {
        const mode = menuModeOf(menuName as MenuName);
        return (
          <div key={menuName} className="mb-3 border rounded-md p-3 bg-gray-50/50">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">{menuName}</div>
              {mode === 'coffee' && (
                <button
                  type="button"
                  onClick={addCoffeeRow}
                  className="text-xs text-blue-600 hover:underline"
                >
                  + 회차 추가
                </button>
              )}
            </div>

            {mode === 'set' &&
              rows.map((r) => (
                <div key={r.id} className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
                  <NumInput
                    label="GTD"
                    value={r.gtd}
                    onChange={(v) => updateRow(r.id, { gtd: v })}
                  />
                  <NumInput
                    label="EXP"
                    value={r.exp}
                    onChange={(v) => updateRow(r.id, { exp: v })}
                  />
                  <TextInput
                    label="비고"
                    className="md:col-span-3"
                    value={r.memo}
                    onChange={(v) => updateRow(r.id, { memo: v })}
                  />
                </div>
              ))}

            {mode === 'qty' &&
              rows.map((r) => (
                <div key={r.id} className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
                  <NumInput
                    label="수량"
                    value={r.quantity}
                    onChange={(v) => updateRow(r.id, { quantity: v })}
                  />
                  <TextInput
                    label="비고"
                    className="md:col-span-3"
                    value={r.memo}
                    onChange={(v) => updateRow(r.id, { memo: v })}
                  />
                </div>
              ))}

            {mode === 'coffee' && (
              <div className="space-y-2">
                {rows.map((r) => (
                  <div key={r.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                    <TextInput
                      label="회차"
                      className="md:col-span-2"
                      value={r.time_label}
                      onChange={(v) => updateRow(r.id, { time_label: v })}
                      placeholder="1time"
                    />
                    <TextInput
                      label="시간"
                      type="time"
                      className="md:col-span-2"
                      value={r.service_time}
                      onChange={(v) => updateRow(r.id, { service_time: v })}
                    />
                    <NumInput
                      label="수량"
                      className="md:col-span-2"
                      value={r.quantity}
                      onChange={(v) => updateRow(r.id, { quantity: v })}
                    />
                    <TextInput
                      label="비고"
                      className="md:col-span-5"
                      value={r.memo}
                      onChange={(v) => updateRow(r.id, { memo: v })}
                    />
                    <button
                      type="button"
                      onClick={() => deleteRow(r.id)}
                      className="md:col-span-1 text-xs text-red-500 hover:underline pb-2"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  className,
  placeholder,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className={className}>
      <label className="text-[11px] uppercase tracking-wide text-gray-500">{label}</label>
      <input
        type={type || 'text'}
        className="input !py-1.5 !text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-[11px] uppercase tracking-wide text-gray-500">{label}</label>
      <input
        type="number"
        className="input !py-1.5 !text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </div>
  );
}
