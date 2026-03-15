# Security, Performance & Glassmorphism Visual Refresh

**Date**: 2026-03-04
**Scope**: Security hardening, database performance, glassmorphism UI refresh
**Target**: Public-facing small server (1-20 users)
**Approach**: Security first, then DB indexes/caching, then visual refresh

---

## 1. Security Hardening

Add security headers middleware via `fastify.addHook('onSend')` in `server/src/index.ts`.

### Headers

| Header                    | Value                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content-Security-Policy   | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' wss: https://api.giphy.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains`                                                                                                                                                                                                                                                             |
| X-Frame-Options           | `DENY`                                                                                                                                                                                                                                                                                            |
| Referrer-Policy           | `strict-origin-when-cross-origin`                                                                                                                                                                                                                                                                 |
| Permissions-Policy        | `camera=(), microphone=(self), geolocation=()`                                                                                                                                                                                                                                                    |
| X-Content-Type-Options    | `nosniff` (extend to all responses, not just uploads)                                                                                                                                                                                                                                             |

### Files Changed

- `server/src/index.ts` — add `onSend` hook

---

## 2. Database Performance

### New Indexes

Add to `server/src/db/schema.ts`:

```sql
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_dm_participants_user_id ON dm_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_group_id ON channels(group_id);
CREATE INDEX IF NOT EXISTS idx_channel_permission_overrides_channel_id ON channel_permission_overrides(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_access_roles_channel_id ON channel_access_roles(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_access_users_channel_id ON channel_access_users(channel_id);
```

### Settings & Roles Cache

Add in-memory cache for server settings and roles (queried on every client connection, rarely change). Pattern: cache with invalidation on update, similar to existing `channelAccessCache`.

### Files Changed

- `server/src/db/schema.ts` — add index creation statements
- `server/src/routes/channels.ts` or relevant query files — add settings/roles cache with invalidation

---

## 3. Glassmorphism Visual Refresh

### New Design Tokens

Add to `client/src/app.css` `:root`:

```css
--glass-bg: rgba(14, 14, 26, 0.65);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-blur: blur(16px);
--glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
--glass-glow: 0 0 0 1px rgba(255, 255, 255, 0.06);
```

### Element Treatments

| Element           | Background            | Effect                                                  |
| ----------------- | --------------------- | ------------------------------------------------------- |
| NavDock           | `rgba(8,8,15,0.7)`    | `backdrop-filter: blur(20px)`                           |
| Sidebar           | `rgba(14,14,26,0.65)` | `backdrop-filter: blur(16px)`, subtle right border glow |
| User list         | Match sidebar         | Glass panel                                             |
| Modals            | Frosted glass panel   | Backdrop `rgba(0,0,0,0.5)` with `blur(8px)`             |
| Context menus     | Glass effect          | 1px luminous border                                     |
| Chat input        | Subtle glass          | Bottom border blur                                      |
| Tooltips/popovers | Glass                 | Soft shadow                                             |

### Theme-Specific Glass

- **Midnight Blue** (default): Purple-tinted glass — `rgba(124,92,252,0.03)` tint
- **Dark**: Neutral glass — pure transparency, no color tint
- **Light**: White glass — `rgba(255,255,255,0.7)`, glassmorphism shines here

### Polish Details

- Softer, larger shadows (more spread, lower opacity)
- Subtle gradient on accent buttons (linear-gradient with slight highlight)
- Brighter glass borders replacing solid rgba borders
- Faint inner glow on active/selected states

### Accessibility (bundled in)

- Add `aria-label` to all icon-only buttons
- Add `aria-live="polite"` for toast notifications and chat messages
- Verify WCAG AA contrast ratios against blurred glass backgrounds

### Not Changing

- Layout structure (NavDock + Sidebar + Chat + UserList)
- Component logic
- Animation timings (150ms)
- Typography (Inter)
- No new dependencies (`backdrop-filter` is native CSS)

### Files Changed

- `client/src/app.css` — design tokens, glass styles, theme overrides
- `client/src/lib/components/NavDock.svelte` — glass background
- `client/src/lib/components/Sidebar.svelte` — glass background
- `client/src/lib/components/UserList.svelte` — glass background
- `client/src/lib/components/ChatPane.svelte` — glass input area
- `client/src/lib/components/Toast.svelte` — glass + aria-live
- All modal/dropdown/context menu components — glass effects
- All icon-only button components — add aria-label
