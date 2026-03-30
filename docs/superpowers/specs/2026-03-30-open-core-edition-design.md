# Open Core: Official Instance Toggle + Standalone Admin Console

**Date:** 2026-03-30
**Status:** Approved

## Overview

A single `OFFICIAL_INSTANCE` env var (defaults to `false`) controls whether official-only features are active: Stripe billing, OAuth2 provider, and the standalone admin console. Self-hosters leave it at `false` and get the full chat app with an in-app admin page. The official instance sets it to `true`, which removes the in-app admin page and enables the standalone admin console with OAuth2 authentication.

## The Toggle

```bash
OFFICIAL_INSTANCE=false  # default
```

In `server/src/config.ts`:
```typescript
officialInstance: env('OFFICIAL_INSTANCE', 'false') === 'true',
```

## ADMIN_USERS Fix: Switch to User IDs

`ADMIN_USERS` currently matches by username, which is a security risk since usernames can be changed. Switch to matching by user ID (UUIDs), which are immutable.

Before:
```bash
ADMIN_USERS=carter,someuser
```

After:
```bash
ADMIN_USERS=550e8400-e29b-41d4-a716-446655440000,7c9e6679-7425-40de-944b-e07fc1f90ae7
```

Update `isInstanceAdmin()` and `requireAdmin` to check `request.user.userId` instead of `request.user.username`.

## What Changes Per Toggle State

| Feature | `false` (default/self-hosted) | `true` (official) |
|---|---|---|
| In-app `/admin` page | Available | Removed |
| Standalone admin console | Not deployed | Deployed |
| OAuth2 provider endpoints | Not registered | Registered |
| Billing/Stripe routes | Not registered | Registered |
| Admin API endpoints (`/api/admin/*`) | Available | Available |

## OAuth2 Provider

New endpoints on the server, only registered when `OFFICIAL_INSTANCE=true`:

- `GET /oauth2/authorize` — consent screen ("Admin Console wants to access your account")
- `POST /oauth2/token` — exchanges authorization code for access token
- `GET /oauth2/userinfo` — returns user info (id, username, isAdmin)
- `POST /oauth2/revoke` — revokes a token

The admin console is a pre-registered OAuth2 client via env vars:

```bash
OAUTH2_CLIENT_ID=admin-console
OAUTH2_CLIENT_SECRET=<random-secret>
OAUTH2_REDIRECT_URI=https://admin.sellserv.net/auth/callback
```

- Authorization codes: short-lived (5 minutes), single-use, stored in database
- Access tokens: JWTs with 1-hour expiry
- Strict redirect URI validation (exact match, no wildcards)
- State parameter required to prevent CSRF on callback

## Standalone Admin Console

A SvelteKit app in the `admin-console/` workspace, deployed at `admin.sellserv.net`.

### Pages

Mirrors the current in-app admin functionality:

- **Dashboard** — stats (users, servers, messages, online count)
- **Users** — list, ban/unban, view details, assign global roles
- **Servers** — list, delete
- **Reports** — content moderation (submit, resolve, dismiss)
- **Audit Log** — viewer
- **Instance Settings** — name, registration toggle, terms/privacy URLs, alpha billing toggle

All pages talk to the existing admin API endpoints (`/api/admin/*`). No new server-side admin logic needed.

### Auth Flow

1. Visit `admin.sellserv.net`
2. Middleware checks for session cookie — none found
3. Redirect to `chat.sellserv.net/oauth2/authorize?client_id=admin-console&scope=admin&state=<random>&redirect_uri=https://admin.sellserv.net/auth/callback`
4. User logs in on main app (or already logged in), sees consent screen
5. Main app verifies user is in `ADMIN_USERS` list (by user ID), redirects back with auth code
6. Admin console exchanges code for access token via server-to-server call
7. Stores token in encrypted HttpOnly session cookie (7-day expiry)
8. Subsequent requests: admin console makes API calls with access token as Bearer token

### Security

- Encrypted HttpOnly session cookies with configurable secret key
- CSRF protection on all state-changing requests
- State parameter on OAuth2 flow
- Strict redirect URI validation (exact match)
- CORS configured for admin console domains via existing `CORS_ORIGINS` env var

## Client Changes

- When `OFFICIAL_INSTANCE=true`, the in-app `/admin` route is hidden/removed
- Billing UI only shown when official instance (server exposes toggle via `/api/public/instance/info`)
- Feature flags exposed in existing public instance info endpoint:
  ```typescript
  features: {
    officialInstance: boolean,
    billing: boolean,
  }
  ```

## Deployments

| Environment | Main App | Admin Console | `OFFICIAL_INSTANCE` |
|---|---|---|---|
| Staging | `staging.sellserv.net` | `admin-staging.sellserv.net` | `true` |
| Production | `chat.sellserv.net` | `admin.sellserv.net` | `true` |
| Self-hosted | user's domain | N/A | `false` |

Same branching model: `staging` deploys both apps to staging domains, `main` deploys both to production. CI workflows updated to build and deploy admin console alongside main app.
