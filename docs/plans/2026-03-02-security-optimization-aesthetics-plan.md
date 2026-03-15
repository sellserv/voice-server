# Security, Optimization & Aesthetics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden security, optimize performance, and polish the UI of the SellServ Voice application across three layered phases.

**Architecture:** Layered bottom-up approach — security fixes first (foundation), then optimization (architecture cleanup), then aesthetics (visual polish). Each phase builds on the previous. Server uses Fastify 5 + SQLite + mediasoup. Client uses SvelteKit + Svelte 5 with scoped CSS.

**Tech Stack:** Node.js 22, Fastify 5, SQLite (better-sqlite3), mediasoup 3.15, SvelteKit, Svelte 5, Vite 6, Tauri v2

---

## Phase 1: Security Hardening

### Task 1: Role Color Hex Validation Fix

**Files:**

- Modify: `server/src/routes/roles.ts:54-55` (create validation) and `server/src/routes/roles.ts:142-143` (update validation)

**Context:** Current regex `/^#[0-9a-fA-F]{3,6}$/` allows 3-6 hex chars, which permits malformed values like `#abcde` (5 chars). Only 3 or 6 should be valid.

**Step 1: Fix create route color validation**

In `server/src/routes/roles.ts`, change line 54:

```ts
// Before:
if (color !== undefined && color !== null && !/^#[0-9a-fA-F]{3,6}$/.test(color))

// After:
if (color !== undefined && color !== null && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color))
```

**Step 2: Fix update route color validation**

In `server/src/routes/roles.ts`, change line 142:

```ts
// Before:
if (color !== null && !/^#[0-9a-fA-F]{3,6}$/.test(color))

// After:
if (color !== null && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color))
```

**Step 3: Verify manually**

Start the server and test:

- Create role with `color: "#ff0000"` — should succeed
- Create role with `color: "#fff"` — should succeed (3-char shorthand)
- Create role with `color: "#abcde"` — should fail (5 chars)
- Create role with `color: "red; background: url(evil)"` — should fail

**Step 4: Commit**

```bash
git add server/src/routes/roles.ts
git commit -m "Fix role color validation to only accept valid 3 or 6 char hex"
```

---

### Task 2: Channel Topic Length Limit

**Files:**

- Modify: `server/src/routes/channels.ts:162-163`

**Context:** The channel update route validates topic is a string but has no max length. Add 512-char limit.

**Step 1: Add topic length validation**

In `server/src/routes/channels.ts`, after line 163 (`return reply.code(400).send({ error: 'Topic must be a string' });`), add:

```ts
if (topic !== undefined && topic.length > 512) {
  return reply.code(400).send({ error: 'Topic must be 512 characters or less' });
}
```

**Step 2: Commit**

```bash
git add server/src/routes/channels.ts
git commit -m "Add 512-char server-side limit on channel topic length"
```

---

### Task 3: Forgot-Password Anti-Enumeration

**Files:**

- Modify: `server/src/routes/auth.ts:555-578` (step 1 handler)

**Context:** The forgot-password step 1 endpoint currently returns `{ ok: true }` even when user is not found (line 565-566), which is good. However, step 2 (`/api/auth/forgot-password/verify` at line 581) returns different responses based on MFA method, revealing the configured method. We need to make step 2 responses uniform.

**Step 1: Read the full forgot-password verify handler**

Read `server/src/routes/auth.ts` lines 581-643 to understand the current branching.

**Step 2: Unify error responses in step 2**

In the verify handler, replace specific MFA-type error messages with generic ones. The response should not reveal whether the user exists or which MFA method is configured. Change:

- Any "User not found" responses to a generic `{ error: 'Invalid credentials' }`
- Keep the MFA method return in the success response since the client needs it for the flow, but ensure failure paths don't leak info

**Step 3: Commit**

```bash
git add server/src/routes/auth.ts
git commit -m "Reduce user enumeration in forgot-password verify endpoint"
```

---

### Task 4: CSRF Double-Submit Cookie

**Files:**

- Modify: `server/src/auth/jwt.ts:21-29` (setAuthCookie)
- Modify: `server/src/auth/middleware.ts:13-47` (requireAuth)
- Modify: `client/src/lib/api.ts:9-13` (request headers)
- Modify: `server/src/index.ts` (cookie plugin config)

**Context:** The app relies solely on `SameSite=Lax` cookies. Add a CSRF token as a non-httpOnly cookie that the client reads and sends as a custom header.

**Step 1: Generate and set CSRF cookie on login**

In `server/src/auth/jwt.ts`, import `randomBytes` from `crypto`. Add a `setCsrfCookie` function:

```ts
import { randomBytes } from 'crypto';

export function setCsrfCookie(reply: FastifyReply) {
  const token = randomBytes(32).toString('hex');
  reply.setCookie('csrf', token, {
    httpOnly: false, // client JS must read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}
```

**Step 2: Call setCsrfCookie wherever setAuthCookie is called**

Search for all `setAuthCookie` calls in auth routes and add `setCsrfCookie(reply)` after each one.

**Step 3: Validate CSRF header in middleware**

In `server/src/auth/middleware.ts`, inside `requireAuth`, after successful JWT verification, add:

```ts
const method = request.method.toUpperCase();
if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
  const csrfCookie = request.cookies.csrf;
  const csrfHeader = request.headers['x-csrf-token'];
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return reply.code(403).send({ error: 'Invalid CSRF token' });
  }
}
```

**Step 4: Send CSRF header from client**

In `client/src/lib/api.ts`, in the `request` function, read the CSRF cookie and add it as a header:

```ts
function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
  return match ? match[1] : '';
}

// Inside request(), add to headers:
opts.headers['X-CSRF-Token'] = getCsrfToken();
```

Also add the same header to the `upload` function's fetch call.

**Step 5: Clear CSRF cookie on logout**

In `server/src/auth/jwt.ts`, update `clearAuthCookie` to also clear the csrf cookie:

