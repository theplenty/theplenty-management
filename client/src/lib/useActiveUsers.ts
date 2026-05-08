// 작성자 / 담당지배인 등 사용자 드롭다운에 사용할 활성 사용자 목록.
// 한 번 로드해서 캐시 — 페이지 내에서 여러 모달이 공유.

import { useEffect, useState } from 'react';
import { api } from './api';
import type { ActiveUserOption } from '../types';

let cache: ActiveUserOption[] | null = null;
let inflight: Promise<ActiveUserOption[]> | null = null;

async function load(): Promise<ActiveUserOption[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.get<{ users: ActiveUserOption[] }>('/api/users/active');
      cache = res.users;
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function invalidateActiveUsers() {
  cache = null;
}

export function useActiveUsers(): ActiveUserOption[] {
  const [users, setUsers] = useState<ActiveUserOption[]>(cache || []);
  useEffect(() => {
    let aborted = false;
    load().then((u) => {
      if (!aborted) setUsers(u);
    });
    return () => {
      aborted = true;
    };
  }, []);
  return users;
}
