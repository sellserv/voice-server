# Electron Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Tauri desktop shell with Electron so voice chat (WebRTC) works on all platforms.

**Architecture:** New `desktop/` directory with Electron main process (`main.js`), preload script (`preload.js`), and electron-builder config. Frontend stays at `client/` unchanged structurally — only the native bridge imports change from `@tauri-apps/*` to `window.electronAPI.*`.

**Tech Stack:** Electron, electron-builder, electron-updater, electron-store, electron-window-state

---

### Task 1: Scaffold Electron project

**Files:**

- Delete: `desktop/src-tauri/` (entire directory)
- Delete: `desktop/package.json` (old Tauri package.json)
- Create: `desktop/package.json`
- Create: `desktop/main.js`
- Create: `desktop/preload.js`

**Step 1: Delete the old Tauri desktop shell**

```bash
rm -rf desktop/src-tauri
rm desktop/package.json
```

**Step 2: Create `desktop/package.json`**

```json
{
  "name": "@voip-server/desktop",
  "version": "1.0.0",
  "private": true,
  "main": "main.js",
  "scripts": {
    "dev": "electron .",
    "build": "electron-builder",
    "build:win": "electron-builder --win",
    "build:linux": "electron-builder --linux",
    "build:mac": "electron-builder --mac"
  },
  "dependencies": {
    "electron-store": "^10.0.0",
    "electron-updater": "^6.3.9",
    "electron-window-state": "^5.0.3"
  },
  "devDependencies": {
    "electron": "^33.3.1",
    "electron-builder": "^25.1.8"
  },
  "build": {
    "appId": "com.voip-server.desktop",
    "productName": "SellServ Voice",
    "directories": {
      "output": "dist"
    },
    "files": ["main.js", "preload.js"],
    "extraResources": [
      {
        "from": "../client/build",
        "to": "app",
        "filter": ["**/*"]
      }
    ],
    "win": {
      "target": "nsis",
      "icon": "icons/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "linux": {
      "target": ["deb", "AppImage", "pacman"],
      "icon": "icons",
      "category": "Network"
    },
    "mac": {
      "target": "dmg",
      "icon": "icons/icon.icns"
    },
    "publish": {
      "provider": "github",
      "owner": "sellserv",
      "repo": "voice-server"
    }
  }
}
```

**Step 3: Copy icons from old Tauri directory**

Before deleting `src-tauri` in step 1, first copy the icons:

```bash
cp -r desktop/src-tauri/icons desktop/icons
```

Actually, re-order: copy icons BEFORE deleting src-tauri. The steps should be:

```bash
mkdir -p desktop/icons
cp desktop/src-tauri/icons/* desktop/icons/
rm -rf desktop/src-tauri
rm desktop/package.json  # then create new one
```

**Step 4: Create `desktop/main.js`**

This is the Electron main process. It replicates all Tauri native features:

- Frameless window loading `client/build/index.html` (production) or `http://localhost:5173` (dev)
- System tray with Show/Quit menu and click-to-show
- Close-to-tray behavior (configurable via electron-store)
- Autostart via `app.setLoginItemSettings()`
- First-launch defaults (closeToTray=true, startMinimized=false, autostart=true)
- Start-minimized when auto-launched
- Window state persistence via electron-window-state
- IPC handlers for all renderer-callable APIs

