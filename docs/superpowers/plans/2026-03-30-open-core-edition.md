# Open Core Feature Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate official-only features behind individual boolean env vars so self-hosters get a clean experience by default.

**Architecture:** Each official-only feature gets its own env var (`BILLING_ENABLED`, `STANDALONE_ADMIN_CONSOLE`), defaulting to `false`. The server exposes enabled features via the existing `/api/public/instance/info` endpoint. The client reads those flags to show/hide UI. No "edition" abstraction — just simple on/off toggles.

**Tech Stack:** Fastify, SvelteKit, TypeScript, npm workspaces

---

### Task 1: Add Feature Toggles to Server Config

**Files:**
- Modify: `server/src/config.ts:43-73`

- [ ] **Step 1: Add feature toggle env vars**

In `server/src/config.ts`, add after the `host` line (line 45), before `jwtSecret`:

```typescript
billingEnabled: env('BILLING_ENABLED', 'false') === 'true',
standaloneAdminConsole: env('STANDALONE_ADMIN_CONSOLE', 'false') === 'true',
```

- [ ] **Step 2: Verify server starts**

Run: `npm run dev:server`
Expected: Server starts without errors. Both flags default to `false`.

- [ ] **Step 3: Commit**

```bash
git add server/src/config.ts
git commit -m "feat: add BILLING_ENABLED and STANDALONE_ADMIN_CONSOLE config flags"
```

---

### Task 2: Gate Billing Routes Behind Toggle

**Files:**
- Modify: `server/src/index.ts:253`

- [ ] **Step 1: Conditionally register billing routes**

In `server/src/index.ts`, change line 253 from:

```typescript
await app.register(billingRoutes);
```

to:

```typescript
if (config.billingEnabled) {
  await app.register(billingRoutes);
}
```

Add `config` to the existing imports if not already imported (it's already imported via other modules — check the imports at the top; if `config` isn't directly imported, add):

```typescript
import { config } from './config.js';
```

- [ ] **Step 2: Verify billing routes are hidden by default**

Run: `npm run dev:server`

```bash
curl -s http://localhost:3000/api/billing/status
```

Expected: `{"error":"Not found"}` (404) — billing routes not registered.

- [ ] **Step 3: Verify billing routes work when enabled**

Stop server, then:

```bash
BILLING_ENABLED=true npm run dev:server
```

```bash
curl -s http://localhost:3000/api/billing/status
```

