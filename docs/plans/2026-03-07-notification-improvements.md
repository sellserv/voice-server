# Notification & Unread Indicator Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add unread message counts, mention badges, tab title updates, missed call indicators, and enhanced desktop notifications.

**Architecture:** Client-side stores track unread counts (Map<channelId, number>) and mention counts separately. Tab title reflects total unread. Missed calls tracked client-side via a store populated from WS call:ended events. Mention detection parses `<@userId>` and `<@everyone>` from incoming message content.

**Tech Stack:** Svelte 5 (runes), TypeScript, writable/derived stores

---

### Task 1: Unread Count Store (channels.ts)

Convert `unreadChannels` from `Set<string>` to a count-based `Map<string, number>` so we can show badge numbers. Keep backward-compatible `unreadChannels` as a derived Set.

**Files:**

- Modify: `client/src/lib/stores/channels.ts:124-132`

**Step 1: Replace the unread store and functions**

In `client/src/lib/stores/channels.ts`, replace lines 124-132:

```typescript
// Old code:
export const unreadChannels = writable<Set<string>>(new Set());

export function markChannelUnread(channelId: string) {
  unreadChannels.update((s) => {
    s.add(channelId);
    return new Set(s);
  });
}

export function markChannelRead(channelId: string) {
  unreadChannels.update((s) => {
    s.delete(channelId);
    return new Set(s);
  });
}
```

With:

```typescript
import { derived } from 'svelte/store'; // add to existing imports if not present

export const unreadCounts = writable<Map<string, number>>(new Map());

export const unreadChannels = derived(unreadCounts, ($m) => new Set($m.keys()));

export function markChannelUnread(channelId: string) {
  unreadCounts.update((m) => {
    m.set(channelId, (m.get(channelId) || 0) + 1);
    return new Map(m);
  });
}

export function markChannelRead(channelId: string) {
  unreadCounts.update((m) => {
    m.delete(channelId);
    return new Map(m);
  });
}
```

**Step 2: Verify no import breakage**

Run: `cd /home/coder/projects/voip && npm run build`

All existing consumers of `unreadChannels` and `markChannelUnread`/`markChannelRead` should work unchanged since `unreadChannels` is now a derived Set with the same API.

**Step 3: Commit**

```bash
git add client/src/lib/stores/channels.ts
git commit -m "feat: track unread message counts per channel"
```

---

### Task 2: Mention Count Store (channels.ts)

Add a separate store for tracking @mentions per channel, plus a missed calls store.

**Files:**

- Modify: `client/src/lib/stores/channels.ts` (append after unread stores)

**Step 1: Add mention and missed call stores**

Append after the unread stores section:

```typescript
export const mentionCounts = writable<Map<string, number>>(new Map());

export function incrementMention(channelId: string) {
  mentionCounts.update((m) => {
    m.set(channelId, (m.get(channelId) || 0) + 1);
    return new Map(m);
  });
}

export function clearMentions(channelId: string) {
  mentionCounts.update((m) => {
    m.delete(channelId);
    return new Map(m);
  });
}

export const missedCalls = writable<Map<string, { callerName: string; time: Date }>>(new Map());

export function addMissedCall(channelId: string, callerName: string) {
  missedCalls.update((m) => {
    m.set(channelId, { callerName, time: new Date() });
    return new Map(m);
  });
}

export function clearMissedCall(channelId: string) {
  missedCalls.update((m) => {
    m.delete(channelId);
    return new Map(m);
  });
}
```

**Step 2: Build check**

Run: `npm run build`

**Step 3: Commit**

```bash
git add client/src/lib/stores/channels.ts
git commit -m "feat: add mention count and missed call stores"
```

---

### Task 3: Wire Up Mention Detection & Missed Calls (+layout.svelte)

Detect @mentions in incoming messages and track missed calls from call:ended events.

**Files:**

- Modify: `client/src/routes/+layout.svelte`

**Step 1: Add imports**

Add to the imports section at the top of `+layout.svelte`:

```typescript
import {
  incrementMention,
  clearMentions,
  addMissedCall,
  clearMissedCall,
  unreadCounts,
} from '$lib/stores/channels';
```

Update the existing channels import line to include `unreadCounts` (and `incrementMention`, `clearMentions`, `addMissedCall`, `clearMissedCall`).

**Step 2: Add mention detection in chat:message handler**

