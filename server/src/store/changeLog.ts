// 변경 이력 기록 + 단순 diff 요약 헬퍼.
// 사용자에게 의미 있는 한 줄 요약 + 구조화된 changes 배열(펼치기 UI용)을 함께 만든다.

import { nanoid } from 'nanoid';
import { store, persistDoc } from './mockStore.js';
import type {
  ChangeLog,
  ChangeLogAction,
  ChangeLogChange,
  ChangeLogEntityType,
  User,
} from '../types.js';

export function logChange(opts: {
  entity_type: ChangeLogEntityType;
  entity_id: string;
  action: ChangeLogAction;
  summary: string;
  changes?: ChangeLogChange[];
  user: User;
}) {
  const log: ChangeLog = {
    id: nanoid(10),
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: opts.action,
    summary: opts.summary,
    changes: opts.changes && opts.changes.length > 0 ? opts.changes : undefined,
    changed_by_id: opts.user.id,
    changed_by_name: opts.user.name,
    changed_at: new Date().toISOString(),
  };
  store.change_logs.push(log);
  persistDoc('change_logs', log.id);
  return log;
}

// 두 객체에서 변경된 필드명 목록을 한 줄 요약 + 구조화된 배열로 반환.
// 깊이 1 비교만 한다 (배열/객체는 길이 변화나 단순 표시 정도).
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {}
): { summary: string; changes: ChangeLogChange[] } {
  const changes: ChangeLogChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'updated_at' || k === 'last_modified_at' || k === 'last_modified_by_id' || k === 'last_modified_by_name') continue;
    const a = before[k];
    const b = after[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        changes.push({
          field: labels[k] || k,
          before: `${a.length}건`,
          after: `${b.length}건`,
        });
      }
      continue;
    }
    if (typeof a === 'object' && a !== null) continue;
    if (typeof b === 'object' && b !== null) continue;
    if ((a ?? '') !== (b ?? '')) {
      const aStr = a == null || a === '' ? '(없음)' : String(a);
      const bStr = b == null || b === '' ? '(없음)' : String(b);
      changes.push({
        field: labels[k] || k,
        before: aStr,
        after: bStr,
      });
    }
  }
  return { summary: buildSummary(changes), changes };
}

// 라벨만 모아 콤마로 합친 짧은 요약. 예: "행사일자, 담당자 수정"
function buildSummary(changes: ChangeLogChange[]): string {
  if (changes.length === 0) return '수정됨';
  const labels = changes.map((c) => c.field);
  if (labels.length > 6) return labels.slice(0, 6).join(', ') + ` 외 ${labels.length - 6}개 수정`;
  return labels.join(', ') + ' 수정';
}

// 옛 호출부 호환 — string 만 필요한 경우.
export function summarizeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {}
): string {
  return computeDiff(before, after, labels).summary;
}

export function getLogsForEntity(entity_type: ChangeLogEntityType, entity_id: string): ChangeLog[] {
  return store.change_logs
    .filter((l) => l.entity_type === entity_type && l.entity_id === entity_id)
    .sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
}
