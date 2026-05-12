// 공통 fetch 래퍼. Vite proxy 설정 때문에 baseUrl 없이 /api로 호출.
// Firebase Auth 활성화 시 매 요청에 Bearer ID 토큰을 첨부 (백엔드 attachUser가 검증).

import { getCurrentIdToken } from './firebase';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export interface ApiError extends Error {
  status: number;
  payload?: unknown;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const idToken = await getCurrentIdToken().catch(() => null);
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    const err = new Error(`API ${res.status}: ${path}`) as ApiError;
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
