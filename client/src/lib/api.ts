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

// 바이너리(파일) 다운로드용 — JSON이 아닌 Blob을 반환. 인증 처리는 request와 동일.
// Content-Disposition의 파일명도 함께 파싱해 돌려준다.
async function requestBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const idToken = await getCurrentIdToken().catch(() => null);
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
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
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
  let filename = '';
  if (m) {
    try {
      filename = decodeURIComponent(m[1]);
    } catch {
      filename = m[1];
    }
  }
  return { blob, filename };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  getBlob: (path: string) => requestBlob(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