```ts
export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie('token', { path: '/' });
  reply.clearCookie('csrf', { path: '/' });
}
```

**Step 6: Verify manually**

- Login and check that a `csrf` cookie appears (non-httpOnly)
- Make a POST request without the X-CSRF-Token header — should get 403
- Make a POST request with the correct header — should succeed
- Logout and verify both cookies are cleared

**Step 7: Commit**

```bash
git add server/src/auth/jwt.ts server/src/auth/middleware.ts client/src/lib/api.ts
git commit -m "Add CSRF double-submit cookie protection"
```

---

### Task 5: Hash Email Verification Codes

**Files:**

- Modify: `server/src/email/codes.ts:10-37`

**Context:** Email codes are stored as plaintext in the `email_codes` DB table. Hash them with SHA-256 for defense-in-depth.

**Step 1: Add hash utility**

In `server/src/email/codes.ts`, add at top:

```ts
import { createHash } from 'crypto';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
```

**Step 2: Hash code before storing**

In `createEmailCode` (line 21-23), change to store the hashed code:

```ts
// Before:
db.prepare(
  'INSERT INTO email_codes (id, user_id, code, type, expires_at) VALUES (?, ?, ?, ?, ?)',
).run(id, userId, code, type, expiresAt);

// After:
db.prepare(
  'INSERT INTO email_codes (id, user_id, code, type, expires_at) VALUES (?, ?, ?, ?, ?)',
).run(id, userId, hashCode(code), type, expiresAt);
```

**Step 3: Hash code before comparing**

In `validateEmailCode` (lines 29-31), hash the submitted code before lookup:

```ts
// Before:
const row = db
  .prepare(
    "SELECT id FROM email_codes WHERE user_id = ? AND code = ? AND type = ? AND used = 0 AND expires_at > datetime('now')",
  )
  .get(userId, code, type);

// After:
const row = db
  .prepare(
    "SELECT id FROM email_codes WHERE user_id = ? AND code = ? AND type = ? AND used = 0 AND expires_at > datetime('now')",
  )
  .get(userId, hashCode(code), type);
```

**Step 4: Commit**

```bash
git add server/src/email/codes.ts
git commit -m "Hash email verification codes with SHA-256 before storing"
```

---

### Task 6: Strengthen JWT Secret Validation

**Files:**

- Modify: `server/src/config.ts:16-18`

**Context:** Currently only checks for one specific placeholder string. Add entropy checks.

**Step 1: Replace placeholder check with comprehensive validation**

In `server/src/config.ts`, replace lines 16-18:

```ts
const commonPlaceholders = [
  'change-me-to-a-random-string',
  'secret',
  'jwt-secret',
  'changeme',
  'password',
];
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters. Run: openssl rand -hex 32');
}
if (commonPlaceholders.includes(jwtSecret.toLowerCase())) {
  throw new Error('JWT_SECRET must not be a common placeholder value. Run: openssl rand -hex 32');
}
if (/^(.)\1+$/.test(jwtSecret)) {
  throw new Error('JWT_SECRET must not be a repeated character. Run: openssl rand -hex 32');
}
```

**Step 2: Commit**

```bash
git add server/src/config.ts
git commit -m "Strengthen JWT_SECRET validation with entropy checks"
```

---

### Task 7: Audit Logging — Schema & Service

**Files:**

- Modify: `server/src/db/schema.ts` (add table after existing tables)
- Create: `server/src/audit/log.ts`

**Context:** Add an audit_log table and a service module for logging security events.

**Step 1: Add audit_log table to schema**

In `server/src/db/schema.ts`, add after the last `db.exec()` block (after the bots/link_previews tables):

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    user_id TEXT,
    target_id TEXT,
    ip TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
`);
```

**Step 2: Create audit log service**

Create `server/src/audit/log.ts`:

```ts
import db from '../db/connection.js';

export type AuditEventType =
  | 'failed_login'
  | 'successful_login'
  | 'password_change'
  | 'mfa_enable'
  | 'mfa_disable'
  | 'role_change'
  | 'user_ban'
  | 'user_unban'
  | 'permission_change'
  | 'admin_settings_change'
  | 'invite_create'
  | 'invite_delete';

const insertStmt = db.prepare(
  'INSERT INTO audit_log (event_type, user_id, target_id, ip, details) VALUES (?, ?, ?, ?, ?)',
);

export function logAuditEvent(
  eventType: AuditEventType,
  userId: string | null,
  targetId: string | null,
  ip: string | null,
  details?: Record<string, unknown>,
) {
  insertStmt.run(eventType, userId, targetId, ip, details ? JSON.stringify(details) : null);
}

export function getAuditLog(opts: {
  page?: number;
  limit?: number;
  eventType?: string;
  userId?: string;
}) {
  const { page = 1, limit = 50, eventType, userId } = opts;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventType) {
    conditions.push('event_type = ?');
    params.push(eventType);
  }
  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
    .get(...params) as { count: number };

  return { entries: rows, total: countRow.count, page, limit };
}

export function cleanupOldAuditEntries() {
  db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')").run();
}
```

**Step 3: Commit**

```bash
git add server/src/db/schema.ts server/src/audit/log.ts
git commit -m "Add audit_log table and logging service"
```

---

### Task 8: Wire Audit Logging Into Routes

**Files:**

- Modify: `server/src/routes/auth.ts` (login success/fail, password change)
- Modify: `server/src/routes/admin.ts` (ban/unban, invites)
- Modify: `server/src/routes/roles.ts` (role changes)
- Modify: `server/src/routes/mfa.ts` (MFA enable/disable)
- Modify: `server/src/routes/server-settings.ts` (settings changes)
- Modify: `server/src/routes/channels.ts` (permission changes)
- Modify: `server/src/index.ts` (periodic cleanup)

**Step 1: Add audit logging to auth routes**

