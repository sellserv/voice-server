import { writable, get, readonly } from 'svelte/store';
import { isCapacitor, getPreference, setPreference, removePreference } from '../capacitor.js';
export { isCapacitor } from '../capacitor.js';

const STORAGE_KEY = 'serverUrl';

function detectDesktop(): boolean {
  try {
    return !!(window as any).electronAPI;
  } catch {
    return false;
  }
}

export const isDesktop = typeof window !== 'undefined' && detectDesktop();

// Track whether the initial load from electron-store is complete
// to avoid the subscribe callback overwriting the stored value with ''
let serverUrlLoaded = false;

/** Load the server URL from electron-store or Capacitor preferences (async). Call once at startup. */
export async function loadServerUrlFromStore() {
  if (isDesktop) {
    const url = await (window as any).electronAPI.storeGet(STORAGE_KEY);
    serverUrlLoaded = true;
    if (url) serverUrl.set(url);
  } else if (isCapacitor) {
    const stored = await getPreference('serverUrl');
    serverUrlLoaded = true;
    if (stored) serverUrl.set(stored);
  }
}

export const serverUrl = writable<string>('');

serverUrl.subscribe((url) => {
  if (!serverUrlLoaded) return;
  if (isDesktop) {
    // Persist to electron-store (survives random-port origin changes)
    (window as any).electronAPI.storeSet(STORAGE_KEY, url || null);
  } else if (isCapacitor) {
    if (url) {
      setPreference('serverUrl', url);
    } else {
      removePreference('serverUrl');
    }
  }
});

export function getServerUrl(): string {
  return get(serverUrl);
}

export function getWsBaseUrl(): string {
  const base = getServerUrl();
  if (!base) return '';
  const url = new URL(base);
  const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${url.host}`;
}

// Token storage for desktop app (WS auth can't use cookies from Tauri HTTP plugin)
let desktopToken: string | null = null;
let desktopCsrf: string | null = null;

export function setDesktopToken(token: string) {
  desktopToken = token;
  if (isDesktop) {
    (window as any).electronAPI.storeSet('authToken', token);
  } else if (isCapacitor) {
    setPreference('authToken', token);
  }
}

export function getDesktopToken(): string | null {
  return desktopToken;
}

export function setDesktopCsrf(csrf: string) {
  desktopCsrf = csrf;
  if (isDesktop) {
    (window as any).electronAPI.storeSet('authCsrf', csrf);
  } else if (isCapacitor) {
    setPreference('authCsrf', csrf);
  }
}

export function getDesktopCsrf(): string | null {
  return desktopCsrf;
}

export async function loadDesktopTokens() {
  if (isDesktop) {
    const token = await (window as any).electronAPI.storeGet('authToken');
    const csrf = await (window as any).electronAPI.storeGet('authCsrf');
    if (token) desktopToken = token;
    if (csrf) desktopCsrf = csrf;
  } else if (isCapacitor) {
    const token = await getPreference('authToken');
    const csrf = await getPreference('authCsrf');
    if (token) desktopToken = token;
    if (csrf) desktopCsrf = csrf;
  }
}

export function clearDesktopTokens() {
  desktopToken = null;
  desktopCsrf = null;
  if (isDesktop) {
    (window as any).electronAPI.storeSet('authToken', null);
    (window as any).electronAPI.storeSet('authCsrf', null);
  } else if (isCapacitor) {
    removePreference('authToken');
    removePreference('authCsrf');
  }
}

// Fires when a 401/4001 indicates the session is no longer valid
const _sessionExpired = writable(false);
export const sessionExpired = readonly(_sessionExpired);
export function markSessionExpired() {
  clearDesktopTokens();
  _sessionExpired.set(true);
}
export function resetSessionExpired() {
  _sessionExpired.set(false);
}

/** Resolve a server-relative path (e.g. /uploads/foo.png) to a full URL on desktop */
export function resolveAsset(path: string | null | undefined): string {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('data:') ||
    path.startsWith('blob:')
  )
    return path;
  if (!isDesktop && !isCapacitor) return path;
  const base = getServerUrl();
  if (!base) return path;
  return `${base}${path}`;
}
