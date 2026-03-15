# Notification Settings Design

**Goal:** Add user-level global notification defaults and per-server notification overrides, giving users control over desktop notifications, sounds, and per-server muting.

## 1. Database & Storage

### Global User Settings (client-side, localStorage)

Stored via existing `createPersistedStore()` pattern — no DB changes needed:

- `notifyDesktop`: boolean (default `true`) — enable browser notification popups
- `notifySound`: boolean (default `true`) — master sound toggle
- `notifyMessageSound`: boolean (default `true`) — message ping sound
- `notifyJoinLeaveSound`: boolean (default `true`) — voice join/leave tones

### Per-Server Settings (database)

New column on `server_members` table:

```sql
ALTER TABLE server_members ADD COLUMN notification_level TEXT NOT NULL DEFAULT 'default';
```

Values: `'default'` | `'all'` | `'mentions'` | `'nothing'`

- `default` — inherit from global user settings
- `all` — notify on all messages
- `mentions` — only notify on @mentions
- `nothing` — mute the server entirely

### Shared Types

Add `notification_level` to `ServerMember` interface:

```typescript
export interface ServerMember {
  server_id: string;
  user_id: string;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: string;
  notification_level: 'default' | 'all' | 'mentions' | 'nothing';
}
```

## 2. Server API

### PATCH `/api/servers/:serverId/members/me/notifications`

- Requires `requireAuth` + `requireServerMember`
- Body: `{ notification_level: 'default' | 'all' | 'mentions' | 'nothing' }`
- Updates the `server_members` row for the current user
- Returns `{ ok: true }`

No dedicated GET needed — `notification_level` is included when server member data is fetched (e.g., in the servers list response or via a new field on the server object sent to the client).

## 3. Client — Global Settings UI

Add a **"Notifications"** section to SettingsModal (personal settings):

- **Desktop Notifications** — toggle (on/off)
- **Notification Sounds** — toggle (on/off, master)
- **Message Sound** — toggle (on/off, indented, disabled when master is off)
- **Join/Leave Sounds** — toggle (on/off, indented, disabled when master is off)

These use `createPersistedStore()` in the existing settings store. No API calls.

## 4. Client — Per-Server Context Menu

Right-click on a server icon in NavDock shows a context menu:

- **Mute Server** — toggle; sets notification_level to `'nothing'` or back to `'default'`
- Separator
- **Notification level options** (radio-style with checkmark on active):
  - Use Default
  - All Messages
  - Only @Mentions
  - Nothing

Selecting an option calls the PATCH API and updates local state.

A muted server (notification_level = `'nothing'`) shows a small crossed-bell icon overlay on its NavDock server icon.

### Client State

Store per-server notification levels in a writable store:

```typescript
export const serverNotificationLevels = writable<Map<string, string>>(new Map());
```

Populated when servers are loaded, updated on context menu changes.

## 5. Notification Dispatch Logic

In `+layout.svelte`, the existing WS event handlers check settings before firing:

### Message notifications (`chat:message`)

1. Look up channel's server_id (from `channelServerMap`)
2. Get notification_level for that server (from `serverNotificationLevels` store)
3. Resolve effective level:
   - If `'nothing'` → skip all notifications and sounds
   - If `'mentions'` → only notify/sound on @mentions
   - If `'all'` → always notify/sound
   - If `'default'` → use global settings (notify on all messages)
4. Gate through global toggles:
   - `notifyDesktop` controls browser notification popups
   - `notifySound` + `notifyMessageSound` controls message ping sound

### Voice events (`voice:joined`, `voice:left`)

1. Check global `notifySound` and `notifyJoinLeaveSound`
2. Check server notification_level — if `'nothing'`, skip sounds
3. Otherwise play join/leave tones

### Call notifications

- Always notify for incoming calls (calls are time-sensitive)
- Respect global `notifyDesktop` toggle for the browser notification popup
- Respect global `notifySound` toggle for ring sound

### DM notifications

- DMs are not server-scoped, so per-server settings don't apply
- Only gated by global toggles
