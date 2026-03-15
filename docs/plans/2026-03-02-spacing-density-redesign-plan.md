# Spacing & Density Refinement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Systematically tighten spacing, padding, and font sizes across the entire UI to achieve Discord-level information density on an 8px grid.

**Architecture:** CSS-first approach — add spacing tokens and a new background level to `app.css`, then update each component's scoped styles. No structural/logic changes, purely visual.

**Tech Stack:** SvelteKit, Svelte 5, CSS custom properties, scoped `<style>` blocks

---

### Task 1: Add spacing tokens and background layer to app.css

**Files:**

- Modify: `client/src/app.css`

**Step 1: Add spacing tokens and `--bg-darker` to the `:root` block**

Add these CSS custom properties alongside the existing ones in `:root`:

```css
/* Spacing scale (8px grid) */
--space-1: 2px;
--space-2: 4px;
--space-3: 8px;
--space-4: 12px;
--space-5: 16px;
--space-6: 20px;
--space-7: 24px;
--space-8: 32px;
```

Add `--bg-darker: #0c0c16;` between `--bg-darkest` and `--bg-dark`.

Also update the light and dark theme variants with appropriate `--bg-darker` values:

- `html.theme-light`: `--bg-darker: #e8e8ee;`
- `html.theme-dark`: `--bg-darker: #050505;`

**Step 2: Reduce the global base font size**

Change the `html, body` font-size from `15px` to `14.5px`.

**Step 3: Verify the page still loads**

