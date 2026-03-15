# App GUI Redesign — Design Document

## Goal

Overhaul the visual design of all three app panels (Watch Together, Soundboard, Voice Changer) to match a Discord Activities aesthetic: clean dark panels, proper spacing, smooth animations, and polished interactions.

## Watch Together — Layout Overhaul

### Current State

Floating draggable window (860x480 fixed) overlaying the chat area. Cramped 220px sidebar for viewers + queue. Drag logic, manual positioning, feels disconnected from the app.

### New Layout

Watch Together takes over the **main content area** (where ChatPane renders). No more floating window.

```
┌──────────────────────────────────────────────────────┐
│  HEADER BAR: "Watch Together" · host avatar+name · [Leave] │
├──────────────────────────┬───────────────────────────┤
│                          │  VIEWERS (avatars + names) │
│                          │  ─────────────────────────│
│    VIDEO PLAYER          │  QUEUE                    │
│    (YouTube embed)       │  1. video title...        │
│    16:9 aspect ratio     │  2. video title...        │
│                          │  ─────────────────────────│
│                          │  [Paste URL...] [+ Add]   │
└──────────────────────────┴───────────────────────────┘
```

- **Header bar**: `--bg-darker` background, bottom border. Host shown with avatar + crown icon. Red "Leave" button.
- **Video area**: Fills available space. Black background, centered 16:9 container.
- **Right panel**: ~280px wide. Viewers list (28px avatars, crown badge for host) and queue (numbered items with added-by username, currently-playing highlighted with accent border).
- **Empty state**: Large play icon with subtle pulse animation, "No video playing" text, prominent "Add a video" button.

### Integration

In `+page.svelte`, add top-level condition:

```
if watchSession active → WatchTogetherView
else if text/dm → ChatPane
else if voice → voice placeholder
else → empty state
```

- Delete the floating `WatchTogetherViewer` from `+layout.svelte`
- Create new `WatchTogetherView.svelte` designed to fill `flex: 1` main content area
- Remove all drag logic and fixed positioning
- NavDock, Sidebar, and UserList remain visible — only center content changes
- "Leave" button clears session, returns to normal chat view

### Animations

- Fade-in when Watch Together activates
- Smooth transitions on video changes
- Viewer join/leave fade in/out

## Soundboard — Visual Refresh

### Current State

280px popover, basic 2-column grid of text-only buttons, tiny default browser range slider.

### Changes

- **Width**: ~320px for breathing room
- **Header**: Speaker icon before "Soundboard" title. Custom-styled volume slider track (CSS, not default browser)
- **Sound buttons**: More padding, subtle background gradient on hover, scale animation on click for tactile feedback. Small speaker icon before each name.
- **Empty state**: Friendly icon with "No sounds yet"
- **Animation**: Panel slides up with fade on open

## Voice Changer — Visual Refresh

### Current State

280px popover, 2-column grid of presets, default browser range slider.

### Changes

- **Width**: ~320px (matches Soundboard)
- **Header**: Mic icon before "Voice Changer", toggle switch gets larger hit area
- **Preset cards**: Larger icons (32px), centered in accent-colored circle badge. Selected preset gets glowing accent border + checkmark overlay
- **Intensity slider**: Custom-styled track matching Soundboard volume slider. Track fills with accent color to show level.
- **Animation**: Same slide-up fade as Soundboard

## Files Affected

- `client/src/routes/+page.svelte` — Add watch session condition
- `client/src/routes/+layout.svelte` — Remove floating WatchTogetherViewer
- `client/src/lib/components/WatchTogetherViewer.svelte` — Delete (replaced)
- `client/src/lib/components/WatchTogetherView.svelte` — New embedded component
- `client/src/lib/components/SoundboardPicker.svelte` — Visual refresh
- `client/src/lib/components/VoiceChangerPanel.svelte` — Visual refresh
- `client/src/lib/components/sidebar/VoiceControls.svelte` — Update panel wrapper sizing
