import { useState } from 'react';
import { nanoid } from '../lib/clientId';
import { MENU_OPTIONS, type FoodItem, type MenuName } from '../types';

// 식음 메뉴 입력 — 드롭다운으로 선택해서 추가, 같은 메뉴 중복 가능.
// 각 행: [메뉴명] [계약 GTD/EXP 쌍] [확정 GTD/EXP 쌍] [비고] [삭제]

type DraftItem = Omit<FoodItem, 'event_id'>;

interface Props {
  items: DraftItem[];
  onChange: (next: DraftItem[]) => void;
}

function makeDraft(name: MenuName): DraftItem {
  return {
    id: nanoid(),
    menu_name: name,
    gtd_contract: null,
    exp_contract: null,
    gtd_final: null,
    exp_final: null,
    time_label: '',
    service_time: '',
    quantity: null,
    memo: '',
  };
}

export default function FoodMenuInput({ items, onChange }: Props) {
  const [picker, setPicker] = useState<MenuName | ''>('');

  function addMenu(name: MenuName) {
    onChange([...items, makeDraft(name)]);
  }

  function updateRow(id: string, patch: Partial<DraftItem>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  function deleteRow(id: string) {
    onChange(items.filter((i) => i.id !== id));
  }

  return (
    <div>
      {/* 메뉴 추가 드롭다운 — 선택 즉시 행이 추가되고 셀렉트는 초기화 */}
      <div className="flex items-center gap-2 mb-4">
        <select
          className="input !py-1.5 !text-sm !w-auto min-w-[200px]"
          value={picker}
          onChange={(e) => {
            const v = e.target.value as MenuName | '';
            if (!v) return;
            addMenu(v);
            setPicker('');
          }}
        >
          <option value="">+ 식음 메뉴 추가 (선택 시 즉시 추가, 중복 가능)</option>
          {MENU_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {items.length > 0 && (
          <span className="text-xs text-gray-500">총 {items.length}개 메뉴 추가됨</span>
        )}
      </div>

      {/* 선택된 메뉴 리스트 */}
      {items.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-2">선택된 메뉴가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {/* 데스크탑 헤더 (md 이상) — 메뉴(3) + 계약(3) + 확정(3) + 비고(2) + 삭제(1) = 12 */}
          <div className="hidden md:grid md:grid-cols-12 gap-2 px-2 text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
            <div className="md:col-span-3">메뉴</div>
            <div className="md:col-span-3 text-center">계약 GTD / EXP</div>
            <div className="md:col-span-3 text-center">확정 GTD / EXP</div>
            <div className="md:col-span-2">비고</div>
            <div className="md:col-span-1" />
          </div>

          {items.map((r, idx) => (
            <div
              key={r.id}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 bg-gray-50/50"
            >
              <div className="md:col-span-3 flex items-center gap-2">
                <span className="text-[11px] text-gray-400 tabular-nums w-5 text-right">
                  {idx + 1}.
                </span>
                <span className="font-medium text-sm">{r.menu_name}</span>
              </div>

              <PairCell
                mobileLabel="계약 GTD / EXP"
                gtd={r.gtd_contract}
                exp={r.exp_contract}
                onGtd={(v) => updateRow(r.id, { gtd_contract: v })}
                onExp={(v) => updateRow(r.id, { exp_contract: v })}
              />
              <PairCell
                mobileLabel="확정 GTD / EXP"
                gtd={r.gtd_final}
                exp={r.exp_final}
                onGtd={(v) => updateRow(r.id, { gtd_final: v })}
                onExp={(v) => updateRow(r.id, { exp_final: v })}
              />

              <div className="md:col-span-2">
                <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">
                  비고
                </label>
                <input
                  type="text"
                  className="input !py-1.5 !text-sm"
                  value={r.memo}
                  onChange={(e) => updateRow(r.id, { memo: e.target.value })}
                />
              </div>

              <div className="md:col-span-1 flex md:justify-end">
                <button
                  type="button"
                  onClick={() => deleteRow(r.id)}
                  className="text-xs text-red-500 hover:underline px-2 py-1"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// GTD/EXP 한 쌍을 한 칸 안에 배치 — 두 개의 작은 number input + 사이에 "/" 구분자.
function PairCell({
  mobileLabel,
  gtd,
  exp,
  onGtd,
  onExp,
}: {
  mobileLabel: string;
  gtd: number | null;
  exp: number | null;
  onGtd: (v: number | null) => void;
  onExp: (v: number | null) => void;
}) {
  return (
    <div className="md:col-span-3">
      <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">
        {mobileLabel}
      </label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          aria-label={`${mobileLabel} — GTD`}
          placeholder="GTD"
          className="input !py-1.5 !text-sm !text-right tabular-nums !px-2"
          value={gtd ?? ''}
          onChange={(e) => onGtd(e.target.value === '' ? null : Number(e.target.value))}
        />
        <span className="text-gray-400 text-sm select-none">/</span>
        <input
          type="number"
          aria-label={`${mobileLabel} — EXP`}
          placeholder="EXP"
          className="input !py-1.5 !text-sm !text-right tabular-nums !px-2"
          value={exp ?? ''}
          onChange={(e) => onExp(e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>
    </div>
  );
}
