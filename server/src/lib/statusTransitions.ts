// 상태 전이 시점 집계 — "이번 주에 새로 INQ 가 된 건이 몇 건, DEF 로 확정된 건이 몇 건" 을 세기 위한 원천.
//
// 세 가지 대상을 같은 모양으로 편다.
//  - 행사(event): 상태(INQ/DEF/LOS …). 변경이력(change_logs) 의 '상태' 변경 시각이 기준.
//  - 웨딩 고객: 진행단계(신규문의/상담/INQ/DEF/LOS). 변경이력 '진행단계' 또는 자동반영 요약문에서 읽는다.
//  - MICE 문의: 진행상황(문의/DEF/LOS). 문의는 고객 문서 안에 있어 변경이력에 상태가 안 남는다 —
//    status_changed_at(2026-10 부터 저장) → confirmed_at(자동 확정) 순으로 쓰고, 없으면 at=null(시각 미상).
//
// 변경이력 도입 전에 만들어진 건은 "처음 상태" 를 생성일에 둔다(처음 상태 = 가장 오래된 이력의 before, 없으면 현재 상태).
// 없는 시각을 지어내지 않는다 — 시각 미상은 null 로 내려보내고 화면이 '제외 N건' 으로 보여준다.
import { store } from '../store/mockStore.js';
import type { ChangeLog } from '../types.js';

export interface StatusTransition {
  kind: 'event' | 'mice' | 'wedding';
  sub: 'MICE' | 'WEDDING';
  id: string; // 이동할 엔티티 id (행사 id / 고객 id)
  name: string;
  to: string; // 바뀐 뒤 상태
  at: string | null; // ISO. null = 시각 미상
}

function logsByEntity(type: ChangeLog['entity_type']): Map<string, ChangeLog[]> {
  const m = new Map<string, ChangeLog[]>();
  for (const l of store.change_logs) {
    if (l.entity_type !== type) continue;
    if (!m.has(l.entity_id)) m.set(l.entity_id, []);
    m.get(l.entity_id)!.push(l);
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.changed_at < b.changed_at ? -1 : 1));
  return m;
}

/** 한 엔티티의 이력에서 특정 라벨의 (before → after, 시각) 만 뽑는다. 자동반영은 summary 에만 남아 정규식으로 보완. */
function fieldChanges(logs: ChangeLog[], label: string, summaryRe: RegExp) {
  const out: Array<{ before: string; after: string; at: string }> = [];
  for (const l of logs) {
    const c = (l.changes || []).find((x) => x.field === label);
    if (c) {
      out.push({ before: c.before, after: c.after, at: l.changed_at });
      continue;
    }
    const m = summaryRe.exec(l.summary || '');
    if (m) out.push({ before: m[1], after: m[2], at: l.changed_at });
  }
  return out;
}

const dateOnlyToIso = (d: string | null | undefined, fallback: string): string => {
  if (!d) return fallback;
  if (d.length === 10) return new Date(d + 'T00:00:00+09:00').toISOString();
  return d;
};

export function computeStatusTransitions(sinceIso: string): StatusTransition[] {
  const out: StatusTransition[] = [];
  const push = (t: StatusTransition) => {
    if (t.at && t.at < sinceIso) return;
    out.push(t);
  };

  // ── 행사 ──
  const evLogs = logsByEntity('event');
  for (const e of store.events) {
    if (e.deleted_at) continue;
    const changes = fieldChanges(evLogs.get(e.id) || [], '상태', /상태 (\S+) → (\S+)/);
    const initial = changes[0]?.before ?? e.status;
    const base = { kind: 'event' as const, sub: e.event_type, id: e.id, name: e.event_name || '(이름 없음)' };
    push({ ...base, to: initial, at: e.created_at });
    for (const c of changes) push({ ...base, to: c.after, at: c.at });
  }

  // ── 웨딩 고객 ──
  const wdLogs = logsByEntity('wedding_customer');
  for (const c of store.wedding_customers) {
    if (c.deleted_at) continue;
    const changes = fieldChanges(wdLogs.get(c.id) || [], '진행단계', /진행단계 (\S+) → (\S+)/);
    const initial = changes[0]?.before ?? c.progress_status;
    const name = c.wedding_event_name || [c.groom_name, c.bride_name].filter(Boolean).join('♥') || '(이름 없음)';
    const base = { kind: 'wedding' as const, sub: 'WEDDING' as const, id: c.id, name };
    push({ ...base, to: initial, at: dateOnlyToIso(c.inquiry_date, c.created_at) });
    for (const ch of changes) push({ ...base, to: ch.after, at: ch.at });
  }

  // ── MICE 문의 ──
  for (const c of store.mice_customers) {
    if (c.deleted_at) continue;
    for (const q of c.inquiries || []) {
      if (q.inquiry_channel === 'DB' || q.progress_status === 'DB수집') continue; // 통화 아님
      const base = { kind: 'mice' as const, sub: 'MICE' as const, id: c.id, name: c.organization_name || '(업체명 없음)' };
      push({ ...base, to: '문의', at: dateOnlyToIso(q.call_date, q.created_at) });
      const s = q.progress_status;
      if (s === 'DEF') push({ ...base, to: 'DEF', at: q.status_changed_at || q.confirmed_at || null });
      else if (s === 'LOS') push({ ...base, to: 'LOS', at: q.status_changed_at || null });
    }
  }
  return out;
}
