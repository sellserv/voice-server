# App GUI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul Watch Together (embedded in main content area), Soundboard, and Voice Changer to a polished Discord Activities aesthetic.

**Architecture:** Watch Together moves from a floating overlay to an embedded view that replaces the chat area when active. Soundboard and Voice Changer keep their popover pattern but get wider panels, better spacing, custom-styled sliders, and entry animations.

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`), SvelteKit, CSS custom properties (see `client/src/app.css` for theme vars).

---

### Task 1: Create WatchTogetherView.svelte (embedded component)

**Files:**

- Create: `client/src/lib/components/WatchTogetherView.svelte`

This replaces the floating `WatchTogetherViewer.svelte`. It fills the main content area (`flex: 1`). Keep all YouTube player logic identical — only the layout/chrome changes.

**Step 1: Create the new component**

The component receives the same props as the old viewer. The structure is:

- Header bar with host info and Leave button
- Body: video panel (flex: 1) + right sidebar (~280px)
- Sidebar: viewers list + queue section with input

Key differences from old component:

- No drag logic (no `onMouseDown`, `onMouseMove`, `onMouseUp`, no `pos`/`size` state)
- No `position: fixed` — uses `display: flex; flex-direction: column; height: 100%` to fill parent
- Wider sidebar (280px vs 220px)
- Styled header bar with host avatar, crown, and red Leave button
- Larger viewer avatars (28px vs 22px)
- Fade-in animation on mount
- Empty state with pulse animation on play icon

Copy all YouTube player logic from `WatchTogetherViewer.svelte` (lines 45-198: `loadYouTubeApi`, `createPlayer`, `destroyPlayer`, `startHostSync`, sync `$effect`, `onMount`, `onDestroy`, `handleQueueSubmit`, context menu logic). This logic is unchanged.

The template and styles are completely new — refer to the design doc at `docs/plans/2026-03-03-app-gui-redesign-design.md` for the layout diagram.

CSS notes (use existing theme vars from `client/src/app.css`):

- Header: `background: var(--bg-darker)`, `border-bottom: 1px solid var(--border)`
- Leave button: `background: var(--danger)`, hover `var(--danger-hover)`
- Crown icon: `color: var(--warning)`
- Video area: `background: #000`
- Sidebar: `background: var(--bg-dark)`, `border-left: 1px solid var(--border)`
- Queue active item: `border-left: 2px solid var(--accent)`
- Input focus: `border-color: var(--accent)`, `box-shadow: 0 0 12px var(--accent-glow)`
- Fade-in: `@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`, `animation: fadeIn 200ms var(--ease-out)`
- Empty state pulse: `@keyframes pulse { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }` on the play SVG

