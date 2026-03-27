# SellServ Voice — Android App Design

## Overview

Sideloadable Android app for SellServ Voice using Capacitor. Wraps the existing SvelteKit web app in a native Android shell with push notifications and background audio support.

## Goals

- Full feature parity with the web app (text chat, voice, WebRTC, file uploads, settings)
- Push notifications for DMs, @mentions, and missed calls
- Background audio so voice stays connected when the app is backgrounded
- Configurable server URL on first launch (saved to device storage)
- Sideloadable .apk — no Play Store listing yet

## Architecture

```
┌─────────────────────────────────┐
│       Android Shell             │
│       (Capacitor WebView)       │
│                                 │
│  ┌───────────────────────────┐  │
│  │   SvelteKit App           │  │
│  │   (same web codebase)     │  │
│  └──────────┬────────────────┘  │
│             │                   │
│  ┌──────────┴────────────────┐  │
│  │  Capacitor Plugins        │  │
│  │  - Push Notifications     │  │
│  │  - Preferences (storage)  │  │
│  │  - Background Audio Svc   │  │
│  └───────────────────────────┘  │
└────────────────┬────────────────┘
                 │ HTTPS / WSS
                 ▼
┌─────────────────────────────────┐
│  SellServ Server (Fastify)      │
│  - REST API                     │
│  - WebSocket                    │
│  - mediasoup (WebRTC SFU)       │
│  - FCM push sender              │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│  Firebase Cloud Messaging       │
│  (delivers push to device)      │
└─────────────────────────────────┘
```

The app bundles the SvelteKit static build inside a native Android WebView. All API, WebSocket, and WebRTC connections go to the user-configured server URL.

## Components

### 1. mobile/ Workspace

New npm workspace in the monorepo alongside client, server, desktop, shared.

- `mobile/capacitor.config.ts` — Capacitor configuration pointing to `../client/build`
- `mobile/android/` — Generated Android project (Gradle-based)
- `mobile/src/` — Custom Capacitor plugins (background audio service)
- `mobile/package.json` — Capacitor dependencies

Build flow: `npm run build` (client) → `npx cap sync` (copy to Android) → Gradle build → `.apk`

### 2. Server Instance Selector

Applies to both Desktop (Electron) and Mobile (Capacitor). On first launch, the app shows a server selector screen with two options:

- **Official Instance** — prominent card linking to `chat.sellserv.net`, one click to connect
- **Self-Hosted Instance** — inline URL input field below an "or connect to" divider, with a "Join" button

The selected server URL is saved to persistent storage (Electron Store on desktop, Capacitor Preferences on mobile). On subsequent launches, the app loads directly using the saved URL. The server is changeable later in Settings (new "Server" section visible on both desktop and mobile).

**Client changes — new component + extending existing stores:**

