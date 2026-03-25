# Channel List Drag-and-Drop Redesign

**Date:** 2026-03-24
**Status:** Approved

## Problem

The HTML5 Drag and Drop API does not reliably initiate drags on `<button>` elements in Svelte 5. Multiple fix attempts (moving `draggable` between parent div and button, string vs boolean values, CSS overrides for `-webkit-user-drag` and `transform`) all failed. Group headers (divs) can be dragged but channel buttons cannot. The current implementation is non-functional.

## Solution

Replace the HTML5 DnD API entirely with a custom pointer-event-based drag-and-drop system. This is the same approach Discord uses — no reliance on native browser DnD. Pointer events work identically in web browsers and Electron desktop apps.

## Architecture

### New Module: `client/src/lib/components/sidebar/channelDnd.svelte.ts`

All drag state and logic lives in a standalone Svelte 5 runes module. ChannelList imports reactive state and calls exported functions. This keeps drag logic isolated and ChannelList focused on rendering.

**Exported reactive state (using `$state`):**

```typescript
dragging: { type: 'channel' | 'group'; id: string; name: string; channelType?: 'text' | 'voice' } | null
ghost: { x: number; y: number } | null
dropTarget: { position: 'above' | 'below'; targetId: string; groupId: string | null } | null
indicator: { top: number; left: number; width: number } | null
```

**Exported functions:**

- `onGripPointerDown(e: PointerEvent, type: 'channel' | 'group', id: string, name: string, channelType?: string)` — Called from grip icon's `onpointerdown`. Stores start position and item info. Calls `e.currentTarget.setPointerCapture(e.pointerId)` for reliable tracking even when the pointer leaves the Electron window.
- `getDragging()` / `getDropTarget()` / `getGhost()` / `getIndicator()` — Reactive getters for use in ChannelList template.
- `registerElement(id: string, element: HTMLElement)` / `unregisterElement(id: string)` — Called by ChannelList to register channel/group DOM elements so the module can query their bounding rects during drag.

**Internal event handling:**

- `pointermove` — Attached to `window` when a grip is pressed. Once pointer moves > 5px from start position, enters drag mode. On each move:
  1. Updates ghost position (`{ x: e.clientX, y: e.clientY }`)
  2. Iterates registered elements, gets bounding rects
  3. Finds the element whose vertical midpoint is closest to the pointer Y
  4. Sets `dropTarget` with `position: 'above'` or `'below'` based on which half of the target the pointer is in
  5. Computes `indicator` pixel coordinates from the target element's rect
- `pointerup` — Executes the reorder/move operation via existing store functions, then clears all state.
- `keydown Escape` — Cancels drag, clears all state.

### Drop Zone Rules

**When dragging a channel:**
- Over another channel row → indicator line above or below (top/bottom half check)
- Over a group header → indicator below header (move into group as first item)
- Below the last channel in a group → append to that group
- Over ungrouped area → move to ungrouped

**When dragging a group:**
- Over another group header → indicator above or below (reorder groups)
- Channel rows are ignored as drop targets

### Visual Elements

**Grip icon:**
- A 6-dot grip icon (vertical dots SVG, similar to `grip-vertical` from lucide)
- Appears on the left side of each channel row and group header on `:hover`
- Only rendered when user has `manage_channels` (for channels) or `manage_channel_groups` (for groups) permission
- Uses `onpointerdown` to initiate drag — no `draggable` attribute needed
- Cursor: `grab` on hover, `grabbing` during drag

**Ghost element:**
- Fixed-position div rendered in ChannelList when `dragging` is non-null
- Shows the channel type icon (hash/volume) + channel name, or group name
- Positioned at `ghost.x + 12, ghost.y - 12` (offset from cursor)
- Semi-transparent background, subtle shadow, rounded corners
- `pointer-events: none` so it doesn't interfere with hit testing

**Indicator line:**
- Fixed-position div rendered when `indicator` is non-null
- 2px height, accent color (`var(--accent)`) with glow (`box-shadow: 0 0 8px var(--accent-glow)`)
- Positioned using `indicator.top`, `indicator.left`, `indicator.width`
- Small circles at each end (like Discord's indicator)
- `pointer-events: none`

### API Integration

On successful drop, calls existing store functions:
- `reorderChannels(orderedIds: string[])` — reorder within a group
- `moveChannelToGroup(channelId: string, groupId: string | null)` — move between groups
- `reorderChannelGroups(orderedIds: string[])` — reorder groups

The drop handler builds the new ordered array by splicing the dragged item into the target position, matching what the API expects.

### Cleanup from ChannelList.svelte

Remove all HTML5 DnD code:

**State variables to remove:**
- `draggingChannelId`, `dragOverChannelId`, `dragOverPosition`
- `dragOverGroupId`, `dragOverBottom`, `draggingGroupId`

**Functions to remove:**
- `handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleDragEnd`
- `handleGroupDragStart`, `handleGroupDragOver`, `handleGroupDragLeave`, `handleGroupReorderDrop`, `handleGroupDragEnd`

**Template attributes to remove:**
- All `draggable`, `ondragstart`, `ondragover`, `ondragleave`, `ondrop`, `ondragend` attributes
- The `bottom-drop-zone` elements (replaced by the indicator line)

**CSS to remove:**
- `.drag-over-above`, `.drag-over-below` pseudo-element rules
- `.bottom-drop-zone`, `.bottom-drop-zone.drag-over`, `.drop-zone-label` rules
- `.group-drag-over`, `.group-dragging` rules
- `[draggable='true']` cursor rules
- `-webkit-user-drag` rules

### Desktop Compatibility

- `setPointerCapture` ensures pointermove/pointerup events continue firing even when the pointer leaves the Electron window boundaries
- The ghost element uses `position: fixed` within the app viewport (not a native OS drag ghost)
- No platform-specific code needed — pointer events behave identically in web and Electron Chromium

### File Changes Summary

| File | Action |
|------|--------|
| `client/src/lib/components/sidebar/channelDnd.svelte.ts` | **Create** — drag state + logic module |
| `client/src/lib/components/sidebar/ChannelList.svelte` | **Edit** — remove HTML5 DnD, add grip icons, render ghost/indicator, wire up pointer events via channelDnd |
