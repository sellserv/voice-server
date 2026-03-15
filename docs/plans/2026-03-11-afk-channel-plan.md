# AFK Voice Channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically move idle users in voice channels to a server-designated AFK channel, and force-mute anyone in that channel.

**Architecture:** Add `afk_channel_id` and `afk_timeout` to the `servers` table. Expose via settings API. Server-side timer tracks idle users in voice and moves them after the configured timeout. Audio producers are paused for anyone in the AFK channel. Client handles `voice:afkMoved` event and shows a toast.

**Tech Stack:** Fastify, better-sqlite3, mediasoup, Svelte 5, WebSocket

---

### Task 1: Database Migration — Add AFK columns to servers table

**Files:**
- Modify: `server/src/db/schema.ts`

**Step 1: Add migration for afk_channel_id column**

In `server/src/db/schema.ts`, after the multi-server indexes block (after line 919), add:

```typescript
// Migrate: add AFK channel settings to servers
try { db.exec('ALTER TABLE servers ADD COLUMN afk_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL'); } catch {}
try { db.exec('ALTER TABLE servers ADD COLUMN afk_timeout INTEGER NOT NULL DEFAULT 300'); } catch {}
```

**Step 2: Verify migration runs**

Run: `cd /home/coder/projects/voip && npm run dev:server`
Expected: Server starts without errors. The new columns exist on the `servers` table.

**Step 3: Commit**

```bash
git add server/src/db/schema.ts
git commit -m "feat: add afk_channel_id and afk_timeout columns to servers table"
```

---

### Task 2: Shared Types — Update ServerSettings and add voice:afkMoved event

**Files:**
- Modify: `shared/types.ts`

**Step 1: Add afk_channel_id and afk_timeout to ServerSettings**

In `shared/types.ts`, update the `ServerSettings` interface (lines 94-98):

```typescript
export interface ServerSettings {
  name: string;
  icon_url: string | null;
  enabled_apps: string[];
  afk_channel_id: string | null;
  afk_timeout: number;
}
```

**Step 2: Add voice:afkMoved to ServerEvent union**

In `shared/types.ts`, add a new entry to the `ServerEvent` union (before the `error` event near line 792):

```typescript
  | {
      type: 'voice:afkMoved';
      channelId: string;
    }
```

**Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "feat: add AFK channel fields to ServerSettings and voice:afkMoved event"
```

---

### Task 3: Server Settings API — Expose AFK settings in GET/PUT routes

**Files:**
- Modify: `server/src/routes/server-settings.ts`

**Step 1: Update getServerSettings to include AFK fields**

In `server/src/routes/server-settings.ts`, update the `getServerSettings` function. After the existing query that fetches server name/icon (line 10-16), add a query for AFK fields:

```typescript
function getServerSettings(serverId: string): ServerSettings {
  const row = db
    .prepare(
      `SELECT s.name, s.icon_file_id, s.afk_channel_id, s.afk_timeout,
              f.stored_name AS icon_stored_name
       FROM servers s LEFT JOIN files f ON f.id = s.icon_file_id
       WHERE s.id = ?`,
    )
    .get(serverId) as any;

  const settingsRow = db
    .prepare('SELECT enabled_apps FROM server_settings WHERE id = 1')
    .get() as any;

  let enabledApps: string[] = [];
  try {
    enabledApps = JSON.parse(settingsRow?.enabled_apps || '[]');
  } catch {}

  const result: ServerSettings = {
    name: row?.name || 'VoIP Server',
    icon_url: row?.icon_stored_name ? `/uploads/${row.icon_stored_name}` : null,
    enabled_apps: enabledApps,
    afk_channel_id: row?.afk_channel_id || null,
    afk_timeout: row?.afk_timeout ?? 300,
  };
  return result;
}
```

**Step 2: Update PUT handler to accept AFK settings**

In the PUT route handler, update the Body type to include `afk_channel_id` and `afk_timeout`:

```typescript
app.put<{ Params: { serverId: string }; Body: { name?: string; icon_file_id?: string | null; enabled_apps?: string[]; afk_channel_id?: string | null; afk_timeout?: number } }>(
```

Add handling for the new fields after the `enabled_apps` block (after line 95):

```typescript
    if (afk_channel_id !== undefined) {
      if (afk_channel_id !== null) {
        // Validate it's a voice channel in this server
        const ch = db.prepare('SELECT type FROM channels WHERE id = ? AND server_id = ?').get(afk_channel_id, serverId) as { type: string } | undefined;
        if (!ch || ch.type !== 'voice') {
          return reply.code(400).send({ error: 'AFK channel must be a voice channel in this server' });
        }
      }
      db.prepare('UPDATE servers SET afk_channel_id = ? WHERE id = ?').run(afk_channel_id, serverId);
    }

    if (afk_timeout !== undefined) {
      if (typeof afk_timeout !== 'number' || afk_timeout < 60 || afk_timeout > 3600) {
        return reply.code(400).send({ error: 'AFK timeout must be between 60 and 3600 seconds' });
      }
      db.prepare('UPDATE servers SET afk_timeout = ? WHERE id = ?').run(afk_timeout, serverId);
    }
```

Also destructure the new fields from `request.body`:

```typescript
const { name, icon_file_id, enabled_apps, afk_channel_id, afk_timeout } = request.body;
```

**Step 3: Verify settings round-trip**

Run: `npm run dev:server`
Expected: Server starts. GET settings returns `afk_channel_id: null, afk_timeout: 300`.

**Step 4: Commit**

```bash
git add server/src/routes/server-settings.ts
git commit -m "feat: expose AFK channel settings in GET/PUT server settings API"
```

---

### Task 4: Server-Side AFK Timer — Move idle users to AFK channel

**Files:**
- Create: `server/src/media/afkManager.ts`
- Modify: `server/src/ws/index.ts` (hook into presence changes)
- Modify: `server/src/ws/handlers.ts` (integrate AFK on disconnect)

**Step 1: Create afkManager.ts**

Create `server/src/media/afkManager.ts`:

```typescript
import db from '../db/connection.js';
import { broadcast, sendTo, getDisplayName, getAvatarUrl } from '../ws/index.js';
import { leaveVoiceChannel, handleVoiceEvent } from './signaling.js';
import { userVoiceChannels } from '../ws/handlers.js';
import type { JwtPayload } from '../auth/jwt.js';

// Map of userId -> AFK timer
const afkTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Called when a user's status changes to 'idle'.
 * Starts an AFK timer if they're in a voice channel with an AFK channel configured.
 */
export function onUserIdle(userId: string) {
  // Already has a timer? Do nothing.
  if (afkTimers.has(userId)) return;

  const currentChannelId = userVoiceChannels.get(userId);
  if (!currentChannelId) return; // Not in voice

  // Find which server this channel belongs to
  const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(currentChannelId) as { server_id: string | null } | undefined;
  if (!channel?.server_id) return;

  // Get server's AFK settings
  const server = db.prepare('SELECT afk_channel_id, afk_timeout FROM servers WHERE id = ?').get(channel.server_id) as { afk_channel_id: string | null; afk_timeout: number } | undefined;
  if (!server?.afk_channel_id) return; // No AFK channel configured

  // Already in the AFK channel? Do nothing.
  if (currentChannelId === server.afk_channel_id) return;

  const afkChannelId = server.afk_channel_id;
  const timeout = (server.afk_timeout || 300) * 1000;

  const timer = setTimeout(() => {
    afkTimers.delete(userId);
    moveUserToAfk(userId, afkChannelId);
  }, timeout);

  afkTimers.set(userId, timer);
}

/**
 * Called when a user's status changes back to 'online' (or any non-idle status).
 * Cancels any pending AFK timer.
 */
export function onUserActive(userId: string) {
  const timer = afkTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    afkTimers.delete(userId);
  }
}

/**
 * Called when a user disconnects or leaves voice. Clean up their AFK timer.
 */
export function clearAfkTimer(userId: string) {
  const timer = afkTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    afkTimers.delete(userId);
  }
}

/**
 * Move a user from their current voice channel to the AFK channel.
 */
async function moveUserToAfk(userId: string, afkChannelId: string) {
  const currentChannelId = userVoiceChannels.get(userId);
  if (!currentChannelId) return; // No longer in voice
  if (currentChannelId === afkChannelId) return; // Already there

  // Verify AFK channel still exists
  const afkChannel = db.prepare('SELECT id FROM channels WHERE id = ?').get(afkChannelId);
  if (!afkChannel) return;

  // Get user info for the join broadcast
  const userRow = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!userRow) return;

  const user: JwtPayload = { userId, username: userRow.username, role: 'member' };

  // Leave current channel
  leaveVoiceChannel(userId);
  broadcast({
    type: 'voice:left',
    channelId: currentChannelId,
    userId,
    username: userRow.username,
  });

  // Join AFK channel via the normal voice join flow
  await handleVoiceEvent(user, { type: 'voice:join', channelId: afkChannelId });

  // Notify the moved user
  sendTo(userId, { type: 'voice:afkMoved' as any, channelId: afkChannelId });
}

