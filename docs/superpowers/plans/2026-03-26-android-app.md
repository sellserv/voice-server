# Android App (Capacitor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sideloadable Android app that wraps the existing SvelteKit web app in a Capacitor shell, with a server instance selector (also added to Electron desktop), push notifications via Firebase Cloud Messaging, and a background audio service to keep voice alive when the app is backgrounded.

**Architecture:** Capacitor wraps the SvelteKit static build in an Android WebView. A new `ServerSelector.svelte` component (shown on first launch for both Electron and Capacitor) lets users pick the official instance or enter a custom URL. The existing platform detection and token storage in `stores/server.ts` and `stores/auth.ts` get `isCapacitor` branches alongside the existing `isDesktop` paths. Push notifications use FCM with server-side delivery triggered by DMs, @mentions, and missed calls. A custom Capacitor plugin provides an Android Foreground Service to keep WebRTC audio alive when backgrounded.

**Tech Stack:** Capacitor 6, `@capacitor/preferences`, `@capacitor/push-notifications`, `@capacitor/status-bar`, `@capacitor/app`, Firebase Admin SDK (`firebase-admin`), Android Foreground Service (Java/Kotlin), SvelteKit + Svelte 5

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `mobile/package.json` | Capacitor workspace package |
| Create | `mobile/capacitor.config.ts` | Capacitor configuration |
| Create | `mobile/android/` | Generated Android project (via `npx cap add android`) |
| Create | `mobile/src/backgroundaudio/BackgroundAudioPlugin.java` | Android Foreground Service plugin |
| Create | `mobile/src/backgroundaudio/BackgroundAudioService.java` | Android Foreground Service implementation |
| Create | `client/src/lib/components/ServerSelector.svelte` | Server instance selector screen |
| Create | `client/src/lib/capacitor.ts` | Capacitor plugin wrappers (preferences, push, background audio) |
| Create | `server/src/push/index.ts` | FCM push notification sender |
| Create | `server/src/routes/push.ts` | Device token registration routes |
| Create | `server/src/db/migrations/device_tokens.ts` | device_tokens table migration |
| Modify | `package.json` (root) | Add `mobile` to workspaces |
| Modify | `client/src/lib/stores/server.ts` | Add `isCapacitor`, Capacitor Preferences branches for URL + tokens |
| Modify | `client/src/lib/stores/auth.ts` | Add `isCapacitor` branches for token storage |
| Modify | `client/src/lib/api.ts` | Add `isCapacitor` to Bearer token and CSRF logic |
| Modify | `client/src/lib/ws.ts` | Add `isCapacitor` to WebSocket token auth |
| Modify | `client/src/routes/+layout.svelte` | Show ServerSelector when no URL saved, init push registration |
| Modify | `client/src/lib/components/SettingsModal.svelte` | Add "Server" settings tab |
| Modify | `client/src/lib/webrtc.ts` | Start/stop background audio service on voice join/leave |
| Modify | `client/src/app.css` | Safe area insets for mobile |
| Modify | `client/src/app.html` | Viewport meta for mobile WebView |
| Modify | `shared/types.ts` | Push notification types |
| Modify | `server/src/index.ts` | Register push routes |
| Modify | `server/src/db/schema.ts` | Run device_tokens migration |
| Modify | `server/src/config.ts` | Firebase config env vars |
| Modify | `server/src/ws/index.ts` | Track active connections for push suppression |
| Modify | `server/src/routes/messages.ts` | Trigger push on DM / @mention |

---

### Task 1: Create mobile/ Capacitor Workspace