```js
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  Notification,
  shell,
  powerMonitor,
} = require('electron');
const path = require('path');
const Store = require('electron-store');
const windowStateKeeper = require('electron-window-state');

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) app.quit();

const isDev = !app.isPackaged;
const store = new Store({ name: 'settings' });

let mainWindow = null;
let tray = null;

// First launch defaults
if (!store.has('firstLaunchDone')) {
  store.set('firstLaunchDone', true);
  store.set('closeToTray', true);
  store.set('startMinimized', false);
  app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] });
}

function createWindow() {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    title: 'SellServ Voice',
    icon: path.join(__dirname, 'icons', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindowState.manage(mainWindow);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const appPath = path.join(process.resourcesPath, 'app', 'index.html');
    mainWindow.loadFile(appPath);
  }

  // Close-to-tray behavior
  mainWindow.on('close', (e) => {
    const closeToTray = store.get('closeToTray', true);
    if (closeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Auto-hide if started minimized via autostart
  const wasAutostarted = process.argv.includes('--autostart');
  const startMinimized = store.get('startMinimized', false);
  if (startMinimized && wasAutostarted) {
    mainWindow.hide();
  }
}

function createTray() {
  const iconPath = path.join(
    __dirname,
    'icons',
    process.platform === 'darwin' ? '32x32.png' : 'icon.ico',
  );
  tray = new Tray(iconPath);
  tray.setToolTip('SellServ Voice');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// --- IPC Handlers ---

// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());

// App info
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);

// Settings store
ipcMain.handle('store:get', (_e, key) => store.get(key));
ipcMain.handle('store:set', (_e, key, value) => store.set(key, value));

// Autostart
ipcMain.handle('autostart:isEnabled', () => {
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin;
});
ipcMain.handle('autostart:set', (_e, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled ? ['--autostart'] : [],
  });
});

// Idle detection
ipcMain.handle('system:getIdleSeconds', () => {
  return powerMonitor.getSystemIdleTime();
});

// Notifications
ipcMain.handle('notification:send', (_e, title, body) => {
  new Notification({ title, body }).show();
});

// Shell
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

// Updater
ipcMain.handle('updater:checkForUpdates', async () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      return {
        available: true,
        version: result.updateInfo.version,
      };
    }
    return { available: false };
  } catch (e) {
    console.error('[Updater]', e);
    return { available: false };
  }
});

ipcMain.handle('updater:downloadAndInstall', async () => {
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoInstallOnAppQuit = true;
  await autoUpdater.downloadUpdate();
  autoUpdater.quitAndInstall();
});

// --- App lifecycle ---

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  mainWindow?.show();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
```

**Step 5: Create `desktop/preload.js`**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Settings store
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),

  // Autostart
  isAutoStartEnabled: () => ipcRenderer.invoke('autostart:isEnabled'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),

  // Idle detection
  getIdleSeconds: () => ipcRenderer.invoke('system:getIdleSeconds'),

  // Notifications
  notify: (title, body) => ipcRenderer.invoke('notification:send', title, body),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  downloadAndInstall: () => ipcRenderer.invoke('updater:downloadAndInstall'),
});
```

**Step 6: Install dependencies**

```bash
cd desktop && npm install
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold Electron desktop shell replacing Tauri"
```

---

### Task 2: Update `isDesktop` detection

**Files:**

- Modify: `client/src/lib/stores/server.ts`

**Step 1: Update the `detectDesktop()` function**

Change from checking `__TAURI_INTERNALS__` to checking `electronAPI`:

```ts
function detectDesktop(): boolean {
  try {
    return !!(window as any).electronAPI;
  } catch {
    return false;
  }
}
```

**Step 2: Commit**

```bash
git add client/src/lib/stores/server.ts
git commit -m "feat: update isDesktop detection for Electron"
```

---

### Task 3: Update TitleBar.svelte

**Files:**

- Modify: `client/src/lib/components/TitleBar.svelte`

**Step 1: Replace Tauri imports with electronAPI calls**

Replace the entire `<script>` block:

```svelte
<script lang="ts">
  import { serverSettings } from '$lib/stores/serverSettings';
  import { onMount } from 'svelte';

  let isMac = $state(false);

  onMount(async () => {
    try {
      const api = (window as any).electronAPI;
      if (api) {
        const platform = await api.getPlatform();
        isMac = platform === 'darwin';
      }
    } catch {}
  });

  function minimize() {
    (window as any).electronAPI?.minimize();
  }

  function toggleMaximize() {
    (window as any).electronAPI?.toggleMaximize();
  }

  function close() {
    (window as any).electronAPI?.close();
  }
</script>
```

**Step 2: Update the drag region attribute**

In the template, change `data-tauri-drag-region` to a CSS-based `-webkit-app-region: drag` approach. Replace all `data-tauri-drag-region` attributes with a class, and add CSS:

In the template, replace `data-tauri-drag-region` with class `drag-region` on the relevant elements (the outer `.titlebar` div and `.titlebar-title` spans).

Add to the `<style>` block:

```css
.drag-region {
  -webkit-app-region: drag;
}