Import `logAuditEvent` in `server/src/routes/auth.ts`. Add calls at:

- After successful login (line ~315): `logAuditEvent('successful_login', user.id, null, request.ip)`
- After failed login (lockout/wrong password): `logAuditEvent('failed_login', null, null, request.ip, { username })`
- After password change (line ~740): `logAuditEvent('password_change', request.user.id, null, request.ip)`

**Step 2: Add audit logging to admin routes**

Import in `server/src/routes/admin.ts`. Add:

- After ban (line ~42): `logAuditEvent('user_ban', request.user.id, id, request.ip)`
- After unban (line ~56): `logAuditEvent('user_unban', request.user.id, id, request.ip)`
- After invite create (line ~74): `logAuditEvent('invite_create', request.user.id, null, request.ip, { code })`
- After invite delete (line ~93): `logAuditEvent('invite_delete', request.user.id, null, request.ip, { id })`

**Step 3: Add audit logging to roles, MFA, settings, channels**

- `roles.ts`: Log `role_change` on create/update/delete
- `mfa.ts`: Log `mfa_enable` on verify (line ~73), `mfa_disable` on disable (line ~100)
- `server-settings.ts`: Log `admin_settings_change` on update
- `channels.ts`: Log `permission_change` on permission override create/update/delete

**Step 4: Add audit log API endpoint**

Create `server/src/routes/audit.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/middleware.js';
import { getAuditLog } from '../audit/log.js';

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/api/admin/audit-log', { preHandler: [requireAuth, requireAdmin] }, async (request) => {
    const { page, limit, event_type, user_id } = request.query as {
      page?: string;
      limit?: string;
      event_type?: string;
      user_id?: string;
    };
    return getAuditLog({
      page: page ? parseInt(page) : undefined,
      limit: limit ? Math.min(parseInt(limit), 100) : undefined,
      eventType: event_type,
      userId: user_id,
    });
  });
}
```

Register in `server/src/index.ts` alongside other route imports.

**Step 5: Add periodic cleanup**

In `server/src/index.ts`, after the existing `cleanupExpiredCodes` interval (line 124), add:

```ts
import { cleanupOldAuditEntries } from './audit/log.js';
setInterval(cleanupOldAuditEntries, 24 * 60 * 60 * 1000); // daily
```

**Step 6: Commit**

```bash
git add server/src/routes/auth.ts server/src/routes/admin.ts server/src/routes/roles.ts server/src/routes/mfa.ts server/src/routes/server-settings.ts server/src/routes/channels.ts server/src/routes/audit.ts server/src/index.ts
git commit -m "Wire audit logging into all security-relevant routes"
```

---

## Phase 2: Optimization

### Task 9: Create Global Users Store

**Files:**

- Create: `client/src/lib/stores/users.ts`
- Modify: `client/src/lib/components/MessageBubble.svelte:22-31` (remove allUsersMap)
- Modify: `client/src/lib/components/MessageInput.svelte:87-91` (remove local fetch)
- Modify: `client/src/lib/components/UserList.svelte:76-80` (remove local fetch)
- Modify: `client/src/lib/components/NavDock.svelte:149-155` (remove local fetch)
- Modify: `client/src/lib/components/ChannelPermissionsModal.svelte:68-82` (use shared store)
- Modify: `client/src/lib/components/ServerSettings.svelte:125-127` (use shared store)

**Step 1: Create the shared users store**

Create `client/src/lib/stores/users.ts`:

```ts
import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';

interface UserInfo {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  banner_url: string | null;
  role_id: string;
  role_name: string;
  role_color: string;
  is_bot: number;
  created_at: string;
}

export const allUsers = writable<UserInfo[]>([]);
export const usersMap = derived(allUsers, ($users) => {
  const map = new Map<string, UserInfo>();
  for (const u of $users) map.set(u.id, u);
  return map;
});

let fetchPromise: Promise<void> | null = null;
let loaded = false;

export async function fetchUsers() {
  if (loaded) return;
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const users = await api.get<UserInfo[]>('/api/users');
      allUsers.set(users);
      loaded = true;
    } catch {
      // silently fail, will retry next time
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

export function refreshUsers() {
  loaded = false;
  return fetchUsers();
}
```

**Step 2: Replace MessageBubble's module-level allUsersMap**

In `MessageBubble.svelte`, remove the module-level `allUsersMap` writable (lines 22-31) and the `loadAllUsersOnce` function. Replace with:

```ts
import { usersMap, fetchUsers } from '$lib/stores/users';
```

Update `onMount` (line 222) to call `fetchUsers()` instead of `loadAllUsersOnce()`.
Update `renderContent` (line 113) to use `$usersMap.get(userId)` instead of `$allUsersMap.get(userId)`.

**Step 3: Replace MessageInput's local fetch**

In `MessageInput.svelte`, remove the `onMount` fetch (lines 87-91). Replace with:

```ts
import { allUsers as usersStore, fetchUsers } from '$lib/stores/users';
```

Use `$usersStore` instead of the local `allUsers` variable. Call `fetchUsers()` in `onMount`.

**Step 4: Replace UserList's local fetch**

In `UserList.svelte`, remove the `onMount` fetch (lines 76-80). Import and use the shared store.

**Step 5: Replace NavDock's local fetch**

In `NavDock.svelte`, remove the fetch in `openPlusMenu` (lines 149-155). Import and use the shared store. Still call `fetchUsers()` in `openPlusMenu` to ensure data is loaded.

**Step 6: Replace ChannelPermissionsModal's local fetch**

In `ChannelPermissionsModal.svelte`, remove the `/api/users` part of the `loadData` Promise.all (line 73). Import and use the shared store.

**Step 7: Replace ServerSettings' local fetch**

In `ServerSettings.svelte`, replace the members section fetch with the shared store.

**Step 8: Wire WS events to refreshUsers()**

In `+layout.svelte`, import `refreshUsers` and call it on WS events that affect the user list (user:update, user:join, etc.).

