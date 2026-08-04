import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDateW } from '../lib/dateFmt';
import { useAuth } from '../auth/AuthContext';
import { canWriteRevenue } from '../auth/permissions';
import { api } from '../lib/api';
import type { Event, EventWithFood, EventRevenueLine, RevenueItem, RevenueCategory, Invoice } from '../types';
import clsx from 'clsx';

const PAGE_SIZE = 50;
// 매출 대상 행사 상태 — 이 3개만 다룬다.
// LOS(취소)를 포함하는 이유: 취소 수수료가 매출로 잡히는 행사가 있다.
// 상담취소·미팅·미팅취소·시식은 매출이 발생하지 않으므로 제외.
// (행사 상태에 'TEN'은 없다 — TEN은 MICE 문의상태/웨딩 진행단계 쪽 값이다)
const REVENUE_STATUSES = ['DEF', 'INQ', 'LOS'] as const;
type RevenueStatus = (typeof REVENUE_STATUSES)[number];

type SortCol = 'date' | 'contract_amount' | 'discount_rate' | 'sales_total' | 'gateway_fee' | 'grand_total';
type SortDir = 'asc' | 'desc';

// ───────────────────────────────────────────────
// Local Types
// ───────────────────────────────────────────────

type RevenueEditForm = {
  contract_amount: string;
  sales_total_amount: string;
  discount_rate: string;
  discount_reason: string;
  contract_date: string;
  gateway_fee: string;
  amounts: Record<string, string>; // revenue_item_id → amount string
  notes: Record<string, string>;   // revenue_item_id → note string
};

type ImportPreviewRow = {
  event_id: string;
  event_name: string;
  contract_amount: number | null;
  sales_total_amount: number | null;
  discount_rate: number | null;
  discount_reason: string;
  contract_date: string;
  gateway_fee: number | null;
  items: Record<string, number | null>; // item.code → amount
  valid: boolean;
};

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

function fmtKRW(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('ko-KR') + '원';
}

function sumOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

const CATEGORY_BADGE: Record<RevenueCategory, string> = {
  공간: 'bg-gray-100 text-gray-700',
  식음: 'bg-blue-100 text-blue-700',
  장비: 'bg-purple-100 text-purple-700',
  장식: 'bg-pink-100 text-pink-700',
  기타: 'bg-slate-100 text-slate-700',
};

const STATUS_BADGE: Record<string, string> = {
  DEF: 'bg-green-100 text-green-700',
  INQ: 'bg-yellow-100 text-yellow-700',
  LOS: 'bg-red-100 text-red-700',
};

function statusLabel(s: string) {
  if (s === 'DEF') return '확정';
  if (s === 'INQ') return '문의';
  if (s === 'LOS') return '취소';
  return s;
}

// ───────────────────────────────────────────────
// Main Component
// ───────────────────────────────────────────────

