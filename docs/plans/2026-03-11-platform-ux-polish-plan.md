# Platform UX & Aesthetic Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a friend system, Home view, NavDock overhaul with pills/tooltips/badges, no-server empty state, and visual polish to bring the multi-server experience up to Discord-level quality.

**Architecture:** New `friendships` table for friend/block relationships. New API routes under `/api/friends/*`. New `HomeSidebar` component replaces the server sidebar when in Home view. NavDock loses DM avatars (they move to HomeSidebar) and gains pill indicators, tooltips, and per-server unread badges. Visual polish standardizes context menus, typography, and active states.

**Tech Stack:** Fastify, better-sqlite3, WebSocket, SvelteKit, Svelte 5 (runes)

---

### Task 1: Database — Friendships table

**Files:**
- Modify: `server/src/db/schema.ts`

Add the friendships table and index after the server_invitations block:

```typescript
// Friendships table (friends, pending requests, blocks)
db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, target_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_friendships_target ON friendships(target_id, status);
`);
```

**Commit:** `git commit -m "feat: add friendships table for friend/block system"`

---

### Task 2: Shared Types — Friendship types and WS events

**Files:**
- Modify: `shared/types.ts`

**Step 1:** Add Friendship interface after `ServerInvitation`:

```typescript
export interface Friendship {
  id: string;
  user_id: string;
  target_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
}

export interface FriendInfo {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  status?: UserStatus;
  online?: boolean;
}

export interface FriendRequest {
  id: string;
  user: FriendInfo;
  direction: 'incoming' | 'outgoing';
  created_at: string;
}
```

**Step 2:** Add friend WS events to `ServerEvent` union (before the `error` event):

```typescript
  | {
      type: 'friend:requestReceived';
      request: FriendRequest;
    }
  | {
      type: 'friend:requestAccepted';
      userId: string;
      friend: FriendInfo;
    }
  | {
      type: 'friend:removed';
      userId: string;
    }
  | {
      type: 'friend:blocked';
      userId: string;
    }
```

**Commit:** `git commit -m "feat: add friendship types and friend WS events to shared types"`

---

### Task 3: Server — Friend API routes

**Files:**
- Create: `server/src/routes/friends.ts`
- Modify: `server/src/routes/index.ts` (or wherever routes are registered — find the file that imports and registers all route modules)

Create `server/src/routes/friends.ts` with these routes (all require `requireAuth`):

**GET `/api/friends`** — List accepted friends with online status:
- Query both directions: `WHERE (user_id = ? AND status = 'accepted') OR (target_id = ? AND status = 'accepted')`
- Join with users table for profile info
- Check online status from WS clients map via `getClient()`
- Return `FriendInfo[]`

**GET `/api/friends/pending`** — List pending requests:
- Incoming: `WHERE target_id = ? AND status = 'pending'`
- Outgoing: `WHERE user_id = ? AND status = 'pending'`
- Return `FriendRequest[]` with `direction` field

**GET `/api/friends/blocked`** — List users you've blocked:
- `WHERE user_id = ? AND status = 'blocked'`
- Return `FriendInfo[]`

**POST `/api/friends/request`** — Send friend request:
- Body: `{ target_id: string }`
- Validate target exists and isn't self
- Check not already friends, no pending request, not blocked by target
- Insert with status `'pending'`
- Send `friend:requestReceived` WS event to target
- Return the friendship row

**POST `/api/friends/accept/:id`** — Accept incoming request:
- Verify the friendship exists, is pending, and target_id = current user
- Update status to `'accepted'`
- Insert reverse row (target→user) with status `'accepted'` for bidirectional lookup
- Send `friend:requestAccepted` WS event to requester
- Return `{ ok: true }`

**POST `/api/friends/decline/:id`** — Decline incoming request:
- Verify friendship exists, is pending, target_id = current user
- Delete the row
- Return `{ ok: true }`

**POST `/api/friends/remove/:id`** — Remove a friend:
- Delete both direction rows (user→target and target→user)
- Send `friend:removed` WS event to the other user
- Return `{ ok: true }`

**POST `/api/friends/block/:userId`** — Block a user:
- Delete any existing friendship rows in both directions
- Insert `(current_user, target, 'blocked')`
- Send `friend:blocked` WS event to indicate removal (don't reveal block)
- Return `{ ok: true }`

**POST `/api/friends/unblock/:userId`** — Unblock:
- Delete the blocked row
- Return `{ ok: true }`

Register the route module in the main route registration file.

**Commit:** `git commit -m "feat: add friend system API routes"`

---

### Task 4: Client — Friends store and WS handlers

**Files:**
- Create: `client/src/lib/stores/friends.ts`
- Modify: `client/src/routes/+layout.svelte` (add WS event handlers + load friends on init)

**Step 1:** Create `client/src/lib/stores/friends.ts`:

```typescript
import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';
import type { FriendInfo, FriendRequest } from '@voip-server/shared';