**Step 9: Commit**

```bash
git add client/src/lib/stores/users.ts client/src/lib/components/MessageBubble.svelte client/src/lib/components/MessageInput.svelte client/src/lib/components/UserList.svelte client/src/lib/components/NavDock.svelte client/src/lib/components/ChannelPermissionsModal.svelte client/src/lib/components/ServerSettings.svelte client/src/routes/+layout.svelte
git commit -m "Centralize user data fetching into shared users store"
```

---

### Task 10: Message Memory Eviction

**Files:**

- Modify: `client/src/lib/stores/messages.ts:6-8`

**Step 1: Add LRU eviction to messagesByChannel**

In `client/src/lib/stores/messages.ts`, add channel access tracking and eviction:

```ts
const MAX_CACHED_CHANNELS = 20;
const channelAccessOrder: string[] = [];

function touchChannel(channelId: string) {
  const idx = channelAccessOrder.indexOf(channelId);
  if (idx !== -1) channelAccessOrder.splice(idx, 1);
  channelAccessOrder.push(channelId);
}

function evictOldChannels() {
  if (channelAccessOrder.length <= MAX_CACHED_CHANNELS) return;
  messagesByChannel.update((map) => {
    while (channelAccessOrder.length > MAX_CACHED_CHANNELS) {
      const oldest = channelAccessOrder.shift()!;
      map.delete(oldest);
    }
    return new Map(map);
  });
}
```

Call `touchChannel(channelId)` and `evictOldChannels()` inside `loadMessages` and `addMessage`.

**Step 2: Commit**

```bash
git add client/src/lib/stores/messages.ts
git commit -m "Add LRU eviction for cached channel messages (max 20 channels)"
```

---

### Task 11: Message List Virtualization

**Files:**

- Create: `client/src/lib/components/VirtualMessageList.svelte`
- Modify: `client/src/lib/components/ChatPane.svelte:256-300`

**Context:** Currently all loaded messages are rendered to the DOM. Implement a virtual scroller that only renders messages in/near the viewport.

**Step 1: Create VirtualMessageList component**

Create `client/src/lib/components/VirtualMessageList.svelte`:

The component should:

- Accept `messages` array and render slot content for each visible message
- Maintain a map of measured message heights (default estimate: 60px)
- Calculate which messages are visible based on scroll position + container height
- Render spacer divs above/below the visible window
- Include an overscan of ~5 messages above and below viewport
- Expose `scrollToBottom()` and `scrollToMessage(id)` methods
- Fire `onscrolltop` event when scrolled near top (for infinite loading)
- Handle `shouldAutoScroll` — when at bottom, stay at bottom on new messages

Key implementation approach:

```svelte
<script lang="ts">
  // Props
  let { messages, onscrolltop, children } = $props();

  let container: HTMLDivElement;
  let heights = new Map<string, number>();
  let scrollTop = 0;
  let containerHeight = 0;
  const DEFAULT_HEIGHT = 60;
  const OVERSCAN = 5;

  // Calculate visible range based on scrollTop and containerHeight
  // Render spacers + visible messages only
</script>

<div class="virtual-list" bind:this={container} onscroll={handleScroll}>
  <div style="height: {topSpace}px"></div>
  {#each visibleMessages as message (message.id)}
    <div bind:clientHeight={...} data-message-id={message.id}>
      {@render children(message)}
    </div>
  {/each}
  <div style="height: {bottomSpace}px"></div>
</div>
```

**Step 2: Integrate into ChatPane**

In `ChatPane.svelte`, replace the direct `{#each messages}` block (lines 280-282) with the VirtualMessageList component. Pass the messages array and handle scroll events.

**Step 3: Verify manually**

- Load a channel with 100+ messages
- Inspect DOM — should only see ~20-30 message elements, not all 100+
- Scroll up/down — messages should appear/disappear smoothly
- New messages should auto-scroll when at bottom
- Scroll up to load older messages — should work correctly

**Step 4: Commit**

```bash
git add client/src/lib/components/VirtualMessageList.svelte client/src/lib/components/ChatPane.svelte
git commit -m "Add virtual scrolling for message list to reduce DOM node count"
```

---

### Task 12: Decompose Sidebar.svelte

**Files:**

- Create: `client/src/lib/components/sidebar/SidebarHeader.svelte` (lines 407-443)
- Create: `client/src/lib/components/sidebar/ChannelList.svelte` (lines 445-630)
- Create: `client/src/lib/components/sidebar/VoiceControls.svelte` (lines 661-706)
- Create: `client/src/lib/components/sidebar/SidebarFooter.svelte` (lines 709-757)
- Modify: `client/src/lib/components/Sidebar.svelte` (compose from sub-components)

**Step 1: Extract SidebarHeader**

Extract lines 407-443 (`.sidebar-header` section) plus any script logic it needs (server settings state, create channel modal trigger). Props: server name, icon, event callbacks.

**Step 2: Extract ChannelList**

Extract lines 445-630 (`.channel-list` section) plus related script logic (grouped channels, drag-drop, collapse state, channel selection). This is the largest section. Props: channels, active channel, event callbacks.

**Step 3: Extract VoiceControls**

Extract lines 661-706 (voice status bar + ping display) plus related script logic (voice state, ping data). Props: voice state, mute/deafen state, event callbacks.

**Step 4: Extract SidebarFooter**

Extract lines 709-757 (user info, status picker, mute/deafen/settings buttons) plus related script logic. Props: current user, status, event callbacks.

**Step 5: Recompose Sidebar**

Update `Sidebar.svelte` to import and render the sub-components. Pass required props and event handlers. Move shared state to remain in Sidebar and pass down.

**Step 6: Verify manually**

- All sidebar functionality works: channel navigation, drag-drop, voice controls, status picker
- No visual regressions

**Step 7: Commit**

