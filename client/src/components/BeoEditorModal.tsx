import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Modal from './Modal';
import {
  type BeoDoc,
  type BeoSeedInput,
  type BeoScheduleRow,
  emptyScheduleRow,
  seedBeoDoc,
  parseBeoDoc,
  openBeoPrint,
} from '../lib/beoDoc';

interface Props {
  open: boolean;
  onClose: () => void;
  eventId: string;
  canWrite: boolean;
  // 자동 시드 입력 — 부모(EventFormModal)가 행사·식음·업체 데이터로 구성해서 전달.
  seedInput: BeoSeedInput;
  // 저장된 BEO payload (event.beo_payload). 없으면 seedInput으로 초안 생성.
  savedPayload: string | undefined;
  // 저장 성공 시 부모 상태 갱신용 (payload 문자열 반환).
  onSaved: (payload: string) => void;
  editorName: string;
}

export default function BeoEditorModal({
  open,
  onClose,
  eventId,
  canWrite,
  seedInput,
  savedPayload,
  onSaved,
  editorName,
}: Props) {
  const [doc, setDoc] = useState<BeoDoc | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const existing = parseBeoDoc(savedPayload);
    setDoc(existing || seedBeoDoc(seedInput));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!doc) return null;

  function patch(p: Partial<BeoDoc>) {
    setDoc((d) => (d ? { ...d, ...p } : d));
  }

  function reseed() {
    if (!confirm('현재 편집 내용을 버리고 행사 데이터로 다시 초안을 생성합니다. 계속할까요?')) return;
    setDoc(seedBeoDoc(seedInput));
  }

  // ── 일정 행 편집 ──
  function updateRow(id: string, p: Partial<BeoScheduleRow>) {
    patch({ schedule: doc!.schedule.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  }
  function addRow() {
    patch({ schedule: [...doc!.schedule, emptyScheduleRow()] });
  }
  function removeRow(id: string) {
    patch({ schedule: doc!.schedule.filter((r) => r.id !== id) });
  }

  // ── 섹션 편집 ──
  function updateSection(id: string, p: { title?: string; body?: string }) {
    patch({ sections: doc!.sections.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  }
  function addSection() {
    patch({ sections: [...doc!.sections, { id: Math.random().toString(36).slice(2, 10), title: '새 섹션', body: '' }] });
  }
  function removeSection(id: string) {
    patch({ sections: doc!.sections.filter((s) => s.id !== id) });
  }

  async function save() {
    if (!doc) return;
    setSaving(true);
    try {
      const next: BeoDoc = { ...doc, updated_at: new Date().toISOString(), updated_by: editorName };
      const payload = JSON.stringify(next);
      await api.patch(`/api/events/${eventId}`, { beo_payload: payload });
      setDoc(next);
      onSaved(payload);
      alert('BEO가 저장되었습니다.');
    } catch (e) {
      alert('BEO 저장 실패');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const ro = !canWrite;
  const inputCls = 'input !py-1 !text-xs';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`BEO 편집 — ${doc.template}`}
      widthClass="max-w-6xl"
      footer={
        <>
          {canWrite && (
            <button onClick={reseed} className="btn-secondary mr-auto" disabled={saving} title="행사 데이터로 초안 다시 생성">
              ↻ 자동 시드
            </button>
          )}
          <button onClick={() => openBeoPrint(doc)} className="btn-secondary">
            🖨 인쇄 / PDF
          </button>
          <button onClick={onClose} className="btn-secondary">
            닫기
          </button>
          {canWrite && (
            <button onClick={save} disabled={saving} className="btn-primary">
              {saving ? '저장중...' : '저장'}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <div className="text-xs text-gray-500">
          자동으로 채워진 항목을 확인하고, 고객 요청사항·현장 전달사항을 직접 보완하세요. 저장하면 행사에 보관되어 다시 열 때 유지됩니다.
          {ro && <span className="ml-1 text-amber-600">(읽기 전용 — 인쇄만 가능)</span>}
        </div>

        {/* ── 헤더 ── */}
        <section>
          <div className="font-semibold text-gray-700 mb-2">헤더 정보</div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Account Name">
              <input className={inputCls} value={doc.account_name} disabled={ro} onChange={(e) => patch({ account_name: e.target.value })} />
            </Labeled>
            <Labeled label="Catering Manager">
              <input className={inputCls} value={doc.catering_manager} disabled={ro} onChange={(e) => patch({ catering_manager: e.target.value })} />
            </Labeled>
            <Labeled label="Organizer">
              <input className={inputCls} value={doc.organizer_name} disabled={ro} onChange={(e) => patch({ organizer_name: e.target.value })} />
            </Labeled>
            <Labeled label="Event Date">
              <input className={inputCls} value={doc.event_date} disabled={ro} onChange={(e) => patch({ event_date: e.target.value })} />
            </Labeled>
            <Labeled label="Event Time">
              <input className={inputCls} value={doc.event_time} disabled={ro} onChange={(e) => patch({ event_time: e.target.value })} />
            </Labeled>
            <Labeled label="Onsite Contact">
              <input className={inputCls} value={doc.onsite_contact} disabled={ro} onChange={(e) => patch({ onsite_contact: e.target.value })} />
            </Labeled>
            <Labeled label="Payment Method">
              <input className={inputCls} value={doc.payment_method} disabled={ro} onChange={(e) => patch({ payment_method: e.target.value })} />
            </Labeled>
            <Labeled label="Signboard">
              <input className={inputCls} value={doc.signboard} disabled={ro} onChange={(e) => patch({ signboard: e.target.value })} />
            </Labeled>
            {doc.template === 'WEDDING' && (
              <Labeled label="Customer Type" full>
                <input className={inputCls} value={doc.customer_type} disabled={ro} onChange={(e) => patch({ customer_type: e.target.value })} />
              </Labeled>
            )}
          </div>
        </section>

        {/* ── 일정 그리드 ── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-gray-700">SCHEDULE</div>
            {canWrite && (
              <button onClick={addRow} className="text-xs text-blue-600 hover:underline">+ 행 추가</button>
            )}
          </div>
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  {['Date', 'Time', 'Room', 'Function', 'Setup', 'GTD', 'EXP', ''].map((h) => (
                    <th key={h} className="px-1.5 py-1 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.schedule.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-gray-400 py-3">일정 없음 — 행을 추가하세요.</td></tr>
                ) : (
                  doc.schedule.map((r) => (
                    <tr key={r.id} className="border-t">
                      {(['date', 'time', 'room', 'func', 'setup', 'gtd', 'exp'] as const).map((k) => (
                        <td key={k} className="px-1 py-0.5">
                          <input
                            className="w-full px-1 py-0.5 border rounded text-xs disabled:bg-gray-50"
                            value={r[k]}
                            disabled={ro}
                            onChange={(e) => updateRow(r.id, { [k]: e.target.value })}
                          />
                        </td>
                      ))}
                      <td className="px-1 py-0.5 text-center">
                        {canWrite && (
                          <button onClick={() => removeRow(r.id)} className="text-red-500 hover:text-red-700" title="행 삭제">✕</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 자유 섹션 ── */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-gray-700">상세 섹션 (Food / Set-up / Program / Billing …)</div>
            {canWrite && (
              <button onClick={addSection} className="text-xs text-blue-600 hover:underline">+ 섹션 추가</button>
            )}
          </div>
          <div className="space-y-3">
            {doc.sections.map((s) => (
              <div key={s.id} className="border rounded-md p-2.5 bg-gray-50/40">
                <div className="flex items-center gap-2 mb-1.5">
                  <input
                    className="font-semibold text-sm px-2 py-1 border rounded flex-1 disabled:bg-gray-100"
                    value={s.title}
                    disabled={ro}
                    onChange={(e) => updateSection(s.id, { title: e.target.value })}
                  />
                  {canWrite && (
                    <button onClick={() => removeSection(s.id)} className="text-xs text-red-600 hover:underline">섹션 삭제</button>
                  )}
                </div>
                <textarea
                  className="w-full text-sm px-2 py-1.5 border rounded font-mono leading-relaxed disabled:bg-gray-100"
                  rows={Math.min(20, Math.max(4, s.body.split('\n').length + 1))}
                  value={s.body}
                  disabled={ro}
                  placeholder="고객 요청사항 / 메뉴 상세 / 세팅·AV / 빌링 등을 자유롭게 작성하세요."
                  onChange={(e) => updateSection(s.id, { body: e.target.value })}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function Labeled({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-[11px] uppercase tracking-wide text-gray-500">{label}</label>
      {children}
    </div>
  );
}
