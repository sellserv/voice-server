# CLAUDE.md

## Project Overview

SellServ Voice — a Discord-like voice/text chat app. Monorepo using npm workspaces: `client`, `server`, `shared`, `desktop`.

## Tech Stack

- **Server:** Fastify + TypeScript, better-sqlite3, mediasoup (WebRTC SFU), WebSocket
- **Client:** SvelteKit + Svelte 5 (runes), Vite, mediasoup-client
- **Desktop:** Electron + electron-builder
- **Shared:** TypeScript types only, imported as `@voip-server/shared`

## Environment

- Repository: https://github.com/sellserv/voice-server
- Production runs on a VPS
- CI/CD uses GitHub Actions

## Commands

- `npm run dev` — starts server + client concurrently
- `npm run dev:server` — server only (tsx watch)
- `npm run dev:client` — client only (Vite on :5173)
- `npm run build` — build client for production
- `npm run start` — start production server
- `npm run desktop:dev` — run Electron dev mode
- `npm test` — run all tests (Vitest)

## Code Style

- 2 spaces, single quotes, semicolons always
- camelCase for vars/functions, PascalCase for types, UPPER_SNAKE_CASE for constants
- Never use tabs or double quotes (except JSX/HTML attributes)

## Server Patterns

- Routes: default async export function, typed generics for Body/Params
- Auth: `requireAuth`/`requirePermission` preHandler decorators
- Server membership: `requireServerMember` middleware for server-scoped routes
- DB: prepared statements, transactions for atomics
- Imports: relative `.js` extensions
- Error responses: `{ error: 'message' }`; success returns data directly

## Multi-Server Architecture

- **Route structure:** Server-scoped routes use `/api/servers/:serverId/...` prefix (e.g., `/api/servers/:serverId/channels`, `/api/servers/:serverId/roles`)
- **Global routes (no server prefix):** auth (`/api/auth/*`), user profile (`PATCH /api/users/me`), DMs (`/api/dm`, `/api/channels/:id/messages` for DM channels), uploads (`/api/upload`), health (`/api/health`)
- **Server middleware:** `requireServerMember` verifies user belongs to the target server, attaches `serverId` to request. Use `getServerId(request)` to retrieve it.
- **Permissions:** `hasPermission(userId, perm, serverId?)` — serverId scopes permission checks to roles in that server
- **WebSocket:** Single connection per client. `broadcastToServer(serverId, event)` sends to server members only. `broadcastToChannel` auto-scopes via channel's server_id. DM events use global `broadcast()`.
- **DMs are global:** DM channels have `server_id = NULL`. DM routes are NOT server-scoped.
- **Client stores:** Use `getActiveServerId()` from `$lib/stores/servers` to get current server for API calls. `isDmView` store toggles between server and DM views.

## Client Patterns

- Components: Svelte 5 runes (`$props`, `$state`, `$derived`, `$effect`)
- State: `svelte/store` (`writable`, `derived`)
- Imports: use `$lib` alias
- REST: typed `api.get/post/patch/delete` utility
- WebSocket: `sendWs()` and `onWsEvent()` for real-time events
- CSS: scoped styles with CSS custom properties (`--bg-mid`, `--text-muted`, etc.)
- Desktop detection: `window.electronAPI`

## Shared Types

```typescript
import type { ... } from '@voip-server/shared';
```

## Quality

- Be very careful with every change pushed to production. Thoroughly check for anything that could cause runtime errors, especially unhandled promise rejections.
- Always handle async errors properly — catch rejected promises, guard against undefined/null access, and validate data before using it.

## Releases

- Always check the latest GitHub release and tag before creating a new one (`gh release list --limit 1` and `git tag --sort=-v:refname | head -1`)

## Commit Rules

- Never add Co-Authored-By lines to commits