**Files:**
- Create: `mobile/package.json`
- Create: `mobile/capacitor.config.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Create mobile/package.json**

```json
{
  "name": "@voip-server/mobile",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "sync": "npx cap sync android",
    "open": "npx cap open android",
    "build": "cd ../client && npm run build && cd ../mobile && npx cap sync android",
    "apk": "cd android && ./gradlew assembleDebug && echo 'APK at android/app/build/outputs/apk/debug/app-debug.apk'"
  },
  "dependencies": {
    "@capacitor/android": "^6.0.0",
    "@capacitor/app": "^6.0.0",
    "@capacitor/core": "^6.0.0",
    "@capacitor/preferences": "^6.0.0",
    "@capacitor/push-notifications": "^6.0.0",
    "@capacitor/status-bar": "^6.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create mobile/capacitor.config.ts**

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.sellserv.voice',
  appName: 'SellServ Voice',
  webDir: '../client/build',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
```

- [ ] **Step 3: Add mobile to root workspaces**

In root `package.json`, add `"mobile"` to the workspaces array and add mobile scripts:

```json
"workspaces": [
  "shared",
  "server",
  "client",
  "desktop",
  "mobile"
],
"scripts": {
  ...existing scripts...,
  "mobile:sync": "npm run sync --workspace=mobile",
  "mobile:build": "npm run build --workspace=mobile",
  "mobile:apk": "npm run apk --workspace=mobile"
}
```

- [ ] **Step 4: Install dependencies and initialize Android project**

```bash
cd mobile && npm install
npx cap add android
```

Expected: Creates `mobile/android/` directory with a complete Gradle-based Android project.

- [ ] **Step 5: Add Capacitor types to client**

Install `@capacitor/core` as a devDependency in the client workspace so TypeScript can resolve Capacitor imports when building for all platforms:

```bash
cd client && npm install --save-dev @capacitor/core @capacitor/preferences @capacitor/push-notifications @capacitor/app @capacitor/status-bar
```

- [ ] **Step 6: Verify Android project builds**

```bash
cd mobile/android && ./gradlew assembleDebug
```

Expected: BUILD SUCCESSFUL, produces `.apk` in `app/build/outputs/apk/debug/`.

- [ ] **Step 7: Commit**

```bash
git add mobile/ package.json client/package.json
git commit -m "feat: add mobile/ Capacitor workspace with Android project"
```

---

### Task 2: Platform Detection + Capacitor Utilities

**Files:**
- Create: `client/src/lib/capacitor.ts`
- Modify: `client/src/lib/stores/server.ts`

- [ ] **Step 1: Create client/src/lib/capacitor.ts**

Thin wrapper around Capacitor APIs that safely no-ops when not on a native platform:

```typescript
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const isCapacitor = typeof window !== 'undefined' && Capacitor.isNativePlatform();

export async function getPreference(key: string): Promise<string | null> {
  if (!isCapacitor) return null;
  const { value } = await Preferences.get({ key });
  return value;
}

export async function setPreference(key: string, value: string): Promise<void> {
  if (!isCapacitor) return;
  await Preferences.set({ key, value });
}

export async function removePreference(key: string): Promise<void> {
  if (!isCapacitor) return;
  await Preferences.remove({ key });
}
```

- [ ] **Step 2: Add isCapacitor to stores/server.ts**

Add import and export at the top of `stores/server.ts`:

```typescript
import { isCapacitor, getPreference, setPreference, removePreference } from '../capacitor.js';
```

Re-export `isCapacitor`:

```typescript
export { isCapacitor } from '../capacitor.js';
```

- [ ] **Step 3: Extend loadServerUrlFromStore() for Capacitor**

Currently loads from `electronAPI.storeGet`. Add Capacitor branch:

```typescript
export async function loadServerUrlFromStore() {
  if (isDesktop) {
    const stored = await (window as any).electronAPI.storeGet('serverUrl');
    if (stored) {
      serverUrl.set(stored);
      initialLoadDone = true;
    }
  } else if (isCapacitor) {
    const stored = await getPreference('serverUrl');
    if (stored) {
      serverUrl.set(stored);
      initialLoadDone = true;
    }
  }
}
```

- [ ] **Step 4: Extend serverUrl subscription for Capacitor persistence**

Currently the `serverUrl.subscribe()` block only persists to electron-store. Add Capacitor:

```typescript
serverUrl.subscribe((val) => {
  if (!initialLoadDone || !val) return;
  if (isDesktop) {
    (window as any).electronAPI.storeSet('serverUrl', val);
  } else if (isCapacitor) {
    setPreference('serverUrl', val);
  }
});
```

- [ ] **Step 5: Extend resolveAsset() for Capacitor**

Currently returns path unchanged for non-desktop. On Capacitor, the WebView origin is different from the server, so assets need the full server URL:

```typescript
export function resolveAsset(path: string): string {
  if (!isDesktop && !isCapacitor) return path;
  if (!path || path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = get(serverUrl);
  if (!base) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}
```

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/capacitor.ts client/src/lib/stores/server.ts
git commit -m "feat: add Capacitor platform detection and preference storage"
```

---

### Task 3: Capacitor Auth Token Storage

**Files:**
- Modify: `client/src/lib/stores/server.ts`
- Modify: `client/src/lib/stores/auth.ts`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/lib/ws.ts`

- [ ] **Step 1: Extend token storage functions in server.ts**

Add Capacitor branches to `setDesktopToken`, `loadDesktopTokens`, `getDesktopToken`, `setDesktopCsrf`, `getDesktopCsrf`, `clearDesktopTokens`:

```typescript
export async function setDesktopToken(token: string) {
  desktopToken = token;
  if (isDesktop) {
    await (window as any).electronAPI.storeSet('authToken', token);
  } else if (isCapacitor) {
    await setPreference('authToken', token);
  }
}

export async function setDesktopCsrf(csrf: string) {
  desktopCsrf = csrf;
  if (isDesktop) {
    await (window as any).electronAPI.storeSet('authCsrf', csrf);
  } else if (isCapacitor) {
    await setPreference('authCsrf', csrf);
  }
}

export async function loadDesktopTokens() {
  if (isDesktop) {
    desktopToken = await (window as any).electronAPI.storeGet('authToken');
    desktopCsrf = await (window as any).electronAPI.storeGet('authCsrf');
  } else if (isCapacitor) {
    desktopToken = await getPreference('authToken');
    desktopCsrf = await getPreference('authCsrf');
  }
}

export async function clearDesktopTokens() {
  desktopToken = null;
  desktopCsrf = null;
  if (isDesktop) {
    await (window as any).electronAPI.storeSet('authToken', null);
    await (window as any).electronAPI.storeSet('authCsrf', null);
  } else if (isCapacitor) {
    await removePreference('authToken');
    await removePreference('authCsrf');
  }
}
```

- [ ] **Step 2: Update auth.ts isDesktop guards**

Every `if (isDesktop)` check that stores/loads tokens must also trigger for `isCapacitor`. Add import:

```typescript
import { isCapacitor } from '../capacitor.js';
```

Then update all guards in `checkAuth()`, `login()`, `verifyMfa()`, `changePassword()`, and `logout()`:

```typescript
// Change every instance of:
if (isDesktop) {
// To:
if (isDesktop || isCapacitor) {
```

There are guards at approximately lines 35, 38-43, 86-92, 116-121, 215, 227-232. Check each one.

- [ ] **Step 3: Update api.ts for Capacitor**

Add import:

```typescript
import { isCapacitor } from './capacitor.js';
```

In `getCsrfToken()` — change `if (isDesktop)` to `if (isDesktop || isCapacitor)`.

In `request()` — change the `if (isDesktop)` check that adds the Bearer token (line ~27) to `if (isDesktop || isCapacitor)`. Also change the 401 session expiry check (line ~55) to `if (isDesktop || isCapacitor)`.

In `upload()` — same pattern: change `if (isDesktop)` guards to `if (isDesktop || isCapacitor)`.

- [ ] **Step 4: Update ws.ts for Capacitor**

Add import:

```typescript
import { isCapacitor } from './capacitor.js';
```

In `getWsUrl()` — change the `if (isDesktop)` check that appends `?token=` to `if (isDesktop || isCapacitor)`. Also update the 4001 session expiry check if present.

- [ ] **Step 5: Verify no remaining isDesktop-only token checks**

Search for any remaining `isDesktop` checks in auth-related code that should also include `isCapacitor`:

```bash
grep -n 'isDesktop' client/src/lib/stores/auth.ts client/src/lib/api.ts client/src/lib/ws.ts
```

Each match should now be `isDesktop || isCapacitor` unless it's a truly desktop-only feature (like window controls).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/stores/server.ts client/src/lib/stores/auth.ts client/src/lib/api.ts client/src/lib/ws.ts
git commit -m "feat: add Capacitor auth token storage alongside Electron"
```

---

### Task 4: Server Instance Selector Component

**Files:**
- Create: `client/src/lib/components/ServerSelector.svelte`
- Modify: `client/src/routes/+layout.svelte`

- [ ] **Step 1: Create ServerSelector.svelte**

Shown on first launch when no server URL is stored. Two options: official instance card and custom URL input.

```svelte
<script lang="ts">
  import { serverUrl } from '$lib/stores/server';

  let customUrl = $state('');
  let error = $state('');

  function connectOfficial() {
    serverUrl.set('https://chat.sellserv.net');
  }

  function connectCustom() {
    let url = customUrl.trim();
    if (!url) {
      error = 'Please enter a server URL';
      return;
    }
    // Add https:// if no protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    // Validate URL
    try {
      new URL(url);
    } catch {
      error = 'Invalid URL';
      return;
    }
    // Remove trailing slash
    url = url.replace(/\/+$/, '');
    error = '';
    serverUrl.set(url);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') connectCustom();
  }
</script>

<div class="selector-container">
  <div class="selector-card">
    <div class="logo">
      <img src="/icon-512x512.png" alt="SellServ Voice" class="logo-img" />
    </div>
    <h1 class="title">SellServ Voice</h1>

    <button class="instance-option official" onclick={connectOfficial}>
      <div class="instance-icon official-icon">&#10022;</div>
      <div class="instance-info">
        <div class="instance-name">Official Instance</div>
        <div class="instance-url">chat.sellserv.net</div>
      </div>
      <span class="connect-arrow">CONNECT &rarr;</span>
    </button>

    <div class="divider">
      <span class="divider-line"></span>
      <span class="divider-text">or connect to</span>
      <span class="divider-line"></span>
    </div>

    <div class="custom-input-row">
      <input
        type="text"
        class="custom-url-input"
        placeholder="https://your-server.com"
        bind:value={customUrl}
        onkeydown={handleKeydown}
      />
      <button class="join-btn" onclick={connectCustom}>Join</button>
    </div>

    {#if error}
      <div class="error-text">{error}</div>
    {/if}
  </div>
</div>

<style>
  .selector-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-dark, #08080f);
    padding: 1rem;
  }

  .selector-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.2rem;
    max-width: 400px;
    width: 100%;
  }

  .logo-img {
    width: 64px;
    height: 64px;
    border-radius: 16px;
  }

  .title {
    color: var(--text-primary, #fff);
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0;
  }

  .instance-option {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    padding: 1rem 1.2rem;
    border-radius: 10px;
    cursor: pointer;
    border: 2px solid var(--accent, #7289da);
    background: var(--bg-mid, #1a1a2e);
    text-align: left;
    color: inherit;
    font: inherit;
  }

  .instance-option:hover {
    background: var(--bg-light, #222240);
  }

  .instance-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    flex-shrink: 0;
  }

  .official-icon {
    background: linear-gradient(135deg, #43b581, #3ca374);
    color: white;
  }

  .instance-info {
    flex: 1;
  }

  .instance-name {
    color: var(--text-primary, #fff);
    font-weight: 600;
    font-size: 0.9rem;
  }

  .instance-url {
    color: var(--text-muted, #888);
    font-size: 0.75rem;
  }

  .connect-arrow {
    color: var(--accent, #7289da);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
  }

  .divider-line {
    flex: 1;
    height: 1px;
    background: var(--border, #333);
  }

  .divider-text {
    color: var(--text-muted, #666);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .custom-input-row {
    display: flex;
    gap: 0.5rem;
    width: 100%;
  }

  .custom-url-input {
    flex: 1;
    background: var(--bg-input, #12121f);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    padding: 0.7rem 1rem;
    color: var(--text-primary, #fff);
    font-size: 0.85rem;
    outline: none;
  }

  .custom-url-input:focus {
    border-color: var(--accent, #7289da);
  }

  .join-btn {
    background: var(--accent, #7289da);
    border: none;
    border-radius: 8px;
    padding: 0.7rem 1rem;
    color: white;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .join-btn:hover {
    opacity: 0.9;
  }

  .error-text {
    color: var(--error, #e74c3c);
    font-size: 0.8rem;
  }
</style>
```

- [ ] **Step 2: Show ServerSelector in +layout.svelte**

In `+layout.svelte`, import the new component and `isCapacitor`:

```typescript
import ServerSelector from '$lib/components/ServerSelector.svelte';
import { isCapacitor } from '$lib/capacitor.js';
```

Add a derived check for whether the server selector should show. This should come before the login page check — if no server URL is set on a native platform, show the selector:

```svelte
{#if (isDesktop || isCapacitor) && !$serverUrl}
  <ServerSelector />
{:else if !$currentUser}
  <LoginPage />
{:else}
  <!-- main app -->
{/if}
```

- [ ] **Step 3: Test on web (should not show selector)**

```bash
npm run dev:client
```

Visit `http://localhost:5173` — the login page should appear as normal. The ServerSelector should NOT be visible since `isDesktop` and `isCapacitor` are both false in the browser.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/components/ServerSelector.svelte client/src/routes/+layout.svelte
git commit -m "feat: add server instance selector for desktop and mobile"
```

---

### Task 5: Server Settings Tab

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte`

- [ ] **Step 1: Add "Server" tab to sidebar**

In SettingsModal.svelte, add a "Server" tab button in the App Settings section. This should be conditional on `isDesktop || isCapacitor` (only native apps need it — web users are already on the server):

```typescript
import { isCapacitor } from '$lib/capacitor.js';
```

Add the tab button alongside the existing desktop/game-activity tabs:

```svelte
{#if isDesktop || isCapacitor}
  <button class:active={activeTab === 'server-connection'} onclick={() => activeTab = 'server-connection'}>
    Server
  </button>
{/if}
```

- [ ] **Step 2: Add server tab content**

Add the content panel for the server tab. Shows the current connected server URL with an option to disconnect and return to the selector:

```svelte
{:else if activeTab === 'server-connection'}
  <div class="settings-content">
    <h2>Server Connection</h2>
    <div class="setting-group">
      <label class="setting-label">Connected to</label>
      <div class="server-url-display">{$serverUrl}</div>
      <button class="btn-danger" onclick={() => {
        serverUrl.set('');
        if (isDesktop) {
          (window as any).electronAPI.storeSet('serverUrl', null);
        }
        // Capacitor handled by serverUrl subscription
      }}>
        Disconnect & Choose Another Server
      </button>
      <p class="setting-note">This will sign you out and return to the server selector.</p>
    </div>
  </div>
```

- [ ] **Step 3: Add CSS for server URL display**

```css
.server-url-display {
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.6rem 1rem;
  color: var(--text-primary);
  font-family: monospace;
  font-size: 0.85rem;
  margin-bottom: 1rem;
  word-break: break-all;
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte
git commit -m "feat: add Server settings tab for changing connected instance"
```

---

### Task 6: Electron Server Selector Integration

**Files:**
- Modify: `desktop/main.js`

- [ ] **Step 1: Update Electron to show selector on first launch**

The Electron app currently loads a hardcoded URL. The server URL is already stored via electron-store and the web app's `loadServerUrlFromStore()` handles loading it. The ServerSelector component (Task 4) will show automatically when `$serverUrl` is empty.

No changes needed in `main.js` for the selector itself — it works through the web layer. But verify the Electron dev URL still works as a fallback. In dev mode, the app should always load `http://localhost:5173` (the Vite dev server), which will then show the selector if no server URL is stored.

In production mode, the local HTTP server serves the static build, which also contains the selector.

- [ ] **Step 2: Test Electron shows selector**

```bash
npm run desktop:dev
```

If `serverUrl` has never been stored in electron-store, the selector should appear. After selecting, it should save and show the login page on next launch.

- [ ] **Step 3: Commit (if changes needed)**

Only commit if `main.js` required changes.

---

### Task 7: Mobile UI Adjustments

**Files:**
- Modify: `client/src/app.css`
- Modify: `client/src/app.html`

- [ ] **Step 1: Add safe area insets to app.css**

Add safe area padding for notch/gesture bar. These CSS env() values are 0 on devices without notches, so they're safe to add globally:

```css
/* Mobile safe area insets */
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

- [ ] **Step 2: Verify viewport meta in app.html**

The existing `app.html` should already have:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

Add `viewport-fit=cover` for proper safe area handling on devices with notches:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

- [ ] **Step 3: Add status bar and back button handling**

In `+layout.svelte`, add Capacitor-specific initialization:

```typescript
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
```

In the `onMount` or `$effect`:

```typescript
if (isCapacitor) {
  // Dark status bar to match app theme
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#08080f' }).catch(() => {});

  // Android back button — navigate within app instead of closing
  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    }
    // Don't exit app — let user use the normal close flow
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/app.css client/src/app.html client/src/routes/+layout.svelte
git commit -m "feat: mobile UI adjustments — safe area insets, status bar, back button"
```

---

### Task 8: Build and Test Android APK

**Files:**
- No new files — integration test of Tasks 1-7

- [ ] **Step 1: Build the client**

```bash
npm run build
```

Expected: SvelteKit builds to `client/build/`.

- [ ] **Step 2: Sync to Android project**

```bash
cd mobile && npx cap sync android
```

Expected: Copies `client/build/` contents into the Android project's assets.

- [ ] **Step 3: Build debug APK**

```bash
cd mobile/android && ./gradlew assembleDebug
```

Expected: BUILD SUCCESSFUL, APK at `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 4: Test on device or emulator**

Install the APK on an Android device or emulator:

```bash
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Verify:
1. Server selector appears on first launch
2. Tapping "Official Instance" saves the URL and shows login
3. Login works with Bearer token auth
4. Text chat, member list, and settings all function
5. Status bar is dark, safe areas are respected
6. Android back button navigates within the app

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: Android build and integration fixes"
```

---

### Task 9: Push Notifications — Server Infrastructure

**Files:**
- Create: `server/src/db/migrations/device_tokens.ts`
- Create: `server/src/push/index.ts`
- Create: `server/src/routes/push.ts`
- Modify: `server/src/db/schema.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add Firebase config to server/src/config.ts**

```typescript
firebase: {
  serviceAccount: env('FIREBASE_SERVICE_ACCOUNT', ''),
},
```

- [ ] **Step 2: Create device_tokens migration**

Create `server/src/db/migrations/device_tokens.ts`:

```typescript
import db from '../connection.js';

export function migrateDeviceTokens() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL DEFAULT 'android',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
  `);
}
```

- [ ] **Step 3: Run migration from schema.ts**

In `server/src/db/schema.ts`, import and call the migration at the end of `initSchema()`:

```typescript
import { migrateDeviceTokens } from './migrations/device_tokens.js';

// At end of initSchema():
migrateDeviceTokens();
```

- [ ] **Step 4: Create server/src/push/index.ts**

FCM push sender module:

```typescript
import admin from 'firebase-admin';
import { config } from '../config.js';
import db from '../db/connection.js';

let firebaseApp: admin.app.App | null = null;

function getFirebase(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;
  if (!config.firebase.serviceAccount) return null;

  try {
    const serviceAccount = JSON.parse(config.firebase.serviceAccount);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return firebaseApp;
  } catch (err) {
    console.error('Failed to initialize Firebase:', err);
    return null;
  }
}

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const fb = getFirebase();
  if (!fb) return;

  const tokens = db.prepare(
    'SELECT token FROM device_tokens WHERE user_id = ?',
  ).all(userId) as { token: string }[];

  if (tokens.length === 0) return;

  const messaging = fb.messaging();
  const results = await Promise.allSettled(
    tokens.map((t) =>
      messaging.send({
        token: t.token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'sellserv_messages',
            sound: 'default',
          },
        },
      }),
    ),
  );

  // Remove invalid tokens
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      const err = result.reason;
      if (
        err?.code === 'messaging/registration-token-not-registered' ||
        err?.code === 'messaging/invalid-registration-token'
      ) {
        db.prepare('DELETE FROM device_tokens WHERE token = ?').run(tokens[i].token);
      }
    }
  }
}

export function isFirebaseConfigured(): boolean {
  return !!config.firebase.serviceAccount;
}
```

- [ ] **Step 5: Create server/src/routes/push.ts**

Device token registration routes:

```typescript
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { requireAuth } from '../auth/middleware.js';

export default async function pushRoutes(app: FastifyInstance) {
  // Register device token
  app.post(
    '/api/push/register',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { token, platform } = request.body as { token: string; platform?: string };
      const userId = request.user.userId;

      if (!token) {
        return reply.code(400).send({ error: 'Token required' });
      }

      // Upsert: if token exists for different user, reassign it
      db.prepare('DELETE FROM device_tokens WHERE token = ?').run(token);
      db.prepare(
        'INSERT INTO device_tokens (id, user_id, token, platform) VALUES (?, ?, ?, ?)',
      ).run(randomUUID(), userId, token, platform || 'android');

      return { ok: true };
    },
  );

  // Unregister device token (on logout)
  // Uses POST instead of DELETE because the client's api.delete doesn't support a request body
  app.post(
    '/api/push/unregister',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      const userId = request.user.userId;

      if (!token) {
        return reply.code(400).send({ error: 'Token required' });
      }

      db.prepare(
        'DELETE FROM device_tokens WHERE user_id = ? AND token = ?',
      ).run(userId, token);

      return { ok: true };
    },
  );
}
```

- [ ] **Step 6: Register push routes in server/src/index.ts**

```typescript
import pushRoutes from './routes/push.js';

// After other route registrations:
await app.register(pushRoutes);
```

- [ ] **Step 7: Install firebase-admin**

```bash
cd server && npm install firebase-admin
```

- [ ] **Step 8: Verify server starts**

```bash
npm run dev:server
```

Expected: Server starts without errors. If `FIREBASE_SERVICE_ACCOUNT` is not set, push functions silently no-op.

- [ ] **Step 9: Commit**

```bash
git add server/src/db/migrations/device_tokens.ts server/src/push/index.ts server/src/routes/push.ts server/src/db/schema.ts server/src/config.ts server/src/index.ts server/package.json
git commit -m "feat: push notification server infrastructure — FCM sender, device token routes"
```

---

### Task 10: Push Notification Triggers

**Files:**
- Modify: `server/src/routes/messages.ts`
- Modify: `server/src/ws/index.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Track active WebSocket connections by userId**

In `server/src/ws/index.ts`, export a function to check if a user has an active WebSocket connection:

```typescript
export function isUserOnline(userId: string): boolean {
  // Check if userId has any active WebSocket clients
  for (const client of clients.values()) {
    if (client.userId === userId) return true;
  }
  return false;
}
```

If `clients` is not already a Map, adapt to however clients are tracked. The key point is: don't send push notifications to users who have an active WebSocket (they'll get real-time events).

- [ ] **Step 2: Trigger push on DM messages**

In `server/src/routes/messages.ts`, after a DM message is created and broadcast via WebSocket, check if the recipient is offline and send a push:

```typescript
import { sendPushToUser } from '../push/index.js';
import { isUserOnline } from '../ws/index.js';

// After broadcasting the DM message:
if (!isUserOnline(recipientUserId)) {
  sendPushToUser(recipientUserId, {
    title: senderUsername,
    body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
    data: {
      type: 'dm',
      channelId: channel.id,
      senderId: senderUserId,
    },
  }).catch((err) => app.log.error('Push notification failed:', err));
}
```

- [ ] **Step 3: Trigger push on @mentions**

In the same message creation handler, after parsing mentions (if mention parsing exists), send push to each mentioned user who is offline:

The app uses rich mention format `<@userId>` (not `@username`). Parse accordingly:

```typescript
// After message creation, check for mentions:
const mentionRegex = /<@([^>]+)>/g;
let match;
while ((match = mentionRegex.exec(messageContent)) !== null) {
  const mentionedUserId = match[1];

  if (mentionedUserId !== senderUserId && !isUserOnline(mentionedUserId)) {
    sendPushToUser(mentionedUserId, {
      title: `${senderUsername} mentioned you`,
      body: messageContent.length > 100 ? messageContent.substring(0, 100) + '...' : messageContent,
      data: {
        type: 'mention',
        channelId: channel.id,
        serverId: channel.server_id || '',
      },
    }).catch((err) => app.log.error('Push notification failed:', err));
  }
}
```

- [ ] **Step 4: Trigger push on missed calls**

In the voice join handler (WebSocket `voice:join` event in `server/src/ws/handlers.ts`), when a user joins a voice channel, check if any users who were recently in that channel (left within the last 5 minutes) are now offline, and notify them:

```typescript
import { sendPushToUser } from '../push/index.js';

// After a user successfully joins a voice channel:
// Check for users who recently left this channel (within 5 minutes)
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
// This requires tracking "last left voice" per user/channel — add a simple
// in-memory Map<string, { userId: string; leftAt: number }[]> keyed by channelId.
// When a user leaves voice, record { userId, leftAt: Date.now() }.
// When a user joins voice, check the map for recent departures and push to offline users.

const recentlyLeft = voiceChannelDepartures.get(channelId) || [];
for (const departure of recentlyLeft) {
  if (departure.leftAt > Date.now() - 5 * 60 * 1000 &&
      departure.userId !== joiningUserId &&
      !isUserOnline(departure.userId)) {
    const channelName = getChannelName(channelId); // look up from DB
    sendPushToUser(departure.userId, {
      title: 'Missed Call',
      body: `${joiningUsername} joined #${channelName}`,
      data: {
        type: 'missed_call',
        channelId,
        serverId: serverId || '',
      },
    }).catch(() => {});
  }
}
```

Also add departure tracking in the `voice:leave` handler:

```typescript
// In-memory store at module level:
const voiceChannelDepartures = new Map<string, { userId: string; leftAt: number }[]>();

// In voice:leave handler:
const departures = voiceChannelDepartures.get(channelId) || [];
departures.push({ userId: leavingUserId, leftAt: Date.now() });
// Keep only last 5 minutes of departures
voiceChannelDepartures.set(
  channelId,
  departures.filter((d) => d.leftAt > Date.now() - 5 * 60 * 1000),
);
```

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/messages.ts server/src/ws/index.ts server/src/ws/handlers.ts shared/types.ts
git commit -m "feat: trigger push notifications on DMs, @mentions, and missed calls"
```

---

### Task 11: Push Notifications — Client Registration

**Files:**
- Modify: `client/src/lib/capacitor.ts`
- Modify: `client/src/routes/+layout.svelte`
- Modify: `client/src/lib/stores/auth.ts`

- [ ] **Step 1: Add push notification functions to capacitor.ts**

```typescript
import { PushNotifications } from '@capacitor/push-notifications';

let pushToken: string | null = null;

export async function initPushNotifications(): Promise<void> {
  if (!isCapacitor) return;

  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') return;

  PushNotifications.addListener('registration', async (token) => {
    pushToken = token.value;
    // Register with server
    try {
      const { default: api } = await import('./api.js');
      await api.post('/api/push/register', { token: token.value, platform: 'android' });
    } catch (err) {
      console.error('Failed to register push token:', err);
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.error('Push registration error:', err);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // App is in foreground — suppress (WebSocket handles it)
    console.log('Push received in foreground (suppressed):', notification);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // User tapped notification — navigate to relevant channel
    const data = action.notification.data;
    if (data?.channelId) {
      // Navigation will be handled by the app's routing
      console.log('Push tapped, channel:', data.channelId);
    }
  });

  await PushNotifications.register();
}

export async function unregisterPush(): Promise<void> {
  if (!isCapacitor || !pushToken) return;
  try {
    const { default: api } = await import('./api.js');
    // Use POST to a dedicated unregister endpoint since api.delete doesn't accept a body
    await api.post('/api/push/unregister', { token: pushToken });
  } catch (err) {
    console.error('Failed to unregister push token:', err);
  }
  pushToken = null;
}
```

- [ ] **Step 2: Initialize push after login in +layout.svelte**

After the user is authenticated (after `checkAuth` succeeds), initialize push:

```typescript
import { initPushNotifications } from '$lib/capacitor.js';

// After successful auth check:
if (isCapacitor) {
  initPushNotifications();
}
```

- [ ] **Step 3: Unregister push on logout**

In `auth.ts`, before clearing tokens in `logout()`:

```typescript
import { unregisterPush } from '../capacitor.js';

// In logout():
await unregisterPush();
```

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/capacitor.ts client/src/routes/+layout.svelte client/src/lib/stores/auth.ts
git commit -m "feat: client push notification registration and lifecycle"
```

---

### Task 12: Background Audio Service — Android Plugin

**Files:**
- Create: `mobile/src/backgroundaudio/BackgroundAudioPlugin.java`
- Create: `mobile/src/backgroundaudio/BackgroundAudioService.java`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Create the Foreground Service**

Create `mobile/android/app/src/main/java/net/sellserv/voice/BackgroundAudioService.java`:

```java
package net.sellserv.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class BackgroundAudioService extends Service {
    private static final String CHANNEL_ID = "sellserv_voice";
    private static final int NOTIFICATION_ID = 1;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String channelName = intent != null ? intent.getStringExtra("channelName") : "a voice channel";
        if (channelName == null) channelName = "a voice channel";

        Intent notificationIntent = new Intent(this, getMainActivityClass());
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SellServ Voice")
            .setContentText("In voice: #" + channelName)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build();

        startForeground(NOTIFICATION_ID, notification);

        // Acquire wake lock to prevent CPU sleep during voice
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SellServ::VoiceWakeLock");
        wakeLock.acquire();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Voice Channel",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows when you are in a voice channel");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Class<?> getMainActivityClass() {
        try {
            return Class.forName("net.sellserv.voice.MainActivity");
        } catch (ClassNotFoundException e) {
            return null;
        }
    }
}
```

- [ ] **Step 2: Create the Capacitor Plugin**

Create `mobile/android/app/src/main/java/net/sellserv/voice/BackgroundAudioPlugin.java`:

```java
package net.sellserv.voice;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String channelName = call.getString("channel", "a voice channel");
        Intent intent = new Intent(getContext(), BackgroundAudioService.class);
        intent.putExtra("channelName", channelName);
        getContext().startForegroundService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundAudioService.class);
        getContext().stopService(intent);
        call.resolve();
    }
}
```

- [ ] **Step 3: Register plugin in MainActivity**

In `mobile/android/app/src/main/java/net/sellserv/voice/MainActivity.java`, register the plugin:

```java
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 4: Update AndroidManifest.xml**

