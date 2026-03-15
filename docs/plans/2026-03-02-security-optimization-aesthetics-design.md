# SellServ Voice: Security, Optimization & Aesthetics Improvements

**Date:** 2026-03-02
**Approach:** Layered Bottom-Up (Security -> Optimization -> Aesthetics)

---

## Phase 1: Security Hardening

### 1A. Input Validation Fixes

**Role color validation**

- Enforce hex-only format (`/^#[0-9a-fA-F]{6}$/`) in `server/src/routes/roles.ts` create/update routes
- Closes CSS injection vector in `MessageBubble.svelte` where `role.color` is embedded in style attributes

**Channel topic length limit**

- Add 512-char max length validation in `server/src/routes/channels.ts` update route
- Currently no server-side bound on topic length

**Forgot-password user enumeration**

- Return generic success response regardless of whether username exists
- Present unified "check your email or authenticator app" message instead of revealing configured MFA method
- Silent no-op if user doesn't exist

### 1B. Defense-in-Depth

**CSRF token (double-submit cookie)**

- Generate random token on auth, set as cookie
- Require matching `X-CSRF-Token` header on all state-changing requests (POST/PUT/DELETE)
- `client/src/lib/api.ts` wrapper automatically includes the header
- Files: `server/src/auth/jwt.ts`, `server/src/auth/middleware.ts`, `client/src/lib/api.ts`

**Hash email codes**

- SHA-256 hash 6-digit codes in the in-memory Map
- Compare by hashing submitted input
- File: `server/src/email/codes.ts`

**Strengthen JWT secret validation**

- Check minimum 32 characters
- Reject common patterns (all same char, sequential, dictionary words)
- File: `server/src/config.ts`

### 1C. Audit Logging

**Schema**

```sql
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  user_id TEXT,
  target_id TEXT,
  ip TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_created_at ON audit_log(created_at);
```

**Events logged:** failed_login, successful_login, password_change, mfa_enable, mfa_disable, role_change, user_ban, user_unban, permission_change, admin_settings_change, invite_create, invite_delete

**Admin viewer:** New tab in ServerSettings with filterable, paginated audit log

**Cleanup:** Auto-delete entries >90 days via existing periodic job

---

## Phase 2: Optimization

### 2A. Client-Side Data Centralization

**Global users store**

- New file: `client/src/lib/stores/users.ts`
- Single `usersMap` writable store with `fetchUsers()` that caches and deduplicates
- Replace independent `/api/users` calls in: UserList, MessageBubble, MessageInput, NavDock, ChannelPermissionsModal
- `refreshUsers()` triggered by WS events (user joined, role changed)

**Message memory eviction**

- Limit `messagesByChannel` to 20 most recently viewed channels
- Evict oldest entry when cache exceeds limit
- Re-fetch on return to evicted channel
- File: `client/src/lib/stores/messages.ts`

### 2B. DOM Performance

**Message list virtualization**

- Virtual scroller in `ChatPane.svelte`
- Render only messages in/near viewport
- Measure heights, use spacer elements above/below
- Keep DOM node count bounded regardless of loaded message count

**Component decomposition**

Sidebar.svelte (~1600 lines) splits into:

- `SidebarHeader.svelte` - server name, status picker
- `ChannelList.svelte` - channel groups with drag-drop
- `VoiceControls.svelte` - mute/deafen/screenshare/disconnect
- `SidebarPanels.svelte` - soundboard/watch-together/voice-changer container

ServerSettings.svelte (~1300 lines) splits into:

- `GeneralSettings.svelte`
- `RolesSettings.svelte`
- `InvitesSettings.svelte`
- `SoundboardSettings.svelte`
- `EmojiSettings.svelte`
- `UserManagement.svelte`
- `BotSettings.svelte`
- `AuditLogViewer.svelte` (new from Phase 1)

### 2C. Server Scaling

**Multi-worker mediasoup**

- Spawn one worker per CPU core (configurable max via env var)
- Round-robin new rooms across workers
- File: `server/src/media/worker.ts`

**Optimize broadcast serialization**

- Pre-serialize JSON payload once per broadcast
- Send same string to all connections passing channel access check
- File: `server/src/ws/index.ts`

**Cache channel access checks**

- Cache `getUsersWithChannelAccess()` result per channel with 5s TTL
- Invalidate on permission/role changes
- File: `server/src/auth/permissions.ts`

---

## Phase 3: Aesthetics

### 3A. Component Polish

**Micro-interactions**

- Buttons: `transform: scale(0.97)` on active
- Channel list: smooth highlight slide on hover
- Voice avatars: soft glow animation when speaking (replace border-only indicator)
- All interactive elements: subtle hover/active transitions

**Loading states**

- Add skeleton/spinner to: settings modal device loading, role/permission saves, invite code generation, soundboard upload

**Toast improvements**

- Slide-in animation from right
- Auto-dismiss progress bar
- Stack multiple toasts with proper spacing

**Smooth transitions**

- Channel switching animation
- Sidebar open/close on mobile
- Settings tab transitions

### 3B. Layout/UX Flow

**Mobile experience**

- Swipe gestures for sidebar open/close
- Bottom sheet for channel switching
- Floating action button for compose
- Minimum 44px touch targets
- Mobile-optimized voice call UI

**Keyboard navigation**

- `Ctrl+K` quick switcher for channels/DMs
- `Escape` to close modals consistently
- Arrow key navigation in channel list
- Focus trapping in modals

**Empty states**

- Meaningful empty states for: no messages, no search results, no DMs, no channels
- Illustrations or icons with helpful text

### 3C. Visual Identity

**Refined color palette**

- Evolve purple accent into distinctive palette
- Secondary accent: teal for success/voice actions, amber for warnings
- Subtle gradient backgrounds for sidebar and nav dock

**Typography hierarchy**

- Channel names: medium weight
- Timestamps: lighter weight, slightly smaller
- Message content: line-height 1.5
- Section headers: subtle letter-spacing

**Icon system**

- Wrapper component for existing inline SVGs
- Consistent sizing, color inheritance, hover animations
- Not a new library - wraps existing SVGs for maintainability

**Avatar enhancements**

- Status indicator dots (online/idle/dnd/offline) across all views
- Subtle ring effect on hover
- Smooth image loading with placeholder backgrounds
