import { writable, get } from 'svelte/store';

export const adminToken = writable<string | null>(null);
export const tokenExpiresAt = writable<string | null>(null);
export const isAuthenticated = writable(false);

export function setAuth(token: string, expiresAt: string) {
  adminToken.set(token);
  tokenExpiresAt.set(expiresAt);
  isAuthenticated.set(true);
}

export function logout() {
  adminToken.set(null);
  tokenExpiresAt.set(null);
  isAuthenticated.set(false);
}

export function isExpired(): boolean {
  const exp = get(tokenExpiresAt);
  if (!exp) return true;
  return new Date(exp).getTime() < Date.now();
}
