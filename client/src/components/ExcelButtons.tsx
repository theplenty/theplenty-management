import { useRef, useState } from 'react';
import type { ColumnDef, ImportResult } from '../lib/excel';
import { exportToXlsx, importFromXlsx } from '../lib/excel';

interface Props<T> {
  filename: string;
  sheetName: string;
  columns: ColumnDef<T>[];
  rows: T[];
  // upsert 미리보기/실행 — 두 번째 인자 dryRun=true면 실제 변경 없이 카운트만 반환.
  // (호출측에서 dryRun을 지원하지 않으면 그냥 무시하고 실제 처리 결과 반환)
  onImportRows: (rows: Partial<T>[], dryRun?: boolean) => Promise<ImportResult>;
  // 미리보기/리포트에 어떤 데이터 종류인지 표시 (e.g. "MICE 고객", "행사")
  importLabel?: string;
}

export default function ExcelButtons<T>({
  filename,
  sheetName,
  columns,
  rows,
  onImportRows,
  importLabel,
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
      const { rows: parsed, errors: parseErrors } = await importFromXlsx<T>({ file, columns });
      if (parsed.length === 0) {
        alert('가져올 데이터가 없습니다. 헤더가 정확한지 확인해주세요.');
        return;
      }
      const label = importLabel ? ` (${importLabel})` : '';

      // 1단계: dry-run 시도 — 신규/업데이트 건수 미리 알림
      let preview: ImportResult | null = null;
      try {
        preview = await onImportRows(parsed, true);
      } catch {
        // dry-run 미지원 → 통과 (기존 동작)
      }

      const parseWarn = parseErrors.length
        ? `\n\n파싱 경고 ${parseErrors.length}건:\n` +
          parseErrors.slice(0, 3).map((e) => `· 행 ${e.row}: ${e.message}`).join('\n')
        : '';

      let confirmMsg = `엑셀에서 ${parsed.length}건${label}을(를) 발견했습니다.`;
      if (preview && (preview.added !== undefined || preview.updated !== undefined)) {
        const a = preview.added ?? 0;
        const u = preview.updated ?? 0;
        const f = preview.failed ?? 0;
        confirmMsg +=
          `\n\n[미리보기]\n` +
          `· 신규 추가 예정: ${a}건\n` +
          `· 기존 업데이트 예정: ${u}건` +
          (f > 0 ? `\n· 오류 / 키 누락: ${f}건` : '');
        if (preview.errors && preview.errors.length > 0) {
          confirmMsg +=
            `\n\n오류 상세 (최대 3건):\n` +
            preview.errors.slice(0, 3).map((e) => `· ${e.key || `행${e.row || '?'}`}: ${e.reason}`).join('\n');
        }
      }
      confirmMsg += parseWarn + '\n\n진행하시겠습니까?';
      if (!confirm(confirmMsg)) return;

      // 2단계: 실제 import
      const result = await onImportRows(parsed, false);
      let report = `등록 완료${label}\n\n` + `총 ${result.ok}건 성공 / ${result.failed}건 실패`;
      if (result.added !== undefined || result.updated !== undefined) {
        report += `\n  · 신규 추가: ${result.added ?? 0}건`;
        report += `\n  · 기존 업데이트: ${result.updated ?? 0}건`;
      }
      if (result.errors && result.errors.length > 0) {
        report +=
          `\n\n오류 상세 (최대 5건):\n` +
          result.errors
            .slice(0, 5)
            .map((e) => `· ${e.key || `행${e.row || '?'}`}: ${e.reason}`)
            .join('\n');
        if (result.errors.length > 5) {
          report += `\n... 외 ${result.errors.length - 5}건. 자세한 내용은 콘솔(F12) 참조.`;
          // eslint-disable-next-line no-console
          console.warn(`[Excel import] ${importLabel || ''} 오류 전체:`, result.errors);
        }
      }
      alert(report);
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