export default function Revenue() {
  const { user } = useAuth();
  const role = user?.role;
  const canWrite = canWriteRevenue(role);
  const navigate = useNavigate();

  // ─── State ───
  const [events, setEvents] = useState<EventWithFood[]>([]);
  const [revenueItems, setRevenueItems] = useState<RevenueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState<number>(currentYear);
  const [monthFilter, setMonthFilter] = useState<'' | number>('');
  const [typeFilter, setTypeFilter] = useState<'' | 'MICE' | 'WEDDING'>('');
  // 매출 대상 3개 상태(DEF·INQ·LOS)를 기본으로 모두 표시. 필요 시 하나만 좁혀본다.
  const [statusFilter, setStatusFilter] = useState<'ALL' | RevenueStatus>('ALL');

  // ─── Sort & Page ───
  const [sortCol, setSortCol] = useState<SortCol>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lineMap, setLineMap] = useState<Record<string, EventRevenueLine[]>>({});

  const [editForm, setEditForm] = useState<RevenueEditForm | null>(null);
  const [saving, setSaving] = useState(false);

  const [importModal, setImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ImportPreviewRow[]>([]);
  const [importLoading, setImportLoading] = useState(false);

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Load ───
  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<{ events: EventWithFood[] }>('/api/events'),
      api.get<RevenueItem[]>('/api/revenue-items'),
    ])
      .then(([evRes, items]) => {
        const evList = (evRes.events ?? (evRes as unknown as EventWithFood[]));
        // DEF·INQ·LOS 만 매출 대상. 목록에서 빠지면 엑셀 내보내기·일괄등록 대상에서도 사라지므로
        // 여기서 3개를 모두 보관하고, 좁혀보는 것은 statusFilter 가 담당한다.
        setEvents(
          evList.filter((e) => (REVENUE_STATUSES as readonly string[]).includes(e.status as string))
        );
        setRevenueItems(Array.isArray(items) ? items : []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // ─── Toast helper ───
  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  // ─── Filtered events ───
  const filteredEvents = events.filter((e) => {
    const d = new Date(e.start_datetime);
    if (d.getFullYear() !== yearFilter) return false;
    if (monthFilter !== '' && d.getMonth() + 1 !== monthFilter) return false;
    if (typeFilter !== '' && e.event_type !== typeFilter) return false;
    // 기본은 DEF·INQ·LOS 전체. 특정 상태만 보려면 필터에서 선택.
    if (statusFilter !== 'ALL' && (e.status as string) !== statusFilter) return false;
    return true;
  });

  // 필터/정렬 변경 시 페이지 리셋
  useEffect(() => { setPage(1); }, [yearFilter, monthFilter, typeFilter, statusFilter, sortCol, sortDir]);

  // ─── Sorted events ───
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    let va: number, vb: number;
    switch (sortCol) {
      case 'date':
        va = new Date(a.start_datetime).getTime();
        vb = new Date(b.start_datetime).getTime();
        break;
      case 'contract_amount':
        va = a.contract_amount ?? 0;
        vb = b.contract_amount ?? 0;
        break;
      case 'discount_rate':
        va = a.discount_rate ?? 0;
        vb = b.discount_rate ?? 0;
        break;
      case 'sales_total':
        va = a.sales_total_amount ?? 0;
        vb = b.sales_total_amount ?? 0;
        break;
      case 'gateway_fee':
        va = a.gateway_fee ?? 0;
        vb = b.gateway_fee ?? 0;
        break;
      case 'grand_total':
        va = (a.sales_total_amount ?? 0) + (a.gateway_fee ?? 0);
        vb = (b.sales_total_amount ?? 0) + (b.gateway_fee ?? 0);
        break;
      default:
        return 0;
    }
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const totalPages = Math.max(1, Math.ceil(sortedEvents.length / PAGE_SIZE));
  const pagedEvents = sortedEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ─── Sort toggle helper ───
  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <span className="ml-1 text-gray-300">⇅</span>;
    return <span className="ml-1 text-blue-500">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  // ─── Summary stats ───
  const statEventCount = filteredEvents.length;
  const statContractTotal = filteredEvents.reduce((s, e) => s + (e.contract_amount ?? 0), 0);
  const statSalesTotal = filteredEvents.reduce((s, e) => s + (e.sales_total_amount ?? 0), 0);
  const statGatewayTotal = filteredEvents.reduce((s, e) => s + (e.gateway_fee ?? 0), 0);

  // ─── Expand row ───
  async function handleExpand(ev: Event) {
    if (expandedId === ev.id) {
      setExpandedId(null);
      setEditForm(null);
      return;
    }
    setExpandedId(ev.id);

    // Load lines if not cached
    if (!lineMap[ev.id]) {
      try {
        const resp = await api.get<{
          event: Event;
          revenue_lines: EventRevenueLine[];
          revenue_items: RevenueItem[];
        }>(`/api/events/${ev.id}/revenue`);
        const lines = Array.isArray(resp.revenue_lines) ? resp.revenue_lines : [];
        setLineMap((prev) => ({ ...prev, [ev.id]: lines }));
        initEditForm(ev, lines);
      } catch {
        setLineMap((prev) => ({ ...prev, [ev.id]: [] }));
        initEditForm(ev, []);
      }
    } else {
      initEditForm(ev, lineMap[ev.id]);
    }
  }

  function initEditForm(ev: Event, lines: EventRevenueLine[]) {
    const amounts: Record<string, string> = {};
    const notes: Record<string, string> = {};
    for (const l of lines) {
      if (l.amount != null) amounts[l.revenue_item_id] = String(l.amount);
      if (l.note) notes[l.revenue_item_id] = l.note;
    }
    setEditForm({
      contract_amount: ev.contract_amount != null ? String(ev.contract_amount) : '',
      sales_total_amount: ev.sales_total_amount != null ? String(ev.sales_total_amount) : '',
      discount_rate: ev.discount_rate != null ? String(Math.round(ev.discount_rate * 1000) / 10) : '',
      discount_reason: ev.discount_reason ?? '',
      contract_date: ev.contract_date ?? '',
      gateway_fee: ev.gateway_fee != null ? String(ev.gateway_fee) : '',
      amounts,
      notes,
    });
  }

  // ─── Save ───
  async function handleSave(eventId: string) {
    if (!editForm) return;
    setSaving(true);
    try {
      const lines = revenueItems
        .map((item) => ({
          revenue_item_id: item.id,
          amount: editForm.amounts[item.id]
            ? Number(String(editForm.amounts[item.id]).replace(/,/g, ''))
            : null,
          note: editForm.notes[item.id] ?? '',
        }))
        .filter((l) => l.amount !== null || l.note);

      await api.put(`/api/events/${eventId}/revenue`, {
        contract_amount: editForm.contract_amount
          ? Number(editForm.contract_amount.replace(/,/g, ''))
          : null,
        sales_total_amount: editForm.sales_total_amount
          ? Number(editForm.sales_total_amount.replace(/,/g, ''))
          : null,
        discount_rate: editForm.discount_rate ? Number(editForm.discount_rate) / 100 : null,
        discount_reason: editForm.discount_reason,
        contract_date: editForm.contract_date || null,
        gateway_fee: editForm.gateway_fee
          ? Number(editForm.gateway_fee.replace(/,/g, ''))
          : null,
        lines,
      });

      // Update local event state
      setEvents((prev) =>
        prev.map((e) => {
          if (e.id !== eventId) return e;
          return {
            ...e,
            contract_amount: editForm.contract_amount
              ? Number(editForm.contract_amount.replace(/,/g, ''))
              : null,
            sales_total_amount: editForm.sales_total_amount
              ? Number(editForm.sales_total_amount.replace(/,/g, ''))
              : null,
            discount_rate: editForm.discount_rate ? Number(editForm.discount_rate) / 100 : null,
            discount_reason: editForm.discount_reason,
            contract_date: editForm.contract_date || null,
            gateway_fee: editForm.gateway_fee
              ? Number(editForm.gateway_fee.replace(/,/g, ''))
              : null,
          };
        })
      );

      // Update lineMap cache from editForm
      const updatedLines: EventRevenueLine[] = lines.map((l, idx) => ({
        id: String(idx),
        event_id: eventId,
        revenue_item_id: l.revenue_item_id,
        amount: l.amount,
        note: l.note,
        created_at: '',
        updated_at: '',
      }));
      setLineMap((prev) => ({ ...prev, [eventId]: updatedLines }));

      showToast('저장되었습니다.');
      setExpandedId(null);
      setEditForm(null);
    } catch {
      showToast('저장 중 오류가 발생했습니다.', false);
    } finally {
      setSaving(false);
    }
  }

  // ─── Excel Export ───
  async function exportExcel() {
    const ExcelJS = (await import('exceljs')).default;

    // 세부 매출항목은 화면에서 행을 펼칠 때만 lineMap 에 캐시된다.
    // 내보내기는 펼치지 않은 행사도 채워야 하므로 전 라인을 한 번에 받아 병합한다.
    // (이걸 안 하면 export → 수정 → import 왕복에서 세부항목이 통째로 지워진다)
    let allLines: Record<string, EventRevenueLine[]> = lineMap;
    try {
      const resp = await api.get<{ revenue_lines: EventRevenueLine[] }>('/api/revenue/all-lines');
      const grouped: Record<string, EventRevenueLine[]> = {};
      for (const l of resp.revenue_lines ?? []) {
        (grouped[l.event_id] ||= []).push(l);
      }
      allLines = grouped;
      setLineMap((prev) => ({ ...grouped, ...prev })); // 화면 캐시도 갱신 (편집 중 값은 유지)
    } catch {
      showToast('세부 매출항목을 불러오지 못해 일부 열이 비어 있을 수 있습니다.', false);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('매출현황');

    const headers = [
      'event_id', '행사일', '행사명', '구분', '계약일', '계약금액', '실매출',
      '할인율(%)', '할인사유', '대관료(가톨릭)',
      ...revenueItems.map((i) => i.name_ko),
      '비고',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    for (const ev of filteredEvents) {
      const lines = allLines[ev.id] ?? [];
      const amtByItemId: Record<string, number | null> = {};
      for (const l of lines) amtByItemId[l.revenue_item_id] = l.amount;

      const row = [
        ev.id,
        ev.start_datetime.slice(0, 10),
        ev.event_name,
        ev.event_type,
        ev.contract_date ?? '',
        ev.contract_amount ?? '',
        ev.sales_total_amount ?? '',
        ev.discount_rate != null ? (ev.discount_rate * 100).toFixed(1) : '',
        ev.discount_reason ?? '',
        ev.gateway_fee ?? '',
        ...revenueItems.map((item) => amtByItemId[item.id] ?? ''),
        '',
      ];
      ws.addRow(row);
    }

    const numCols = [6, 7, 10, ...revenueItems.map((_, i) => 11 + i)];
    for (const colIdx of numCols) {
      ws.getColumn(colIdx).numFmt = '#,##0';
      ws.getColumn(colIdx).width = 14;
    }
    ws.getColumn(8).numFmt = '0.0';
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 30;
    ws.getColumn(4).width = 10;
    ws.getColumn(5).width = 12;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `매출현황_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Template Download ───
  async function downloadTemplate() {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('매출현황');

    const headers = [
      'event_id', '행사일', '행사명', '구분', '계약일', '계약금액', '실매출',
      '할인율(%)', '할인사유', '대관료(가톨릭)',
      ...revenueItems.map((i) => i.name_ko),
      '비고',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

    for (const ev of filteredEvents) {
      ws.addRow([
        ev.id,
        ev.start_datetime.slice(0, 10),
        ev.event_name,
        ev.event_type,
        '', '', '', '', '', '',
        ...revenueItems.map(() => ''),
        '',
      ]);
    }

    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 30;
    ws.getColumn(4).width = 10;
    ws.getColumn(5).width = 12;
    for (let i = 6; i <= headers.length; i++) {
      ws.getColumn(i).width = 14;
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `매출템플릿_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Import ───
  async function handleImportFile(file: File) {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const buf = await file.arrayBuffer();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];

    const headerRow = ws.getRow(1);
    const colMap: Record<string, number> = {};
    headerRow.eachCell((cell, colNum) => {
      const v = String(cell.value ?? '').trim();
      if (v) colMap[v] = colNum;
    });

    const rows: ImportPreviewRow[] = [];
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const eventId = String(row.getCell(colMap['event_id'] ?? 1).value ?? '').trim();
      if (!eventId) return;

      const getNum = (key: string): number | null => {
        const col = colMap[key];
        if (!col) return null;
        const v = row.getCell(col).value;
        if (v == null || v === '') return null;
        return Number(String(v).replace(/,/g, ''));
      };

      const items: Record<string, number | null> = {};
      for (const item of revenueItems) {
        const v = getNum(item.name_ko);
        if (v !== null) items[item.code] = v;
      }

      const discountPct = getNum('할인율(%)');

      rows.push({
        event_id: eventId,
        event_name: events.find((e) => e.id === eventId)?.event_name ?? '(행사 없음)',
        contract_amount: getNum('계약금액'),
        sales_total_amount: getNum('실매출'),
        discount_rate: discountPct != null ? discountPct / 100 : null,
        discount_reason: String(row.getCell(colMap['할인사유'] ?? 0).value ?? ''),
        contract_date: String(row.getCell(colMap['계약일'] ?? 0).value ?? '').slice(0, 10),
        gateway_fee: getNum('대관료(가톨릭)'),
        items,
        valid: !!events.find((e) => e.id === eventId),
      });
    });

    setImportRows(rows);
    setImportModal(true);
  }

  async function handleImportSubmit() {
    setImportLoading(true);
    try {
      const validRows = importRows.filter((r) => r.valid);
      await api.post('/api/revenue/import', {
        rows: validRows.map((r) => ({
          event_id: r.event_id,
          contract_amount: r.contract_amount,
          sales_total_amount: r.sales_total_amount,
          discount_rate: r.discount_rate,
          discount_reason: r.discount_reason,
          contract_date: r.contract_date || null,
          gateway_fee: r.gateway_fee,
          items: r.items,
        })),
      });
      setImportModal(false);
      setImportRows([]);
      showToast(`${validRows.length}건 가져오기 완료`);
      // Reload events
      const evRes = await api.get<{ events: EventWithFood[] }>('/api/events');
      const evList = evRes.events ?? (evRes as unknown as EventWithFood[]);
      setEvents(
        evList.filter((e) => (REVENUE_STATUSES as readonly string[]).includes(e.status as string))
      );
      setLineMap({});
    } catch {
      showToast('가져오기 중 오류가 발생했습니다.', false);
    } finally {
      setImportLoading(false);
    }
  }

  // ─── Category grouping ───
  const CATEGORIES: RevenueCategory[] = ['공간', '식음', '장비', '장식', '기타'];
  const itemsByCategory = CATEGORIES.reduce<Record<RevenueCategory, RevenueItem[]>>(
    (acc, cat) => {
      acc[cat] = revenueItems.filter((i) => i.category === cat && i.is_active);
      return acc;
    },
    { 공간: [], 식음: [], 장비: [], 장식: [], 기타: [] }
  );

  // ─── Render ───
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        불러오는 중...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">{error}</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div
          className={clsx(
            'fixed top-4 right-4 z-50 px-4 py-2 rounded shadow text-white text-sm',
            toast.ok ? 'bg-green-600' : 'bg-red-600'
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">매출 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">확정·잠정 행사별 계약 및 세부 매출 관리</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => fileInputRef.current?.click()}
              >
                📥 엑셀 가져오기
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportFile(f);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button type="button" className="btn-secondary text-sm" onClick={exportExcel}>
            📤 엑셀 내보내기
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={downloadTemplate}>
            📋 템플릿 다운로드
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded border p-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <span>연도</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={yearFilter}
            onChange={(e) => setYearFilter(Number(e.target.value))}
          >
            {[2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <span>월</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">전체</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <span>구분</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as '' | 'MICE' | 'WEDDING')}
          >
            <option value="">전체</option>
            <option value="MICE">MICE</option>
            <option value="WEDDING">WEDDING</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700">
          <span>상태</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | RevenueStatus)}
            title="LOS(취소)도 취소 수수료가 매출로 잡힐 수 있어 포함됩니다"
          >
            <option value="ALL">전체 (DEF·INQ·LOS)</option>
            <option value="DEF">DEF 확정</option>
            <option value="INQ">INQ 문의</option>
            <option value="LOS">LOS 취소</option>
          </select>
        </label>
        <span className="text-sm text-gray-500 ml-auto">
          조회 결과 <strong>{filteredEvents.length}</strong>건
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '행사 수', value: `${statEventCount}건` },
          { label: '계약 총액', value: fmtKRW(statContractTotal || null) },
          { label: '실 매출 합산', value: fmtKRW(statSalesTotal || null) },
          { label: '대관료 합산', value: fmtKRW(statGatewayTotal || null) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border rounded p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-bold text-gray-900 mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Main table */}
      <div className="bg-white rounded border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 w-10">#</th>
                <th
                  className="px-3 py-2.5 text-left font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort('date')}
                >
                  행사일<SortIcon col="date" />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">행사명</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">구분</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">계약일</th>
                <th
                  className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort('contract_amount')}
                >
                  계약금액<SortIcon col="contract_amount" />
                </th>
                <th
                  className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort('discount_rate')}
                >
                  할인율<SortIcon col="discount_rate" />
                </th>
                <th
                  className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort('sales_total')}
                >
                  실매출<SortIcon col="sales_total" />
                </th>
                <th
                  className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort('gateway_fee')}
                >
                  대관료<SortIcon col="gateway_fee" />
                </th>
                <th
                  className="px-3 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap cursor-pointer hover:text-blue-600 select-none"
                  onClick={() => toggleSort('grand_total')}
                >
                  매출계<SortIcon col="grand_total" />
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600">상태</th>
                <th className="px-3 py-2.5 text-left font-medium text-gray-600 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pagedEvents.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-gray-400">
                    조회된 행사가 없습니다.
                  </td>
                </tr>
              )}
              {pagedEvents.map((ev, idx) => {
                const isExpanded = expandedId === ev.id;
                const salesSum = sumOrNull(ev.sales_total_amount, ev.gateway_fee);
                const rowNum = (page - 1) * PAGE_SIZE + idx + 1;

                return (
                  <Fragment key={ev.id}>
                    {/* Main row */}
                    <tr
                      className={clsx(
                        'hover:bg-gray-50 cursor-pointer transition-colors',
                        isExpanded && 'bg-blue-50/30'
                      )}
                      onClick={() => handleExpand(ev)}
                    >
                      <td className="px-3 py-2 text-gray-500">{rowNum}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDateW(ev.start_datetime)}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[220px]">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{ev.event_name}</span>
                          <button
                            type="button"
                            title="행사정보 보기"
                            className="flex-shrink-0 text-gray-300 hover:text-blue-500 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/events?focus=${ev.id}`);
                            }}
                          >
                            ↗
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={clsx(
                            'text-xs px-1.5 py-0.5 rounded font-medium',
                            ev.event_type === 'MICE'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-rose-100 text-rose-700'
                          )}
                        >
                          {ev.event_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {ev.contract_date ? fmtDateW(ev.contract_date) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {fmtKRW(ev.contract_amount)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {ev.discount_rate != null
                          ? `${(ev.discount_rate * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {fmtKRW(ev.sales_total_amount)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {fmtKRW(ev.gateway_fee)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-medium">
                        {fmtKRW(salesSum)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={clsx(
                            'text-xs px-1.5 py-0.5 rounded font-medium',
                            STATUS_BADGE[ev.status] ?? 'bg-gray-100 text-gray-700'
                          )}
                        >
                          {statusLabel(ev.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-xs text-blue-600 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExpand(ev);
                          }}
                        >
                          {isExpanded ? '닫기' : '매출'}
                        </button>
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {isExpanded && editForm && (
                      <tr>
                        <td colSpan={12} className="bg-blue-50/20 border-t border-b border-blue-100 p-4">
                          <ExpandedPanel
                            ev={ev}
                            invoice={ev.invoice ?? null}
                            editForm={editForm}
                            setEditForm={setEditForm}
                            revenueItems={revenueItems}
                            itemsByCategory={itemsByCategory}
                            CATEGORIES={CATEGORIES}
                            canWrite={canWrite}
                            saving={saving}
                            onSave={() => handleSave(ev.id)}
                            onCancel={() => {
                              setExpandedId(null);
                              setEditForm(null);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded border px-4 py-2.5">
          <span className="text-sm text-gray-500">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sortedEvents.length)} / {sortedEvents.length}건
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => setPage(1)}
              disabled={page === 1}
              title="처음으로"
            >
              ««
            </button>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ‹
            </button>
            <span className="px-3 py-1 text-sm font-medium text-gray-700">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              ›
            </button>
            <button
              type="button"
              className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              title="마지막으로"
            >
              »»
            </button>
          </div>
        </div>
      )}

      {/* Import modal */}
      {importModal && (
        <ImportModal
          rows={importRows}
          loading={importLoading}
          onConfirm={handleImportSubmit}
          onClose={() => {
            setImportModal(false);
            setImportRows([]);
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────
// Expanded Panel
// ───────────────────────────────────────────────

interface ExpandedPanelProps {
  ev: EventWithFood;
  invoice: Invoice | null;
  editForm: RevenueEditForm;
  setEditForm: React.Dispatch<React.SetStateAction<RevenueEditForm | null>>;
  revenueItems: RevenueItem[];
  itemsByCategory: Record<RevenueCategory, RevenueItem[]>;
  CATEGORIES: RevenueCategory[];
  canWrite: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

function ExpandedPanel({
  ev,
  invoice,
  editForm,
  setEditForm,
  revenueItems,
  itemsByCategory,
  CATEGORIES,
  canWrite,
  saving,
  onSave,
  onCancel,
}: ExpandedPanelProps) {
  function updateField(field: keyof Omit<RevenueEditForm, 'amounts' | 'notes'>, val: string) {
    setEditForm((prev) => prev ? { ...prev, [field]: val } : prev);
  }
  function updateAmount(itemId: string, val: string) {
    setEditForm((prev) => prev ? { ...prev, amounts: { ...prev.amounts, [itemId]: val } } : prev);
  }
  function updateNote(itemId: string, val: string) {
    setEditForm((prev) => prev ? { ...prev, notes: { ...prev.notes, [itemId]: val } } : prev);
  }

  // Compute lines total
  const linesTotal = revenueItems.reduce((s, item) => {
    const v = editForm.amounts[item.id];
    return s + (v ? Number(String(v).replace(/,/g, '')) : 0);
  }, 0);
  const gatewayNum = editForm.gateway_fee ? Number(editForm.gateway_fee.replace(/,/g, '')) : 0;
  const grandTotal = linesTotal + gatewayNum;

  const ro = !canWrite;

  return (
    <div className="space-y-5">
      <div className="text-sm font-semibold text-gray-700 mb-2">
        {ev.event_name} — 매출 상세 입력
      </div>

      {/* Contract Info */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          계약 정보
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">계약일</label>
            {ro ? (
              <div className="text-sm text-gray-800">{editForm.contract_date ? fmtDateW(editForm.contract_date) : '—'}</div>
            ) : (
              <input
                type="date"
                className="input-field text-sm w-full"
                value={editForm.contract_date}
                onChange={(e) => updateField('contract_date', e.target.value)}
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">계약금액 (원)</label>
            {ro ? (
              <div className="text-sm text-gray-800">{fmtKRW(editForm.contract_amount ? Number(editForm.contract_amount) : null)}</div>
            ) : (
              <input
                type="text"
                className="input-field text-sm w-full"
                value={editForm.contract_amount}
                onChange={(e) => updateField('contract_amount', e.target.value)}
                placeholder="0"
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">실매출 (원)</label>
            {ro ? (
              <div className="text-sm text-gray-800">{fmtKRW(editForm.sales_total_amount ? Number(editForm.sales_total_amount) : null)}</div>
            ) : (
              <input
                type="text"
                className="input-field text-sm w-full"
                value={editForm.sales_total_amount}
                onChange={(e) => updateField('sales_total_amount', e.target.value)}
                placeholder="0"
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">할인율 (%)</label>
            {ro ? (
              <div className="text-sm text-gray-800">
                {editForm.discount_rate ? `${editForm.discount_rate}%` : '—'}
              </div>
            ) : (
              <input
                type="text"
                className="input-field text-sm w-full"
                value={editForm.discount_rate}
                onChange={(e) => updateField('discount_rate', e.target.value)}
                placeholder="0.0"
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">할인사유</label>
            {ro ? (
              <div className="text-sm text-gray-800">{editForm.discount_reason || '—'}</div>
            ) : (
              <input
                type="text"
                className="input-field text-sm w-full"
                value={editForm.discount_reason}
                onChange={(e) => updateField('discount_reason', e.target.value)}
                placeholder="사유 입력"
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">대관료(가톨릭) (원)</label>
            {ro ? (
              <div className="text-sm text-gray-800">{fmtKRW(editForm.gateway_fee ? Number(editForm.gateway_fee) : null)}</div>
            ) : (
              <input
                type="text"
                className="input-field text-sm w-full"
                value={editForm.gateway_fee}
                onChange={(e) => updateField('gateway_fee', e.target.value)}
                placeholder="0"
              />
            )}
          </div>
        </div>
      </div>

      {/* 가톨릭대관료 입금현황 (행사정보 연동, 읽기 전용) */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-2">
          가톨릭대관료 입금현황
          <span className="text-xs font-normal text-gray-400 normal-case">(행사정보 &gt; 가톨릭대관료 탭에서 수정)</span>
        </div>
        {!invoice ? (
          <div className="text-sm text-gray-400 italic">등록된 입금 정보가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 bg-amber-50/40 border border-amber-100 rounded p-3">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">입금상태</div>
              <div className="text-sm font-medium text-gray-800">
                {invoice.payment_status || '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">입금자명</div>
              <div className="text-sm text-gray-800">{invoice.depositor_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">입금액</div>
              <div className="text-sm font-medium text-gray-800">
                {invoice.payment_amount != null
                  ? invoice.payment_amount.toLocaleString('ko-KR') + '원'
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">입금일자</div>
              <div className="text-sm text-gray-800">{invoice.payment_date ? fmtDateW(invoice.payment_date) : '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">계산서 발행</div>
              <div className="text-sm text-gray-800">{invoice.invoice_type || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">계산서 발행상태</div>
              <div className="text-sm text-gray-800">{invoice.invoice_issue_status || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-0.5">세금계산서 발행일자</div>
              <div className="text-sm text-gray-800">{invoice.tax_invoice_issue_date ? fmtDateW(invoice.tax_invoice_issue_date) : '—'}</div>
            </div>
          </div>
        )}
      </div>

      {/* Revenue Items */}
      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          세부 매출 항목
        </div>
        {revenueItems.length === 0 ? (
          <div className="text-sm text-gray-400 italic">등록된 매출 항목이 없습니다.</div>
        ) : (
          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">항목명</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">카테고리</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">금액 (원)</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">비고</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {CATEGORIES.map((cat) => {
                  const items = itemsByCategory[cat];
                  if (items.length === 0) return null;
                  return (
                    <Fragment key={cat}>
                      <tr className="bg-gray-50/60">
                        <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          {cat}
                        </td>
                      </tr>
                      {items.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/40">
                          <td className="px-3 py-2">{item.name_ko}</td>
                          <td className="px-3 py-2">
                            <span className={clsx('text-xs px-1.5 py-0.5 rounded', CATEGORY_BADGE[item.category])}>
                              {item.category}
                            </span>
                          </td>
                          <td className="px-3 py-2 w-40">
                            {ro ? (
                              <span className="text-gray-800">
                                {editForm.amounts[item.id]
                                  ? Number(editForm.amounts[item.id]).toLocaleString('ko-KR') + '원'
                                  : '—'}
                              </span>
                            ) : (
                              <input
                                type="text"
                                className="input-field text-sm w-full"
                                value={editForm.amounts[item.id] ?? ''}
                                onChange={(e) => updateAmount(item.id, e.target.value)}
                                placeholder="0"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 w-48">
                            {ro ? (
                              <span className="text-gray-600">{editForm.notes[item.id] || '—'}</span>
                            ) : (
                              <input
                                type="text"
                                className="input-field text-sm w-full"
                                value={editForm.notes[item.id] ?? ''}
                                onChange={(e) => updateNote(item.id, e.target.value)}
                                placeholder="비고"
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot className="bg-gray-100 border-t">
                <tr>
                  <td className="px-3 py-2 font-semibold text-gray-700" colSpan={2}>합계</td>
                  <td className="px-3 py-2 font-semibold text-gray-900 text-right" colSpan={2}>
                    <div className="text-xs text-gray-500 text-right">
                      매출 항목 계: {linesTotal.toLocaleString('ko-KR')}원
                      {gatewayNum > 0 && (
                        <> + 대관료: {gatewayNum.toLocaleString('ko-KR')}원</>
                      )}
                    </div>
                    <div className="text-sm font-bold text-gray-900 text-right">
                      총계: {grandTotal.toLocaleString('ko-KR')}원
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {canWrite && (
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}
      {!canWrite && (
        <div className="flex justify-end pt-2">
          <button type="button" className="btn-secondary text-sm" onClick={onCancel}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────
// Import Modal
// ───────────────────────────────────────────────

interface ImportModalProps {
  rows: ImportPreviewRow[];
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function ImportModal({ rows, loading, onConfirm, onClose }: ImportModalProps) {
  const validCount = rows.filter((r) => r.valid).length;
  const invalidCount = rows.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-semibold text-gray-900">엑셀 가져오기 확인</div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-3 text-sm text-gray-600 border-b">
          <span className="text-green-700 font-medium">{validCount}건</span> 가져오기 가능
          {invalidCount > 0 && (
            <>, <span className="text-red-600 font-medium">{invalidCount}건</span> 행사 ID 불일치 (건너뜀)</>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-gray-600">행사명</th>
                <th className="px-3 py-2 text-right text-gray-600">계약금액</th>
                <th className="px-3 py-2 text-right text-gray-600">실매출</th>
                <th className="px-3 py-2 text-center text-gray-600">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => (
                <tr key={i} className={clsx(!r.valid && 'bg-red-50')}>
                  <td className="px-3 py-2">
                    {r.valid ? (
                      <span>{r.event_name}</span>
                    ) : (
                      <span className="text-red-600">{r.event_name} (ID: {r.event_id})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtKRW(r.contract_amount)}</td>
                  <td className="px-3 py-2 text-right">{fmtKRW(r.sales_total_amount)}</td>
                  <td className="px-3 py-2 text-center">
                    {r.valid ? (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">유효</span>
                    ) : (
                      <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">오류</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={loading}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={onConfirm}
            disabled={loading || validCount === 0}
          >
            {loading ? '가져오는 중…' : `${validCount}건 가져오기 실행`}
          </button>
        </div>
      </div>
    </div>
  );
}
