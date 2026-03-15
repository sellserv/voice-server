# Multi-Server (Guilds) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Discord-like multi-server support where users can create/join multiple servers, each with independent channels, roles, and permissions. DMs remain global. Existing data migrates seamlessly into a default server.

**Architecture:** Server context comes from route params (`/api/servers/:serverId/...`), not from JWT. JWT stays global (userId only). A `requireServerMember` middleware verifies the user belongs to the target server and resolves their server-specific roles. Single WebSocket connection with server-scoped broadcasts.

**Tech Stack:** SQLite (better-sqlite3), Fastify, SvelteKit, mediasoup, WebSocket

---

## Phase 1: Schema & Types

### Task 1: Add shared types for servers

**Files:**
- Modify: `shared/types.ts`

**Step 1:** Add Server and ServerMember types to `shared/types.ts`:

```typescript
export interface Server {
  id: string;
  name: string;
  icon_file_id: string | null;
  icon_url: string | null;
  owner_id: string;
  member_count?: number;
  created_at: string;
}

export interface ServerMember {
  server_id: string;
  user_id: string;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: string;
}
```

**Step 2:** Add server-related client/server events to the ClientEvent and ServerEvent unions:

```typescript
// ClientEvent additions:
| { type: 'server:switch'; serverId: string }

// ServerEvent additions:
| { type: 'server:memberJoined'; serverId: string; userId: string; username: string }
| { type: 'server:memberLeft'; serverId: string; userId: string }
| { type: 'server:updated'; server: Server }
| { type: 'server:deleted'; serverId: string }
```

**Step 3:** Commit: `"Add shared types for multi-server support"`

---

### Task 2: Database schema migration

**Files:**
- Modify: `server/src/db/schema.ts`

**Step 1:** Add `servers` table creation after the existing table definitions:

```sql
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_file_id TEXT REFERENCES files(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  avatar_url TEXT,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS instance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  allow_server_creation INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO instance_settings (id) VALUES (1);
```

**Step 2:** Add migration block (in the migrations section) to add `server_id` to existing tables. Use try/catch pattern already used in the file:

Tables needing `server_id TEXT REFERENCES servers(id)`:
- `channels` (skip type='dm')
- `channel_groups`
- `roles`
- `channel_permission_overrides`
- `group_permission_overrides`
- `custom_emojis`
- `soundboard_sounds`
- `invite_codes`
- `bots`
- `audit_log`

Migration pattern for each:
```typescript
try { db.exec('ALTER TABLE channels ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
```

**Step 3:** Add the data migration that creates the default server from existing data:

```typescript
// Create default server from existing server_settings if servers table is empty
const serverCount = (db.prepare('SELECT COUNT(*) as c FROM servers').get() as any).c;
if (serverCount === 0) {
  const settings = db.prepare('SELECT name, icon_file_id FROM server_settings WHERE id = 1').get() as any;
  const defaultServerId = randomUUID();
  const firstAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as any;

  db.prepare('INSERT INTO servers (id, name, icon_file_id, owner_id) VALUES (?, ?, ?, ?)').run(
    defaultServerId,
    settings?.name || 'My Server',
    settings?.icon_file_id || null,
    firstAdmin?.id || 'system'
  );

  // Add all existing users as members
  const users = db.prepare('SELECT id FROM users WHERE is_bot = 0').all() as any[];
  const insertMember = db.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)');
  for (const u of users) insertMember.run(defaultServerId, u.id);

  // Backfill server_id on all existing data
  for (const table of ['channels', 'channel_groups', 'roles', 'custom_emojis', 'soundboard_sounds', 'invite_codes', 'bots', 'audit_log']) {
    db.prepare(`UPDATE ${table} SET server_id = ? WHERE server_id IS NULL`).run(defaultServerId);
  }
  db.prepare(`UPDATE channel_permission_overrides SET server_id = ? WHERE server_id IS NULL`).run(defaultServerId);
  db.prepare(`UPDATE group_permission_overrides SET server_id = ? WHERE server_id IS NULL`).run(defaultServerId);

  // Add bots as server members too
  const bots = db.prepare('SELECT user_id FROM bots').all() as any[];
  for (const b of bots) insertMember.run(defaultServerId, b.user_id);
}
```

