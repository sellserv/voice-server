# Notification Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user-level global notification defaults (localStorage) and per-server notification overrides (database), giving users control over desktop notifications, sounds, and per-server muting.

**Architecture:** Global settings use `createPersistedStore()` (existing pattern in `settings.ts`). Per-server notification level stored as a column on `server_members` table. NavDock server icons get a right-click context menu for per-server notification level. Notification/sound dispatch logic in `+layout.svelte` is gated through these settings.

**Tech Stack:** Svelte 5, SvelteKit, Fastify, better-sqlite3, Web Notification API, Web Audio API

---

### Task 1: Add notification_level column to server_members

**Files:**
- Modify: `server/src/db/schema.ts`

**Step 1: Add migration in initSchema()**

Add at the end of `initSchema()`, after the friendships table creation:

```typescript
// Migration: add notification_level to server_members
try {
  db.exec(`ALTER TABLE server_members ADD COLUMN notification_level TEXT NOT NULL DEFAULT 'default'`);
} catch {}
```

**Step 2: Verify server starts**

Run: `cd server && npx tsx src/index.ts`
Expected: Server starts without errors, column exists on server_members.

**Step 3: Commit**

```bash
git add server/src/db/schema.ts
git commit -m "feat: add notification_level column to server_members"
```

---

### Task 2: Update shared types

**Files:**
- Modify: `shared/types.ts`

**Step 1: Add notification_level to ServerMember**

In the `ServerMember` interface (line ~234), add:

```typescript
export type NotificationLevel = 'default' | 'all' | 'mentions' | 'nothing';

export interface ServerMember {
  server_id: string;
  user_id: string;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: string;
  notification_level: NotificationLevel;
}
```

**Step 2: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add NotificationLevel type and notification_level to ServerMember"
```

---

### Task 3: Add PATCH API route for per-server notification level

**Files:**
- Modify: `server/src/routes/servers.ts`

**Step 1: Add the PATCH endpoint**

Add before the closing `}` of `serverRoutes`:

```typescript
// Update per-server notification level
app.patch<{ Params: { serverId: string }; Body: { notification_level: string } }>(
  '/api/servers/:serverId/members/me/notifications',
  { preHandler: [requireAuth, requireServerMember] },
  async (request, reply) => {
    const serverId = getServerId(request);
    const userId = request.user.userId;
    const { notification_level } = request.body;

    const valid = ['default', 'all', 'mentions', 'nothing'];
    if (!notification_level || !valid.includes(notification_level)) {
      return reply.code(400).send({ error: 'Invalid notification_level' });
    }

    db.prepare(
      'UPDATE server_members SET notification_level = ? WHERE server_id = ? AND user_id = ?'
    ).run(notification_level, serverId, userId);

    return { ok: true };
  },
);
```

**Step 2: Include notification_level in GET /api/servers response**

In the `GET /api/servers` route (line ~71), update the query to include `sm.notification_level`:

Change the query from:
```sql
SELECT servers.*, COUNT(sm2.user_id) as member_count, f.stored_name as icon_stored_name
FROM servers
JOIN server_members sm ON sm.server_id = servers.id AND sm.user_id = ?
LEFT JOIN server_members sm2 ON sm2.server_id = servers.id
LEFT JOIN files f ON f.id = servers.icon_file_id
GROUP BY servers.id
```

To:
```sql
SELECT servers.*, sm.notification_level, COUNT(sm2.user_id) as member_count, f.stored_name as icon_stored_name
FROM servers
JOIN server_members sm ON sm.server_id = servers.id AND sm.user_id = ?
LEFT JOIN server_members sm2 ON sm2.server_id = servers.id
LEFT JOIN files f ON f.id = servers.icon_file_id
GROUP BY servers.id
```

And add `notification_level: row.notification_level || 'default'` to the returned object.

**Step 3: Commit**

```bash
git add server/src/routes/servers.ts
git commit -m "feat: add PATCH notification level API and include in servers list"
```

---

### Task 4: Add global notification settings stores

**Files:**
- Modify: `client/src/lib/stores/settings.ts`

**Step 1: Add four persisted stores**

Add after the existing voice changer stores:

```typescript
// Notification settings
export const notifyDesktop = createPersistedStore<boolean>('notifyDesktop', true);
export const notifySound = createPersistedStore<boolean>('notifySound', true);
export const notifyMessageSound = createPersistedStore<boolean>('notifyMessageSound', true);
export const notifyJoinLeaveSound = createPersistedStore<boolean>('notifyJoinLeaveSound', true);
```

**Step 2: Commit**

```bash
git add client/src/lib/stores/settings.ts
git commit -m "feat: add global notification setting stores"
```

---

### Task 5: Add serverNotificationLevels store and populate from server list

**Files:**
- Modify: `client/src/lib/stores/servers.ts`

**Step 1: Add the store and population logic**

Add a writable store for per-server notification levels:

```typescript
export const serverNotificationLevels = writable<Map<string, string>>(new Map());
```

In `loadServers()`, after setting the servers store, populate `serverNotificationLevels` from the response (each server now includes `notification_level`).

Add a helper to update a single server's level:

```typescript
export async function setServerNotificationLevel(serverId: string, level: string) {
  await api.patch(`/api/servers/${serverId}/members/me/notifications`, { notification_level: level });
  serverNotificationLevels.update(map => {
    const m = new Map(map);
    m.set(serverId, level);
    return m;
  });
}
```

**Step 2: Update Server type to carry notification_level from API**

The `Server` type in shared/types.ts may not include `notification_level` since it's per-member. Instead, handle it as an extra field in the API response and extract it during `loadServers()`.

**Step 3: Commit**

```bash
git add client/src/lib/stores/servers.ts
git commit -m "feat: add serverNotificationLevels store with API integration"
```

---

### Task 6: Add Notifications section to SettingsModal

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte`