Add the service declaration and required permissions:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- Inside <application>: -->
<service
    android:name=".BackgroundAudioService"
    android:foregroundServiceType="mediaPlayback"
    android:exported="false" />
```

- [ ] **Step 5: Commit**

```bash
git add mobile/android/
git commit -m "feat: Android background audio foreground service plugin"
```

---

### Task 13: Background Audio — Client Integration

**Files:**
- Modify: `client/src/lib/capacitor.ts`
- Modify: `client/src/lib/webrtc.ts`

- [ ] **Step 1: Add BackgroundAudio wrapper to capacitor.ts**

```typescript
import { registerPlugin } from '@capacitor/core';

interface BackgroundAudioPlugin {
  start(options: { channel: string }): Promise<void>;
  stop(): Promise<void>;
}

const BackgroundAudio = registerPlugin<BackgroundAudioPlugin>('BackgroundAudio');

export async function startBackgroundAudio(channelName: string): Promise<void> {
  if (!isCapacitor) return;
  try {
    await BackgroundAudio.start({ channel: channelName });
  } catch (err) {
    console.error('Failed to start background audio:', err);
  }
}

export async function stopBackgroundAudio(): Promise<void> {
  if (!isCapacitor) return;
  try {
    await BackgroundAudio.stop();
  } catch (err) {
    console.error('Failed to stop background audio:', err);
  }
}
```

- [ ] **Step 2: Start background audio on voice join**

In `client/src/lib/webrtc.ts`, at the end of `joinVoice()` (after successful connection):

```typescript
import { startBackgroundAudio } from './capacitor.js';