**Step 2: Verify build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds (component isn't mounted yet, but should compile)

**Step 3: Commit**

```
git add client/src/lib/components/WatchTogetherView.svelte
git commit -m "feat: create embedded WatchTogetherView component"
```

---

### Task 2: Wire WatchTogetherView into page routing

**Files:**

- Modify: `client/src/routes/+page.svelte`
- Modify: `client/src/routes/+layout.svelte`

**Step 1: Update +page.svelte to show WatchTogetherView when session is active**

Add import for `watchSession` store and `WatchTogetherView` component. Add a new top-level condition before the existing channel logic:

In `client/src/routes/+page.svelte`, the script block (lines 1-8) needs:

```typescript
import { watchSession } from '$lib/stores/watchTogether';
import WatchTogetherView from '$lib/components/WatchTogetherView.svelte';
```

The template (lines 10-41) changes to add a watch session check. After the `{#if !$currentUser}` / `LoginPage` block, before `{:else if $activeChannel}`, add:

```svelte
{:else if $watchSession}
  <WatchTogetherView
    videoId={$watchSession.videoId}
    hostUserId={$watchSession.hostUserId}
    hostUsername={$watchSession.hostUsername}
    isHost={$watchSession.hostUserId === $currentUser?.id}
    queue={$watchQueue}
    viewers={$watchViewers}
    onleave={handleLeaveWatch}
  />
```

Also import `watchQueue`, `watchViewers`, `leaveWatch`, `stopWatch` from the watch store. Add a `handleLeaveWatch` function similar to `handleCloseWatchViewer` in +layout.svelte:

```typescript
function handleLeaveWatch() {
  leaveWatch();
  if ($watchSession && $currentUser && $watchSession.hostUserId === $currentUser.id) {
    stopWatch();
  }
}
```

**Step 2: Remove floating WatchTogetherViewer from +layout.svelte**

In `client/src/routes/+layout.svelte`:

- Remove the `WatchTogetherViewer` import (line 27)
- Remove the `showWatchViewer` state (line 37)
- Remove the `handleCloseWatchViewer` function (lines 353-360)
- In the `watch:started` case (line 209-217): remove the `showWatchViewer = true` line (keep the `watchSession.set(...)` call)
- Remove the `{#if showWatchViewer && $watchSession}` rendering block (lines 470-480)
- Clean up any unused imports (`leaveWatch`, `stopWatch` if only used in the removed function — check first)

**Step 3: Verify build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```
git add client/src/routes/+page.svelte client/src/routes/+layout.svelte
git commit -m "feat: embed Watch Together in main content area, remove floating viewer"
```

---

### Task 3: Delete old WatchTogetherViewer.svelte

**Files:**

- Delete: `client/src/lib/components/WatchTogetherViewer.svelte`

**Step 1: Delete the file**

```bash
rm client/src/lib/components/WatchTogetherViewer.svelte
```

**Step 2: Verify no remaining imports**

Search for any remaining references:

```bash
grep -r "WatchTogetherViewer" client/src/
```

Expected: No results (already removed import in Task 2)

**Step 3: Verify build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```
git add -A
git commit -m "chore: delete old floating WatchTogetherViewer component"
```

---

### Task 4: Refresh SoundboardPicker.svelte

**Files:**

- Modify: `client/src/lib/components/SoundboardPicker.svelte`

**Step 1: Update the component**

Changes to make in `client/src/lib/components/SoundboardPicker.svelte`:

Template changes:

- Add a speaker SVG icon in the header next to "Soundboard" text
- Replace the native `<input type="range">` with a custom slider: a `<div class="slider-track">` containing a `<div class="slider-fill">` (width bound to volume %) and a `<div class="slider-thumb">`. Use `onpointerdown`/`onpointermove`/`onpointerup` on the track to calculate position. Keep the hidden `<input type="range">` for accessibility or replace entirely with the custom implementation.
- Add a small speaker SVG icon (12x12) before each sound button name
- Add a click animation class that briefly applies on button press

Style changes:

- `.soundboard-popover`: width `320px` (was 280px)
- `.sb-header`: Add `gap: 8px` for icon spacing
- `.sb-btn`: More padding (`10px 12px`), add `transform: scale(0.97)` on `:active` for click feedback, add speaker icon flex layout
- Custom slider styles: track `height: 4px`, `background: var(--bg-light)`, `border-radius: 2px`. Fill: `background: var(--accent)`. Thumb: `width: 14px`, `height: 14px`, `border-radius: 50%`, `background: white`, `box-shadow: 0 0 4px rgba(0,0,0,0.3)`
- Add slide-up animation: `@keyframes slideUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }`, apply to `.soundboard-popover`

**Step 2: Verify build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```
git add client/src/lib/components/SoundboardPicker.svelte
git commit -m "feat: refresh Soundboard UI with wider panel, custom slider, click feedback"
```

---

### Task 5: Refresh VoiceChangerPanel.svelte

**Files:**

- Modify: `client/src/lib/components/VoiceChangerPanel.svelte`

**Step 1: Update the component**

Changes to make in `client/src/lib/components/VoiceChangerPanel.svelte`:

Template changes:

- Add a mic SVG icon in the header next to "Voice Changer" text
- Replace the native `<input type="range">` intensity slider with a custom slider (same pattern as Soundboard Task 4)
- Wrap each preset icon in a `<div class="preset-icon-circle">` for the accent-colored circle background
- Add a checkmark overlay SVG to the selected preset (positioned absolute in the icon circle)

Style changes:

- `.vc-popover`: width `320px` (was 280px)
- `.vc-preset-icon` → `.preset-icon-circle`: `width: 40px`, `height: 40px`, `border-radius: 50%`, `background: var(--bg-light)`, `display: flex`, `align-items: center`, `justify-content: center`. On `.vc-preset.selected .preset-icon-circle`: `background: var(--accent-subtle)`
- `.vc-preset`: increase padding to `10px 12px`
- SVG icons inside: `width: 24px`, `height: 24px` (was 20px)
- Checkmark overlay: `position: absolute`, `bottom: -2px`, `right: -2px`, small green circle with white check
- Custom intensity slider: same styling as Soundboard custom slider, with filled track showing accent color up to current value
- `.vc-toggle`: slightly larger hit area — `width: 40px`, `height: 22px` (was 36x20)
- Add same slide-up animation as Soundboard

**Step 2: Verify build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```
git add client/src/lib/components/VoiceChangerPanel.svelte
git commit -m "feat: refresh Voice Changer UI with wider panel, icon circles, custom slider"
```

---

### Task 6: Update VoiceControls wrapper sizing

**Files:**

- Modify: `client/src/lib/components/sidebar/VoiceControls.svelte`

**Step 1: Update panel wrapper widths**

The `.soundboard-wrapper` and `.voice-changer-wrapper` CSS in `client/src/lib/components/sidebar/VoiceControls.svelte` currently don't set a width (the inner components set their own). Verify the wider 320px panels don't overflow the sidebar. The sidebar is `var(--sidebar-width)` = 300px, but the popover components use `position: absolute` with `left: 0; right: 0` — they may need adjustment.

Check: the SoundboardPicker and VoiceChangerPanel set their own widths (`320px`). Since they're absolutely positioned above the voice controls area, they can extend beyond the sidebar width. This should be fine but verify visually after build.

No code changes needed unless overflow is observed.

**Step 2: Verify build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds

**Step 3: Commit (if changes were needed)**

```
git add client/src/lib/components/sidebar/VoiceControls.svelte
git commit -m "fix: adjust panel wrapper sizing for wider app panels"
```

---

### Task 7: Final verification

**Step 1: Full build**

Run: `cd /home/coder/projects/voip/client && npm run build`
Expected: Build succeeds with no warnings related to changed files

**Step 2: Server type check**

Run: `cd /home/coder/projects/voip/server && npx tsc --noEmit 2>&1 | grep -v "TS6059\|TS7016\|TS7006\|TS2554\|TS2352"`
Expected: No new errors (filter out pre-existing ones)

**Step 3: Push**

```
git push
```