Expected: 401 (unauthorized — route exists but requires auth, not 404).

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: gate billing routes behind BILLING_ENABLED flag"
```

---

### Task 3: Expose Feature Flags in Public Instance Info

**Files:**
- Modify: `server/src/index.ts:212-230` (existing `/api/public/instance/info` endpoint)

- [ ] **Step 1: Add feature flags to existing endpoint**

In `server/src/index.ts`, modify the existing `/api/public/instance/info` handler to include the feature flags. Change the return block (lines 223-229) from:

```typescript
return {
  totalUsers,
  totalServers,
  totalMessages,
  onlineCount,
  registrationOpen,
};
```

to:

```typescript
return {
  totalUsers,
  totalServers,
  totalMessages,
  onlineCount,
  registrationOpen,
  features: {
    billing: config.billingEnabled,
    standaloneAdminConsole: config.standaloneAdminConsole,
  },
};
```

- [ ] **Step 2: Verify endpoint returns features**

Run: `npm run dev:server`

```bash
curl -s http://localhost:3000/api/public/instance/info | jq .features
```

Expected:

```json
{
  "billing": false,
  "standaloneAdminConsole": false
}
```

- [ ] **Step 3: Verify with flags enabled**

```bash
BILLING_ENABLED=true STANDALONE_ADMIN_CONSOLE=true npm run dev:server
curl -s http://localhost:3000/api/public/instance/info | jq .features
```

Expected:

```json
{
  "billing": true,
  "standaloneAdminConsole": true
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: expose feature flags in public instance info endpoint"
```

---

### Task 4: Client — Read Feature Flags

**Files:**
- Create: `client/src/lib/stores/features.ts`

- [ ] **Step 1: Create the features store**

Create `client/src/lib/stores/features.ts`:

```typescript
import { writable, derived } from 'svelte/store';

interface Features {
  billing: boolean;
  standaloneAdminConsole: boolean;
}

export const features = writable<Features>({
  billing: false,
  standaloneAdminConsole: false,
});

export const billingEnabled = derived(features, ($f) => $f.billing);
```

- [ ] **Step 2: Populate features from instance info**

Find where the app already fetches `/api/public/instance/info` (or where it initializes). After the fetch, update the features store:

```typescript
import { features } from '$lib/stores/features';

// After fetching instance info:
if (data.features) {
  features.set(data.features);
}
```

If the app doesn't currently fetch this endpoint on init, add the fetch to the root layout or main entry point alongside existing init calls.

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`

Open browser devtools console:

```javascript
// Check the store value in Svelte devtools or via a temporary $inspect
```

Confirm `billing` is `false` by default.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/stores/features.ts
git commit -m "feat: add client features store for feature flag awareness"
```

---

### Task 5: Client — Hide Billing UI When Disabled

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte`
- Modify: `client/src/routes/admin/+page.svelte`

- [ ] **Step 1: Hide billing section in SettingsModal**

In `client/src/lib/components/SettingsModal.svelte`, import the store:

```typescript
import { billingEnabled } from '$lib/stores/features';
```

Wrap the billing/subscription section in `{#if $billingEnabled}` so it only renders when billing is enabled. Also gate the billing status fetch call behind the same check.

- [ ] **Step 2: Hide alpha billing toggle in admin page**

In `client/src/routes/admin/+page.svelte`, import the store:

```typescript
import { billingEnabled } from '$lib/stores/features';
```

Wrap the alpha billing toggle section (around lines 60-77) in `{#if $billingEnabled}` so self-hosters don't see a toggle for a feature that isn't active.

- [ ] **Step 3: Verify in browser**

Run `npm run dev` (flags default to false):
- Open Settings modal — billing section should be hidden
- Open /admin — alpha billing toggle should be hidden

Run `BILLING_ENABLED=true npm run dev:server` (keep client dev server running):
- Reload — billing section should appear
- Admin page — alpha billing toggle should appear

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte client/src/routes/admin/+page.svelte
git commit -m "feat: hide billing UI when BILLING_ENABLED is false"
```

---

### Task 6: Scaffold Admin Console Workspace

**Files:**
- Create: `admin-console/package.json`
- Create: `admin-console/README.md`
- Modify: `package.json` (root — add workspace)

- [ ] **Step 1: Create minimal workspace**

Create `admin-console/package.json`:

```json
{
  "name": "@voip-server/admin-console",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "echo 'Admin console not yet implemented'",
    "build": "echo 'Admin console not yet implemented'"
  },
  "dependencies": {
    "@voip-server/shared": "*"
  }
}
```

Create `admin-console/README.md`:

```markdown
# Admin Console

Standalone admin console for the official instance. Deployed at `admin.sellserv.net`.

This is a placeholder — the full SvelteKit app will be implemented separately.

Self-hosters: you can ignore this directory. The in-app admin page at `/admin` provides all admin functionality.
```

- [ ] **Step 2: Add workspace to root package.json**

In the root `package.json`, add `"admin-console"` to the workspaces array:

```json
"workspaces": [
  "shared",
  "server",
  "client",
  "desktop",
  "mobile",
  "admin-console"
]
```

- [ ] **Step 3: Verify workspace resolves**

```bash
npm ls --workspaces
```

Expected: `@voip-server/admin-console` appears in the list without errors.

- [ ] **Step 4: Commit**

```bash
git add admin-console/package.json admin-console/README.md package.json
git commit -m "feat: scaffold admin-console workspace"
```

---

### Task 7: Document Feature Flags in .env.example

**Files:**
- Modify or create: `.env.example`

- [ ] **Step 1: Add feature flag documentation**

Add to `.env.example` (create if it doesn't exist, or append to existing):

```bash
# ── Feature Flags ──────────────────────────────────
# Official-only features. Self-hosters can leave these as false.

# Enable Stripe billing (also requires STRIPE_* vars below)
BILLING_ENABLED=false

# Enable standalone admin console (admin.sellserv.net)
# The in-app /admin page is always available regardless of this setting.
STANDALONE_ADMIN_CONSOLE=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document feature flags in .env.example"
```
