# Spacing & Density Refinement Design

**Date:** 2026-03-02
**Goal:** Systematically rework spacing, padding, font sizes, and visual layering across the entire UI to achieve Discord-level information density while maintaining the app's distinct purple-accented dark theme identity.

**Approach:** Spacing-first pass — keep current component structure, standardize all spacing on an 8px grid, tighten density, and add background layering for depth.

---

## Spacing Scale

Standardize on an 8px base grid. Replace all ad-hoc pixel values with CSS custom property tokens:

| Token       | Value | Usage                                |
| ----------- | ----- | ------------------------------------ |
| `--space-1` | 2px   | Micro gaps (icon-to-text)            |
| `--space-2` | 4px   | Tight padding (badges, tags)         |
| `--space-3` | 8px   | Default inner padding, small gaps    |
| `--space-4` | 12px  | Component padding, list item padding |
| `--space-5` | 16px  | Section gaps, input padding          |
| `--space-6` | 20px  | Between sections                     |
| `--space-7` | 24px  | Modal/card padding                   |
| `--space-8` | 32px  | Large section separation             |

---

## Background Layering

Add one more background level for depth (Discord uses ~5 levels):

```
--bg-darkest: #08080f  (page/nav dock background)
--bg-darker:  #0c0c16  (sidebar background)  ← NEW
--bg-dark:    #0e0e1a  (main content)
--bg-mid:     #161625  (inputs, cards)
--bg-light:   #1e1e32  (hover states)
```

Apply `--bg-darker` to sidebar to visually separate it from the main chat area.

---

## Font Size Scale

| Element           | Current | New             |
| ----------------- | ------- | --------------- |
| Channel names     | 15px    | 14px            |
| Messages          | 15px    | 14.5px          |
| Timestamps        | 12px    | 11px            |
| Section headers   | 12px    | 11px, uppercase |
| User list names   | 14px    | 13px            |
| Input placeholder | 15px    | 14px            |

---

## Area-by-Area Changes

### Sidebar

- Channel items: reduce padding from ~12px to 6px vertical, 8px horizontal
- Channel font size: 15px → 14px
- Group headers: reduce margin, tighter letter-spacing
- Voice channel member avatars: 24px → 20px, tighter stacking
- Footer user area: reduce height from ~60px to ~52px
- Background: use `--bg-darker` instead of `--bg-dark`

### Chat Header

- Height: 50px → 44px
- Channel name font: slightly smaller
- Topic text: same line as channel name when space allows

### Messages

- Tighten vertical spacing between messages
- Compact consecutive messages from same user (no avatar repeat, less gap)
- Timestamp: smaller (11px), dimmer, positioned inline
- Reactions row: tighter spacing between reaction pills

### Message Input

- Reduce outer padding
- Input field: 14px font, 10px padding
- Action buttons (emoji, gif, upload): 32px → 28px with tighter spacing

### User List

- User row height: reduce padding
- Avatar: 32px → 28px
- Section headers ("Online — 3"): smaller (11px), tighter
- Role group separators: less vertical space

### Settings Modals

- Section spacing: 24px → 16px between sections
- Input label-to-field gap: 8px → 6px
- Button groups: tighter horizontal spacing

### Login Page

- Card max-width: 400px → 420px
- Field spacing: tighten vertical gaps between fields
- Tab buttons: more compact
