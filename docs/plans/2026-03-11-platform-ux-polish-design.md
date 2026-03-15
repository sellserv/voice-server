# Platform UX & Aesthetic Polish Design

**Goal:** Bring the multi-server platform experience up to Discord-level polish with a friend system, Home view, NavDock overhaul, empty state handling, and visual consistency improvements.

## 1. Friend System + Home View

### Database

New `friendships` table:
```sql
CREATE TABLE friendships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, target_id)
);
```

- `pending`: user_id sent a request to target_id
- `accepted`: mutual friendship (row exists for both directions)
- `blocked`: user_id blocked target_id (one-directional — blocker can't see blocked user's activity, blocked user can't DM or send friend requests to blocker)

### API Routes (global, no server prefix)

- `POST /api/friends/request` — send friend request (body: `{ target_id }`)
- `POST /api/friends/accept/:id` — accept incoming request
- `POST /api/friends/decline/:id` — decline incoming request
- `POST /api/friends/remove/:id` — remove a friend
- `POST /api/friends/block/:id` — block a user
- `POST /api/friends/unblock/:id` — unblock a user
- `GET /api/friends` — list accepted friends (with online status)
- `GET /api/friends/pending` — list pending requests (incoming + outgoing)
- `GET /api/friends/blocked` — list blocked users

### WebSocket Events

- `friend:requestReceived` (server→client) — someone sent you a friend request
- `friend:requestAccepted` (server→client) — your request was accepted
- `friend:removed` (server→client) — someone removed you as friend
- `friend:statusUpdate` (server→client) — a friend's online status changed

### Blocking Behavior

- Blocked user cannot: send friend requests, open DMs, see blocker in user lists
- Blocker sees blocked user removed from all friend/DM/user lists
- Existing DM channel is hidden (not deleted) from both sides
- If both block each other, both sides hidden

### Home View (replaces current DM view)

When the Home icon is active, the sidebar shows:

- **Add Friend bar** at top — search by username, send request button
- **Tab navigation:** Friends | Pending | Blocked
- **Friends tab:** List of accepted friends with online status, DM button, call button
- **Pending tab:** Incoming requests (accept/decline), outgoing requests (cancel)
- **Blocked tab:** Blocked users with unblock button

Below the tabs:
- **DM Conversations list** — the DM list currently in NavDock moves here, sorted by most recent message

Main content area when Home is active:
- If a DM is selected: DM chat (unchanged)
- If no DM selected: Welcome splash with online friends as quick-access cards and recent DMs

## 2. NavDock Overhaul

### Layout (top to bottom)

1. **Home button** (replaces logo/compass) — house icon, clicking switches to Home view
2. **Separator**
3. **Server list** — server icons with new indicators
4. **Add Server button** (+)
5. **Admin button** (shield, admin only)

DM avatars are removed from the NavDock entirely — they now live in the Home sidebar.

### Active Pill Indicator

A white rounded pill on the left edge of the NavDock:
- Active item: 8px tall pill, animated slide to position
- Hovered item: 4px tall pill
- Transition: 200ms ease-out on height and translateY

### Server Icon Shape Morph

- Default: circle (border-radius: 50%)
- Hover: rounded square (border-radius: 16px), scale 1.08
- Active: rounded square (border-radius: 16px), persists until deselected
- Transition: 200ms ease-out

### Unread/Mention Badges Per Server

- Unread (any channel has unread messages): small white dot, bottom-right of server icon
- Mentions: red badge with count, bottom-right, replaces the dot
- Badges pulled from existing `unreadCounts` and `mentionCounts` stores, aggregated per server

### Tooltips

- Hover on server icon shows tooltip to the right
- Contains server name
- Small arrow/caret pointing left
- CSS-only (::after pseudo-element), no JS library
- 200ms delay before appearing

### Website Link

Moved to personal Settings modal — small link in the settings sidebar footer, alongside version info.

## 3. No-Server Empty State

When a user has no servers:
- Sidebar shows Home view (friends list / add friend bar)
- Main content shows a welcome splash:
  - Platform name heading
  - Two action cards side by side:
    - "Create a Server" (if instance allows server creation) — opens create server modal
    - "Join a Server" — opens invite code input or shows pending server invitations
  - Below: "Add some friends" section with the add-friend search bar

When app loads with no `lastServerId`:
- Default to Home view instead of empty state

## 4. Visual Polish

### Context Menu Consistency

Standardize all context menus to use glassmorphism:
```css
background: var(--glass-bg);
backdrop-filter: blur(16px);
border: 1px solid var(--glass-border-bright);
box-shadow: var(--glass-shadow), var(--glass-glow);
```

Replace any context menus using `--bg-dark` background.

### Typography Scale

Add CSS custom properties to `app.css`:
```css
--font-xs: 0.75rem;
--font-sm: 0.85rem;
--font-md: 0.95rem;
--font-lg: 1.1rem;
--font-xl: 1.3rem;
```

Use these throughout components instead of hardcoded rem values.

### Active State Consistency

- **NavDock:** Pill indicator (left edge) + shape morph
- **Sidebar channels:** Background `var(--bg-active)` + left accent border
- **Tabs:** Bottom border with `var(--accent)`
- Remove box-shadow active states in favor of the above patterns

### Server Switch Transition

When `activeServerId` changes, add a subtle transition on the sidebar channel list:
- 100ms opacity fade out → swap content → 100ms opacity fade in
- Prevents the hard "flash" when switching servers