export const friends = writable<FriendInfo[]>([]);
export const pendingRequests = writable<FriendRequest[]>([]);
export const blockedUsers = writable<FriendInfo[]>([]);

export const onlineFriends = derived(friends, ($f) =>
  $f.filter((f) => f.online)
);

export async function loadFriends() {
  const list = await api.get<FriendInfo[]>('/api/friends');
  friends.set(list);
}

export async function loadPendingRequests() {
  const list = await api.get<FriendRequest[]>('/api/friends/pending');
  pendingRequests.set(list);
}

export async function loadBlockedUsers() {
  const list = await api.get<FriendInfo[]>('/api/friends/blocked');
  blockedUsers.set(list);
}

export async function sendFriendRequest(targetId: string) {
  await api.post('/api/friends/request', { target_id: targetId });
}

export async function acceptFriendRequest(friendshipId: string) {
  await api.post(`/api/friends/accept/${friendshipId}`, {});
  await Promise.all([loadFriends(), loadPendingRequests()]);
}

export async function declineFriendRequest(friendshipId: string) {
  await api.post(`/api/friends/decline/${friendshipId}`, {});
  await loadPendingRequests();
}

export async function removeFriend(friendshipId: string) {
  await api.post(`/api/friends/remove/${friendshipId}`, {});
  await loadFriends();
}

export async function blockUser(userId: string) {
  await api.post(`/api/friends/block/${userId}`, {});
  await Promise.all([loadFriends(), loadBlockedUsers()]);
}

export async function unblockUser(userId: string) {
  await api.post(`/api/friends/unblock/${userId}`, {});
  await loadBlockedUsers();
}

export function addFriendFromWs(friend: FriendInfo) {
  friends.update((list) => {
    if (list.some((f) => f.id === friend.id)) return list;
    return [...list, friend];
  });
}

export function removeFriendFromWs(userId: string) {
  friends.update((list) => list.filter((f) => f.id !== userId));
}

export function addPendingFromWs(request: FriendRequest) {
  pendingRequests.update((list) => {
    if (list.some((r) => r.id === request.id)) return list;
    return [...list, request];
  });
}
```

**Step 2:** In `+layout.svelte`, add WS event handlers for friend events and call `loadFriends()` + `loadPendingRequests()` in the init flow.

Add friend WS cases to the event switch:
```typescript
case 'friend:requestReceived':
  addPendingFromWs(event.request);
  toast('New friend request from ' + event.request.user.display_name);
  break;
case 'friend:requestAccepted':
  addFriendFromWs(event.friend);
  removePendingByUser(event.userId);
  toast.success(event.friend.display_name + ' accepted your friend request');
  break;
case 'friend:removed':
  removeFriendFromWs(event.userId);
  break;
case 'friend:blocked':
  removeFriendFromWs(event.userId);
  break;