In the `chat:message` handler (around line 84-102), after the existing `markChannelUnread` call, add mention detection:

```typescript
// After: markChannelUnread(event.message.channel_id);
// Add mention detection:
if ($currentUser && event.message.user_id !== $currentUser.id) {
  const content = event.message.content || '';
  if (content.includes(`<@${$currentUser.id}>`) || content.includes('<@everyone>')) {
    incrementMention(event.message.channel_id);
  }
}
```

**Step 3: Clear mentions when channel is opened**

Find where `markChannelRead` is called (in ChannelList.svelte and NavDock.svelte when clicking a channel). Add `clearMentions(channelId)` alongside each `markChannelRead` call. Also add `clearMissedCall(channelId)` alongside DM channel reads in NavDock.

**Step 4: Track missed calls in call:ended handler**

In the `call:ended` handler (around line 307-315), add missed call tracking:

```typescript
case 'call:ended': {
  // existing code...

  // Track missed calls (timeout = no answer, unavailable = offline)
  const call = $activeCall;
  if (call && (event.reason === 'timeout' || event.reason === 'unavailable') && call.status === 'incoming') {
    // We were the recipient and missed it
    // Find DM channel for this caller
    const dmChannel = $dmChannels.find(dm => dm.dm_participant_ids?.includes(call.peerId));
    if (dmChannel) {
      addMissedCall(dmChannel.id, call.peerName);
    }
  }
  // ... rest of existing handler
}
```

**Step 5: Build check**

Run: `npm run build`

**Step 6: Commit**

```bash
git add client/src/routes/+layout.svelte
git commit -m "feat: wire up mention detection and missed call tracking"
```

---

### Task 4: Tab Title Updates (+layout.svelte)

Show unread count in the browser tab title: "(3) Server Name"

**Files:**

- Modify: `client/src/routes/+layout.svelte`

**Step 1: Add a reactive effect for document title**

Inside the `<script>` block (after the store declarations but before onMount), add:

```typescript
$effect(() => {
  const total = Array.from($unreadCounts.values()).reduce((a, b) => a + b, 0);
  const name = $serverSettings?.name || 'SellServ Voice';
  document.title = total > 0 ? `(${total}) ${name}` : name;
});
```

**Step 2: Remove any existing static document.title sets**

