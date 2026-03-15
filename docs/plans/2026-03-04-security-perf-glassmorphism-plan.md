# Security, Performance & Glassmorphism Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden security headers, add missing DB indexes with settings/roles cache, and apply a glassmorphism visual refresh across all three themes.

**Architecture:** Server-side changes are isolated to `server/src/index.ts` and `server/src/db/schema.ts` plus two route files. Client-side changes center on `client/src/app.css` design tokens, then propagate glass effects through ~15 Svelte components. No new dependencies needed.

**Tech Stack:** Fastify (security headers via onSend hook), SQLite (CREATE INDEX), CSS (backdrop-filter, rgba backgrounds, CSS custom properties), Svelte 5

---

## Task 1: Add Security Headers

**Files:**

- Modify: `server/src/index.ts:38-52` (after plugin registration, before routes)

**Step 1: Add onSend hook for security headers**

Insert after line 52 (after `fastifyMultipart` registration) and before line 54 (`mkdirSync`):

```typescript
// Security headers
app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  reply.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' blob: data: https://*.giphy.com",
      "media-src 'self' blob:",
      "connect-src 'self' wss: https://api.giphy.com",
      'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
    ].join('; '),
  );
  return payload;
});
```

**Step 2: Verify the server starts**

Run: `cd /home/coder/projects/voip && npm run dev:server`
Expected: Server starts without errors. Check curl headers:

```bash
curl -sI http://localhost:3000/api/health | grep -iE 'x-frame|content-security|strict-transport|referrer-policy|permissions-policy|x-content-type'
```

Expected: All 5-6 headers present in response.

**Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy)"
```

---

## Task 2: Add Database Indexes

**Files:**

- Modify: `server/src/db/schema.ts:591-605` (after audit log table, before closing brace of `initSchema()`)

**Step 1: Add index creation statements**

Insert after line 605 (after the audit log indexes `db.exec` block closes with `);`), before line 606 (the closing `}` of `initSchema()`):

```typescript
// Performance indexes for frequently queried foreign keys
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
    CREATE INDEX IF NOT EXISTS idx_dm_participants_user_id ON dm_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_channels_group_id ON channels(group_id);
    CREATE INDEX IF NOT EXISTS idx_channel_perm_overrides_channel ON channel_permission_overrides(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_access_roles_channel ON channel_access_roles(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_access_users_channel ON channel_access_users(channel_id);
  `);
```

**Step 2: Verify server starts with new indexes**

Run: `cd /home/coder/projects/voip && npm run dev:server`
Expected: Server starts without errors. Indexes created silently (IF NOT EXISTS).

**Step 3: Commit**

```bash
git add server/src/db/schema.ts
git commit -m "perf: add missing database indexes on frequently queried foreign keys"
```

---

## Task 3: Add Settings & Roles Cache

**Files:**

- Modify: `server/src/routes/server-settings.ts:8-23` (getSettings function)
- Modify: `server/src/routes/roles.ts:28-31` (GET /api/roles handler)

**Step 1: Add cache to server-settings.ts**

At the top of the file (after imports), add a cache variable and modify `getSettings()`:

```typescript
// In-memory cache for server settings (invalidated on update)
let settingsCache: ReturnType<typeof getSettings> | null = null;

function getSettings() {
  if (settingsCache) return settingsCache;
  // ... existing query logic ...
  settingsCache = result;
  return result;
}

// Call this whenever settings are updated (in the PUT handler)
function invalidateSettingsCache() {
  settingsCache = null;
}
```

Add `invalidateSettingsCache()` call inside the existing PUT `/api/server-settings` handler, right after the DB update succeeds.

**Step 2: Add cache to roles.ts**

At the top of the file (after imports), add a cache variable:

```typescript
// In-memory cache for roles list (invalidated on create/update/delete/reorder)
let rolesCache: any[] | null = null;

function invalidateRolesCache() {
  rolesCache = null;
}
```

In the GET `/api/roles` handler, check cache first:

```typescript
app.get('/api/roles', { preHandler: [requireAuth] }, async () => {
  if (rolesCache) return rolesCache;
  const rows = db.prepare('SELECT * FROM roles ORDER BY position').all() as any[];
  const parsed = rows.map((r) => ({ ...r, permissions: JSON.parse(r.permissions) }));
  rolesCache = parsed;
  return parsed;
});
```

Add `invalidateRolesCache()` calls in POST (create), PUT (update), PUT (reorder), PUT (set default), and DELETE handlers — right after their DB operations succeed.

**Step 3: Verify caching works**

Run: `cd /home/coder/projects/voip && npm run dev:server`
Expected: Server starts. GET /api/roles and GET /api/server-settings return same data as before.

**Step 4: Commit**

```bash
git add server/src/routes/server-settings.ts server/src/routes/roles.ts
git commit -m "perf: add in-memory cache for server settings and roles with invalidation on update"
```

---

## Task 4: Add Glassmorphism Design Tokens

**Files:**

- Modify: `client/src/app.css:1-81` (:root block)
- Modify: `client/src/app.css:162-194` (theme-light block)
- Modify: `client/src/app.css:196-228` (theme-dark block)

**Step 1: Add glass tokens to :root**

After line 62 (`--bg-nav-gradient`), add:

```css
/* Glass effects */
--glass-bg: rgba(14, 14, 26, 0.65);
--glass-bg-heavy: rgba(8, 8, 15, 0.75);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-border-bright: rgba(255, 255, 255, 0.12);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
--glass-glow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
--glass-tint: rgba(124, 92, 252, 0.03);
```

Update existing shadow tokens for softer, larger shadows (replace lines 39-41):

```css
--shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
--shadow-lg: 0 8px 40px rgba(0, 0, 0, 0.4);
--shadow-glow: 0 0 24px var(--accent-glow);
```

Update existing border tokens for slightly brighter glass borders (replace lines 45-46):

```css
--border: rgba(255, 255, 255, 0.08);
--border-light: rgba(255, 255, 255, 0.12);
```

**Step 2: Add glass tokens to theme-light**

After line 193 (`--bg-nav-gradient`) in the `html.theme-light` block, add:

```css
--glass-bg: rgba(255, 255, 255, 0.7);
--glass-bg-heavy: rgba(255, 255, 255, 0.8);
--glass-border: rgba(0, 0, 0, 0.06);
--glass-border-bright: rgba(0, 0, 0, 0.1);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
--glass-glow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
--glass-tint: rgba(88, 101, 242, 0.02);
```

**Step 3: Add glass tokens to theme-dark**

After line 227 (`--bg-nav-gradient`) in the `html.theme-dark` block, add:

```css
--glass-bg: rgba(13, 13, 13, 0.7);
--glass-bg-heavy: rgba(0, 0, 0, 0.8);
--glass-border: rgba(255, 255, 255, 0.06);
--glass-border-bright: rgba(255, 255, 255, 0.1);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
--glass-glow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
--glass-tint: transparent;
```

**Step 4: Add global glass utility class**

After the `:root` closing brace (line 81), add:

```css
/* Glass panel mixin — apply to panels, modals, menus */
.glass-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow), var(--glass-glow);
}
```

**Step 5: Update accent button styling**

After the `button:disabled` rule (line 125), add:

```css
button.btn-accent {
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-muted) 100%);
  box-shadow: 0 2px 12px var(--accent-glow);
}

button.btn-accent:hover {
  background: linear-gradient(135deg, var(--accent-hover) 0%, var(--accent) 100%);
}
```

**Step 6: Verify client builds**

Run: `cd /home/coder/projects/voip && npm run dev:client`
Expected: Client dev server starts, no CSS errors.

**Step 7: Commit**

```bash
git add client/src/app.css
git commit -m "feat: add glassmorphism design tokens and glass utility class for all three themes"
```

---

## Task 5: Apply Glass to NavDock

**Files:**

- Modify: `client/src/lib/components/NavDock.svelte:412` (`.nav-dock` background)
- Modify: `client/src/lib/components/NavDock.svelte:691-707` (`.plus-popup` background)

**Step 1: Update NavDock background**

Change line 412 from:

```css
background: var(--bg-nav-gradient);
```

to:

```css
background: var(--glass-bg-heavy);
background-image: linear-gradient(180deg, var(--glass-tint), transparent);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border-right: 1px solid var(--glass-border);
```

**Step 2: Update plus-popup to glass**

Change `.plus-popup` (lines 691-707) background from:

```css
background: var(--bg-dark);
border: 1px solid var(--border-light);
```

to:

```css
background: var(--glass-bg);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border: 1px solid var(--glass-border-bright);
box-shadow: var(--glass-shadow), var(--glass-glow);
```

**Step 3: Add aria-labels to icon-only buttons**

Find the folder toggle button (~line 279) and add `aria-label="Toggle group"`.
Find the plus back button (~line 361) and add `aria-label="Back"`.

**Step 4: Commit**

```bash
git add client/src/lib/components/NavDock.svelte
git commit -m "feat: apply glass effect to NavDock and plus popup, add aria-labels"
```

---

## Task 6: Apply Glass to Sidebar

**Files:**

- Modify: `client/src/lib/components/Sidebar.svelte:174` (`.sidebar` background)
- Modify: `client/src/lib/components/Sidebar.svelte:192-200` (`.ctx-menu` background)

**Step 1: Update Sidebar background**

Change line 174 from:

```css
background: var(--bg-darker);
```

to:

```css
background: var(--glass-bg);
background-image: linear-gradient(180deg, var(--glass-tint), transparent);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border-right: 1px solid var(--glass-border);
```

**Step 2: Update context menu to glass**

Change `.ctx-menu` (lines 192-200) from:

```css
background: var(--bg-dark);
border: 1px solid var(--border-light);
```

to:

```css
background: var(--glass-bg);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border: 1px solid var(--glass-border-bright);
box-shadow: var(--glass-shadow), var(--glass-glow);
```

**Step 3: Commit**

```bash
git add client/src/lib/components/Sidebar.svelte
git commit -m "feat: apply glass effect to Sidebar and group context menu"
```

---

## Task 7: Apply Glass to UserList

**Files:**

- Modify: `client/src/lib/components/UserList.svelte:124` (`.user-list` background)

**Step 1: Update UserList background**

Change line 124 from:

```css
background: var(--bg-gradient-sidebar, var(--bg-darkest));
```

to:

```css
background: var(--glass-bg);
background-image: linear-gradient(180deg, var(--glass-tint), transparent);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border-left: 1px solid var(--glass-border);
```

**Step 2: Commit**

```bash
git add client/src/lib/components/UserList.svelte
git commit -m "feat: apply glass effect to UserList panel"
```

---

## Task 8: Apply Glass to Modals

Apply consistent glass treatment to all modal overlays and modal cards.

**Files:**

- Modify: `client/src/lib/components/SettingsModal.svelte:615-640`
- Modify: `client/src/lib/components/CreateChannelModal.svelte:75-96`
- Modify: `client/src/lib/components/ChannelPermissionsModal.svelte:287-310`
- Modify: `client/src/lib/components/GroupPermissionsModal.svelte:313-336`
- Modify: `client/src/lib/components/Toast.svelte:139-165` (confirm overlay/modal)
- Modify: `client/src/lib/components/ServerSettings.svelte:80-103`

**Step 1: Update modal overlays**

For each component that has an `.overlay` with `backdrop-filter: blur(8px)`, increase to `blur(12px)`.

For SettingsModal and CreateChannelModal, update `.overlay` background from `var(--overlay)` to keep it the same (these already have blur).

**Step 2: Update modal cards**

For each `.modal` or `.confirm-modal` class, change:

```css
background: var(--bg-dark);
border: 1px solid var(--border-light);
```

to:

```css
background: var(--glass-bg);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border: 1px solid var(--glass-border-bright);
box-shadow: var(--glass-shadow), var(--glass-glow);
```

**Step 3: Update ServerSettings overlay**

ServerSettings uses a full-screen overlay (not centered modal). Change `.overlay` (line 80-86):

```css
background: var(--bg-darkest);
```

to:

```css
background: var(--glass-bg-heavy);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
```

Update `.settings-nav` (line 94-103) background from solid to glass:

```css
background: var(--glass-bg);
border-right: 1px solid var(--glass-border);
```

**Step 4: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte client/src/lib/components/CreateChannelModal.svelte client/src/lib/components/ChannelPermissionsModal.svelte client/src/lib/components/GroupPermissionsModal.svelte client/src/lib/components/Toast.svelte client/src/lib/components/ServerSettings.svelte
git commit -m "feat: apply glass effect to all modal overlays and cards"
```

---

## Task 9: Apply Glass to Context Menus, Pickers & Popovers

**Files:**

- Modify: `client/src/lib/components/ChannelContextMenu.svelte:79-88` (`.context-menu`)
- Modify: `client/src/lib/components/VoiceContextMenu.svelte:105-114` (`.context-menu`)
- Modify: `client/src/lib/components/GifPicker.svelte:88-103` (`.gif-popover`)
- Modify: `client/src/lib/components/SoundboardPicker.svelte:96-110` (`.soundboard-popover`)
- Modify: `client/src/lib/components/VoiceChangerPanel.svelte:107-119` (`.vc-popover`)
- Modify: `client/src/lib/components/QuickSwitcher.svelte:105-114` (`.qs-modal`)
- Modify: `client/src/lib/components/MessageInput.svelte:506-520` (`.mention-popup`)
- Modify: `client/src/lib/components/SidebarHeader.svelte:145-157` (`.plus-menu`)
- Modify: `client/src/lib/components/SidebarFooter.svelte:232-244` (`.status-picker`)
- Modify: `client/src/lib/components/VoiceControls.svelte:370-382` (`.watch-url-popup`)

**Step 1: Apply glass to all context menus and popovers**

For each component's popup/popover/context-menu class, replace:

```css
background: var(--bg-dark);
border: 1px solid var(--border-light); /* or var(--border) */
```

with:

```css
background: var(--glass-bg);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border: 1px solid var(--glass-border-bright);
box-shadow: var(--glass-shadow), var(--glass-glow);
```

**Step 2: Update QuickSwitcher overlay**

Change `.qs-overlay` (line 88) background from `rgba(0, 0, 0, 0.6)` to `var(--overlay)` with `backdrop-filter: blur(8px)`.

Change `.qs-modal` (line 105) to use glass:

```css
background: var(--glass-bg);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border: 1px solid var(--glass-border-bright);
box-shadow: var(--glass-shadow), var(--glass-glow);
```

**Step 3: Commit**

```bash
git add client/src/lib/components/ChannelContextMenu.svelte client/src/lib/components/VoiceContextMenu.svelte client/src/lib/components/GifPicker.svelte client/src/lib/components/SoundboardPicker.svelte client/src/lib/components/VoiceChangerPanel.svelte client/src/lib/components/QuickSwitcher.svelte client/src/lib/components/MessageInput.svelte client/src/lib/components/SidebarHeader.svelte client/src/lib/components/SidebarFooter.svelte client/src/lib/components/VoiceControls.svelte
git commit -m "feat: apply glass effect to all context menus, pickers, and popovers"
```

---

## Task 10: Apply Glass to Chat Input & Toast

**Files:**

- Modify: `client/src/lib/components/MessageInput.svelte:386-395` (`.input-bar`)
- Modify: `client/src/lib/components/Toast.svelte:59-99` (toast styling)

**Step 1: Update chat input bar**

Change `.input-bar` (line 386-395) to add subtle glass:

```css
.input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
  transition: background 150ms var(--ease-out);
  position: relative;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
```

**Step 2: Update toast styling to glass**

Change `.toast-info`, `.toast-success`, `.toast-error`, `.toast-warning` backgrounds (lines 77-99) from `var(--bg-dark)` to:

```css
background: var(--glass-bg);
backdrop-filter: blur(16px);
-webkit-backdrop-filter: blur(16px);
border: 1px solid var(--glass-border-bright);
```

Keep the left-border color accents for each type (success=green, error=red, etc.).

**Step 3: Add aria-live to toast container**

In the template, find the `.toast-container` div and add `aria-live="polite"` attribute:

```svelte
<div class="toast-container" aria-live="polite">
```

**Step 4: Commit**

```bash
git add client/src/lib/components/MessageInput.svelte client/src/lib/components/Toast.svelte
git commit -m "feat: apply glass effect to chat input and toasts, add aria-live to toast container"
```

---

## Task 11: Add aria-labels to Icon-Only Buttons

**Files:**

- Modify: `client/src/lib/components/MessageBubble.svelte` (action buttons ~lines 303-326)
- Modify: `client/src/lib/components/ChatPane.svelte` (header icon buttons ~lines 191-197)
- Modify: `client/src/lib/components/SidebarHeader.svelte` (icon buttons ~lines 34, 54)
- Modify: `client/src/lib/components/SidebarFooter.svelte` (footer buttons ~lines 83-90)
- Modify: `client/src/lib/components/VoiceControls.svelte` (control buttons ~lines 160-165)
- Modify: `client/src/lib/components/CallOverlay.svelte` (call buttons ~lines 57-95)

**Step 1: Add aria-label to all icon-only buttons**

For each button that has only an icon/SVG and a `title` attribute but no `aria-label`, add an `aria-label` matching the title value. Examples:

```svelte
<!-- MessageBubble action buttons -->
<button class="action-btn" title="Reply" aria-label="Reply">...</button>
<button class="action-btn" title="Add Reaction" aria-label="Add Reaction">...</button>

<!-- ChatPane header buttons -->
<button class="header-icon-btn" title="Start call" aria-label="Start call">...</button>
<button class="search-toggle" title="Search messages" aria-label="Search messages">...</button>

<!-- SidebarHeader -->
<button class="icon-btn" title="Create" aria-label="Create">...</button>
<button class="icon-btn" title="Server Settings" aria-label="Server Settings">...</button>

<!-- SidebarFooter -->
<button class="footer-btn" title="Mute" aria-label="Mute">...</button>
<button class="footer-btn" title="Deafen" aria-label="Deafen">...</button>
<button class="footer-btn" title="User Settings" aria-label="User Settings">...</button>

<!-- VoiceControls -->
<button class="voice-status-btn" title="Share Screen" aria-label="Share Screen">...</button>
<button class="voice-disconnect-btn" title="Disconnect" aria-label="Disconnect">...</button>
```

**Step 2: Commit**

```bash
git add client/src/lib/components/MessageBubble.svelte client/src/lib/components/ChatPane.svelte client/src/lib/components/SidebarHeader.svelte client/src/lib/components/SidebarFooter.svelte client/src/lib/components/VoiceControls.svelte client/src/lib/components/CallOverlay.svelte
git commit -m "a11y: add aria-label to all icon-only buttons across components"
```

---

## Task 12: Final Verification & Polish

**Step 1: Build the client**

Run: `cd /home/coder/projects/voip && npm run build`
Expected: Clean build with no errors.

**Step 2: Start the full stack**

Run: `cd /home/coder/projects/voip && npm run dev`
Expected: Both server and client start without errors.

**Step 3: Verify security headers**

```bash
curl -sI http://localhost:3000/api/health | grep -iE 'x-frame|content-security|referrer-policy|permissions-policy|x-content-type'
```

Expected output should show all 5 security headers.

**Step 4: Visual check**

Open the app in a browser. Verify:

- NavDock, Sidebar, UserList have frosted glass backgrounds
- Modals open with glass panel effect
- Context menus and pickers show glass styling
- Chat input has subtle glass effect
- Toasts appear with glass styling
- Switch between all 3 themes (Midnight Blue, Dark, Light) — glass should adapt
- Light theme should show white glass effect
- Text remains readable against glass backgrounds (WCAG AA contrast)

**Step 5: Final commit if any polish needed**

```bash
git add -A
git commit -m "chore: final glassmorphism polish and tweaks"
```