- New `ServerSelector.svelte` component shown before the login page when no server URL is saved
- The client already has URL and token plumbing in `stores/server.ts` (`serverUrl` writable, `getServerUrl()`, `getWsBaseUrl()`) and `api.ts` (`getBase()`), gated behind `isDesktop` checks using `window.electronAPI`. These existing functions need a new `isCapacitor` branch added alongside the `isDesktop` branch:
  - `stores/server.ts`: Add Capacitor Preferences read/write for server URL (parallel to Electron's `storeGet`/`storeSet`)
  - `stores/server.ts`: `getServerUrl()` and `getWsBaseUrl()` already handle desktop — add Capacitor path
  - `api.ts`: `getBase()` already delegates to `getServerUrl()` — no changes needed
  - `ws.ts`: Already uses `getWsBaseUrl()` — no changes needed
- Electron's existing server URL storage (`electronAPI.storeGet`/`storeSet`) is already in place — the selector just needs to be shown on first launch when no URL is stored

### 3. Client Platform Layer

Platform detection adds `isCapacitor` alongside the existing `isDesktop`:

```typescript
import { Capacitor } from '@capacitor/core';
export const isCapacitor = typeof window !== 'undefined' && Capacitor.isNativePlatform();
```

**Auth — extending existing token logic:**

The client already has Bearer token auth for desktop in `stores/server.ts` (`setDesktopToken`, `loadDesktopTokens`, `getDesktopToken`) and `stores/auth.ts`, gated behind `isDesktop` / `window.electronAPI`. These functions need `isCapacitor` branches that use Capacitor Preferences instead of `electronAPI.storeGet`/`storeSet`:

- `setDesktopToken()` → add Capacitor Preferences `.set()` path
- `loadDesktopTokens()` → add Capacitor Preferences `.get()` path
- `getDesktopToken()` → add Capacitor Preferences `.get()` path
- Auth guards in `auth.ts` that check `isDesktop` should also check `isCapacitor`

No cookies — the WebView's cookie jar doesn't reliably work cross-origin.

**Asset URL resolution:**

The existing `resolveAsset()` function in `stores/server.ts` only resolves asset URLs on desktop (`if (!isDesktop) return path`). On Capacitor, the WebView origin is `capacitor://localhost` while assets (avatars, uploads) live on the remote server. `resolveAsset()` must also resolve on Capacitor — prepending the configured server URL to relative asset paths so images/avatars/uploads display correctly.

**Hidden on mobile:**
- Game activity detection (requires desktop OS hooks)
- Global push-to-talk hotkeys (requires uiohook-napi)
- Auto-updater (Electron-only)
- Window title bar controls

### 4. Push Notifications

#### Client side (Capacitor)
- `@capacitor/push-notifications` plugin
- On app start, request notification permission and get device token
- Send token to server via `POST /api/push/register`
- On token refresh, re-register
- Suppress notifications when app is in foreground (WebSocket is already delivering events)

#### Server side
- New `device_tokens` table:
  ```sql
  CREATE TABLE device_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL DEFAULT 'android',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_device_tokens_user ON device_tokens(user_id);
  ```
- New route: `POST /api/push/register` — stores/updates device token for authenticated user
- New route: `DELETE /api/push/register` — removes token on logout
- New module: `server/src/push/index.ts` — sends FCM messages via Firebase Admin SDK (`firebase-admin` npm package)
- Notification triggers:
  - **DM received** — when user has no active WebSocket connection (offline/backgrounded)
  - **@mention** — when mentioned user has no active WebSocket connection
  - **Missed call** — when someone joins a voice channel the user was recently in
- Notification payload includes: sender name, message preview (truncated), channel/server context, deep link data

#### Firebase setup
- Create Firebase project (free)
- Download `google-services.json` → `mobile/android/app/`
- Get Firebase Admin SDK service account key → server env var `FIREBASE_SERVICE_ACCOUNT` (JSON string or file path)

### 5. Background Audio Service

Android kills WebView audio ~30 seconds after the app is backgrounded. A Foreground Service prevents this.

**Custom Capacitor plugin** (`mobile/src/BackgroundAudioPlugin.java`):
- Starts an Android Foreground Service when the user joins a voice channel
- Shows persistent notification: "SellServ Voice — In voice: #channel-name"
- Tap notification returns to the app
- Service stopped when the user leaves voice
- Acquires a partial wake lock to prevent CPU sleep during voice

**Client integration:**
- When joining a voice channel, call `BackgroundAudio.start({ channel: channelName })`
- When leaving voice, call `BackgroundAudio.stop()`
- Only invoked when `isCapacitor` is true

### 6. Mobile UI Adjustments

The web app already has responsive design at 768px breakpoint. Additional mobile tweaks:

- Safe area insets (notch/gesture bar) via CSS `env(safe-area-inset-*)`
- Status bar styling via `@capacitor/status-bar` plugin
- Back button handling — Android hardware back navigates within the app instead of closing it
- Keyboard handling — input fields scroll into view when virtual keyboard opens

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth mechanism | Bearer token in Preferences | Same as Electron; cookies unreliable in WebView cross-origin |
| API routing | Direct fetch to configured URL | No proxy needed; app knows server URL |
| WebRTC | Native WebView support | Android WebView supports WebRTC; no plugin needed |
| Push delivery | Firebase Cloud Messaging | Required for Android; free tier sufficient; also works for iOS later |
| Background voice | Android Foreground Service | Only reliable way to keep audio alive when backgrounded |
| Build output | .apk via Gradle | Sideloadable; .aab for Play Store later |
| Workspace | mobile/ in monorepo | Follows existing pattern (client, server, desktop, shared) |

## Not In Scope

- iOS build (Capacitor supports it — add later with same codebase)
- Play Store listing and signing
- Picture-in-picture for screen share viewing
- Offline mode / message caching
