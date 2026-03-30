# Open Core Edition Separation Design

**Date:** 2026-03-30
**Status:** Approved

## Overview

Separate self-hosted (community) and official instance code within a single repo using a feature flag approach. Community is the default — self-hosters don't need to configure anything. All code remains visible in the repo; official-only features are simply gated at runtime.

## Edition Config

Add an `edition` field to the server config:

```typescript
edition: process.env.EDITION || 'community' // 'community' | 'official'
```

A helper `isOfficial()` wraps the check. Community is the default. The edition flag is the single gate — if `edition` is `community`, official-only routes don't register regardless of whether their backing service keys are set.

## Billing Route Gating

Billing routes (`server/src/routes/billing.ts`) only register when `isOfficial()` returns true:

```typescript
if (isOfficial()) {
  registerBillingRoutes(app);
}
```

The Stripe dependency stays in `package.json` but never gets used in community edition — no conditional dependency management needed.

The client hides billing/upgrade UI when the server reports `edition: "community"` via the instance info endpoint.

## Standalone Admin Console

A new `admin-console/` workspace at the monorepo root — a separate SvelteKit app deployed at `admin.sellserv.net` (official instance only).

- **Shares types** from `@voip-server/shared`
- **Talks to the same server API** — the existing admin endpoints in `server/src/routes/admin.ts` serve both the in-app admin and the standalone console
- **Auth:** Uses the same API session/token system (cookie or token-based, matching the main app). The server's existing `requirePermission` middleware already enforces instance admin privileges on admin endpoints. CORS on the server is configured to allow the admin console origins (`admin.sellserv.net`, `admin-staging.sellserv.net`).
- **In-app admin stays:** Self-hosters keep the existing `/admin` route in the client. The standalone console is an alternative interface for the official instance, not a replacement.
- **Official-only endpoints:** Any future endpoints exclusive to the standalone console are gated behind `isOfficial()`.

## Exposing Edition to the Client

A public endpoint exposes edition and public instance settings:

```typescript
GET /api/instance-info
{
  edition: 'community' | 'official',
  instanceName: 'SellServ Voice',
  allowRegistration: true,
  // ...other public instance_settings
}
```

No sensitive data exposed. The client uses this to:

- Hide billing/upgrade/Pro UI in community edition
- Optionally show a "Community Edition" indicator

## CI/CD and Deployments

Two build targets from the same repo, same branching model:

### Community (default)
- `npm run build` produces server + client, excludes `admin-console/`
- Future Docker image sets `EDITION=community`

### Official
- Builds everything including `admin-console/`
- `EDITION=official` set in deploy environment

### Deployment Matrix

| Environment | Main App | Admin Console | Edition |
|---|---|---|---|
| Staging | `staging.sellserv.net` | `admin-staging.sellserv.net` | `official` |
| Production | `chat.sellserv.net` | `admin.sellserv.net` | `official` |

The admin console follows the same staging-first deploy flow as the main app. Pushes to `staging` deploy both, merges to `main` deploy both.

## What Gets Gated

| Feature | Community | Official |
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
