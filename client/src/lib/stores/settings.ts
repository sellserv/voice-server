import { writable } from 'svelte/store';

export const themes = [
  { id: '', name: 'Midnight Blue' },
  { id: 'theme-dark', name: 'Dark' },
  { id: 'theme-light', name: 'Light' },
] as const;

function applyThemeClass(themeId: string) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  // Remove all theme-* classes
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith('theme-')) el.classList.remove(cls);
  }
  if (themeId) el.classList.add(themeId);
}

function createThemeStore() {
  const stored = typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') ?? '') : '';
  const { subscribe, set } = writable(stored);

  // Apply on load
  if (typeof document !== 'undefined') {
    applyThemeClass(stored);
  }

  return {
    subscribe,
    set(value: string) {
      set(value);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('theme', value);
      }
      if (typeof document !== 'undefined') {
        applyThemeClass(value);
      }
    },
  };
}

export const theme = createThemeStore();

// Push-to-talk settings
function createPersistedStore<T>(key: string, defaultValue: T) {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  const initial = stored !== null ? (JSON.parse(stored) as T) : defaultValue;
  const { subscribe, set, update } = writable<T>(initial);

  return {
    subscribe,
    set(value: T) {
      set(value);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(value));
      }
    },
    update(fn: (v: T) => T) {
      update((v) => {
        const newVal = fn(v);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, JSON.stringify(newVal));
        }
        return newVal;
      });
    },
  };
}

export const voiceMode = createPersistedStore<'vad' | 'ptt'>('voiceMode', 'vad');
export const vadSensitivity = createPersistedStore<number>('vadSensitivity', 40);
export const pushToTalkEnabled = createPersistedStore<boolean>('pushToTalkEnabled', false);
export const pttKey = createPersistedStore<string>('pttKey', 'Space');
export const noiseSuppression = createPersistedStore<boolean>('noiseSuppression', true);

export const soundboardVolume = createPersistedStore<number>('soundboardVolume', 70);

// Voice changer settings
export const voiceChangerEnabled = createPersistedStore<boolean>('voiceChangerEnabled', false);
export const voiceChangerPreset = createPersistedStore<string>('voiceChangerPreset', 'robot');
export const voiceChangerIntensity = createPersistedStore<number>('voiceChangerIntensity', 50);

// Notification settings
export const notifyDesktop = createPersistedStore<boolean>('notifyDesktop', true);
export const notifySound = createPersistedStore<boolean>('notifySound', true);
export const notifyMessageSound = createPersistedStore<boolean>('notifyMessageSound', true);
export const notifyJoinLeaveSound = createPersistedStore<boolean>('notifyJoinLeaveSound', true);

// Per-user volume settings (persisted locally)
export const userVolumeSettings = createPersistedStore<
  Record<string, { volume: number; muted: boolean }>
>('userVolumeSettings', {});

export function getUserVolume(userId: string): { volume: number; muted: boolean } {
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem('userVolumeSettings') : null;
  const settings = stored
    ? (JSON.parse(stored) as Record<string, { volume: number; muted: boolean }>)
    : {};
  return settings[userId] ?? { volume: 100, muted: false };
}

export function setUserVolume(userId: string, volume: number) {
  userVolumeSettings.update((s) => ({
    ...s,
    [userId]: { ...(s[userId] ?? { volume: 100, muted: false }), volume },
  }));
}

export function toggleUserMute(userId: string): boolean {
  let muted = false;
  userVolumeSettings.update((s) => {
    const current = s[userId] ?? { volume: 100, muted: false };
    muted = !current.muted;
    return { ...s, [userId]: { ...current, muted } };
  });
  return muted;
}