```bash
git add client/src/lib/components/sidebar/ client/src/lib/components/Sidebar.svelte
git commit -m "Decompose Sidebar into SidebarHeader, ChannelList, VoiceControls, SidebarFooter"
```

---

### Task 13: Decompose ServerSettings.svelte

**Files:**

- Create: `client/src/lib/components/settings/GeneralSettings.svelte` (lines 372-399)
- Create: `client/src/lib/components/settings/RolesSettings.svelte` (lines 401-476)
- Create: `client/src/lib/components/settings/MemberManagement.svelte` (lines 478-527)
- Create: `client/src/lib/components/settings/InvitesSettings.svelte` (lines 529-553)
- Create: `client/src/lib/components/settings/SoundboardSettings.svelte` (lines 555-608)
- Create: `client/src/lib/components/settings/EmojiSettings.svelte` (lines 610-638)
- Create: `client/src/lib/components/settings/AppsSettings.svelte` (lines 640-699)
- Create: `client/src/lib/components/settings/BotSettings.svelte` (lines 701-757)
- Create: `client/src/lib/components/settings/AuditLogViewer.svelte` (new, for Phase 1 audit log)
- Modify: `client/src/lib/components/ServerSettings.svelte`

**Step 1: Extract each tab section**

For each section, extract the template and related script logic into its own component. Each component manages its own data loading and API calls.

**Step 2: Create AuditLogViewer**

New component that fetches from `/api/admin/audit-log` with pagination and filtering:

```svelte
<script lang="ts">
  import { api } from '$lib/api';

  let entries = $state([]);
  let total = $state(0);
  let page = $state(1);
  let filterType = $state('');

  async function loadLog() {
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (filterType) params.set('event_type', filterType);
    const result = await api.get(`/api/admin/audit-log?${params}`);
    entries = result.entries;
    total = result.total;
  }

  $effect(() => {
    loadLog();
  });
</script>
```

Display as a table with columns: Time, Event, Actor, Target, Details. Add filter dropdown for event types. Add pagination controls.

**Step 3: Recompose ServerSettings**

Update `ServerSettings.svelte` to import all sub-components and render the active one based on `activeSection`. Add "Audit Log" to the nav tabs.

**Step 4: Verify manually**

- All settings tabs work correctly
- Audit log tab shows logged events with filtering and pagination

**Step 5: Commit**

```bash
git add client/src/lib/components/settings/ client/src/lib/components/ServerSettings.svelte
git commit -m "Decompose ServerSettings into per-tab components, add AuditLogViewer"
```

---

### Task 14: Multi-Worker Mediasoup

**Files:**

- Modify: `server/src/media/worker.ts:11-28`
- Modify: `server/src/media/room.ts` (use worker from pool)
- Modify: `server/src/index.ts` (init multiple workers)

**Step 1: Convert to worker pool**

In `server/src/media/worker.ts`, replace single worker with a pool:

```ts
import * as os from 'os';

const workers: mediasoup.types.Worker[] = [];
let nextWorkerIdx = 0;

export async function createWorkers(): Promise<void> {
  const maxWorkers = parseInt(process.env.MEDIASOUP_WORKERS || '0') || os.cpus().length;
  const numWorkers = Math.max(1, Math.min(maxWorkers, os.cpus().length));

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      rtcMinPort: config.mediasoup.minPort,
      rtcMaxPort: config.mediasoup.maxPort,
      logLevel: 'warn',
    });
    worker.on('died', () => {
      console.error(`mediasoup worker ${worker.pid} died, restarting...`);
      const idx = workers.indexOf(worker);
      if (idx !== -1) workers.splice(idx, 1);
      setTimeout(async () => {
        const replacement = await createSingleWorker();
        workers.push(replacement);
      }, 2000);
    });
    workers.push(worker);
    console.log(`mediasoup worker ${i + 1}/${numWorkers} started [pid:${worker.pid}]`);
  }
}

export function getNextWorker(): mediasoup.types.Worker {
  const worker = workers[nextWorkerIdx];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}
```

**Step 2: Update room.ts to use getNextWorker**

In `server/src/media/room.ts`, replace direct worker usage with `getNextWorker()` when creating a new router.

**Step 3: Update index.ts**

Replace `createWorker()` call with `createWorkers()`.

**Step 4: Add MEDIASOUP_WORKERS to .env.example**

```
MEDIASOUP_WORKERS=      # Number of mediasoup workers (default: CPU count)
```

**Step 5: Commit**

```bash
git add server/src/media/worker.ts server/src/media/room.ts server/src/index.ts .env.example
git commit -m "Support multiple mediasoup workers (one per CPU core)"
```

---

### Task 15: Optimize Broadcast Serialization

**Files:**

- Modify: `server/src/ws/index.ts:75-82`

**Step 1: Pre-serialize broadcast payload**

In `server/src/ws/index.ts`, the `broadcast` function currently calls `JSON.stringify` once (line 76) then sends to all clients. This is already good. However, the channel-aware broadcast functions (like `broadcastToChannel`) should be checked.

Read the full broadcast-related functions to identify where serialization happens per-connection vs. once.

Optimize any `broadcastToChannel` or similar functions to serialize once:

```ts
export function broadcastToChannel(channelId: string, event: ServerEvent, excludeUserId?: string) {
  const msg = JSON.stringify(event); // serialize ONCE
  const accessibleUsers = getCachedChannelAccess(channelId); // use cache (Task 16)
  for (const [userId, ws] of clients) {
    if (userId === excludeUserId) continue;
    if (accessibleUsers && !accessibleUsers.has(userId)) continue;
    if (ws.readyState === 1) ws.send(msg);
  }
}
```

**Step 2: Commit**

```bash
git add server/src/ws/index.ts
git commit -m "Pre-serialize broadcast payloads to avoid per-connection JSON.stringify"
```

---

### Task 16: Cache Channel Access Checks

**Files:**

- Modify: `server/src/auth/permissions.ts:130-149`

