import { get } from 'svelte/store';
import { myStatus, isAutoIdled, updateUserStatus } from './stores/presence';
import { currentUser } from './stores/auth';
import { sendWs } from './ws';
import { isDesktop } from './stores/server';

const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const IDLE_SECONDS = 5 * 60; // 5 minutes in seconds
const POLL_INTERVAL = 15_000; // Poll system idle every 15 seconds

// Fallback document-level activity events (used when IdleDetector API unavailable)
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
const WINDOW_EVENTS = ['focus'] as const;

let timer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let listening = false;
let idleDetector: any = null;
let idleAbort: AbortController | null = null;

function updateLocalStatus(status: 'online' | 'idle') {
  myStatus.set(status);
  const user = get(currentUser);
  if (user) updateUserStatus(user.id, status);
  sendWs({ type: 'presence:setStatus', status });
}

function onActivity() {
  // If we auto-idled, restore to online
  if (get(isAutoIdled)) {
    isAutoIdled.set(false);
    updateLocalStatus('online');
  }

  // Reset the idle timer (only auto-idle from 'online')
  if (timer) clearTimeout(timer);
  if (get(myStatus) === 'online') {
    timer = setTimeout(goIdle, IDLE_TIMEOUT);
  }
}

function goIdle() {
  if (get(myStatus) !== 'online') return;
  isAutoIdled.set(true);
  updateLocalStatus('idle');
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    onActivity();
  }
}

// Desktop: poll the OS-level idle time via Electron
async function startDesktopIdlePoll(): Promise<boolean> {
  if (!isDesktop) return false;

  try {
    const api = (window as any).electronAPI;
    await api.getIdleSeconds();

    pollTimer = setInterval(async () => {
      try {
        const seconds: number = await api.getIdleSeconds();
        if (seconds >= IDLE_SECONDS) {
          goIdle();
        } else if (get(isAutoIdled)) {
          isAutoIdled.set(false);
          updateLocalStatus('online');
        }
      } catch {}
    }, POLL_INTERVAL);

    return true;
  } catch {
    return false;
  }
}

// Try to use the IdleDetector API for system-wide idle detection.
// This detects mouse/keyboard activity anywhere on the OS, not just the browser tab.
// Supported in Chrome/Edge 94+. Falls back to document events otherwise.
async function startSystemIdleDetector(): Promise<boolean> {
  if (!('IdleDetector' in window)) return false;

  try {
    const permission = await (navigator.permissions as any).query({ name: 'idle-detection' });
    if (permission.state === 'denied') return false;

    idleAbort = new AbortController();
    idleDetector = new (window as any).IdleDetector();

    idleDetector.addEventListener('change', () => {
      const userState = idleDetector.userState; // 'active' or 'idle'
      const screenState = idleDetector.screenState; // 'locked' or 'unlocked'

      if (userState === 'active' && screenState === 'unlocked') {
        onActivity();
      } else {
        // User is idle system-wide or screen is locked
        goIdle();
      }
    });

    await idleDetector.start({
      threshold: IDLE_TIMEOUT,
      signal: idleAbort.signal,
    });

    return true;
  } catch {
    idleDetector = null;
    idleAbort = null;
    return false;
  }
}

function startFallbackDetection() {
  for (const evt of ACTIVITY_EVENTS) {
    document.addEventListener(evt, onActivity, { passive: true });
  }
  for (const evt of WINDOW_EVENTS) {
    window.addEventListener(evt, onActivity, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  timer = setTimeout(goIdle, IDLE_TIMEOUT);
}

export async function startIdleDetection() {
  if (listening) return;
  listening = true;

  // If server restored us as 'idle' from a previous session, treat it as
  // auto-idle so the next activity event restores us to 'online'.
  if (get(myStatus) === 'idle') {
    isAutoIdled.set(true);
  }

  // On desktop: use Electron's OS-level idle detection (best coverage)
  const hasDesktopIdle = await startDesktopIdlePoll();

  // On web or as supplement: try the browser IdleDetector API
  if (!hasDesktopIdle) {
    await startSystemIdleDetector();
  }

  // Always listen for document activity to recover from idle
  startFallbackDetection();
}

export function stopIdleDetection() {
  if (!listening) return;
  listening = false;

  // Stop desktop idle poll
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Stop system idle detector
  if (idleAbort) {
    idleAbort.abort();
    idleAbort = null;
    idleDetector = null;
  }

  // Stop fallback listeners
  for (const evt of ACTIVITY_EVENTS) {
    document.removeEventListener(evt, onActivity);
  }
  for (const evt of WINDOW_EVENTS) {
    window.removeEventListener(evt, onActivity);
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
