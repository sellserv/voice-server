# Multi-Server (Guilds) Design

## Overview

Add Discord-like multi-server support. Users have global accounts, can create/join multiple servers, and each server has its own channels, roles, and permissions. DMs are global across servers.

## Data Model

### New Tables

**`servers`** — id, name, icon_file_id, owner_id, allow_server_creation (instance-level), created_at.

**`server_members`** — user_id, server_id, nickname, avatar_url, joined_at. Per-server profile overrides.

**`instance_settings`** — Global config. `allow_server_creation` toggle (default: true).

### Modified Tables (add `server_id`)

- `channels` (not DM channels — those stay global)
- `channel_groups`
- `roles`
- `channel_permission_overrides`
- `group_permission_overrides`
- `custom_emojis`
- `soundboard_sounds`
- `invite_codes`
- `bots`
- `audit_log`

### Unchanged Tables

- `users` — global accounts
- `messages` — scoped implicitly via channel_id
- `files` — user-owned, referenced by server-scoped entities
- `dm_participants` — DMs are global
- `link_previews` — cache, no server scope needed

## Authentication

JWT remains global: `{ userId, username, pwc }`. No server_id in token.

Server context derived from routes (e.g., `/api/servers/:serverId/channels`). Permission checks look up the user's roles within the target server via `server_members` + `roles`.

## Permissions

Roles are per-server. Each server has its own role hierarchy and permission set. The existing permission system (channel overrides, group overrides) works the same but scoped by server_id.

Server owners have implicit admin. The `administrator` permission within a server grants full control of that server only.

## WebSocket

Single WS connection per client. Events include `serverId` where applicable.

New broadcast function: `broadcastToServer(serverId, event)` — sends to all online members of that server.

`broadcastToChannel` already scopes by channel access — channels now belong to a server, so this naturally scopes correctly.

Client subscribes to events for all servers they're a member of. Server-specific events (role changes, channel updates, etc.) include the serverId so the client knows which server state to update.

## Client UI

### Server List (NavDock)

Left sidebar becomes a vertical server icon list (like Discord):
- DM icon at top (always present)
- Server icons below, ordered by join date or drag-to-reorder
- "+" button at bottom to create or join a server
- Unread indicators / mention badges per server

### Server Context

Clicking a server loads its channels, member list, roles, and settings. All existing stores (channels, roles, channelGroups, etc.) become scoped to the active server.

### Create/Join Modal

- Create: server name + optional icon
- Join: paste invite code/link

### Server Settings

Each server has its own settings panel (name, icon, roles, channels, emojis, soundboard, invites, etc.). Only accessible to users with appropriate permissions in that server.

## Voice

Each server has independent voice channels. User can only be in one voice channel globally across all servers. Joining a voice channel in another server auto-leaves the current one.

## DMs

Global across servers. DM list accessible from the DM icon in the server list. Users can DM anyone they share a server with. DM conversations persist regardless of shared server membership.

## Server Creation

Configurable via `instance_settings.allow_server_creation`:
- `true` (default): any registered user can create a server
- `false`: only instance admin can create servers

## Invites

Invite codes are per-server. Each invite belongs to a specific server. Using an invite adds the user as a member of that server (creates `server_members` row). If the user doesn't have an account yet, they register first then join.

## File Uploads

No structural change. Files stay in a single uploads directory. They're referenced by server-scoped entities (channels, emojis, etc.) so they're implicitly scoped.

## Migration

Seamless transition for existing data:

1. Create `servers` table, insert existing server as first record (using current `server_settings` name/icon)
2. Create `server_members` table, insert all existing users as members of the initial server
3. Add `server_id` column to all affected tables with default = initial server id
4. Create `instance_settings` table with defaults
5. Migrate existing `server_settings` data into `servers` row
6. Update all routes and queries to include server_id filtering
7. Update client to support server switching

All existing data, users, channels, messages, roles, and permissions remain intact under the initial server.