Run: `cd client && npx vite build`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add client/src/app.css
git commit -m "feat: add spacing tokens, --bg-darker, tighten base font size"
```

---

### Task 2: Tighten Sidebar spacing

**Files:**

- Modify: `client/src/lib/components/Sidebar.svelte`
- Modify: `client/src/lib/components/sidebar/SidebarHeader.svelte`
- Modify: `client/src/lib/components/sidebar/ChannelList.svelte`
- Modify: `client/src/lib/components/sidebar/SidebarFooter.svelte`
- Modify: `client/src/lib/components/sidebar/VoiceControls.svelte`

**Step 1: Update Sidebar.svelte background**

In `Sidebar.svelte`, change the `.sidebar` background from `var(--bg-dark)` to `var(--bg-darker)`.

**Step 2: Tighten SidebarHeader.svelte**

Apply these changes to the `<style>` block:

- `.sidebar-header`: padding `16px` → `12px 12px 8px`
- `.server-icon`, `.server-icon-fallback`: width/height `28px` → `24px`, font-size `0.85rem` → `0.7rem`
- `.logo`: font-size `1.1rem` → `1rem`
- `.icon-btn`: width/height `32px` → `28px`
- `.svg-icon`: width/height `18px` → `16px`
- `.plus-menu-item`: padding `8px 10px` → `6px 10px`

**Step 3: Tighten ChannelList.svelte**

Apply these changes:

- `.channel-section`: padding `12px 8px 4px` → `8px 6px 4px`
- `.section-title`: font-size `0.7rem` → `0.65rem`, padding `0 8px 8px` → `0 8px 4px`
- `.channel-btn`: padding `8px 12px` → `5px 8px`, gap `8px` → `6px`, font-size (add) `0.9rem`
- `.channel-icon`: width `20px` → `18px`
- `.voice-peers`: padding `2px 0 4px 36px` → `2px 0 2px 32px`
- `.voice-peer`: padding `4px 8px` → `2px 8px`, font-size `0.95rem` → `0.8rem`
- `.peer-avatar`: width/height `26px` → `20px`, font-size `0.75rem` → `0.6rem`

**Step 4: Tighten SidebarFooter.svelte**

Apply these changes:

- `.sidebar-footer`: padding `12px` → `8px 10px`, gap `8px` → `6px`
- `.user-avatar`: width/height `34px` → `30px`, font-size `0.9rem` → `0.8rem`
- `.user-info`: gap `10px` → `8px`
- `.user-name`: font-size `0.95rem` → `0.85rem`
- `.user-role`: font-size `0.75rem` → `0.7rem`
- `.footer-btn`: width/height `32px` → `28px`
- `.footer-status-dot`: width/height `12px` → `10px`
- `.voice-status-btn`, `.voice-disconnect-btn`: width/height `32px` → `28px`

**Step 5: Tighten VoiceControls.svelte**

Apply these changes to button sizes (any `32px` → `28px` buttons) and reduce padding on voice panels (any `10px 14px` → `8px 10px`).

**Step 6: Verify build**

Run: `cd client && npx vite build`
Expected: Build succeeds.

**Step 7: Commit**

```bash
git add client/src/lib/components/Sidebar.svelte client/src/lib/components/sidebar/
git commit -m "feat: tighten sidebar spacing and apply --bg-darker"
```

---

### Task 3: Tighten ChatPane header and search

**Files:**

- Modify: `client/src/lib/components/ChatPane.svelte`

**Step 1: Apply spacing changes**

- `.chat-header`: padding `14px 20px` → `10px 16px`
- `h2` (channel name): font-size `1.1rem` → `1rem`
- `.hash`: font-size `1.3rem` → `1.15rem`
- `.topic`: font-size `0.85rem` → `0.8rem`
- `.search-toggle`, `.header-icon-btn`: width/height `32px` → `28px`
- `.search-bar`: padding `8px 20px` → `6px 16px`
- `.search-input`: padding `8px 12px` → `6px 10px`, font-size `0.9rem` → `0.85rem`
- `.typing-indicator`: padding `4px 20px 2px` → `2px 16px 2px`
- `.dm-header-avatar`: width/height `28px` → `24px`

**Step 2: Verify build**

Run: `cd client && npx vite build`

**Step 3: Commit**

```bash
git add client/src/lib/components/ChatPane.svelte
git commit -m "feat: tighten chat header and search bar spacing"
```

---

### Task 4: Tighten MessageBubble spacing

**Files:**

- Modify: `client/src/lib/components/MessageBubble.svelte`

**Step 1: Apply spacing changes**

- `.message`: gap `12px` → `10px`, padding `6px 20px` → `4px 16px`
- `.message.grouped`: padding-left `70px` → `62px` (adjust to match new avatar+gap width)
- `.header`: gap `8px` → `6px`
- `.author`: font-size `0.95rem` → `0.9rem`
- `.time`: font-size `0.75rem` → `0.7rem`
- `.edited`: font-size `0.7rem` → `0.65rem`
- `.action-btn`: width/height `28px` → `24px`
- `.action-icon`: width/height `16px` → `14px`
- `.reactions`: gap `4px` → `3px`, margin-top `6px` → `4px`
- `.reaction-pill`: padding `4px 8px` → `2px 6px`, font-size `0.85rem` → `0.8rem`
- `.reply-ref`: padding `4px 8px` → `2px 6px`, margin-bottom `4px` → `2px`
- `.reply-ref-author`, `.reply-ref-text`: font-size `0.75rem` → `0.7rem`

**Step 2: Check that avatar size in messages matches the new grouped padding-left**

The avatar is likely ~36px wide. With gap `10px` + avatar `36px` + some padding = adjust `.message.grouped` padding-left to align text with the non-grouped message text. Look at the avatar element's width and calculate: `padding-left(16px) + avatar-width + gap(10px)`.

**Step 3: Verify build**

Run: `cd client && npx vite build`

**Step 4: Commit**

```bash
git add client/src/lib/components/MessageBubble.svelte
git commit -m "feat: tighten message bubble spacing and font sizes"
```

---

### Task 5: Tighten MessageInput spacing

**Files:**

- Modify: `client/src/lib/components/MessageInput.svelte`

**Step 1: Apply spacing changes**

- `.input-bar`: padding `12px 16px 16px` → `8px 12px 12px`
- `.attach-btn`: width/height `38px` → `32px`, font-size `1.1rem` → `1rem`
- `.picker-btn`: width/height `38px` → `32px`, font-size `0.85rem` → `0.8rem`
- `.text-input`: padding `9px 14px` → `8px 12px`
- `.send-btn`: padding `9px 18px` → `8px 14px`
- `.mention-popup`: padding `4px` → `3px`
- `.mention-item`: padding `6px 10px` → `5px 8px`
- `.mention-icon`, `.mention-avatar`: width/height `24px` → `20px`
- `.mention-label`: font-size `0.9rem` → `0.85rem`
- `.reply-preview`: padding `8px 16px` → `6px 12px`, margin `0 16px` → `0 12px`
- `.reply-preview-close`: width/height `24px` → `20px`

**Step 2: Verify build**

Run: `cd client && npx vite build`

**Step 3: Commit**

```bash
git add client/src/lib/components/MessageInput.svelte
git commit -m "feat: tighten message input spacing"
```

---

### Task 6: Tighten UserList spacing

**Files:**

- Modify: `client/src/lib/components/UserList.svelte`

**Step 1: Apply spacing changes**

- `.user-list`: padding `16px 12px` → `12px 8px`
- `.title`: font-size `0.75rem` → `0.7rem`, margin-bottom `12px` → `8px`
- `.user`: gap `10px` → `8px`, padding `6px 8px` → `4px 8px`
- `.username`: font-size `0.95rem` → `0.85rem`
- `.offline-title`: margin-top `16px` → `12px`
- `.dm-icon-btn`: width/height `28px` → `24px`

Also check the Avatar component usage — if it passes `size`, update to a smaller size (e.g., `28` → `24`).

**Step 2: Verify build**

Run: `cd client && npx vite build`

**Step 3: Commit**

```bash
git add client/src/lib/components/UserList.svelte
git commit -m "feat: tighten user list spacing"
```

---

### Task 7: Tighten LoginPage spacing

**Files:**

- Modify: `client/src/lib/components/LoginPage.svelte`

**Step 1: Apply spacing changes**

- `.login-card`: padding `40px` → `32px`, max-width `400px` → `420px`
- `.brand`: font-size `2rem` → `1.8rem`
- `.tagline`: margin-bottom `32px` → `24px`
- `.tabs`: margin-bottom `24px` → `16px`
- `.tab`: padding `10px 8px` → `8px 8px`
- `.field`: margin-bottom `16px` → `12px`, gap `6px` → `4px`
- `.field span`: font-size `0.85rem` → `0.8rem`
- `.field input`: padding `10px 14px` → `9px 12px`
- `.submit-btn`: padding `12px` → `10px`
- `.back-btn`: padding `10px` → `8px`

**Step 2: Verify build**

Run: `cd client && npx vite build`

**Step 3: Commit**

```bash
git add client/src/lib/components/LoginPage.svelte
git commit -m "feat: tighten login page spacing"
```

---

### Task 8: Tighten SettingsModal spacing

**Files:**

- Modify: `client/src/lib/components/SettingsModal.svelte`

**Step 1: Apply spacing changes**

- `.modal`: padding `28px` → `22px`, width `480px` → `460px`
- `.modal-header`: margin-bottom `20px` → `14px`
- `.section`: margin-bottom `24px` → `16px`
- `.section-title`: font-size `0.75rem` → `0.7rem`, margin-bottom `12px` → `8px`
- `.field`: margin-bottom `12px` → `10px`, gap `6px` → `4px`
- `.field span`: font-size `0.85rem` → `0.8rem`
- `.text-input`, `.field select`: padding `10px 14px` → `8px 12px`
- `.theme-grid`: gap `8px` → `6px`
- `.theme-option`: padding `10px 12px` → `8px 10px`, gap `10px` → `8px`
- `.voice-mode-btn`: padding `10px 12px` → `8px 10px`
- `.save-btn`, `.logout-btn`: padding `12px` → `10px`
- `.avatar-picker`: width/height `64px` → `56px`
- `.mfa-qr`: width/height `200px` → `180px`

**Step 2: Verify build**

Run: `cd client && npx vite build`

**Step 3: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte
git commit -m "feat: tighten settings modal spacing"
```

