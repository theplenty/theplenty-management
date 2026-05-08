import type { Event, Hall } from '../types';

// 두 홀 이름이 물리적으로 겹치는지 — "Hall A+B"는 Hall A, Hall B를 포함한다.
// 다른 홀끼리는 독립적이므로 이름 일치만 검사.
function physicallyOverlaps(a: Hall, b: Hall): boolean {
  if (a === b) return true;
  if (a === 'Hall A+B' && (b === 'Hall A' || b === 'Hall B')) return true;
  if (b === 'Hall A+B' && (a === 'Hall A' || a === 'Hall B')) return true;
  return false;
}

function hallsOverlap(a: Event, b: Event): boolean {
  if (a.halls.length === 0 || b.halls.length === 0) return false;
  for (const h1 of a.halls) {
    for (const h2 of b.halls) {
      if (physicallyOverlaps(h1, h2)) return true;
    }
  }
  return false;
}

// 행사 시간이 겹치는지 — 끝점이 같은 경우(연달아 사용)는 겹치지 않은 것으로 처리
function timeOverlaps(a: Event, b: Event): boolean {
  const aStart = new Date(a.start_datetime).getTime();
  const aEnd = new Date(a.end_datetime).getTime();
  const bStart = new Date(b.start_datetime).getTime();
  const bEnd = new Date(b.end_datetime).getTime();
  return aStart < bEnd && bStart < aEnd;
}

export type ConflictLevel = 'none' | 'soft' | 'hard';

/**
 * 한 행사가 다른 행사들과 충돌하는지 판정.
 * - hard: DEF/TEN 끼리 같은 홀+시간에 겹침 (강한 경고)
 * - soft: INQ가 다른 행사와 겹침 (약한 경고, 등록 허용)
 * - LOS 상태는 충돌 검사에서 제외
 */
export function detectConflict(target: Event, others: Event[]): { level: ConflictLevel; with: Event[] } {
  if (target.status === 'LOS') return { level: 'none', with: [] };

  const conflicts = others.filter((o) => {
    if (o.id === target.id) return false;
    if (o.status === 'LOS') return false;
    return hallsOverlap(target, o) && timeOverlaps(target, o);
  });

  if (conflicts.length === 0) return { level: 'none', with: [] };

  const hard = conflicts.some(
    (o) =>
      (o.status === 'DEF' || o.status === 'TEN') &&
      (target.status === 'DEF' || target.status === 'TEN')
  );
  return { level: hard ? 'hard' : 'soft', with: conflicts };
}