**Step 1: Import notification stores**

Add to the imports:

```typescript
import { notifyDesktop, notifySound, notifyMessageSound, notifyJoinLeaveSound } from '$lib/stores/settings';
```

**Step 2: Add Notifications section**

Add a new `<section>` before the "Theme" section (before line ~898):

```svelte
<section class="section">
  <h4 class="section-title">Notifications</h4>

  <label class="toggle-row">
    <span>Desktop Notifications</span>
    <input type="checkbox" bind:checked={$notifyDesktop} />
  </label>

  <label class="toggle-row">
    <span>Notification Sounds</span>
    <input type="checkbox" bind:checked={$notifySound} />
  </label>

  <label class="toggle-row" class:disabled={!$notifySound}>
    <span class="indent">Message Sound</span>
    <input type="checkbox" bind:checked={$notifyMessageSound} disabled={!$notifySound} />
  </label>

  <label class="toggle-row" class:disabled={!$notifySound}>
    <span class="indent">Join/Leave Sounds</span>
    <input type="checkbox" bind:checked={$notifyJoinLeaveSound} disabled={!$notifySound} />
  </label>
</section>
```

**Step 3: Add styles**

Add `.indent` and `.disabled` styles if not already present:

```css
.indent {
  padding-left: 20px;
}

.toggle-row.disabled {
  opacity: 0.5;
}
```

Use existing `.toggle-row` pattern from the modal. If no `.toggle-row` exists, add styling for a flex row with label and checkbox.

**Step 4: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte
git commit -m "feat: add Notifications section to user settings"
```

---

### Task 7: Add right-click context menu to NavDock server icons

**Files:**
- Modify: `client/src/lib/components/NavDock.svelte`

**Step 1: Import stores and API function**

```typescript
import { serverNotificationLevels, setServerNotificationLevel } from '$lib/stores/servers';
```

**Step 2: Add context menu state and handler**

```typescript
let contextMenu: { serverId: string; serverName: string; x: number; y: number } | null = $state(null);

function handleServerContext(e: MouseEvent, server: { id: string; name: string }) {
  e.preventDefault();
  contextMenu = { serverId: server.id, serverName: server.name, x: e.clientX, y: e.clientY };
}
```

**Step 3: Add oncontextmenu to server buttons**

On each server `<button>`, add:
```svelte
oncontextmenu={(e) => handleServerContext(e, server)}
```

**Step 4: Add context menu markup**

After the server list, add:

```svelte
{#if contextMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ctx-backdrop" onclick={() => (contextMenu = null)}></div>
  <div class="ctx-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    {@const level = $serverNotificationLevels.get(contextMenu.serverId) || 'default'}
    <button class="ctx-item" onclick={() => {
      const newLevel = level === 'nothing' ? 'default' : 'nothing';
      setServerNotificationLevel(contextMenu!.serverId, newLevel);
      contextMenu = null;
    }}>
      {level === 'nothing' ? 'Unmute Server' : 'Mute Server'}
    </button>
    <div class="ctx-separator"></div>
    {#each [
      { value: 'default', label: 'Use Default' },
      { value: 'all', label: 'All Messages' },
      { value: 'mentions', label: 'Only @Mentions' },
      { value: 'nothing', label: 'Nothing' },
    ] as option}
      <button class="ctx-item" onclick={() => {
        setServerNotificationLevel(contextMenu!.serverId, option.value);
        contextMenu = null;
      }}>
        {#if level === option.value}<span class="ctx-check">✓</span>{/if}
        {option.label}
      </button>
    {/each}
  </div>
{/if}
```

**Step 5: Add muted bell overlay on server icons**

Inside each server button, after the badge markup, add:

```svelte
{#if $serverNotificationLevels.get(server.id) === 'nothing'}
  <span class="muted-badge">
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  </span>
{/if}
```

**Step 6: Add context menu and muted badge styles**

```css
.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 199;
}

.ctx-menu {
  position: fixed;
  z-index: 200;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border-bright);
  box-shadow: var(--glass-shadow), var(--glass-glow);
  border-radius: var(--radius-sm);
  padding: 4px;
  min-width: 160px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  text-align: left;
  transition: background 150ms var(--ease-out);
}

.ctx-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.ctx-separator {
  height: 1px;
  background: var(--glass-border);
  margin: 4px 0;
}