// At end of joinVoice(), after setupVoiceMode():
startBackgroundAudio(channelName);
```

Where `channelName` is the name of the voice channel being joined. This may need to be looked up from the channels store using the `channelId` parameter.

- [ ] **Step 3: Stop background audio on voice leave**

In `leaveVoice()`, near the beginning:

```typescript
import { stopBackgroundAudio } from './capacitor.js';

// At start of leaveVoice():
stopBackgroundAudio();
```

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/capacitor.ts client/src/lib/webrtc.ts
git commit -m "feat: start/stop background audio service on voice join/leave"
```

---

### Task 14: Firebase Setup + Final Android Build

**Files:**
- Modify: `mobile/android/app/build.gradle`
- Modify: `mobile/android/build.gradle`

- [ ] **Step 1: Add Firebase dependencies to Android project**

In `mobile/android/build.gradle` (project-level), add the Google services classpath:

```groovy
buildscript {
    dependencies {
        classpath 'com.google.gms:google-services:4.4.0'
    }
}
```

In `mobile/android/app/build.gradle` (app-level), add:

```groovy
apply plugin: 'com.google.gms.google-services'

dependencies {
    implementation platform('com.google.firebase:firebase-bom:32.7.0')
    implementation 'com.google.firebase:firebase-messaging'
}
```