---

### Task 9: Tighten ServerSettings spacing

**Files:**

- Modify: `client/src/lib/components/ServerSettings.svelte`
- Modify: `client/src/lib/components/settings/GeneralSettings.svelte`
- Modify: `client/src/lib/components/settings/RolesSettings.svelte`
- Modify: `client/src/lib/components/settings/MemberManagement.svelte`
- Modify: `client/src/lib/components/settings/InvitesSettings.svelte`
- Modify: `client/src/lib/components/settings/SoundboardSettings.svelte`
- Modify: `client/src/lib/components/settings/EmojiSettings.svelte`
- Modify: `client/src/lib/components/settings/AppsSettings.svelte`
- Modify: `client/src/lib/components/settings/BotSettings.svelte`
- Modify: `client/src/lib/components/settings/AuditLogViewer.svelte`

**Step 1: Update ServerSettings.svelte**

- `.settings-nav`: width `220px` → `200px`, padding `20px 12px` → `16px 10px`
- `.nav-title`: padding `8px 12px` → `6px 10px`, margin-bottom `8px` → `4px`
- `.nav-item`: padding `8px 12px` → `6px 10px`, font-size `0.9rem` → `0.85rem`
- `.settings-content`: padding `20px 40px` → `16px 32px`
- `.content-header`: margin-bottom `24px` → `16px`
- `.content-header h2`: font-size `1.3rem` → `1.15rem`
- `.close-btn`: width/height `36px` → `32px`, font-size `22px` → `18px`