.ctx-check {
  color: var(--accent);
  font-weight: 700;
}

.muted-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 16px;
  height: 16px;
  background: var(--bg-darkest);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  z-index: 1;
}
```

**Step 7: Commit**

```bash
git add client/src/lib/components/NavDock.svelte
git commit -m "feat: add right-click context menu for per-server notification levels"
```

---

### Task 8: Gate notification dispatch through settings

**Files:**
- Modify: `client/src/lib/sounds.ts`
- Modify: `client/src/lib/notifications.ts`
- Modify: `client/src/routes/+layout.svelte`

**Step 1: Update sounds.ts — gate through notification stores**

Import the stores and check them before playing:

```typescript
import { notifySound, notifyMessageSound, notifyJoinLeaveSound } from './stores/settings';
```

Update `playMessageSound()`:
```typescript
export function playMessageSound() {
  if (get(isDnd)) return;
  if (!get(notifySound) || !get(notifyMessageSound)) return;
  // ... existing tone code
}
```

Update `playJoinSound()` and `playLeaveSound()`:
```typescript
export function playJoinSound() {
  if (get(isDnd)) return;
  if (!get(notifySound) || !get(notifyJoinLeaveSound)) return;
  playTone(400, 600);
}

export function playLeaveSound() {
  if (get(isDnd)) return;
  if (!get(notifySound) || !get(notifyJoinLeaveSound)) return;
  playTone(600, 400);
}
```

Update `playRingSound()` — gate through `notifySound`:
```typescript
export function playRingSound(): () => void {
  if (get(isDnd)) return () => {};
  if (!get(notifySound)) return () => {};
  // ... existing code
}
```

**Step 2: Update notifications.ts — gate through notifyDesktop**

```typescript
import { get } from 'svelte/store';
import { notifyDesktop } from './stores/settings';
```

Add check at start of `notifyMessage()` and `notifyMention()`:
```typescript
if (!get(notifyDesktop)) return;
```

For `notifyCall()` — always notify (calls are time-sensitive), but still respect `notifyDesktop`:
```typescript
export function notifyCall(callerName: string) {
  if (!get(notifyDesktop)) return;
  notify('Incoming Call', `${callerName} is calling you`, true);
}
```

**Step 3: Update +layout.svelte — gate through per-server notification level**

Import the stores:
```typescript
import { serverNotificationLevels } from '$lib/stores/servers';
import { channelServerMap } from '$lib/stores/channels';
```

In the `chat:message` handler, before calling `playMessageSound()` / `notifyMessage()` / `notifyMention()`, look up the server's notification level:

```typescript
case 'chat:message': {
  addMessage(event.message);
  if (event.message.user_id !== $currentUser?.id) {
    const serverId = channelServerMap.get(event.message.channel_id);
    const level = serverId ? ($serverNotificationLevels.get(serverId) || 'default') : 'default';

    const content = event.message.content || '';
    const isMention = $currentUser &&
      (content.includes(`<@${$currentUser.id}>`) || content.includes('<@everyone>'));

    // Skip all notifications/sounds if server is muted
    const shouldNotify = level === 'nothing' ? false
      : level === 'mentions' ? !!isMention
      : true; // 'all' or 'default'

    if (shouldNotify) {
      playMessageSound();
    }

    if (event.message.channel_id !== $activeChannelId) {
      markChannelUnread(event.message.channel_id);
      if (isMention) {
        incrementMention(event.message.channel_id);
        if (shouldNotify) {
          // ... notify mention
        }
      } else if (shouldNotify) {
        // ... notify message
      }
    } else if (shouldNotify) {
      if (isMention) {
        // ... notify mention
      } else {
        // ... notify message
      }
    }
  }
  // ... DM bump code stays
  break;
}
```

For `voice:joined` and `voice:left`, the sounds are already gated through `playJoinSound()`/`playLeaveSound()` which check the stores. But also check per-server level:

```typescript
case 'voice:joined': {
  // ... existing peer/channel logic
  const voiceServerId = /* get from channelServerMap using event.channelId */;
  const voiceLevel = voiceServerId ? ($serverNotificationLevels.get(voiceServerId) || 'default') : 'default';
  if (voiceLevel !== 'nothing') {
    playJoinSound();
  }
  break;
}
```

Same pattern for `voice:left`.

**Step 4: Commit**

```bash
git add client/src/lib/sounds.ts client/src/lib/notifications.ts client/src/routes/+layout.svelte
git commit -m "feat: gate notifications and sounds through user and per-server settings"
```

---

### Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | DB migration | `server/src/db/schema.ts` |
| 2 | Shared types | `shared/types.ts` |
| 3 | Server API route | `server/src/routes/servers.ts` |
| 4 | Global notification stores | `client/src/lib/stores/settings.ts` |
| 5 | Server notification levels store | `client/src/lib/stores/servers.ts` |
| 6 | Settings modal UI | `client/src/lib/components/SettingsModal.svelte` |
| 7 | NavDock context menu | `client/src/lib/components/NavDock.svelte` |
| 8 | Dispatch logic gating | `sounds.ts`, `notifications.ts`, `+layout.svelte` |
