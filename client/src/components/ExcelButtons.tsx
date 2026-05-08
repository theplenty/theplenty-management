import { useRef, useState } from 'react';
import type { ColumnDef } from '../lib/excel';
import { exportToXlsx, importFromXlsx } from '../lib/excel';

interface Props<T> {
  filename: string;
  sheetName: string;
  columns: ColumnDef<T>[];
  rows: T[];
  onImportRows: (rows: Partial<T>[]) => Promise<{ ok: number; failed: number }>;
}

export default function ExcelButtons<T>({
  filename,
  sheetName,
  columns,
  rows,
  onImportRows,
}: Props<T>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function handleExport() {
    await exportToXlsx({ filename, sheetName, rows, columns });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const { rows: parsed, errors } = await importFromXlsx<T>({ file, columns });
      if (parsed.length === 0) {
        alert('가져올 데이터가 없습니다. 헤더가 정확한지 확인해주세요.');
        return;
      }
      const sample = errors.slice(0, 3).map((e) => `· 행 ${e.row}: ${e.message}`).join('\n');
      const ok = confirm(
        `엑셀에서 ${parsed.length}건을 발견했습니다. 일괄 등록하시겠습니까?` +
          (errors.length ? `\n\n경고 ${errors.length}건:\n${sample}` : '')
      );
      if (!ok) return;
      const result = await onImportRows(parsed);
      alert(`등록 완료: 성공 ${result.ok}건 / 실패 ${result.failed}건`);
    } catch (err) {
      alert('엑셀 파싱 실패. 형식을 확인해주세요.');
      console.error(err);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex gap-2">
      <button onClick={handleExport} className="btn-secondary !py-1.5 text-xs" type="button">
        ⬇ 엑셀 내보내기
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        className="btn-secondary !py-1.5 text-xs"
        type="button"
      >
        ⬆ 엑셀 가져오기
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
