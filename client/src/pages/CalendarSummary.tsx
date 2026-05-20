import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { type EventWithFood, type EventStatus, STATUS_HEX } from '../types';
import CalendarSummaryView from '../components/CalendarSummaryView';

// 캘린더 요약 — 월별로 행사를 요약하여 표시하고 인쇄 가능.
// 요약 화면 제외 조건:
//   - WEDDING 상담(별도 컬렉션) — 행사가 아니므로 전체 제외
//   - 행사 status 가 상담취소 / 미팅 / 미팅취소 / LOS

const EXCLUDED_STATUSES = new Set<EventStatus>(['상담취소', '미팅', '미팅취소', 'LOS']);

interface MonthKey {
  year: number;
  month: number; // 1-12
}

function fmtMonth(m: MonthKey): string {
  return `${m.year}년 ${m.month}월`;
}

function fmtMonthSlug(m: MonthKey): string {
  return `${m.year}-${String(m.month).padStart(2, '0')}`;
}

function addMonths(m: MonthKey, delta: number): MonthKey {
  const total = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function currentMonth(): MonthKey {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// 행사 1건의 GTD/EXP 합계 — 확정 우선, 없으면 계약 fallback.
// 라벨은 값의 출처에 따라 다름: 확정에서 왔으면 '확정', 계약에서 왔으면 '계약'.
type GtdExpSource = 'final' | 'contract' | null;
function aggregateGtdExp(ev: EventWithFood): {
  gtd: number | null;
  exp: number | null;
  gtdSource: GtdExpSource;
  expSource: GtdExpSource;
} {
  let gtdFinal = 0;
  let gtdContract = 0;
  let expFinal = 0;
  let expContract = 0;
  let hasFinalGtd = false;
  let hasContractGtd = false;
  let hasFinalExp = false;
  let hasContractExp = false;
  for (const it of ev.food_items || []) {
    if (it.gtd_final != null) {
      gtdFinal += it.gtd_final;
      hasFinalGtd = true;
    }
    if (it.gtd_contract != null) {
      gtdContract += it.gtd_contract;
      hasContractGtd = true;
    }
    if (it.exp_final != null) {
      expFinal += it.exp_final;
      hasFinalExp = true;
    }
    if (it.exp_contract != null) {
      expContract += it.exp_contract;
      hasContractExp = true;
    }
  }
  // 옛 이벤트 단위 필드 fallback
  const legacy = ev as unknown as Record<string, number | null>;
  if (!hasFinalGtd && legacy.food_gtd_final != null) {
    gtdFinal = legacy.food_gtd_final;
    hasFinalGtd = true;
  }
  if (!hasContractGtd && legacy.food_gtd_contract != null) {
    gtdContract = legacy.food_gtd_contract;
    hasContractGtd = true;
  }
  if (!hasFinalExp && legacy.food_exp_final != null) {
    expFinal = legacy.food_exp_final;
    hasFinalExp = true;
  }
  if (!hasContractExp && legacy.food_exp_contract != null) {
    expContract = legacy.food_exp_contract;
    hasContractExp = true;
  }
  return {
    gtd: hasFinalGtd ? gtdFinal : hasContractGtd ? gtdContract : null,
    exp: hasFinalExp ? expFinal : hasContractExp ? expContract : null,
    gtdSource: hasFinalGtd ? 'final' : hasContractGtd ? 'contract' : null,
    expSource: hasFinalExp ? 'final' : hasContractExp ? 'contract' : null,
  };
}

// 라벨 결정 — 값이 있는 항목의 출처를 모두 보고 결정.
// 모두 final 이면 '확정', 하나라도 contract 면 '계약' (출처가 다르면 보수적으로 '계약').
function gtdExpLabel(gtdSource: GtdExpSource, expSource: GtdExpSource): string {
  const sources: GtdExpSource[] = [];
  if (gtdSource) sources.push(gtdSource);
  if (expSource) sources.push(expSource);
  if (sources.length === 0) return '확정 GTD/EXP'; // 둘 다 없음 — 기본 라벨
  return sources.every((s) => s === 'final') ? '확정 GTD/EXP' : '계약 GTD/EXP';
}

function dateKey(s: string): string {
  return (s || '').slice(0, 10);
}

function timeOnly(s: string): string {
  return (s || '').slice(11, 16);
}

export default function CalendarSummary() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [printPickerOpen, setPrintPickerOpen] = useState(false);
  const [selectedPrintMonths, setSelectedPrintMonths] = useState<Set<string>>(
    new Set([fmtMonthSlug(currentMonth())])
  );
  // 인쇄 모드 — 선택된 모든 월을 한 페이지에 렌더
  const [printMode, setPrintMode] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get<{ events: EventWithFood[] }>('/api/events')
      .then((res) => setEvents(res.events))
      .catch((e) => {
        setError('행사 목록을 불러오지 못했습니다.');
        console.error(e);
      })
      .finally(() => setLoading(false));
  }, []);

  // 필터링된 행사 — 제외 상태 + 요약 표시 대상
  const filtered = useMemo(() => {
    return events
      .filter((e) => !EXCLUDED_STATUSES.has(e.status))
      .sort((a, b) => (a.start_datetime < b.start_datetime ? -1 : 1));
  }, [events]);

  // 월별 그룹화
  const byMonth = useMemo(() => {
    const map = new Map<string, EventWithFood[]>();
    for (const ev of filtered) {
      const d = dateKey(ev.start_datetime);
      if (!d) continue;
      const slug = d.slice(0, 7); // YYYY-MM
      if (!map.has(slug)) map.set(slug, []);
      map.get(slug)!.push(ev);
    }
    return map;
  }, [filtered]);

  // 인쇄 가능한 월 후보 — 실제 행사가 있는 월들
  const availableMonths = useMemo(() => {
    const list: MonthKey[] = [];
    for (const slug of byMonth.keys()) {
      const [y, m] = slug.split('-').map((s) => parseInt(s, 10));
      list.push({ year: y, month: m });
    }
    list.sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
    return list;
  }, [byMonth]);

  // 인쇄 모드 시작 — 선택한 월들을 한 번에 렌더 → window.print()
  function startPrint() {
    if (selectedPrintMonths.size === 0) {
      alert('인쇄할 월을 한 개 이상 선택해주세요.');
      return;
    }
    setPrintMode(true);
    setPrintPickerOpen(false);
    // 다음 프레임에 print 호출 — 상태 반영 후
    setTimeout(() => {
      window.print();
      // print 후 인쇄 모드 해제 (Chrome 은 afterprint 이벤트가 동작)
      setTimeout(() => setPrintMode(false), 300);
    }, 100);
  }

  useEffect(() => {
    // 브라우저 인쇄 다이얼로그 닫힌 후 인쇄 모드 해제
    const handler = () => setPrintMode(false);
    window.addEventListener('afterprint', handler);
    return () => window.removeEventListener('afterprint', handler);
  }, []);

  // 공개 공유 링크 — 토큰을 발급/조회한 뒤 클립보드에 복사. 링크만 있으면 로그인 없이 열람.
  async function copyShareLink() {
    try {
      const { token } = await api.get<{ token: string }>('/api/calendar-summary/share');
      const url = `${window.location.origin}/public/summary/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        setShareMsg('공유 링크가 복사되었습니다. 링크만 있으면 로그인 없이 열람할 수 있습니다.');
      } catch {
        // 클립보드 차단 환경 — 링크를 직접 노출
        setShareMsg(url);
      }
      setTimeout(() => setShareMsg(null), 6000);
    } catch {
      setShareMsg('공유 링크 생성에 실패했습니다.');
      setTimeout(() => setShareMsg(null), 4000);
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">불러오는 중...</div>;
  if (error)
    return <div className="p-6 text-sm text-red-600">{error}</div>;

  const printMonthsList: MonthKey[] = printMode
    ? [...selectedPrintMonths]
        .map((slug) => {
          const [y, m] = slug.split('-').map((s) => parseInt(s, 10));
          return { year: y, month: m };
        })
        .sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month))
    : [];

  const printStamp = (() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <div className="max-w-5xl mx-auto pb-8">
      {/* 헤더 — 인쇄 모드에선 숨김 */}
      <div className="no-print">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1 text-xs text-gray-500">
              <button onClick={() => navigate('/calendar')} className="hover:underline">
                ← 캘린더로
              </button>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900">📊 캘린더 요약</h1>
            <p className="text-xs text-gray-500 mt-1">
              상담·미팅·LOS·취소 행사는 자동 제외 · 행사를 클릭하면 사용홀·메뉴·GTD/EXP·비고 표시
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyShareLink}
              className="btn-secondary"
              title="링크만으로 열람 가능한 공유 주소 복사"
            >
              🔗 공유 링크 복사
            </button>
            <button
              onClick={() => setPrintPickerOpen(true)}
              className="btn-secondary"
              title="원하는 월을 선택하여 인쇄"
            >
              🖨️ 출력
            </button>
          </div>
        </div>

        {shareMsg && (
          <div className="mb-4 text-xs bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 break-all">
            {shareMsg}
          </div>
        )}
      </div>

      {/* 본문 — 인쇄 모드 OFF: 캘린더 그리드, 인쇄 모드 ON: 선택된 월 리스트 */}
      {!printMode ? (
        <div className="no-print">
          <CalendarSummaryView events={filtered} />
        </div>
      ) : (
        printMonthsList.map((m) => (
          <MonthSection
            key={fmtMonthSlug(m)}
            month={m}
            events={byMonth.get(fmtMonthSlug(m)) || []}
          />
        ))
      )}

      {/* 인쇄 시 바닥글 — print 모드일 때만 출력. CSS에서 @media print 로 보임. */}
      <div className="print-footer hidden">
        <hr className="my-4 border-gray-300" />
        <div className="text-xs text-gray-600 text-center py-2">
          출력일시 {printStamp} · 플렌티컨벤션 운영관리 시스템
        </div>
      </div>

      {/* 인쇄 월 선택 모달 */}
      {printPickerOpen && (
        <PrintPicker
          available={availableMonths}
          selected={selectedPrintMonths}
          onChange={setSelectedPrintMonths}
          onClose={() => setPrintPickerOpen(false)}
          onPrint={startPrint}
        />
      )}
    </div>
  );
}

function MonthSection({ month, events }: { month: MonthKey; events: EventWithFood[] }) {
  // 날짜별 그룹화
  const byDate = useMemo(() => {
    const map = new Map<string, EventWithFood[]>();
    for (const ev of events) {
      const d = dateKey(ev.start_datetime);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(ev);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [events]);

  return (
    <section className="mb-6 page-break-after">
      <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-3 print:text-base">
        {fmtMonth(month)} <span className="text-sm text-gray-500">({events.length}건)</span>
      </h2>
      {events.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-6 text-center bg-white border rounded">
          이 달에 요약 대상 행사가 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {byDate.map(([d, list]) => (
            <DateGroup key={d} date={d} events={list} />
          ))}
        </div>
      )}
    </section>
  );
}

function DateGroup({ date, events }: { date: string; events: EventWithFood[] }) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const dateObj = new Date(date + 'T00:00');
  const label = `${date} (${days[dateObj.getDay()]})`;
  return (
    <div className="bg-white border rounded-lg p-3 print:border-gray-300 print:break-inside-avoid">
      <div className="text-sm font-semibold text-gray-700 mb-2">{label}</div>
      <ul className="space-y-2">
        {events.map((ev) => (
          <EventCard key={ev.id} ev={ev} />
        ))}
      </ul>
    </div>
  );
}

function EventCard({ ev }: { ev: EventWithFood }) {
  const halls = (ev.halls || []).join(' / ') || '홀 미지정';
  const { gtd, exp, gtdSource, expSource } = aggregateGtdExp(ev);
  const label = gtdExpLabel(gtdSource, expSource);
  const color = STATUS_HEX[ev.status] || '#6b7280';
  const foodItems = ev.food_items || [];
  // 메뉴명 모음 (중복 제거 — 같은 메뉴 여러 행 가능)
  const menuNames = Array.from(new Set(foodItems.map((f) => f.menu_name).filter(Boolean)));
  // 메뉴 비고 — 내용 있는 것만
  const menuMemos = foodItems
    .filter((f) => (f.memo || '').trim())
    .map((f) => ({ menu: f.menu_name, memo: f.memo }));

  return (
    <li className="border rounded p-2.5 print:border-gray-300">
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="badge bg-gray-100 text-gray-700 text-[10px]">{ev.event_type}</span>
        <span className="badge text-white text-[10px]" style={{ background: color }}>
          {ev.status}
        </span>
        <span className="text-xs text-gray-500">
          {timeOnly(ev.start_datetime)} ~ {timeOnly(ev.end_datetime)}
        </span>
      </div>
      <div className="font-semibold text-sm text-gray-900">
        {ev.event_name || '(이름 없음)'}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 mt-1.5 text-xs">
        <div>
          <span className="text-gray-500">사용홀:</span> <span className="text-gray-900">{halls}</span>
        </div>
        <div>
          <span className="text-gray-500">{label}:</span>{' '}
          <span className="text-gray-900 font-mono">
            {gtd ?? '-'} / {exp ?? '-'}
          </span>
        </div>
        {menuNames.length > 0 && (
          <div className="md:col-span-2">
            <span className="text-gray-500">메뉴:</span>{' '}
            <span className="text-gray-900">{menuNames.join(', ')}</span>
          </div>
        )}
      </div>
      {menuMemos.length > 0 && (
        <div className="mt-1.5 text-xs">
          <div className="text-gray-500 mb-0.5">메뉴 비고:</div>
          <ul className="space-y-0.5 pl-3">
            {menuMemos.map((m, i) => (
              <li key={i} className="text-gray-800">
                · <strong>{m.menu}</strong>: {m.memo}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

// 인쇄할 월 선택 다이얼로그
function PrintPicker({
  available,
  selected,
  onChange,
  onClose,
  onPrint,
}: {
  available: MonthKey[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  onClose: () => void;
  onPrint: () => void;
}) {
  function toggle(slug: string) {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  }
  function selectAll() {
    onChange(new Set(available.map(fmtMonthSlug)));
  }
  function clearAll() {
    onChange(new Set());
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 mb-2">🖨️ 인쇄할 월 선택</h3>
        <p className="text-xs text-gray-500 mb-3">
          선택된 월의 요약만 인쇄됩니다. 바닥글에 출력일시가 자동 표시됩니다.
        </p>
        <div className="flex items-center gap-2 mb-3 text-xs">
          <button onClick={selectAll} className="text-blue-600 hover:underline">전체 선택</button>
          <span className="text-gray-300">·</span>
          <button onClick={clearAll} className="text-gray-600 hover:underline">전체 해제</button>
          <span className="ml-auto text-gray-500">{selected.size}개 선택됨</span>
        </div>
        <div className="border rounded max-h-64 overflow-y-auto">
          {available.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-400">행사가 있는 월이 없습니다.</div>
          ) : (
            <ul>
              {available.map((m) => {
                const slug = fmtMonthSlug(m);
                const checked = selected.has(slug);
                return (
                  <li key={slug}>
                    <label className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(slug)}
                      />
                      <span className="text-sm text-gray-900">{fmtMonth(m)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1">취소</button>
          <button onClick={onPrint} disabled={selected.size === 0} className="btn-primary flex-1 disabled:opacity-50">
            출력 시작
          </button>
        </div>
      </div>
    </div>
  );
}
