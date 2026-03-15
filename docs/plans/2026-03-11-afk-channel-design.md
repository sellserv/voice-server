# AFK Voice Channel Design

**Goal:** Automatically move idle users in voice channels to a server-designated AFK channel after a configurable timeout, and force-mute anyone in the AFK channel.

## Architecture

Server admins designate any existing voice channel as the AFK channel and configure a timeout (default 5 minutes). When a user in a voice channel goes idle for the configured duration, the server moves them to the AFK channel. Users in the AFK channel are server-muted — their audio producer is paused server-side regardless of client-side mute state.

## Server-Side

### Database
- Add `afk_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL` to `servers` table
- Add `afk_timeout INTEGER NOT NULL DEFAULT 300` to `servers` table (seconds)

### Settings API
- Expose `afk_channel_id` and `afk_timeout` in `ServerSettings` type
- Add to GET/PUT `/api/servers/:serverId/settings` routes
- Validate that `afk_channel_id` references a voice channel in the same server
- Validate `afk_timeout` is a reasonable range (60-3600 seconds)

### AFK Move Logic (server-side timer)
- When the server receives `presence:setStatus` with `idle` for a user in voice:
  - Start a timer for `afk_timeout` seconds
  - On timeout, if user is still idle and in a non-AFK voice channel:
    - Remove user from current voice room
    - Add user to AFK channel voice room
    - Broadcast `voice:left` for old channel, `voice:joined` for AFK channel
    - Send `voice:afkMoved` to the moved user with the new channel ID
  - If user goes back to `online` before timeout, cancel the timer
- If no AFK channel is configured, no auto-move occurs
- If user is already in the AFK channel, no action

### Forced Mute in AFK Channel
- When a user joins the AFK channel (auto-moved or manual join), pause their audio producer server-side
- When a user attempts to produce audio (`rtc:produce` with kind `audio`) in the AFK channel, pause the producer immediately
- Send `voice:muteUpdate` with `muted: true` to reflect forced mute state
- When user leaves AFK channel (joins another channel), normal mute state resumes

### New WebSocket Event
- `voice:afkMoved` (server -> client): `{ channelId: string }` — tells the moved user's client to update its local voice state to the AFK channel

## Client-Side

### Server Settings UI
- Add AFK section to server settings:
  - Dropdown to select AFK channel (filtered to voice channels in current server), with "None" option
  - Timeout input (minutes) with reasonable bounds
- Requires `manage_server` permission

### Voice State Handling
- Handle `voice:afkMoved` event: update local voice channel store to reflect new channel
- Show a toast notification: "You were moved to the AFK channel due to inactivity"
- Handle forced `voice:muteUpdate` when in AFK channel — reflect muted state in UI

## Shared Types
- Add `afk_channel_id` and `afk_timeout` to `ServerSettings` interface
- Add `voice:afkMoved` to `ServerEvent` union

## Edge Cases
- AFK channel deleted: `ON DELETE SET NULL` clears the setting, no auto-moves occur
- User disconnects while AFK timer running: timer cleaned up on disconnect
- Server setting changed while timers active: existing timers use old timeout, new idle events use new timeout
- User in AFK channel goes idle: no action (already there)