/**
 * Check if a channel is the AFK channel for its server.
 */
export function isAfkChannel(channelId: string): boolean {
  const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as { server_id: string | null } | undefined;
  if (!channel?.server_id) return false;
  const server = db.prepare('SELECT afk_channel_id FROM servers WHERE id = ?').get(channel.server_id) as { afk_channel_id: string | null } | undefined;
  return server?.afk_channel_id === channelId;
}
```

**Step 2: Hook AFK manager into presence changes**

In `server/src/ws/index.ts`, import and call AFK manager from `setClientStatus`.

Add import at the top:
```typescript
import { onUserIdle, onUserActive } from '../media/afkManager.js';
```

In the `setClientStatus` function (around line 156), after `client.status = status;`, add:

```typescript
  // AFK voice channel management
  if (status === 'idle') {
    onUserIdle(userId);
  } else {
    onUserActive(userId);
  }
```

**Step 3: Clean up AFK timer on disconnect**

In `server/src/ws/handlers.ts`, import `clearAfkTimer` and call it in `handleDisconnect`.

Add to imports:
```typescript
import { clearAfkTimer } from '../media/afkManager.js';
```

Find the `handleDisconnect` function (search for `export function handleDisconnect` or `export async function handleDisconnect`). Add `clearAfkTimer(user.userId);` at the beginning of that function.

**Step 4: Verify AFK timer logic**

Run: `npm run dev:server`
Expected: Server starts without import errors.

**Step 5: Commit**

```bash
git add server/src/media/afkManager.ts server/src/ws/index.ts server/src/ws/handlers.ts
git commit -m "feat: add server-side AFK timer to move idle users to AFK voice channel"
```

---

### Task 5: Forced Mute in AFK Channel — Pause audio producers

**Files:**
- Modify: `server/src/media/signaling.ts`

**Step 1: Import isAfkChannel**

Add import at the top of `server/src/media/signaling.ts`:

```typescript
import { isAfkChannel } from './afkManager.js';
```

**Step 2: Force mute on voice:join to AFK channel**

In the `voice:join` case handler (around line 105-134 in signaling.ts), after the peer is added and the `voice:joined` broadcast is sent, add:

```typescript
      // Force mute in AFK channel
      if (isAfkChannel(event.channelId)) {
        const afkPeer = room.peers.get(user.userId);
        if (afkPeer) afkPeer.muted = true;
        broadcast({
          type: 'voice:muteUpdate',
          channelId: event.channelId,
          userId: user.userId,
          muted: true,
        });
      }
```

**Step 3: Block unmute in AFK channel**

In the `voice:mute` case handler (around line 152-165), add a check before updating mute state:

```typescript
      case 'voice:mute': {
        const channelId = userVoiceChannels.get(user.userId);
        if (channelId) {
          // Prevent unmuting in AFK channel
          if (!event.muted && isAfkChannel(channelId)) {
            broadcast({
              type: 'voice:muteUpdate',
              channelId,
              userId: user.userId,
              muted: true,
            });
            break;
          }
          const room = rooms.get(channelId);
          const peer = room?.peers.get(user.userId);
          if (peer) peer.muted = event.muted;
          broadcast({
            type: 'voice:muteUpdate',
            channelId,
            userId: user.userId,
            muted: event.muted,
          });
        }
        break;
      }
```

**Step 4: Pause audio producer in AFK channel**

In the `rtc:produce` case handler (around line 219-273), after the producer is created and before notifying peers, add a check to pause the producer if in AFK channel:

After `sendTo(user.userId, { type: 'rtc:produced', producerId });` (line 251), add:

```typescript
        // Pause audio in AFK channel
        if (kind === 'audio' && isAfkChannel(channelId)) {
          const afkRoom = rooms.get(channelId);
          const afkPeer = afkRoom?.peers.get(user.userId);
          if (afkPeer?.producer) {
            await afkPeer.producer.pause();
          }
        }
```

**Step 5: Commit**

```bash
git add server/src/media/signaling.ts
git commit -m "feat: force mute users in AFK voice channel"
```

---

### Task 6: Client Settings UI — AFK channel picker and timeout selector

**Files:**
- Modify: `client/src/lib/components/settings/GeneralSettings.svelte`
- Modify: `client/src/lib/stores/serverSettings.ts`

**Step 1: Update serverSettings store default**

In `client/src/lib/stores/serverSettings.ts`, update the default value to include AFK fields:

```typescript
export const serverSettings = writable<ServerSettings>({
  name: 'VoIP Server',
  icon_url: null,
  enabled_apps: [],
  afk_channel_id: null,
  afk_timeout: 300,
});
```

**Step 2: Add AFK section to GeneralSettings.svelte**

In `client/src/lib/components/settings/GeneralSettings.svelte`, add imports and state for AFK settings:

Update the script block to add:

```typescript
  import { voiceChannels } from '$lib/stores/channels';

  let afkChannelId = $state<string | null>($serverSettings.afk_channel_id);
  let afkTimeout = $state(Math.round(($serverSettings.afk_timeout || 300) / 60));
