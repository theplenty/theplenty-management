import ExcelJS from 'exceljs';

export interface ColumnDef<T> {
  header: string;
  key: keyof T & string;
  width?: number;
  // 내보낼 때 셀 값 변환 (예: 날짜 포맷, enum 라벨)
  format?: (value: unknown, row: T) => string | number | null;
  // 가져올 때 셀 값 변환 (Excel 셀 → 객체 필드 값)
  parse?: (value: unknown) => unknown;
}

/** 데이터 배열을 시트로 만들어 사용자 PC로 다운로드 */
export async function exportToXlsx<T>(opts: {
  filename: string;
  sheetName: string;
  rows: T[];
  columns: ColumnDef<T>[];
}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Plenty Convention 운영관리';
  wb.created = new Date();

  const ws = wb.addWorksheet(opts.sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = opts.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 18,
  }));

  for (const row of opts.rows) {
    const cells: Record<string, unknown> = {};
    for (const c of opts.columns) {
      const raw = (row as unknown as Record<string, unknown>)[c.key];
      cells[c.key] = c.format ? c.format(raw, row) : (raw ?? '');
    }
    ws.addRow(cells);
  }

  // 헤더 스타일
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };
  headerRow.alignment = { vertical: 'middle' };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 사용자가 업로드한 xlsx 파일을 파싱해서 객체 배열 반환 */
export async function importFromXlsx<T>(opts: {
  file: File;
  sheetName?: string; // 미지정 시 첫 번째 시트
  columns: ColumnDef<T>[];
}): Promise<{ rows: Partial<T>[]; errors: { row: number; message: string }[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await opts.file.arrayBuffer());
  const ws = opts.sheetName ? wb.getWorksheet(opts.sheetName) : wb.worksheets[0];
  if (!ws) {
    return { rows: [], errors: [{ row: 0, message: '시트를 찾을 수 없습니다.' }] };
  }

  // 헤더 행을 읽어 컬럼 매핑 만들기
  const headerRow = ws.getRow(1);
  const headerMap: Record<string, ColumnDef<T>> = {};
  for (const c of opts.columns) headerMap[c.header] = c;

  // 시트 컬럼 인덱스 → 우리 키
  const colIndexToCol: Record<number, ColumnDef<T>> = {};
  headerRow.eachCell((cell, colNumber) => {
    const headerText = String(cell.value || '').trim();
    const def = headerMap[headerText];
    if (def) colIndexToCol[colNumber] = def;
  });

  const rows: Partial<T>[] = [];
  const errors: { row: number; message: string }[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const obj: Record<string, unknown> = {};
    let hasAny = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const def = colIndexToCol[colNumber];
      if (!def) return;
      let v: unknown = cell.value;
      // exceljs는 날짜를 Date 객체로, 숫자를 number로, hyperlink는 객체로 줌. 최대한 단순화.
      if (v && typeof v === 'object' && 'text' in (v as object)) {
        v = (v as { text: string }).text;
      }
      if (v && typeof v === 'object' && 'result' in (v as object)) {
        v = (v as { result: unknown }).result;
      }
      if (v instanceof Date) {
        // YYYY-MM-DD로 변환
        const d = v as Date;
        const pad = (n: number) => String(n).padStart(2, '0');
        v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
      if (typeof v === 'string') v = v.trim();
      if (v !== null && v !== undefined && v !== '') hasAny = true;
      obj[def.key] = def.parse ? def.parse(v) : v;
    });
    if (hasAny) rows.push(obj as Partial<T>);
    else errors.push({ row: rowNumber, message: '빈 행 — 건너뜀' });
  });

  return { rows, errors };
}