**Step 1: Add TTL cache for channel access**

```ts
const channelAccessCache = new Map<string, { users: Set<string>; expiresAt: number }>();
const CACHE_TTL = 5000; // 5 seconds

export function getCachedChannelAccess(channelId: string): Set<string> | null {
  const cached = channelAccessCache.get(channelId);
  if (cached && Date.now() < cached.expiresAt) return cached.users;

  const userIds = getUsersWithChannelAccess(channelId);
  if (userIds.length === 0) {
    channelAccessCache.delete(channelId);
    return null; // no restrictions
  }

  const userSet = new Set(userIds);
  channelAccessCache.set(channelId, { users: userSet, expiresAt: Date.now() + CACHE_TTL });
  return userSet;
}

export function invalidateChannelAccessCache(channelId?: string) {
  if (channelId) channelAccessCache.delete(channelId);
  else channelAccessCache.clear();
}
```

**Step 2: Invalidate cache on permission/role changes**

In `server/src/routes/channels.ts`, call `invalidateChannelAccessCache(channelId)` after permission override changes.
In `server/src/routes/roles.ts`, call `invalidateChannelAccessCache()` (clear all) after role changes.

**Step 3: Commit**

```bash
git add server/src/auth/permissions.ts server/src/routes/channels.ts server/src/routes/roles.ts
git commit -m "Add TTL cache for channel access checks, invalidate on permission changes"
```

---

## Phase 3: Aesthetics

### Task 17: Micro-Interactions — Button & Interactive Polish

**Files:**

- Modify: `client/src/app.css` (global button styles at lines 84-96)
- Modify: Various component `<style>` blocks

**Step 1: Add global button micro-interactions**

In `client/src/app.css`, enhance the existing button styles (lines 84-96):

```css
button {
  /* existing styles ... */
  transition:
    transform 150ms var(--ease-out),
    opacity 150ms var(--ease-out),
    background 150ms var(--ease-out),
    box-shadow 150ms var(--ease-out);
}

button:active:not(:disabled) {
  transform: scale(0.97);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Step 2: Add channel list hover slide effect**

In `Sidebar.svelte` (or the new `ChannelList.svelte` after decomposition), add a sliding highlight on channel items:

```css
.channel-item {
  position: relative;
}

.channel-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  transform: scaleY(0);
  transition: transform 200ms var(--ease-out);
}

.channel-item:hover::before,
.channel-item.active::before {
  transform: scaleY(1);
}
```

**Step 3: Add voice avatar speaking glow**

Replace the current border-based speaking indicator with a soft glow:

```css
.voice-avatar.speaking {
  box-shadow:
    0 0 0 2px var(--speaking),
    0 0 12px 2px rgba(67, 181, 129, 0.3);
  transition: box-shadow 200ms var(--ease-out);
}
```

**Step 4: Commit**

```bash
git add client/src/app.css client/src/lib/components/Sidebar.svelte
git commit -m "Add button press, channel hover slide, and voice speaking glow micro-interactions"
```

---

### Task 18: Toast Improvements

**Files:**

- Modify: `client/src/lib/components/Toast.svelte`

**Step 1: Add progress bar for auto-dismiss**

Add an animated progress bar that shrinks over the toast duration:

```svelte
{#each $toasts as t (t.id)}
  <div class="toast toast-{t.type}" role="alert">
    <span class="toast-msg">{t.message}</span>
    <button class="toast-close" onclick={() => removeToast(t.id)}>×</button>
    <div class="toast-progress" style="animation-duration: {t.duration || 4000}ms"></div>
  </div>
{/each}
```

```css
.toast {
  position: relative;
  overflow: hidden;
}

.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: currentColor;
  opacity: 0.3;
  animation: progressShrink linear forwards;
}

@keyframes progressShrink {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
```

**Step 2: Improve stacking**

Add gap between stacked toasts and a slide-in animation stagger:

```css
.toast-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast {
  animation: toastIn 300ms var(--ease-out);
}
```

**Step 3: Commit**

```bash
git add client/src/lib/components/Toast.svelte
git commit -m "Add toast progress bar, stacking, and improved animations"
```

---

### Task 19: Loading States

**Files:**

- Modify: `client/src/lib/components/SettingsModal.svelte` (device loading)
- Modify: Various settings sub-components (role save, invite create, soundboard upload)

**Step 1: Add loading spinner component or pattern**

Add a reusable loading indicator. Since the project uses inline SVGs, add a simple CSS spinner:

```css
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--text-dim);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

**Step 2: Add loading states to async operations**

Add `saving` state variables to forms that make API calls. Show spinner on buttons while saving. Disable buttons during save.

**Step 3: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte client/src/lib/components/settings/
git commit -m "Add loading spinners to settings, role saves, and async operations"
```

---

### Task 20: Mobile UX Improvements

**Files:**

- Modify: `client/src/routes/+layout.svelte:580-634` (mobile styles)
- Modify: `client/src/app.css:217-224` (mobile breakpoint)

**Step 1: Add swipe gesture for sidebar**

In `+layout.svelte`, add touch event handlers for swipe-to-open sidebar:

```ts
let touchStartX = 0;
let touchStartY = 0;

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
  if (dy > 50) return; // vertical swipe, ignore

  if (dx > 80 && touchStartX < 40) {
    showMobileSidebar = true;
  } else if (dx < -80 && showMobileSidebar) {
    showMobileSidebar = false;
  }
}
```

**Step 2: Increase touch targets**

In `client/src/app.css`, add minimum touch target sizes for mobile:

```css
@media (max-width: 768px) {
  button,
  .channel-item,
  .user-item {
    min-height: 44px;
  }
}
```

**Step 3: Commit**

```bash
git add client/src/routes/+layout.svelte client/src/app.css
git commit -m "Add swipe gestures for mobile sidebar and increase touch target sizes"
```

---

### Task 21: Keyboard Navigation — Quick Switcher

**Files:**

- Create: `client/src/lib/components/QuickSwitcher.svelte`
- Modify: `client/src/routes/+layout.svelte` (keyboard listener, render)

**Step 1: Create QuickSwitcher component**

```svelte
<script lang="ts">
  import { channels, dmChannels, activeChannelId } from '$lib/stores/channels';

  let { onclose } = $props();
  let query = $state('');
  let selectedIndex = $state(0);
  let input: HTMLInputElement;

  const filtered = $derived(() => {
    const q = query.toLowerCase();
    const all = [...$channels, ...$dmChannels];
    if (!q) return all.slice(0, 10);
    return all.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      selectedIndex = Math.min(selectedIndex + 1, filtered().length - 1);
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      selectedIndex = Math.max(selectedIndex - 1, 0);
      e.preventDefault();
    }
    if (e.key === 'Enter') {
      select(filtered()[selectedIndex]);
    }
    if (e.key === 'Escape') {
      onclose();
    }
  }

  function select(channel) {
    activeChannelId.set(channel.id);
    onclose();
  }

  $effect(() => {
    input?.focus();
  });