**Step 2: Tighten sub-component settings panels**

For each settings sub-component, apply a consistent pattern:

- Section titles: font-size `0.75rem` → `0.7rem`
- Field margins: `12px` → `10px`
- Input padding: `10px 14px` → `8px 12px`
- Button padding: `10px` → `8px`
- Gaps between items: reduce by 2-4px where currently >8px

These are all scoped styles, so read each file's `<style>` block and apply the same tightening pattern.

**Step 3: Verify build**

Run: `cd client && npx vite build`

**Step 4: Commit**

```bash
git add client/src/lib/components/ServerSettings.svelte client/src/lib/components/settings/
git commit -m "feat: tighten server settings and sub-panel spacing"
```

---

### Task 10: Tighten NavDock and layout spacing

**Files:**

- Modify: `client/src/lib/components/NavDock.svelte`
- Modify: `client/src/routes/+layout.svelte`

**Step 1: Tighten NavDock**

Read `NavDock.svelte` and reduce:

- Dock width: if using `--nav-dock-width` (60px), change to `56px` in app.css
- Icon sizes and gaps: reduce by ~2px
- Padding: tighten by ~2-4px

**Step 2: Update layout.svelte**

- Update `--nav-dock-width` reference if changed
- Mobile sidebar width: `260px` → `260px` (keep, already tight)
- Mobile buttons: `40px` → `44px` (increase to proper touch target)
- Reduce mobile `padding-top` from `50px` to `44px` if header height changed

**Step 3: Verify build**

Run: `cd client && npx vite build`

**Step 4: Commit**

```bash
git add client/src/lib/components/NavDock.svelte client/src/routes/+layout.svelte client/src/app.css
git commit -m "feat: tighten nav dock and layout spacing"
```

---

### Task 11: Final build and visual verification

**Step 1: Full clean build**

```bash
cd client && rm -rf build .svelte-kit && npx vite build
```

Expected: Build succeeds with 0 errors.

**Step 2: Run svelte-check**

```bash
cd client && npx svelte-check
```

Expected: 0 errors (warnings acceptable).

**Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: final spacing adjustments after visual review"
```