.titlebar-btn,
.mac-btn,
.refresh-btn {
  -webkit-app-region: no-drag;
}
```

Remove all `data-tauri-drag-region` attributes and add `class:drag-region={true}` or just `class="drag-region"` to:

- The outer `.titlebar` div
- Both `.titlebar-title` spans

**Step 3: Commit**

```bash
git add client/src/lib/components/TitleBar.svelte
git commit -m "feat: update TitleBar to use Electron IPC"
```

---

### Task 4: Update SettingsModal.svelte

**Files:**

- Modify: `client/src/lib/components/SettingsModal.svelte`

**Step 1: Replace Tauri imports with electronAPI calls**

Replace lines 80-93 (the desktop settings initialization block):

```ts
if (isDesktop) {
  const api = (window as any).electronAPI;
  api.getVersion().then((v: string) => {
    appVersion = v;
  });
  api.isAutoStartEnabled().then((v: boolean) => {
    autostartEnabled = v;
  });
  api.storeGet('closeToTray').then((v: boolean | undefined) => {
    if (v !== null && v !== undefined) closeToTray = v;
  });
  api.storeGet('startMinimized').then((v: boolean | undefined) => {
    if (v !== null && v !== undefined) startMinimized = v;
  });
}
```

**Step 2: Replace `toggleAutostart` function (lines 95-108)**

```ts
async function toggleAutostart() {
  autostartLoading = true;
  try {
    const api = (window as any).electronAPI;
    autostartEnabled = !autostartEnabled;
    await api.setAutoStart(autostartEnabled);
  } catch {
    autostartEnabled = !autostartEnabled; // revert on failure
  }
  autostartLoading = false;
}
```

**Step 3: Replace `toggleCloseToTray` function (lines 110-119)**

```ts
async function toggleCloseToTray() {
  closeToTrayLoading = true;
  try {
    const api = (window as any).electronAPI;
    closeToTray = !closeToTray;
    await api.storeSet('closeToTray', closeToTray);
  } catch {}
  closeToTrayLoading = false;
}
```

**Step 4: Replace `toggleStartMinimized` function (lines 121-130)**

```ts
async function toggleStartMinimized() {
  startMinimizedLoading = true;
  try {
    const api = (window as any).electronAPI;
    startMinimized = !startMinimized;
    await api.storeSet('startMinimized', startMinimized);
  } catch {}
  startMinimizedLoading = false;
}
```

**Step 5: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte
git commit -m "feat: update SettingsModal to use Electron IPC"
```

---

### Task 5: Update updater.ts

**Files:**

- Modify: `client/src/lib/updater.ts`

**Step 1: Rewrite `checkForUpdates` to use electronAPI**

```ts
import { isDesktop } from './stores/server';
import { addToast, removeToast } from './stores/toast';

export async function checkForUpdates() {
  if (!isDesktop) return;

  try {
    const api = (window as any).electronAPI;
    const platform: string = await api.getPlatform();
    const update = await api.checkForUpdates();

    if (update?.available) {
      if (platform !== 'win32') {
        addToast(
          `Update v${update.version} available — please download the latest version from the downloads page to continue using the app.`,
          'info',
          0,
        );
        return;
      }

      const toastId = addToast(`Downloading update v${update.version}...`, 'info', 0);
      await api.downloadAndInstall();
      removeToast(toastId);
      addToast('Update installed — restarting...', 'success', 3000);
    }
  } catch (e: any) {
    console.error('[Updater] Failed to check for updates:', e);
  }
}
```

**Step 2: Commit**

```bash
git add client/src/lib/updater.ts
git commit -m "feat: update updater to use Electron IPC"
```

---

### Task 6: Update notifications.ts

**Files:**

- Modify: `client/src/lib/notifications.ts`

**Step 1: Rewrite to use electronAPI for desktop notifications**