</script>

<div class="quick-switcher-overlay" onclick={onclose}>
  <div class="quick-switcher" onclick|stopPropagation>
    <input
      bind:this={input}
      bind:value={query}
      onkeydown={handleKeydown}
      placeholder="Search channels..."
    />
    <div class="results">
      {#each filtered() as ch, i (ch.id)}
        <button class="result" class:selected={i === selectedIndex} onclick={() => select(ch)}>
          <span class="icon">{ch.type === 'text' ? '#' : ch.type === 'dm' ? '@' : '🔊'}</span>
          <span>{ch.name}</span>
        </button>
      {/each}
    </div>
  </div>
</div>
```

**Step 2: Wire Ctrl+K in layout**

In `+layout.svelte`, add keyboard listener:

```ts
let showQuickSwitcher = $state(false);

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showQuickSwitcher = !showQuickSwitcher;
  }
}
```

Add `<svelte:window onkeydown={handleGlobalKeydown} />` and render `<QuickSwitcher>` when visible.

**Step 3: Commit**

```bash
git add client/src/lib/components/QuickSwitcher.svelte client/src/routes/+layout.svelte
git commit -m "Add Ctrl+K quick switcher for channels and DMs"
```

---

### Task 22: Empty States

**Files:**

- Modify: `client/src/lib/components/ChatPane.svelte:284-299` (empty state)
- Modify: `client/src/routes/+page.svelte:21-26` (welcome empty state)

**Step 1: Design meaningful empty states**

Replace the minimal text with styled empty states including an icon and helpful text:

For ChatPane (no messages):

```svelte
<div class="empty-channel">
  <div class="empty-icon">
    <svg><!-- message bubble icon --></svg>
  </div>
  <h3>No messages yet</h3>
  <p>Be the first to send a message in <strong>#{channel.name}</strong></p>
</div>
```

For +page.svelte (no channel selected):

```svelte
<div class="empty-state">
  <div class="empty-icon">
    <svg><!-- channels icon --></svg>
  </div>
  <h2>Welcome to {$serverName}</h2>
  <p>Select a channel from the sidebar to get started.</p>
  <p class="hint">Tip: Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to quickly find channels</p>
</div>
```

**Step 2: Style empty states**

```css
.empty-state,
.empty-channel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-muted);
}

.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-round);
  background: var(--bg-mid);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-icon svg {
  width: 32px;
  height: 32px;
  opacity: 0.5;
}

