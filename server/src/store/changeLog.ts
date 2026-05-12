// 변경 이력 기록 + 단순 diff 요약 헬퍼.
// 모킹 단계에서는 사용자에게 의미 있는 한 줄 요약만 만들면 충분하다.

import { nanoid } from 'nanoid';
import { store, persistDoc } from './mockStore.js';
import type {
  ChangeLog,
  ChangeLogAction,
  ChangeLogEntityType,
  User,
} from '../types.js';

export function logChange(opts: {
  entity_type: ChangeLogEntityType;
  entity_id: string;
  action: ChangeLogAction;
  summary: string;
  user: User;
}) {
  const log: ChangeLog = {
    id: nanoid(10),
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: opts.action,
    summary: opts.summary,
    changed_by_id: opts.user.id,
    changed_by_name: opts.user.name,
    changed_at: new Date().toISOString(),
  };
  store.change_logs.push(log);
  persistDoc('change_logs', log.id);
  return log;
}

// 두 객체에서 변경된 필드명 목록을 한 줄 요약으로 반환.
// 깊이 1 비교만 한다 (배열/객체는 길이 변화나 단순 표시 정도).
export function summarizeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string> = {}
): string {
  const changes: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k === 'updated_at' || k === 'last_modified_at' || k === 'last_modified_by_id' || k === 'last_modified_by_name') continue;
    const a = before[k];
    const b = after[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        changes.push(`${labels[k] || k} ${a.length}건→${b.length}건`);
      }
      continue;
    }
    if (typeof a === 'object' && a !== null) continue;
    if (typeof b === 'object' && b !== null) continue;
    if ((a ?? '') !== (b ?? '')) {
      const aStr = a == null || a === '' ? '(없음)' : String(a);
      const bStr = b == null || b === '' ? '(없음)' : String(b);
      // 너무 긴 값은 짧게
      const trim = (s: string) => (s.length > 24 ? s.slice(0, 22) + '…' : s);
      changes.push(`${labels[k] || k} "${trim(aStr)}"→"${trim(bStr)}"`);
    }
  }
  if (changes.length === 0) return '수정됨';
  // 너무 많이 나오면 앞 4개만
  if (changes.length > 4) return changes.slice(0, 4).join(', ') + ` 외 ${changes.length - 4}개`;
  return changes.join(', ');
}

export function getLogsForEntity(entity_type: ChangeLogEntityType, entity_id: string): ChangeLog[] {
  return store.change_logs
    .filter((l) => l.entity_type === entity_type && l.entity_id === entity_id)
    .sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
}