**Step 4:** Add indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id);
CREATE INDEX IF NOT EXISTS idx_channel_groups_server ON channel_groups(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
```

**Step 5:** Verify the migration runs cleanly: `npm run dev:server` — should start without errors.

**Step 6:** Commit: `"Add multi-server schema migration"`

---

## Phase 2: Server Middleware & Routes

### Task 3: Server membership middleware

**Files:**
- Create: `server/src/auth/serverMiddleware.ts`
- Modify: `server/src/auth/middleware.ts`

**Step 1:** Create `server/src/auth/serverMiddleware.ts`:

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import db from '../db/connection.js';

export function requireServerMember(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const serverId = (request.params as any).serverId;
  if (!serverId) {
    reply.code(400).send({ error: 'Server ID required' });
    return;
  }

  const member = db.prepare(
    'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?'
  ).get(serverId, request.user.userId);

  if (!member) {
    reply.code(403).send({ error: 'Not a member of this server' });
    return;
  }

  // Attach serverId to request for downstream use
  (request as any).serverId = serverId;
  done();
}

export function getServerId(request: FastifyRequest): string {
  return (request as any).serverId || (request.params as any).serverId;
}
```

**Step 2:** Commit: `"Add server membership middleware"`

---

### Task 4: Server CRUD routes

**Files:**
- Create: `server/src/routes/servers.ts`
- Modify: `server/src/index.ts` (register new route)

**Step 1:** Create `server/src/routes/servers.ts` with these endpoints:

- `GET /api/servers` — list servers the user is a member of
- `POST /api/servers` — create a new server (check instance_settings.allow_server_creation)
- `GET /api/servers/:serverId` — get server details (requires membership)
- `PATCH /api/servers/:serverId` — update server name/icon (requires owner or administrator permission)
- `DELETE /api/servers/:serverId` — delete server (owner only)
- `POST /api/servers/:serverId/join` — join via invite code
- `POST /api/servers/:serverId/leave` — leave server
- `GET /api/servers/:serverId/members` — list server members

Key implementation details:
- Creating a server: creates default roles (admin, member), default text channel ("general"), default voice channel ("General Voice"), and adds creator as owner + member
- Joining: validate invite code belongs to this server
- Leaving: remove from server_members, if owner must transfer ownership first
- Deleting: cascade deletes channels, roles, messages, etc.

**Step 2:** Register in `server/src/index.ts`:
```typescript
import serverRoutes from './routes/servers.js';
app.register(serverRoutes);
```

**Step 3:** Commit: `"Add server CRUD routes"`

---

### Task 5: Migrate existing routes to server-scoped paths

**Files:**
- Modify: `server/src/routes/channels.ts`
- Modify: `server/src/routes/channelGroups.ts`
- Modify: `server/src/routes/roles.ts`
- Modify: `server/src/routes/custom-emojis.ts`
- Modify: `server/src/routes/soundboard.ts`
- Modify: `server/src/routes/bots.ts`

**Strategy:** Change route paths from `/api/channels` to `/api/servers/:serverId/channels` etc. Add `requireServerMember` as preHandler. Add `AND server_id = ?` to all queries using `getServerId(request)`.

For each route file, the pattern is:

1. Import `requireServerMember` and `getServerId`
2. Change route paths to include `/servers/:serverId/` prefix
3. Add `requireServerMember` to preHandler array (after requireAuth)
4. Add `server_id = ?` filter to all SELECT/INSERT/UPDATE/DELETE queries
5. Use `getServerId(request)` to get the serverId

Example transformation for channels.ts:
```typescript
// Before:
app.get('/api/channels', { preHandler: requireAuth }, async (request) => {
  const channels = db.prepare('SELECT * FROM channels WHERE type != ?').all('dm');
  // ...
});

// After:
app.get('/api/servers/:serverId/channels', { preHandler: [requireAuth, requireServerMember] }, async (request) => {
  const serverId = getServerId(request);
  const channels = db.prepare('SELECT * FROM channels WHERE type != ? AND server_id = ?').all('dm', serverId);
  // ...
});
```

**Apply same pattern to:**
- `channelGroups.ts`: `/api/servers/:serverId/channel-groups`
- `roles.ts`: `/api/servers/:serverId/roles`
- `custom-emojis.ts`: `/api/servers/:serverId/custom-emojis` and `/api/servers/:serverId/admin/custom-emojis`
- `soundboard.ts`: `/api/servers/:serverId/soundboard`
- `bots.ts`: `/api/servers/:serverId/bots` and `/api/servers/:serverId/admin/bots`

**Step 2:** Commit: `"Migrate routes to server-scoped paths"`

---

### Task 6: Migrate admin, users, server-settings, and invite routes

**Files:**
- Modify: `server/src/routes/admin.ts`
- Modify: `server/src/routes/users.ts`
- Modify: `server/src/routes/server-settings.ts`

**admin.ts changes:**
- Ban/unban: `/api/servers/:serverId/admin/ban/:id` — removes user from server_members (not global ban)
- Invite codes: `/api/servers/:serverId/admin/invite-codes` — scope to server
- Audit log: `/api/servers/:serverId/admin/audit-log` — scope to server

**users.ts changes:**
- `GET /api/servers/:serverId/users` — only return members of that server via JOIN on server_members
- `PUT /api/servers/:serverId/users/:id/roles` — verify roles belong to server
- Profile update (`PATCH /api/users/me`) stays global (not server-scoped)

**server-settings.ts changes:**
- Remove singleton pattern (id=1)
- Move server-level settings into `servers` table or keep `server_settings` with server_id
- `GET /api/servers/:serverId/settings` — returns settings for that server
- `PATCH /api/servers/:serverId/settings` — update settings (requires admin in that server)
- Keep `enabled_apps` per-server

**Step 2:** Commit: `"Migrate admin, users, and settings routes to server scope"`

---

### Task 7: Update permissions system for server context

**Files:**
- Modify: `server/src/auth/permissions.ts`

**Changes:**
- All permission functions gain a `serverId` parameter
- `getUserPermissions(userId, serverId)` — filter roles by server_id
- `hasPermission(userId, perm, serverId)` — pass serverId through
- `hasChannelPermission(userId, channelId, perm)` — derive serverId from channel's server_id
- `hasChannelAccess(userId, channelId)` — same
- Update cache keys to include serverId
- `requirePermission(perm)` middleware — extract serverId from request params

**Step 2:** Commit: `"Scope permission system to server context"`

---

### Task 8: Update messages route

**Files:**
- Modify: `server/src/routes/messages.ts`

**Changes:**
- `GET /api/servers/:serverId/channels/:id/messages` — verify channel belongs to server
- DM message routes stay at `/api/channels/:id/messages` (no server scope)
- Add server membership check before allowing message access
- Search endpoint: scope to server's channels

**Step 2:** Commit: `"Scope message routes to server context"`

---

## Phase 3: WebSocket & Real-Time

### Task 9: Server-scoped WebSocket broadcasts

**Files:**
- Modify: `server/src/ws/index.ts`

**Changes:**

1. Track which servers each connected user belongs to:
```typescript
// On connection, fetch user's server memberships
const serverIds = db.prepare(
  'SELECT server_id FROM server_members WHERE user_id = ?'
).all(userId) as { server_id: string }[];
client.serverIds = serverIds.map(s => s.server_id);
```

2. Add `broadcastToServer(serverId, event, excludeUserId?)`:
```typescript
export function broadcastToServer(serverId: string, event: ServerEvent, excludeUserId?: string) {
  const msg = JSON.stringify(event);
  for (const [userId, client] of clients) {
    if (userId === excludeUserId) continue;
    if (!client.serverIds?.includes(serverId)) continue;
    if (client.ws.readyState === 1) client.ws.send(msg);
  }
}
```

3. Update `getOnlineUsers()` to accept optional serverId filter

4. `presence:list` event — send per-server online users when client requests a specific server

5. Replace `broadcast()` calls throughout codebase with `broadcastToServer()` where appropriate (keep `broadcast()` for truly global events like DMs)

**Step 2:** Commit: `"Add server-scoped WebSocket broadcasts"`

---

### Task 10: Update WS event handlers

**Files:**
- Modify: `server/src/ws/handlers.ts`

**Changes:**

1. All server-scoped events need the serverId. Derive it from the channel's server_id:
```typescript
const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId);
```

2. Chat handlers (chat:send, chat:edit, chat:delete):
   - Verify user is member of the channel's server
   - Pass serverId to permission checks

3. Voice handlers (voice:join, voice:leave):
   - Verify channel belongs to a server user is member of
   - Auto-leave voice in other servers when joining

4. Include `serverId` in broadcast events where the client needs it for routing

5. DM handlers stay unchanged (global)

**Step 2:** Commit: `"Update WS handlers for server context"`

---

## Phase 4: Client-Side Changes

### Task 11: Server store and API updates

**Files:**
- Create: `client/src/lib/stores/servers.ts`
- Modify: `client/src/lib/api.ts`

**Step 1:** Create `client/src/lib/stores/servers.ts`:
```typescript
import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';
import type { Server } from '@voip-server/shared';

export const servers = writable<Server[]>([]);
export const activeServerId = writable<string | null>(null);
export const activeServer = derived([servers, activeServerId], ([$servers, $id]) =>
  $servers.find(s => s.id === $id) ?? null
);

export async function loadServers() {
  const list = await api.get<Server[]>('/api/servers');
  servers.set(list);
  return list;
}

export async function createServer(name: string): Promise<Server> {
  const server = await api.post<Server>('/api/servers', { name });
  servers.update(list => [...list, server]);
  return server;
}

export async function joinServer(inviteCode: string): Promise<Server> {
  const server = await api.post<Server>('/api/servers/join', { invite_code: inviteCode });
  servers.update(list => [...list, server]);
  return server;
}

export async function leaveServer(serverId: string) {
  await api.post(`/api/servers/${serverId}/leave`, {});
  servers.update(list => list.filter(s => s.id !== serverId));
}
```

**Step 2:** Update `client/src/lib/api.ts` — add helper to prefix server routes:
```typescript
export function serverApi(serverId: string) {
  return {
    get: <T>(path: string) => api.get<T>(`/api/servers/${serverId}${path}`),
    post: <T>(path: string, body?: any) => api.post<T>(`/api/servers/${serverId}${path}`, body),
    patch: <T>(path: string, body?: any) => api.patch<T>(`/api/servers/${serverId}${path}`, body),
    delete: <T>(path: string) => api.delete<T>(`/api/servers/${serverId}${path}`),
  };
}
```

**Step 3:** Commit: `"Add server store and API helpers"`

---

### Task 12: Update existing stores to use server-scoped API

**Files:**
- Modify: `client/src/lib/stores/channels.ts`
- Modify: `client/src/lib/stores/permissions.ts`
- Modify: `client/src/lib/stores/users.ts`
- Modify: `client/src/lib/stores/serverSettings.ts`

**Changes for each store:**

Replace API calls from `/api/channels` to use `serverApi(serverId)`:
```typescript
// Before:
const channels = await api.get('/api/channels');

// After:
import { get } from 'svelte/store';
import { activeServerId } from './servers';
const serverId = get(activeServerId);
const channels = await api.get(`/api/servers/${serverId}/channels`);
```

Apply to:
- `loadChannels()` → `/api/servers/${serverId}/channels`
- `loadRoles()` → `/api/servers/${serverId}/roles`
- `loadChannelOverrides()` → `/api/servers/${serverId}/channel-overrides`
- `loadGroupOverrides()` → `/api/servers/${serverId}/group-overrides`
- `loadChannelGroups()` → `/api/servers/${serverId}/channel-groups`
- `fetchUsers()` → `/api/servers/${serverId}/users`
- `loadServerSettings()` → `/api/servers/${serverId}/settings`

**Step 2:** Commit: `"Update client stores to use server-scoped API"`

---

### Task 13: Server list UI in NavDock

**Files:**
- Modify: `client/src/lib/components/NavDock.svelte`
- Create: `client/src/lib/components/CreateServerModal.svelte`

**NavDock changes:**

The current NavDock has: logo → separator → DM list → plus button. Transform to:

- Logo (top)
- DM icon (clicking shows DMs, like current DM behavior)
- Separator
- Server icons (each server shows icon or first letter, click to switch)
- "+" button (create or join server)

Each server icon shows:
- Server icon image or name initial with colored background
- Unread indicator dot
- Mention badge count
- Active state (highlighted border) for current server

**CreateServerModal:**
- Two tabs: "Create" and "Join"
- Create: name input, optional icon upload
- Join: invite code/link input

**Step 2:** Commit: `"Add server list and create/join UI to NavDock"`

---

### Task 14: Server switching logic

**Files:**
- Modify: `client/src/routes/+layout.svelte`

**Changes:**

1. On app init: load servers list, set activeServerId to last-used or first server

2. Add `switchServer(serverId)` function that:
   - Sets `activeServerId`
   - Reloads all server-scoped data: channels, roles, users, settings, channel groups, overrides
   - Clears current channel selection, selects first text channel
   - If in voice, leaves voice (can only be in one voice channel globally)
   - Persists last-used server to localStorage/electron-store

3. WS event handling: filter incoming events by serverId where applicable
   - Server-scoped events (channel:created, role:updated, etc.) include serverId
   - Only update stores if event.serverId matches activeServerId
   - For non-active servers, just update unread/mention counts

4. On initial load:
```typescript
const serverList = await loadServers();
if (serverList.length > 0) {
  const lastServer = localStorage.getItem('lastServerId');
  const serverId = serverList.find(s => s.id === lastServer)?.id ?? serverList[0].id;
  activeServerId.set(serverId);
  await switchServer(serverId);
}
```

**Step 3:** Commit: `"Add server switching logic"`

---

### Task 15: Update settings modals for server context

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte`
- Modify: `client/src/lib/components/settings/EmojiSettings.svelte`
- Modify: `client/src/lib/components/settings/SoundboardSettings.svelte`
- Modify: `client/src/lib/components/settings/RolesSettings.svelte`
- Modify: `client/src/lib/components/settings/BotSettings.svelte`
- Modify: `client/src/lib/components/settings/InvitesSettings.svelte`
- Modify: `client/src/lib/components/settings/MemberManagement.svelte`

**Changes:** Update all API calls in settings components to use server-scoped paths. These components already use the API — just need to prefix with `/api/servers/${serverId}/`.

**Step 2:** Commit: `"Update settings components for server-scoped API"`

---

### Task 16: Per-server profiles (nickname/avatar)

**Files:**
- Modify: `server/src/routes/servers.ts` (add profile endpoint)
- Modify: `client/src/lib/components/UserList.svelte`
- Modify: `client/src/lib/components/MessageBubble.svelte`

**Server route:**
- `PATCH /api/servers/:serverId/members/me` — update nickname/avatar for current server

**Display logic:**
- When showing a user in a server context, prefer `server_members.nickname` over `users.display_name`
- When showing a user in DMs, use their global profile
- User list and messages should show server nickname when available

**Step 2:** Commit: `"Add per-server profile support"`

---

## Phase 5: Testing & Polish

### Task 17: Auth flow updates for multi-server

**Files:**
- Modify: `server/src/routes/auth.ts`

**Changes:**
- Registration: after creating user, if invite_code provided, add to that server's members
- Registration without invite: if server creation allowed, user starts with no servers (can create one)
- First user (instance admin): auto-creates default server and becomes owner
- Login: unchanged (global auth)
- Add `GET /api/servers/discover` — optional, list public servers (skip if not needed)

**Step 2:** Commit: `"Update auth flow for multi-server"`

---

### Task 18: DM system compatibility

**Files:**
- Modify: `server/src/ws/handlers.ts` (DM handlers)
- Modify: `client/src/lib/components/NavDock.svelte` (DM view)

**Verify:**
- DMs work regardless of active server
- DM list accessible from dedicated icon in NavDock
- Switching to DM view doesn't require a server context
- DM channels have no server_id (null)
- Can DM any user you share a server with

**Step 2:** Commit: `"Verify and fix DM compatibility with multi-server"`

---

### Task 19: End-to-end testing and migration verification

**Steps:**
1. Start fresh DB — verify schema creates cleanly
2. Start with existing DB — verify migration runs and existing data is preserved
3. Test: create new server, verify channels/roles created
4. Test: join server via invite, verify membership
5. Test: switch between servers, verify data loads correctly
6. Test: send messages in different servers, verify scoping
7. Test: voice channels work per-server
8. Test: DMs work across servers
9. Test: role/permission changes are server-scoped
10. Test: server settings are independent
11. Build client: `npm run build` — verify no errors
12. Run tests: `npm test` — fix any failures

**Step 2:** Commit: `"Fix issues found in multi-server e2e testing"`

---

### Task 20: Update CLAUDE.md and clean up

**Files:**
- Modify: `CLAUDE.md`

**Changes:**
- Document new route structure (`/api/servers/:serverId/...`)
- Document server middleware pattern
- Note that DMs are global (no server prefix)
- Update any route examples

**Step 2:** Commit and tag release.

---

## Execution Order Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-2 | Schema, types, migration |
| 2 | 3-8 | Server middleware, routes, permissions |
| 3 | 9-10 | WebSocket server-scoping |
| 4 | 11-16 | Client stores, UI, server switching |
| 5 | 17-20 | Auth, DMs, testing, polish |

## Key Risks

- **Migration correctness:** Existing data must map to default server without loss. Test with a copy of production DB before deploying.
- **Route changes break client:** Client and server must be deployed together. The old `/api/channels` routes will 404 after migration.
- **WebSocket event routing:** Events must include serverId so client knows which server's state to update.
- **Voice channel global constraint:** Joining voice in server B must leave voice in server A. This already works if `inVoiceChannel` is global state.