```

**Commit:** `git commit -m "feat: add friends store and WS event handlers"`

---

### Task 5: Client — HomeSidebar component

**Files:**
- Create: `client/src/lib/components/HomeSidebar.svelte`

This component replaces the server Sidebar when `isDmView` is true. It contains:

**Header:** "Home" title with a small user icon.

**Add Friend bar:** Text input + "Send Request" button. Searches by username via the existing users store or a dedicated search endpoint. On submit, calls `sendFriendRequest()`.

**Tab navigation:** Three tabs — Friends, Pending, Blocked. Use buttons with bottom-border active indicator matching the design's active state pattern.

**Friends tab content:**
- List of friends with avatar, display name, online status dot
- Each friend has a "Message" button (opens DM via `openOrCreateDm`) and "Call" button (via `initiateCall`)
- Context menu or hover button: "Remove Friend"

**Pending tab content:**
- Section "Incoming" — each with Accept/Decline buttons
- Section "Outgoing" — each with Cancel button
- Empty state: "No pending requests"

**Blocked tab content:**
- List with "Unblock" button per user
- Empty state: "No blocked users"

**DM Conversations section** (below the tabs):
- Separator + "Direct Messages" label
- List of DM channels sorted by most recent, similar to how they appear in NavDock now but as a vertical list with usernames visible (not just avatars)
- Each DM shows: avatar, name, online status, unread badge
- Click opens the DM in the main content area

**Styling:** Match existing sidebar patterns — `var(--bg-darker)` background, same spacing, glassmorphism for any popups.

**Commit:** `git commit -m "feat: add HomeSidebar component with friends tabs and DM list"`

---

### Task 6: Client — WelcomeSplash component

**Files:**
- Create: `client/src/lib/components/WelcomeSplash.svelte`

Shown in the main content area when Home view is active and no DM channel is selected.

**Content:**
- Centered container with max-width ~600px
- Heading: "Welcome back, {displayName}" or platform name
- **Online Friends** section: horizontal row of avatar cards for online friends (click to DM)
- **Recent DMs** section: last 5 DM conversations as clickable cards
- If no friends and no DMs: "Add some friends to get started" with the add-friend input

**Styling:** Dark background (`--bg-dark`), cards with `--bg-light` and hover effect, accent-colored headings.

**Commit:** `git commit -m "feat: add WelcomeSplash component for Home view"`

---

### Task 7: Layout wiring — Connect Home view to layout

**Files:**
- Modify: `client/src/routes/+layout.svelte` (template section)
- Modify: `client/src/routes/+page.svelte` (show WelcomeSplash when appropriate)

**Step 1:** In the layout template, where `<Sidebar>` is rendered, add a conditional:
```svelte
{#if $isDmView}
  <HomeSidebar />
{:else}
  <Sidebar ... />
{/if}
```

Import `HomeSidebar` and `isDmView`.

**Step 2:** In `+page.svelte`, when `isDmView` is true and no active DM channel is selected, show `<WelcomeSplash />` instead of the empty state or chat pane.

**Step 3:** When loading the app, if there's no `lastServerId` in localStorage, default to Home view (`isDmView.set(true)`).

**Commit:** `git commit -m "feat: wire HomeSidebar and WelcomeSplash into layout"`

---

### Task 8: NavDock — Replace logo with Home button, remove DM list

**Files:**
- Modify: `client/src/lib/components/NavDock.svelte`

**Step 1:** Replace the `<a class="nav-logo">` (the compass SVG linking to website) with a Home button:

```svelte
<button
  class="server-icon home-btn"
  class:active={$isDmView}
  title="Home"
  onclick={() => isDmView.set(true)}
>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="home-icon-svg">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
</button>
```

**Step 2:** Remove the entire DM icon button (the `<button class="server-icon dm-icon">` block).

**Step 3:** Remove the entire DM list section (`{#if $isDmView}` ... the `nav-dm-list` div with all DM avatars, folders, plus button). This is a large block (~230 lines of template + the plus menu popup + folder context menu). All this functionality moves to HomeSidebar.

**Step 4:** Remove the second separator (the one before the DM list).

**Step 5:** Clean up unused imports, state variables, and functions related to DMs and folders: `dmChannels`, `unreadChannels`, `markChannelRead`, `unreadCounts`, `mentionCounts`, `missedCalls`, `clearMentions`, `clearMissedCall`, `openOrCreateDm`, `onlineUsers`, `activeCall`, `initiateCall`, `allUsers`, `fetchUsers`, folder state, drag handlers, plus menu state/handlers, etc. Keep only what's needed for the server list, home button, admin button, and create server modal.

**Step 6:** Remove all CSS related to DM items, folders, plus menu, plus popup — roughly everything from `.nav-dm-list` through `.plus-empty` and `.ctx-*`. Keep `.nav-dock`, `.server-icon`, `.server-list`, `.nav-separator`, `.add-server`, `.admin-btn` styles.

**Step 7:** Add Home button styles:

```css
.home-btn {
  margin-bottom: 4px;
}

.home-icon-svg {
  width: 24px;
  height: 24px;
  color: var(--text-dim);
}

.home-btn.active .home-icon-svg {
  color: var(--text);
}
```

**Commit:** `git commit -m "feat: replace NavDock logo with Home button, remove DM list"`

---

### Task 9: NavDock — Active pill indicators and shape morph

**Files:**
- Modify: `client/src/lib/components/NavDock.svelte`

**Step 1:** Add a pill indicator element. Wrap each server icon and the Home button with a container that includes a left-edge pill:

```svelte
<div class="nav-item" class:active={$isDmView} class:has-unread={false}>
  <span class="nav-pill"></span>
  <button class="server-icon home-btn" ...>...</button>
</div>
```

Same pattern for each server:
```svelte
<div class="nav-item" class:active={$activeServerId === server.id && !$isDmView}>
  <span class="nav-pill"></span>
  <button class="server-icon" ...>...</button>
</div>
```

**Step 2:** Add pill + shape morph CSS:

```css
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-pill {
  position: absolute;
  left: 0;
  width: 4px;
  height: 0;
  border-radius: 0 4px 4px 0;
  background: var(--text);
  transition: height 200ms var(--ease-out);
}

.nav-item:hover .nav-pill {
  height: 20px;
}

.nav-item.active .nav-pill {
  height: 36px;
}

.server-icon.active {
  border-radius: 16px;
  box-shadow: none; /* remove old box-shadow active */
}
```

**Step 3:** Remove the old `.server-icon.active` box-shadow style and replace with the border-radius morph (border-radius persists at 16px when active).

**Commit:** `git commit -m "feat: add NavDock pill indicators and active shape morph"`

---

### Task 10: NavDock — Server tooltips

**Files:**
- Modify: `client/src/lib/components/NavDock.svelte`

Add CSS-only tooltips that appear to the right of server icons on hover. Remove the `title` attribute (which shows browser-native tooltips) and use a custom tooltip.

**Step 1:** Add a `data-tooltip` attribute to each server button and the Home button:

```svelte
<button class="server-icon" data-tooltip={server.name} ...>
```

**Step 2:** Add tooltip CSS using `::after`:

```css
.server-icon[data-tooltip] {
  position: relative;
}

.server-icon[data-tooltip]::after {
  content: attr(data-tooltip);
  position: absolute;
  left: calc(100% + 12px);
  top: 50%;
  transform: translateY(-50%);
  background: var(--bg-dark);
  color: var(--text);
  padding: 6px 12px;
  border-radius: var(--radius);
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 150ms var(--ease-out);
  z-index: 1000;
  box-shadow: var(--glass-shadow);
  border: 1px solid var(--glass-border-bright);
}

.server-icon[data-tooltip]:hover::after {
  opacity: 1;
  transition-delay: 400ms;
}
```

**Step 3:** Remove `title` attributes from all NavDock buttons (Home, servers, add server, admin).

**Commit:** `git commit -m "feat: add CSS tooltips to NavDock server icons"`

---

### Task 11: NavDock — Per-server unread and mention badges

**Files:**
- Modify: `client/src/lib/components/NavDock.svelte`
- Modify: `client/src/lib/stores/channels.ts` (or create a derived store)

**Step 1:** Create a derived store that aggregates unread/mention counts per server. This needs to know which channels belong to which server. The `channels` store already has `server_id` on each channel (from the Channel type). Create a derived store:

```typescript
// In channels.ts or a new file
export const serverUnreadCounts = derived(
  [channels, unreadCounts, mentionCounts],
  ([$channels, $unread, $mentions]) => {
    const result = new Map<string, { unread: boolean; mentions: number }>();
    for (const ch of $channels) {
      if (!ch.server_id) continue;
      const entry = result.get(ch.server_id) || { unread: false, mentions: 0 };
      if ($unread.has(ch.id)) entry.unread = true;
      entry.mentions += $mentions.get(ch.id) || 0;
      result.set(ch.server_id, entry);
    }
    return result;
  }
);
```

Note: This requires that the `channels` store contains channels for ALL servers the user is a member of, not just the active one. Check whether this is the case. If not, you may need a separate lightweight store or WS event that tracks per-server unread counts. If channels are only loaded for the active server, use the existing `unreadCounts` and `mentionCounts` stores (which persist across server switches since they're updated by WS events) and derive from those keyed by channel, looking up which server each channel belongs to from a cached mapping.

**Step 2:** In NavDock, show badge on each server icon:

```svelte
{@const serverBadge = $serverUnreadCounts.get(server.id)}
<button class="server-icon" ...>
  ...
  {#if serverBadge?.mentions}
    <span class="server-badge mention">{serverBadge.mentions}</span>
  {:else if serverBadge?.unread}
    <span class="server-badge unread"></span>
  {/if}
</button>
```

**Step 3:** Add badge CSS:

```css
.server-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  border: 2px solid var(--bg-darkest);
  border-radius: 8px;
  z-index: 1;
}

.server-badge.unread {
  width: 12px;
  height: 12px;
  background: var(--text);
  border-radius: 50%;
}

.server-badge.mention {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: var(--danger);
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
```

**Commit:** `git commit -m "feat: add per-server unread and mention badges to NavDock"`

---

### Task 12: Website link in Settings modal

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte` (the personal settings modal)

Find the settings modal footer or bottom area. Add a small website link:

```svelte
<a href="https://info.sellserv.net" target="_blank" rel="noopener" class="website-link">
  sellserv.net
</a>
```

Style it subtly — small font, muted color, bottom of the settings sidebar.

**Commit:** `git commit -m "feat: move website link to Settings modal footer"`

---

### Task 13: No-server empty state

**Files:**
- Create: `client/src/lib/components/NoServerSplash.svelte`
- Modify: `client/src/routes/+page.svelte`

**Step 1:** Create `NoServerSplash.svelte`:
- Centered container
- Platform name heading (from serverSettings or hardcoded)
- Two action cards side by side:
  - "Create a Server" with a plus icon — opens CreateServerModal
  - "Join a Server" with a door/arrow icon — shows invite code input
- "Add some friends" section below with the username search + send request
- Styling: cards use `--bg-light`, accent borders on hover, consistent with app design

**Step 2:** In `+page.svelte`, add logic: if `$servers.length === 0 && !$isDmView`, show `<NoServerSplash />`.

**Step 3:** In the app init flow (layout.svelte), if no `lastServerId` and no servers, default to Home view.

**Commit:** `git commit -m "feat: add no-server empty state with create/join/add friends"`

---

### Task 14: Visual polish — Context menus, typography, active states, transitions

**Files:**
- Modify: `client/src/app.css`
- Modify: `client/src/lib/components/NavDock.svelte` (context menu styles)
- Modify: `client/src/lib/components/Sidebar.svelte` (verify context menus use glass)

**Step 1:** Add typography scale variables to `app.css`:

```css
--font-xs: 0.75rem;
--font-sm: 0.85rem;
--font-md: 0.95rem;
--font-lg: 1.1rem;
--font-xl: 1.3rem;
```

**Step 2:** Fix NavDock context menu to use glassmorphism. In NavDock.svelte, the `.ctx-menu` uses `background: var(--bg-dark)` — change to match Sidebar's glass style:

```css
.ctx-menu {
  position: fixed;
  z-index: 300;
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border-bright);
  box-shadow: var(--glass-shadow), var(--glass-glow);
  border-radius: var(--radius-sm);
  padding: 4px;
  min-width: 120px;
}
```

**Step 3:** Add server switch transition. In the sidebar or layout, add a CSS transition on the channel list container:

```css
.sidebar-content {
  transition: opacity 100ms var(--ease-out);
}

.sidebar-content.switching {
  opacity: 0;
}
```

Trigger the `switching` class briefly when `activeServerId` changes (via an `$effect` that sets a flag for 100ms).

**Commit:** `git commit -m "feat: visual polish — glass context menus, typography scale, transitions"`

---

### Task 15: Integration check — verify end-to-end flows

**Step 1:** Start the app (`npm run dev`) and verify:
- Home button in NavDock switches to HomeSidebar
- Friends tab shows empty state with add-friend bar
- Sending a friend request creates a pending entry
- Accepting a request shows the friend in Friends tab
- Blocking removes from friends, prevents DMs
- DM list appears in HomeSidebar below the tabs
- Clicking a DM opens the chat pane
- No DM selected shows WelcomeSplash

**Step 2:** Verify NavDock:
- Server icons have pill indicators (hover = short, active = tall)
- Active server icon has rounded-square shape
- Tooltips appear on hover with 400ms delay
- Unread badges show on servers with unread channels
- Mention badges show count in red
- No DM avatars in the dock

**Step 3:** Verify empty state:
- Register a new account — see NoServerSplash
- Create a server from the splash — server appears in NavDock
- Website link appears in Settings modal

**Step 4:** Verify visual polish:
- All context menus use glassmorphism
- Server switching has subtle fade transition

**Step 5:** Fix any issues found, commit.