- [ ] **Step 2: Add google-services.json placeholder**

The user needs to create a Firebase project and download `google-services.json` to `mobile/android/app/`. Add a note in the mobile README or a placeholder:

Create `mobile/SETUP.md`:

```markdown
# Mobile App Setup

## Firebase (Push Notifications)

1. Create a Firebase project at https://console.firebase.google.com
2. Add an Android app with package name `net.sellserv.voice`
3. Download `google-services.json` and place it in `mobile/android/app/`
4. Get the Firebase Admin SDK service account JSON from Project Settings > Service Accounts
5. Set the `FIREBASE_SERVICE_ACCOUNT` env var on your server (paste the full JSON string)

## Building

```bash
npm run build                    # Build SvelteKit
cd mobile && npx cap sync       # Sync to Android
cd android && ./gradlew assembleDebug  # Build APK
```

APK output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Installing on Device

```bash
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
```

- [ ] **Step 3: Add .gitignore entries**

Add to `mobile/.gitignore`:

```
android/app/google-services.json
node_modules/
```

Add to root `.gitignore` if not already present:

```
.superpowers/
```

- [ ] **Step 4: Full build and test**

```bash
npm run build
cd mobile && npx cap sync android
cd android && ./gradlew assembleDebug
```

Install and verify:
1. Server selector works
2. Login and chat work
3. Voice channel join/leave works
4. Background audio keeps voice alive when app is backgrounded
5. Push notifications arrive when app is backgrounded (requires Firebase setup)

- [ ] **Step 5: Commit**

```bash
git add mobile/ .gitignore
git commit -m "feat: Firebase setup, mobile build docs, and final Android integration"
```

---

### Task 15: Hide Desktop-Only Features on Mobile

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte`
- Modify: `client/src/routes/+layout.svelte`

- [ ] **Step 1: Hide game activity and desktop settings tabs on mobile**

In `SettingsModal.svelte`, the "Game Activity" and "Desktop" tabs are already gated behind `{#if isDesktop}`. Verify they don't show on Capacitor (they shouldn't since `isDesktop` is false on Capacitor).

If any desktop-only UI (like the title bar controls in `TitleBar.svelte`) is showing on mobile, add `isCapacitor` exclusions.

- [ ] **Step 2: Hide PTT-specific settings on mobile**

In voice settings, if there are push-to-talk keybind options that reference `electronAPI.configurePtt`, these should be hidden when `isCapacitor` is true (mobile has no global hotkeys). The fallback DOM-based PTT should still work for in-app press-and-hold.

- [ ] **Step 3: Hide auto-updater on mobile**

In `+layout.svelte`, the updater check (`checkForUpdates`) should only run when `isDesktop`:

```typescript
if (isDesktop) {
  checkForUpdates();
}
```

Verify this is already the case — if it checks `window.electronAPI`, it's safe.

- [ ] **Step 4: Commit (if changes needed)**

```bash
git add client/src/lib/components/SettingsModal.svelte client/src/routes/+layout.svelte
git commit -m "feat: hide desktop-only features on mobile platform"
```
