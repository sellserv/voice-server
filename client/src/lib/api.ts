import { getServerUrl, getDesktopCsrf, getDesktopToken, isDesktop, markSessionExpired } from './stores/server';
import { toast } from './stores/toast';

let rateLimitWarned = false;

function getBase(): string {
  return getServerUrl();
}

function getCsrfToken(): string {
  if (isDesktop) {
    return getDesktopCsrf() || '';
  }
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
  return match ? match[1] : '';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const BASE = getBase();
  const opts: RequestInit = {
    method,
    credentials: 'include',
    headers: {} as Record<string, string>,
  };

  // Desktop app: use Bearer token since cross-origin cookies aren't sent
  if (isDesktop) {
    const token = getDesktopToken();
    if (token) {
      (opts.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
  }

  (opts.headers as Record<string, string>)['X-CSRF-Token'] = getCsrfToken();

  if (body !== undefined) {
    (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res = await fetch(`${BASE}${path}`, opts);

  // Retry once after a short delay on rate limit or temporary unavailable
  if (res.status === 429 || res.status === 503) {
    if (!rateLimitWarned) {
      rateLimitWarned = true;
      toast.error('Slow down — too many requests. Retrying...');
      setTimeout(() => { rateLimitWarned = false; }, 5000);
    }
    await new Promise(r => setTimeout(r, 1500));
    res = await fetch(`${BASE}${path}`, opts);
  }

  if (!res.ok) {
    if (res.status === 401 && isDesktop && getDesktopToken()) {
      markSessionExpired();
    }
    if (res.status === 429 || res.status === 503) {
      throw new Error('Slow down — too many requests. Try again in a moment.');
    }
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Request failed');
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),

  upload: async (file: File | Blob, filename?: string) => {
    const form = new FormData();
    form.append('file', file, filename ?? (file instanceof File ? file.name : 'upload.bin'));
    const headers: Record<string, string> = { 'X-CSRF-Token': getCsrfToken() };
    if (isDesktop) {
      const token = getDesktopToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${getBase()}/api/upload`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    });
    if (!res.ok) {
      if (res.status === 401 && isDesktop && getDesktopToken()) {
        markSessionExpired();
      }
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
};

export function serverApi(serverId: string) {
  return {
    get: <T>(path: string) => api.get<T>(`/api/servers/${serverId}${path}`),
    post: <T>(path: string, body?: unknown) => api.post<T>(`/api/servers/${serverId}${path}`, body),
    put: <T>(path: string, body?: unknown) => api.put<T>(`/api/servers/${serverId}${path}`, body),
    patch: <T>(path: string, body?: unknown) => api.patch<T>(`/api/servers/${serverId}${path}`, body),
    delete: <T>(path: string) => api.delete<T>(`/api/servers/${serverId}${path}`),
  };
}
