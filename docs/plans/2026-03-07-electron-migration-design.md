# Electron Migration Design

## Overview

Replace the Tauri desktop shell with Electron to get full WebRTC support on all platforms (Linux, macOS, Windows). Tauri's reliance on system webviews (WebKitGTK on Linux, WKWebView on macOS) means RTCPeerConnection is unavailable on many installs, breaking voice chat entirely.

Electron bundles Chromium, which has full WebRTC support built in.

## Approach

Electron with electron-builder for packaging and electron-updater for auto-updates via GitHub Releases. Full replacement of Tauri — no dual maintenance.

## Project Structure

```
desktop/
├── package.json          # Electron deps, electron-builder config, scripts
├── main.js               # Main process (tray, window, IPC, autostart)
├── preload.js            # Context bridge — exposes native APIs to renderer
├── icons/                # Reuse existing icons from src-tauri/icons/
└── build/                # electron-builder resources (installer assets)
```

Frontend stays at `client/`. Electron loads `client/build/index.html` in production, `http://localhost:5173` in development.

## Native Feature Mapping

| Feature               | Tauri (current)                        | Electron (new)                                |
| --------------------- | -------------------------------------- | --------------------------------------------- |
| System tray           | `tauri::tray::TrayIconBuilder`         | `Tray` + `Menu` from `electron`               |
| Close to tray         | Window close event + `prevent_close()` | `win.on('close')` + `win.hide()`              |
| Autostart             | `tauri-plugin-autostart`               | `app.setLoginItemSettings()` (built-in)       |
| Auto-updater          | `tauri-plugin-updater`                 | `electron-updater` (GitHub Releases)          |
| Window state          | `tauri-plugin-window-state`            | `electron-window-state` package               |
| Custom title bar      | `decorations: false`                   | `frame: false` in `BrowserWindow`             |
| Notifications         | `tauri-plugin-notification`            | `Notification` from `electron` (built-in)     |
| Idle detection        | Custom Rust cmd + `user-idle` crate    | `powerMonitor.getSystemIdleTime()` (built-in) |
| Settings store        | `tauri-plugin-store`                   | `electron-store` package                      |
| HTTP client           | `tauri-plugin-http`                    | Not needed — Chromium `fetch` works           |
| OS platform           | `tauri-plugin-os`                      | `process.platform` (built-in)                 |
| Process relaunch      | `tauri-plugin-process`                 | `app.relaunch()` (built-in)                   |
| Open URLs             | `tauri-plugin-opener`                  | `shell.openExternal()` (built-in)             |
| Window controls       | `@tauri-apps/api/window`               | IPC to main process                           |
| WebKitGTK media perms | Custom Rust permission handler         | Not needed                                    |

External packages needed: `electron-updater`, `electron-window-state`, `electron-store`.

## Frontend Integration Layer

A preload script exposes `window.electronAPI` with methods for window controls, app info, settings store, autostart, idle detection, notifications, updater, and shell operations.

The `isDesktop` check changes from `window.__TAURI_INTERNALS__` to `!!window.electronAPI`.

### Files that change

| File                   | Change                                                            |
| ---------------------- | ----------------------------------------------------------------- |
| `TitleBar.svelte`      | `@tauri-apps/api/window` → `window.electronAPI.*`                 |
| `SettingsModal.svelte` | `@tauri-apps/plugin-autostart/store/app` → `window.electronAPI.*` |
| `updater.ts`           | `@tauri-apps/plugin-updater/os/process` → `window.electronAPI.*`  |
| `notifications.ts`     | `@tauri-apps/plugin-notification` → `window.electronAPI.*`        |
| `idleDetector.ts`      | `@tauri-apps/api/core` invoke → `window.electronAPI.*`            |
| `api.ts`               | Remove `@tauri-apps/plugin-http` — use `fetch` everywhere         |
| `ServerConnect.svelte` | Remove `@tauri-apps/plugin-http` — use `fetch`                    |

## Auto-Updater

- **Windows:** Auto-download, install, and relaunch via `electron-updater` + GitHub Releases.
- **Linux & macOS:** Show persistent toast directing users to download from the website.

## Packaging & Distribution

electron-builder targets:

| Platform | Target   | Format      |
| -------- | -------- | ----------- |
| Windows  | NSIS     | `.exe`      |
| Linux    | deb      | `.deb`      |
| Linux    | AppImage | `.AppImage` |
| Linux    | pacman   | `.pacman`   |
| macOS    | DMG      | `.dmg`      |

Build scripts: `dev`, `build`, `build:win`, `build:linux`, `build:mac`.

## Cleanup

- Remove `desktop/src-tauri/` entirely
- Remove all `@tauri-apps/*` dependencies from `client/package.json`