```

Update the `saveGeneral` function to include AFK settings in the PUT body:

```typescript
  async function saveGeneral() {
    saving = true;
    try {
      const serverId = getActiveServerId();
      let icon_file_id: string | null | undefined = undefined;
      if (iconFile) {
        const result = await api.upload(iconFile);
        icon_file_id = result.fileId || result.id;
      }
      await api.put(`/api/servers/${serverId}/settings`, {
        name: serverName || undefined,
        icon_file_id,
        afk_channel_id: afkChannelId,
        afk_timeout: afkTimeout * 60,
      });
      await loadServerSettings();
    } finally {
      saving = false;
    }
  }
```

Add the AFK settings UI before the save button in the template:

```svelte
  <div class="field">
    <span>AFK Voice Channel</span>
    <select class="text-input" bind:value={afkChannelId}>
      <option value={null}>None (disabled)</option>
      {#each $voiceChannels as ch}
        <option value={ch.id}>{ch.name}</option>
      {/each}
    </select>
    <span class="hint">Idle users in voice will be moved to this channel</span>
  </div>

  <div class="field">
    <span>AFK Timeout (minutes)</span>
    <input type="number" class="text-input" bind:value={afkTimeout} min="1" max="60" style="max-width: 120px" />
    <span class="hint">How long a user must be idle before being moved (1-60 min)</span>
  </div>
```

Add `.hint` style to the style block:

```css
  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.7;
  }
```

**Step 3: Verify UI renders**

Run: `npm run dev`
Expected: Server Settings > General tab shows AFK channel dropdown and timeout input.

**Step 4: Commit**

```bash
git add client/src/lib/components/settings/GeneralSettings.svelte client/src/lib/stores/serverSettings.ts
git commit -m "feat: add AFK channel and timeout settings to server settings UI"
```

---

### Task 7: Client Voice State — Handle voice:afkMoved event

**Files:**
- Modify: `client/src/routes/+layout.svelte`

**Step 1: Add voice:afkMoved handler**

In `client/src/routes/+layout.svelte`, find the `voice:deafenUpdate` handler (around line 297-299). After it, add the `voice:afkMoved` handler:

```typescript
        case 'voice:afkMoved':
          // Server moved us to the AFK channel
          inVoiceChannel.set(event.channelId);
          toast.warning('You were moved to the AFK channel due to inactivity');
          break;
```

Make sure `inVoiceChannel` is imported from `$lib/stores/media` (it should already be imported) and `toast` is imported from `$lib/stores/toast`.

Check existing imports — if `toast` is not imported, add:
```typescript
import { toast } from '$lib/stores/toast';
```

If `inVoiceChannel` is not imported, add it to the existing media imports.

**Step 2: Verify event handling**

Run: `npm run dev`
Expected: No compilation errors. The WS event handler switch includes `voice:afkMoved`.

**Step 3: Commit**

```bash
git add client/src/routes/+layout.svelte
git commit -m "feat: handle voice:afkMoved event on client with toast notification"
```

---

### Task 8: Integration Testing — Verify end-to-end flow

**Step 1: Manual test — configure AFK channel**

1. Start the dev server: `npm run dev`
2. Log in as admin, go to Server Settings > General
3. Create a voice channel called "AFK" if one doesn't exist
4. Select it as the AFK channel, set timeout to 1 minute for testing
5. Save — verify GET settings returns the new values

**Step 2: Manual test — AFK move**

1. Join a non-AFK voice channel
2. Wait for idle detection (5 min) or trigger it manually
3. After the configured AFK timeout, verify:
   - You are moved to the AFK channel
   - A toast notification appears
   - Your mute state is forced to muted
   - Other users see you leave the old channel and join the AFK channel
4. Verify you cannot unmute while in the AFK channel

**Step 3: Manual test — edge cases**

1. Set AFK channel to "None" and verify no auto-move occurs
2. Delete the AFK channel and verify the setting is cleared (ON DELETE SET NULL)
3. Disconnect while AFK timer is running — verify no errors
4. Join the AFK channel manually — verify you are force-muted

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration testing issues for AFK channel"
```
