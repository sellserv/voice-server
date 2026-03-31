import { getServerUrl, getDesktopCsrf, getDesktopToken, isDesktop, isCapacitor, markSessionExpired } from './stores/server';
import { toast } from './stores/toast';

let rateLimitWarned = false;
let serverConfig: { voiceType: string; storageType: string } | null = null;

async function getServerConfig(): Promise<{ voiceType: string; storageType: string }> {
  if (serverConfig) return serverConfig;
  try {
    const res = await fetch(`${getBase()}/api/config`);
    serverConfig = await res.json();
  } catch {
    serverConfig = { voiceType: 'mediasoup', storageType: 'local' };
  }
  return serverConfig!;
}

function getBase(): string {
  return getServerUrl();
}

function getCsrfToken(): string {
  if (isDesktop || isCapacitor) {
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

  // Desktop/Capacitor app: use Bearer token since cross-origin cookies aren't sent
  if (isDesktop || isCapacitor) {
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
    if (res.status === 401 && (isDesktop || isCapacitor) && getDesktopToken()) {
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
    const name = filename ?? (file instanceof File ? file.name : 'upload.bin');
    const config = await getServerConfig();

    if (config.storageType === 's3') {
      // S3 mode: presign → upload to S3 → confirm
      const presign = await request<{ uploadUrl: string; key: string; fileUrl: string }>(
        'POST', '/api/upload/presign', { filename: name, contentType: file.type },
      );
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');
      return request('POST', '/api/upload/confirm', {
        key: presign.key, filename: name, contentType: file.type, sizeBytes: file.size,
      });
    }

    // Local mode: upload directly to server
    const form = new FormData();
    form.append('file', file, name);
    const headers: Record<string, string> = { 'X-CSRF-Token': getCsrfToken() };
    if (isDesktop || isCapacitor) {
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
      if (res.status === 401 && (isDesktop || isCapacitor) && getDesktopToken()) {
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