```ts
import { isDesktop } from './stores/server';

let permissionGranted = false;

export async function initNotifications() {
  if (isDesktop) {
    // Electron notifications don't need permission on most platforms
    permissionGranted = true;
    return;
  }

  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    permissionGranted = true;
  }
}

async function ensurePermission() {
  if (permissionGranted) return true;

  if (isDesktop) {
    permissionGranted = true;
    return true;
  }

  if (!('Notification' in window)) return false;
  if (Notification.permission === 'denied') return false;

  const p = await Notification.requestPermission();
  permissionGranted = p === 'granted';
  return permissionGranted;
}

async function notify(title: string, body: string, _requireInteraction = false) {
  if (!permissionGranted && !(await ensurePermission())) return;

  if (isDesktop) {
    const api = (window as any).electronAPI;
    api.notify(title, body);
    return;
  }

  if (document.hasFocus()) return;

  const n = new Notification(title, { body, silent: true });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export function notifyMessage(username: string, displayName: string | undefined, content: string) {
  if (!isDesktop && document.hasFocus()) return;
  const title = displayName || username;
  const body = content.length > 100 ? content.slice(0, 100) + '...' : content;
  notify(title, body);
}

export function notifyCall(callerName: string) {
  notify('Incoming Call', `${callerName} is calling you`, true);
}

export function notifyMention(channelName: string, username: string, content: string) {
  const title = `Mentioned in #${channelName}`;
  const body = `${username}: ${content.length > 80 ? content.slice(0, 80) + '...' : content}`;
  notify(title, body);
}
```

**Step 2: Commit**

```bash
git add client/src/lib/notifications.ts
git commit -m "feat: update notifications to use Electron IPC"
```

---

### Task 7: Update idleDetector.ts

**Files:**

- Modify: `client/src/lib/idleDetector.ts`

**Step 1: Replace the `startTauriIdlePoll` function**

Replace the function (lines 55-80) with an Electron-based version:

```ts
async function startDesktopIdlePoll(): Promise<boolean> {
  if (!isDesktop) return false;

  try {
    const api = (window as any).electronAPI;
    // Test the call works
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
```

**Step 2: Update `startIdleDetection` to call the renamed function**

In `startIdleDetection()`, change:

```ts
const hasTauriIdle = await startTauriIdlePoll();
```

to:

```ts
const hasDesktopIdle = await startDesktopIdlePoll();
```

And update the condition below it:

```ts
if (!hasDesktopIdle) {
  await startSystemIdleDetector();
}
```

**Step 3: Remove the `@tauri-apps/api/core` import**

The dynamic `import('@tauri-apps/api/core')` inside the old function is deleted as part of the rewrite.

**Step 4: Update comments**

Change the comment `// Tauri desktop: poll the OS-level idle time via Rust command` to `// Desktop: poll the OS-level idle time via Electron`.

Change `// Stop Tauri idle poll` to `// Stop desktop idle poll`.

**Step 5: Commit**

```bash
git add client/src/lib/idleDetector.ts
git commit -m "feat: update idle detection to use Electron IPC"
```

---

### Task 8: Update api.ts — remove Tauri HTTP plugin

**Files:**

- Modify: `client/src/lib/api.ts`

**Step 1: Remove the Tauri fetch wrapper**

The entire file simplifies because Electron's Chromium `fetch` works normally with cookies. Remove:

- The `tauriFetch` variable
- The `getTauriFetch()` function
- The `doFetch()` function (replace calls with plain `fetch`)
- The `isDesktop` import (if no longer needed)

Replace `doFetch(url, opts)` calls with `fetch(url, opts)`.

The file should still import `getServerUrl` and `getDesktopCsrf` from `./stores/server` since the desktop app still needs CSRF handling and server URL resolution. But check: does Electron handle cookies natively with `credentials: 'include'`?

Electron's Chromium does handle cookies with `credentials: 'include'` when loading from `file://` protocol — but since we load from `file://` and make requests to `https://`, we may still need to handle auth via tokens rather than cookies, same as Tauri does now. Keep the CSRF/token handling but drop `@tauri-apps/plugin-http`.

Simplified `api.ts`:

```ts
import { getServerUrl, getDesktopCsrf, isDesktop } from './stores/server';

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

  (opts.headers as Record<string, string>)['X-CSRF-Token'] = getCsrfToken();

  if (body !== undefined) {
    (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);

  if (!res.ok) {
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
    const res = await fetch(`${getBase()}/api/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': getCsrfToken() },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  },
};
```

**Step 2: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "refactor: remove Tauri HTTP plugin, use native fetch"
```

---

### Task 9: Update ServerConnect.svelte — remove Tauri HTTP plugin

**Files:**

- Modify: `client/src/lib/components/ServerConnect.svelte`

**Step 1: Remove the Tauri fetch wrapper**

Replace the `doFetch` function and its usage with plain `fetch`. Remove the `isDesktop` import if no longer needed.

In the `<script>` block, change:

```svelte
<script lang="ts">
  import { serverUrl } from '$lib/stores/server';

  let url = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleConnect() {
    error = '';
    const trimmed = url.trim().replace(/\/+$/, '');

    if (!trimmed) {
      error = 'Please enter a server URL';
      return;
    }

    try {
      new URL(trimmed);
    } catch {
      error = 'Invalid URL. Use format: https://chat.example.com';
      return;
    }

    loading = true;
    try {
      const res = await fetch(`${trimmed}/api/auth/me`);
      if (!res.ok && res.status !== 401) {
        throw new Error(`Server returned ${res.status}`);
      }
      serverUrl.set(trimmed);
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }
</script>
```

**Step 2: Commit**

```bash
git add client/src/lib/components/ServerConnect.svelte
git commit -m "refactor: remove Tauri HTTP plugin from ServerConnect"
```

---

### Task 10: Remove webrtc.ts RTCPeerConnection guard

**Files:**

- Modify: `client/src/lib/webrtc.ts`

**Step 1: Remove the RTCPeerConnection check**

Since Electron bundles Chromium which always has RTCPeerConnection, remove the guard we added at the top of `joinVoice()` (lines 304-306):

```ts
if (typeof RTCPeerConnection === 'undefined') {
  throw new Error(
    'Voice chat is not supported in this browser or webview. RTCPeerConnection is not available — try using the web app instead.',
  );
}
```

This guard was only needed for WebKitGTK. The web app already has WebRTC via the browser, and Electron has it via Chromium.

**Step 2: Commit**

```bash
git add client/src/lib/webrtc.ts
git commit -m "refactor: remove RTCPeerConnection guard (Electron has WebRTC)"
```

---

### Task 11: Remove @tauri-apps dependencies

**Files:**

- Modify: `client/package.json`
- Modify: `package.json` (root workspace)

**Step 1: Remove Tauri plugin dependencies from `client/package.json`**

Remove these from `dependencies`:

- `@tauri-apps/plugin-autostart`
- `@tauri-apps/plugin-http`
- `@tauri-apps/plugin-opener`
- `@tauri-apps/plugin-process`
- `@tauri-apps/plugin-store`
- `@tauri-apps/plugin-updater`

**Step 2: Remove Tauri dependencies from root `package.json`**

Remove these from `dependencies`:

- `@tauri-apps/plugin-notification`
- `@tauri-apps/plugin-os`

**Step 3: Update root `package.json` scripts**

Replace the Tauri scripts:

```json
"tauri:dev": "npm run tauri:dev --workspace=desktop",
"tauri:build": "npm run tauri:build --workspace=desktop"
```

With Electron scripts:

```json
"desktop:dev": "npm run dev --workspace=desktop",
"desktop:build": "npm run build --workspace=desktop"
```

**Step 4: Run npm install to clean up lock file**

```bash
cd /home/coder/projects/voip && npm install
```

**Step 5: Commit**

```bash
git add package.json client/package.json package-lock.json
git commit -m "chore: remove all @tauri-apps dependencies"
```

---

### Task 12: Test dev mode

**Step 1: Start the client dev server**

```bash
cd /home/coder/projects/voip && npm run dev:client
```

**Step 2: In another terminal, start Electron in dev mode**

```bash
cd /home/coder/projects/voip/desktop && npm run dev
```

**Step 3: Verify**

- Window opens with custom title bar (frameless)
- Title bar buttons work (minimize, maximize, close)
- System tray appears with icon
- Tray right-click shows Show/Quit menu
- Close button hides to tray (doesn't quit)
- Settings modal shows Desktop section with toggles
- Voice channel join works (WebRTC connects)

**Step 4: Fix any issues found, then commit**

```bash
git add -A
git commit -m "fix: resolve issues from dev testing"
```

---

### Task 13: Test production build

**Step 1: Build the frontend**

```bash
cd /home/coder/projects/voip && npm run build
```

**Step 2: Build Electron for current platform**

```bash
cd /home/coder/projects/voip/desktop && npm run build
```

**Step 3: Verify the built app runs and all features work**

**Step 4: Commit any build config fixes**

```bash
git add -A
git commit -m "fix: resolve production build issues"
```