kbd {
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-mid);
  border: 1px solid var(--border);
  font-size: 0.8em;
}
```

**Step 3: Commit**

```bash
git add client/src/lib/components/ChatPane.svelte client/src/routes/+page.svelte
git commit -m "Add styled empty states with icons and helpful text"
```

---

### Task 23: Color Palette Refinement

**Files:**

- Modify: `client/src/app.css:1-56` (root theme)
- Modify: `client/src/app.css:133-160` (light theme)
- Modify: `client/src/app.css:162-189` (dark theme)

**Step 1: Add secondary accent colors**

Add teal and amber accents to the CSS custom properties:

```css
:root {
  /* existing accent (purple) */
  --accent: #7c5cfc;

  /* new secondary accents */
  --accent-success: #2dd4a8; /* teal for voice/success actions */
  --accent-warning: #f5a623; /* amber for warnings */

  /* gradient backgrounds */
  --bg-sidebar-gradient: linear-gradient(180deg, var(--bg-dark) 0%, var(--bg-darkest) 100%);
  --bg-nav-gradient: linear-gradient(180deg, var(--bg-darkest) 0%, #06060c 100%);
}
```

**Step 2: Apply gradients to sidebar and nav dock**

In `Sidebar.svelte` styles, replace flat background with gradient:

```css
.sidebar {
  background: var(--bg-sidebar-gradient);
}
```

In `NavDock.svelte` styles:

```css
.nav-dock {
  background: var(--bg-nav-gradient);
}
```

**Step 3: Update light and dark themes**

Add the new variables to both theme overrides with appropriate values.

**Step 4: Commit**

```bash
git add client/src/app.css client/src/lib/components/Sidebar.svelte client/src/lib/components/NavDock.svelte
git commit -m "Add teal/amber secondary accents and gradient backgrounds to sidebar and nav"
```

---

### Task 24: Typography Hierarchy

**Files:**

- Modify: `client/src/app.css` (global typography)
- Modify: Component styles as needed

**Step 1: Enhance type scale**

Add typography tokens to `client/src/app.css`:

```css
:root {
  /* existing ... */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --line-height-body: 1.5;
  --line-height-tight: 1.3;
  --letter-spacing-header: 0.02em;
}
```

**Step 2: Apply to key elements**

- Channel names: `font-weight: var(--font-weight-medium)`
- Message timestamps: `font-weight: 300; font-size: 0.75rem; color: var(--text-dim)`
- Message content: `line-height: var(--line-height-body)`
- Section headers (sidebar groups, settings tabs): `letter-spacing: var(--letter-spacing-header); font-weight: var(--font-weight-semibold); text-transform: uppercase; font-size: 0.7rem`

**Step 3: Commit**

```bash
git add client/src/app.css client/src/lib/components/
git commit -m "Refine typography hierarchy with weight, line-height, and letter-spacing tokens"
```

---

### Task 25: Icon Wrapper Component

**Files:**

- Create: `client/src/lib/components/Icon.svelte`
- Gradually migrate inline SVGs in high-traffic components

**Step 1: Create Icon component**

```svelte
<script lang="ts">
  let { name, size = 20, class: className = '' } = $props();
</script>

<span class="icon {className}" style="width: {size}px; height: {size}px;">
  {#if name === 'hash'}
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  {:else if name === 'volume'}
    <!-- volume icon SVG -->
  {:else if name === 'mic'}
    <!-- mic icon SVG -->
  {:else if name === 'mic-off'}
    <!-- mic-off icon SVG -->
  {:else if name === 'settings'}
    <!-- settings icon SVG -->
  {:else if name === 'plus'}
    <!-- plus icon SVG -->
  {/if}
</span>

<style>
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: inherit;
    transition: color 150ms var(--ease-out);
  }
  .icon svg {
    width: 100%;
    height: 100%;
  }
</style>
```

**Step 2: Migrate icons in Sidebar and NavDock first**

Replace the most common inline SVGs with `<Icon name="..." />` calls. Do this incrementally — start with 5-10 most-used icons.

**Step 3: Commit**

```bash
git add client/src/lib/components/Icon.svelte client/src/lib/components/Sidebar.svelte client/src/lib/components/NavDock.svelte
git commit -m "Add Icon wrapper component and migrate sidebar/nav dock icons"
```

---

### Task 26: Avatar Enhancements

**Files:**

- Create: `client/src/lib/components/Avatar.svelte`
- Modify components that render avatars: UserList, MessageBubble, Sidebar, NavDock

**Step 1: Create Avatar component**

```svelte
<script lang="ts">
  import { onlineUsers } from '$lib/stores/presence';

  let { src, alt, size = 36, userId = '', showStatus = false, class: className = '' } = $props();

  let loaded = $state(false);

  const statusColor = $derived(() => {
    if (!showStatus || !userId) return null;
    const status = $onlineUsers.get(userId);
    if (!status) return 'var(--text-dim)'; // offline gray
    switch (status) {
      case 'online':
        return 'var(--success)';
      case 'idle':
        return 'var(--warning)';
      case 'dnd':
        return 'var(--danger)';
      default:
        return 'var(--text-dim)';
    }
  });
</script>

<div class="avatar {className}" style="width: {size}px; height: {size}px;">
  {#if src}
    <img {src} {alt} class:loaded onload={() => (loaded = true)} width={size} height={size} />
  {/if}
  <div class="placeholder" class:hidden={loaded && src}>
    {alt?.[0]?.toUpperCase() || '?'}
  </div>
  {#if showStatus && statusColor()}
    <span class="status-dot" style="background: {statusColor()}"></span>
  {/if}
</div>

<style>
  .avatar {
    position: relative;
    border-radius: var(--radius-round);
    overflow: visible;
    flex-shrink: 0;
  }
  img {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-round);
    object-fit: cover;
    opacity: 0;
    transition: opacity 200ms var(--ease-out);
  }
  img.loaded {
    opacity: 1;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-mid);
    border-radius: var(--radius-round);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.85em;
  }
  .placeholder.hidden {
    display: none;
  }
  .status-dot {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--bg-dark);
  }
  .avatar:hover {
    filter: brightness(1.1);
    cursor: pointer;
  }
</style>
```

**Step 2: Replace avatar rendering in key components**

Start with UserList and MessageBubble, replacing raw `<img>` tags with `<Avatar>`.

**Step 3: Commit**

```bash
git add client/src/lib/components/Avatar.svelte client/src/lib/components/UserList.svelte client/src/lib/components/MessageBubble.svelte
git commit -m "Add Avatar component with status dots, smooth loading, and placeholder fallback"
```

---

### Task 27: Smooth Channel Transitions

**Files:**

- Modify: `client/src/lib/components/ChatPane.svelte`

**Step 1: Add fade transition on channel switch**

Wrap the ChatPane content in a keyed block that triggers a transition on channel change:

```svelte
{#key channel.id}
  <div class="chat-content" in:fade={{ duration: 150 }}>
    <!-- existing content -->
  </div>
{/key}
```

Or use CSS:

```css
.chat-content {
  animation: fadeIn 150ms var(--ease-out);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Step 2: Commit**

```bash
git add client/src/lib/components/ChatPane.svelte
git commit -m "Add subtle fade transition when switching channels"
```

---

### Task 28: Final Polish Pass & Verify

**Files:**

- Review all changes across the codebase

**Step 1: Visual regression check**

Manually verify:

- All three themes (Midnight Blue, Dark, Light) look correct
- Mobile layout works with swipe gestures
- Quick switcher opens with Ctrl+K
- Toast notifications stack and show progress bars
- Empty states appear correctly
- Avatar status dots render in all views
- Channel switching has smooth transition
- Button press animations feel natural
- Sidebar gradient backgrounds look good

**Step 2: Security regression check**

- Login/register flow works
- CSRF protection blocks requests without header
- Audit log populates with events
- Forgot-password doesn't enumerate users
- Role colors only accept valid hex

**Step 3: Performance check**

- Message list only renders visible messages (check DOM inspector)
- Navigating between channels doesn't cause duplicate /api/users calls
- Long chat history doesn't cause memory issues

**Step 4: Final commit**

```bash
git add -A
git commit -m "Final polish pass: fix any visual or functional regressions"
```
