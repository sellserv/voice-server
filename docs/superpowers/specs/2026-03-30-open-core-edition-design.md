# Open Core Feature Toggles Design

**Date:** 2026-03-30
**Status:** Approved

## Overview

Gate official-only features behind individual boolean env vars. Each feature is a simple `true`/`false` toggle, defaulting to `false`. Self-hosters don't need to configure anything — they get the full chat app with the integrated admin panel. The official instance sets the flags it needs.

## Feature Toggles

```bash
BILLING_ENABLED=false
STANDALONE_ADMIN_CONSOLE=false
```

Added to `server/src/config.ts` as booleans. No "edition" abstraction — each feature stands on its own.

## Billing Route Gating

Billing routes (`server/src/routes/billing.ts`) only register when `config.billingEnabled` is `true`:

```typescript
if (config.billingEnabled) {
  await app.register(billingRoutes);
}
```

The Stripe dependency stays in `package.json` but never gets used when billing is disabled.

The client hides billing/upgrade UI when the server reports `billing: false` via the public instance info endpoint.

## Standalone Admin Console

A new `admin-console/` workspace at the monorepo root — a separate SvelteKit app deployed at `admin.sellserv.net` (only when `STANDALONE_ADMIN_CONSOLE=true`).

- **Shares types** from `@voip-server/shared`
- **Talks to the same server API** — the existing admin endpoints in `server/src/routes/admin.ts` serve both the in-app admin and the standalone console
- **Auth:** Uses the same API session/token system (cookie or token-based, matching the main app). The server's existing `requirePermission` middleware already enforces instance admin privileges on admin endpoints. CORS on the server is configured to allow the admin console origins (`admin.sellserv.net`, `admin-staging.sellserv.net`) via the existing `CORS_ORIGINS` env var.
- **In-app admin stays:** Self-hosters keep the existing `/admin` route in the client. The standalone console is an alternative interface for the official instance, not a replacement.

## Exposing Feature Flags to the Client

The existing `/api/public/instance/info` endpoint is extended with a `features` object:

```typescript
{
  totalUsers: 42,
  totalServers: 3,
  // ...existing fields...
  features: {
    billing: false,
    standaloneAdminConsole: false
  }
}
```

The client reads these flags on init and uses them to show/hide UI sections.

## Deployment Matrix

| Environment | Main App | Admin Console | Feature Flags |
|---|---|---|---|
| Staging | `staging.sellserv.net` | `admin-staging.sellserv.net` | `BILLING_ENABLED=true`, `STANDALONE_ADMIN_CONSOLE=true` |
| Production | `chat.sellserv.net` | `admin.sellserv.net` | `BILLING_ENABLED=true`, `STANDALONE_ADMIN_CONSOLE=true` |
| Self-hosted | user's domain | N/A | defaults (`false`) |

## What Gets Gated

| Feature | Default (self-hosted) | Official |
|---|---|---|
| Core chat (voice/text/channels) | Yes | Yes |
| In-app admin (`/admin` route) | Yes | Yes |
| Standalone admin console | No | Yes |
| Stripe billing | No | Yes |
| Alpha billing toggle | No | Yes |
| Instance settings (name, registration, etc.) | Yes | Yes |

## What Does NOT Change

- Repo remains public and single
- All code is visible to self-hosters
- Staging/main branching model unchanged
- Existing admin API endpoints unchanged — they serve both interfaces
- Stripe dependency stays in `package.json`
- Self-hosters could enable any flag if they want — features just need their backing services configured (e.g., Stripe keys for billing)
