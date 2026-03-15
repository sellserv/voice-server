import { writable } from 'svelte/store';
import { isDesktop } from './stores/server';
import { addToast } from './stores/toast';

export const updateReady = writable<{ version: string } | null>(null);

let pollingStarted = false;
let alreadyReady = false;

export async function checkForUpdates() {
  if (!isDesktop) return;

  await doCheck();

  // Poll every 5 minutes for real-time update detection
  if (!pollingStarted) {
    pollingStarted = true;
    setInterval(doCheck, 5 * 60 * 1000);
  }
}

async function doCheck() {
  if (alreadyReady) return;

  try {
    const api = (window as any).electronAPI;
    const platform: string = await api.getPlatform();
    const update = await api.checkForUpdates();
    console.log('[Updater] Check result:', update);

    if (update?.available) {
      alreadyReady = true;

      if (platform === 'win32') {
        // Auto-download in background, then signal the UI
        await api.downloadUpdate();
      }

      updateReady.set({ version: update.version });
    }
  } catch (e: any) {
    console.error('[Updater] Failed to check for updates:', e);
  }
}

export function installUpdate() {
  const api = (window as any).electronAPI;
  api.installUpdate();
}