Check for existing `document.title = ...` lines in +layout.svelte and remove/replace them (there's one around line 274 that sets it from server settings). The $effect above handles it reactively.

**Step 3: Build check**

Run: `npm run build`

**Step 4: Commit**

```bash
git add client/src/routes/+layout.svelte
git commit -m "feat: show unread count in browser tab title"
```

---

### Task 5: Channel List Unread & Mention Badges (ChannelList.svelte)

Replace the simple unread dot with a count badge. Add a separate mention badge.

**Files:**

- Modify: `client/src/lib/components/sidebar/ChannelList.svelte`

**Step 1: Update imports**

Add to the imports in ChannelList.svelte:

```typescript
import { unreadCounts, mentionCounts } from '$lib/stores/channels';
```

(Keep existing `unreadChannels` import if used for the bold class binding.)

**Step 2: Replace unread dot with count badge**

Find the unread dot rendering (around line 344-346):

```svelte
{#if $unreadChannels.has(channel.id)}
  <span class="unread-dot"></span>
{/if}
```

Replace with:

```svelte
{#if $mentionCounts.has(channel.id)}
  <span class="mention-badge">@{$mentionCounts.get(channel.id)}</span>
{:else if $unreadCounts.has(channel.id)}
  <span class="unread-badge">{$unreadCounts.get(channel.id)}</span>
{/if}
```

**Step 3: Add badge styles**

Add to the `<style>` section:

```css
.unread-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--text-dim);
  color: var(--bg-dark);
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}

.mention-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}
```

**Step 4: Remove old `.unread-dot` style** if no longer used.

**Step 5: Build check**

Run: `npm run build`

**Step 6: Commit**

```bash
git add client/src/lib/components/sidebar/ChannelList.svelte
git commit -m "feat: show unread count and mention badges on channels"
```

---

### Task 6: NavDock DM Badges (NavDock.svelte)

Add count badges and missed call indicators to DM entries in the nav dock.

**Files:**

- Modify: `client/src/lib/components/NavDock.svelte`

**Step 1: Update imports**

Add to imports:

```typescript
import {
  unreadCounts,
  mentionCounts,
  missedCalls,
  clearMentions,
  clearMissedCall,
} from '$lib/stores/channels';
```

**Step 2: Update unread badge for unfoldered DMs**

Find the unread dot rendering for unfoldered DMs (around line 251-253):

```svelte
{#if isUnread}
  <span class="nav-dm-unread"></span>
{/if}
```

Replace with:

```svelte
{#if $missedCalls.has(dm.id)}
  <span class="nav-dm-missed-call" title="Missed call from {$missedCalls.get(dm.id)?.callerName}">
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      ><path
        d="M15.05 5A5 5 0 0 1 19 8.95M15.05 1A9 9 0 0 1 23 8.94m-1 7.98v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
      /></svg
    >
  </span>
{:else if $mentionCounts.has(dm.id)}
  <span class="nav-dm-mention">@{$mentionCounts.get(dm.id)}</span>
{:else if isUnread}
  <span class="nav-dm-badge">{$unreadCounts.get(dm.id) || ''}</span>
{/if}
```

**Step 3: Update unread badge for foldered DMs** (around line 323-325) with the same pattern.

**Step 4: Clear mentions and missed calls on DM click**

Where `markChannelRead` is called on DM click, also add:

```typescript
clearMentions(dm.id);
clearMissedCall(dm.id);
```

**Step 5: Add badge styles**

```css
.nav-dm-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-darkest);
  line-height: 1;
}

.nav-dm-mention {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--danger);
  color: white;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-darkest);
  line-height: 1;
}

.nav-dm-missed-call {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--danger);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-darkest);
  animation: pulse-call 2s ease-in-out infinite;
}

@keyframes pulse-call {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--danger-rgb, 239, 68, 68), 0.4);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(var(--danger-rgb, 239, 68, 68), 0);
  }
}
```

**Step 6: Remove old `.nav-dm-unread` dot style** if replaced entirely.

**Step 7: Build check**

Run: `npm run build`

**Step 8: Commit**

```bash
git add client/src/lib/components/NavDock.svelte
git commit -m "feat: add count badges and missed call indicators on DMs"
```

---

### Task 7: Enhanced Desktop Notifications (notifications.ts)

Add mention-specific notifications that are more prominent.

**Files:**

- Modify: `client/src/lib/notifications.ts`

**Step 1: Add notifyMention function**

Add after `notifyCall`:

```typescript
export function notifyMention(channelName: string, username: string, content: string) {
  const title = `Mentioned in #${channelName}`;
  const body = `${username}: ${content.length > 80 ? content.slice(0, 80) + '...' : content}`;
  notify(title, body);
}
```

**Step 2: Wire up in +layout.svelte**

Import `notifyMention` and call it in the chat:message handler when a mention is detected (alongside the `incrementMention` call):

```typescript
if (content.includes(`<@${$currentUser.id}>`) || content.includes('<@everyone>')) {
  incrementMention(event.message.channel_id);
  // Find channel name for notification
  const ch =
    $channels.find((c) => c.id === event.message.channel_id) ||
    $dmChannels.find((c) => c.id === event.message.channel_id);
  if (ch) {
    notifyMention(
      ch.name || 'DM',
      event.message.display_name || event.message.username,
      event.message.content,
    );
  }
}
```

**Step 3: Build check**

Run: `npm run build`

**Step 4: Commit**

```bash
git add client/src/lib/notifications.ts client/src/routes/+layout.svelte
git commit -m "feat: add mention-specific desktop notifications"
```

---

### Task 8: Final Polish & Cleanup

**Step 1: Clear all unreads on reconnect**

In the `presence:list` handler in +layout.svelte, consider whether to reset unread state. Generally keep existing unreads across reconnects (no change needed).

**Step 2: Full build and manual verification**

Run: `npm run build`

Test scenarios:

1. Open app in two browser tabs with different users
2. Send message from User A -> verify User B sees count badge on channel
3. @mention User B -> verify red mention badge appears
4. Open the channel -> verify badges clear
5. Check browser tab title shows "(N) Server Name"
6. Minimize window, send message -> verify desktop notification
7. Initiate call that times out -> verify missed call icon on DM

**Step 3: Commit any final adjustments**

```bash
git add -A
git commit -m "feat: notification improvements polish"
```
