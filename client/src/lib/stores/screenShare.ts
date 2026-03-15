import { writable, derived } from 'svelte/store';

export interface ScreenShareEntry {
  producerId: string;
  username: string;
  stream?: MediaStream;
}

export const activeScreenShares = writable<Map<string, ScreenShareEntry>>(new Map());
export const isScreenSharing = writable(false);

export function addScreenShare(userId: string, entry: ScreenShareEntry) {
  activeScreenShares.update((m) => {
    const next = new Map(m);
    next.set(userId, entry);
    return next;
  });
}

export function removeScreenShare(userId: string) {
  activeScreenShares.update((m) => {
    const next = new Map(m);
    next.delete(userId);
    return next;
  });
}

export function setScreenShareStream(userId: string, stream: MediaStream) {
  activeScreenShares.update((m) => {
    const next = new Map(m);
    const entry = next.get(userId);
    if (entry) {
      next.set(userId, { ...entry, stream });
    }
    return next;
  });
}
