import { useState } from 'react';
import { nanoid } from '../lib/clientId';
import { type FoodItem, type MenuMode, MENU_OPTIONS, menuModeOf } from '../types';

// 식음 메뉴 입력 — MENU_OPTIONS 고정 목록에서 선택.
// 행사 저장 후에는 menu_name이 문자열로 고정됨 (마스터 변경 영향 없음).
// 각 행: [메뉴명(고정)] [모드별 수량입력] [비고] [삭제]

type DraftItem = Omit<FoodItem, 'event_id'>;

interface Props {
  items: DraftItem[];
  onChange: (next: DraftItem[]) => void;
}

function makeDraft(name: string): DraftItem {
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
  const [picker, setPicker] = useState('');

  function addMenu(name: string) {
    if (!name) return;
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
      {/* 메뉴 추가 드롭다운 */}
      <div className="flex items-center gap-2 mb-4">
        <select
          className="input !py-1.5 !text-sm !w-auto min-w-[220px]"
          value={picker}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            addMenu(v);
            setPicker('');
          }}
        >
          <option value="">+ 식음 메뉴 추가 (선택 시 즉시 추가, 중복 가능)</option>
          <option value="식사없음">식사없음</option>
          {MENU_OPTIONS.map((name) => (
            <option key={name} value={name}>
              {name}
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
          {items.map((r, idx) => {
            // 식사없음은 수량 입력 없이 단순 라벨 행으로 표시
            if (r.menu_name === '식사없음') {
              return (
                <NoMealRow
                  key={r.id}
                  idx={idx}
                  onDelete={() => deleteRow(r.id)}
                />
              );
            }
            const mode = menuModeOf(r.menu_name);
            return (
              <FoodRow
                key={r.id}
                idx={idx}
                item={r}
                mode={mode}
                onUpdate={(patch) => updateRow(r.id, patch)}
                onDelete={() => deleteRow(r.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 개별 행 컴포넌트 ─────────────────────────────────────────────────
function FoodRow({
  idx,
  item,
  mode,
  onUpdate,
  onDelete,
}: {
  idx: number;
  item: DraftItem;
  mode: MenuMode;
  onUpdate: (patch: Partial<DraftItem>) => void;
  onDelete: () => void;
}) {
  if (mode === 'set') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 bg-gray-50/50">
        <NameCell idx={idx} name={item.menu_name} />
        <PairCell
          mobileLabel="계약 GTD / EXP"
          gtd={item.gtd_contract}
          exp={item.exp_contract}
          onGtd={(v) => onUpdate({ gtd_contract: v })}
          onExp={(v) => onUpdate({ exp_contract: v })}
        />
        <PairCell
          mobileLabel="확정 GTD / EXP"
          gtd={item.gtd_final}
          exp={item.exp_final}
          onGtd={(v) => onUpdate({ gtd_final: v })}
          onExp={(v) => onUpdate({ exp_final: v })}
        />
        <MemoCell memo={item.memo} onMemo={(v) => onUpdate({ memo: v })} />
        <DeleteCell onDelete={onDelete} />
      </div>
    );
  }

  if (mode === 'coffee') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 bg-gray-50/50">
        <NameCell idx={idx} name={item.menu_name} />
        {/* 타임 라벨 */}
        <div className="md:col-span-2">
          <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">
            타임 라벨
          </label>
          <input
            type="text"
            className="input !py-1.5 !text-sm"
            placeholder="예: 오전"
            value={item.time_label}
            onChange={(e) => onUpdate({ time_label: e.target.value })}
          />
        </div>
        {/* 서비스 시간 */}
        <div className="md:col-span-2">
          <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">
            서비스 시간
          </label>
          <input
            type="text"
            className="input !py-1.5 !text-sm"
            placeholder="예: 10:00"
            value={item.service_time}
            onChange={(e) => onUpdate({ service_time: e.target.value })}
          />
        </div>
        {/* 수량 */}
        <div className="md:col-span-2">
          <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">
            수량
          </label>
          <input
            type="number"
            className="input !py-1.5 !text-sm !text-right tabular-nums !px-2"
            placeholder="수량"
            value={item.quantity ?? ''}
            onChange={(e) =>
              onUpdate({ quantity: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </div>
        <MemoCell memo={item.memo} onMemo={(v) => onUpdate({ memo: v })} />
        <DeleteCell onDelete={onDelete} />
      </div>
    );
  }

  // mode === 'qty': 단순 수량
  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center border rounded-md p-2 bg-gray-50/50">
      <NameCell idx={idx} name={item.menu_name} />
      <div className="md:col-span-6">
        <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">수량</label>
        <input
          type="number"
          className="input !py-1.5 !text-sm !text-right tabular-nums !px-2 w-32"
          placeholder="수량"
          value={item.quantity ?? ''}
          onChange={(e) =>
            onUpdate({ quantity: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
      </div>
      <MemoCell memo={item.memo} onMemo={(v) => onUpdate({ memo: v })} />
      <DeleteCell onDelete={onDelete} />
    </div>
  );
}

// ── 식사없음 행 ───────────────────────────────────────────────────────
function NoMealRow({ idx, onDelete }: { idx: number; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 border border-orange-200 rounded-md p-2 bg-orange-50/40">
      <span className="text-[11px] text-gray-400 tabular-nums w-5 text-right">{idx + 1}.</span>
      <span className="font-medium text-sm text-orange-700">🚫 식사없음</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDelete}
        className="text-xs text-red-500 hover:underline px-2 py-1"
      >
        삭제
      </button>
    </div>
  );
}

// ── 공통 셀 ──────────────────────────────────────────────────────────
function NameCell({ idx, name }: { idx: number; name: string }) {
  return (
    <div className="md:col-span-3 flex items-center gap-2">
      <span className="text-[11px] text-gray-400 tabular-nums w-5 text-right">{idx + 1}.</span>
      <span className="font-medium text-sm">{name}</span>
    </div>
  );
}

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

function MemoCell({ memo, onMemo }: { memo: string; onMemo: (v: string) => void }) {
  return (
    <div className="md:col-span-2">
      <label className="md:hidden text-[11px] uppercase tracking-wide text-gray-500">비고</label>
      <input
        type="text"
        className="input !py-1.5 !text-sm"
        value={memo}
        onChange={(e) => onMemo(e.target.value)}
      />
    </div>
  );
}

function DeleteCell({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="md:col-span-1 flex md:justify-end">
      <button
        type="button"
        onClick={onDelete}
        className="text-xs text-red-500 hover:underline px-2 py-1"
      >
        삭제
      </button>
    </div>
  );
}
