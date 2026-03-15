# Desktop App Improvements Design

## 1. System-Wide Idle Detection (Tauri)

**Problem:** Current idle detection uses the browser `IdleDetector` API (Chrome-only) with a fallback to document-level events (mousemove, keydown, etc). The fallback only detects activity _within the app window_, not system-wide. On desktop, if the user is active in another app, they'll still appear idle.

**Solution:** Use `tauri-plugin-global-shortcut` or a polling approach via Tauri to detect system-wide input. However, Tauri doesn't have a built-in idle detection plugin. The best approach:

- Keep the existing `IdleDetector` API path (works in WebKitGTK on some systems)
- Add a Tauri-specific backend command that checks system idle time using OS APIs
- Poll from the frontend every 30 seconds
- Rust side: use `user_idle` crate which works on Windows, macOS, and Linux

## 2. Window State Persistence

**Problem:** Window size/position resets every launch.

**Solution:** Use `tauri-plugin-window-state` which automatically saves and restores window geometry. One line plugin registration + one Cargo dependency.

## 3. Soundboard URL Resolution

**Problem:** `new Audio(event.soundUrl)` in `+layout.svelte` uses the raw URL from the WS event. On desktop, relative URLs like `/uploads/sounds/x.mp3` won't resolve.

**Solution:** Wrap `event.soundUrl` with `resolveAsset()` from the server store, same pattern as the avatar/icon fix.

## 4. Desktop Notifications

**Problem:** Browser `Notification` API may not work reliably in Tauri's WebView.

**Solution:** Use `tauri-plugin-notification` for native OS notifications on desktop, keep browser Notifications for web.

## 5. Global Push-to-Talk

**Problem:** PTT key only works when the app window is focused.

**Solution:** Use `tauri-plugin-global-shortcut` to register the PTT key as a global hotkey. When pressed/released, trigger the same PTT logic regardless of which app is focused.

## 6. Keyboard Shortcuts

**Problem:** Only Ctrl+K (quick switcher) exists. Common actions lack shortcuts.

**Solution:** Add global keyboard shortcuts:

- `Ctrl+Shift+M` — toggle mute
- `Ctrl+Shift+D` — toggle deafen
- `Ctrl+Shift+E` — disconnect from voice

## Implementation Order

1. Window state persistence (simplest, immediate UX win)
2. Soundboard URL fix (bug fix)
3. System-wide idle detection (core feature request)
4. Desktop notifications (reliability improvement)
5. Keyboard shortcuts (UX improvement)
6. Global PTT (complex but high value)
