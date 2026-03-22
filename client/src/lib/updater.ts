import { writable } from 'svelte/store';
import { isDesktop } from './stores/server';
import { addToast } from './stores/toast';

export const updateReady = writable<{ version: string; store?: boolean } | null>(null);

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

      if (platform === 'win32' && !update.store) {
        // Auto-download in background, then signal the UI (exe only)
        await api.downloadUpdate();
      }

      updateReady.set({ version: update.version, store: !!update.store });
    }
  } catch (e: any) {
    console.error('[Updater] Failed to check for updates:', e);
  }
}

export function installUpdate() {
  const api = (window as any).electronAPI;
  api.installUpdate();
}

export function openStoreUpdate() {
  const api = (window as any).electronAPI;
  api.openExternal('ms-windows-store://pdp/?productid=9NTD3XLC0JRJ');
}
