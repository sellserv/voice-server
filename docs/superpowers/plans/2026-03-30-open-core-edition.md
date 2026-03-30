# Open Core Edition Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate billing routes and prepare for a standalone admin console behind an `EDITION` env var, with a public `/api/instance-info` endpoint so clients know what UI to show.

**Architecture:** Add `edition` to server config (defaults to `community`). Billing routes only register when `edition` is `official`. A new public endpoint exposes edition + instance settings. Client hides billing UI in community edition. The standalone admin console workspace is scaffolded but implementation is a separate project.

**Tech Stack:** Fastify, SvelteKit, TypeScript, npm workspaces

---

### Task 1: Add Edition to Server Config

**Files:**
- Modify: `server/src/config.ts:43-73`
- Create: `server/src/edition.ts`
- Modify: `shared/types.ts` (add Edition type)

- [ ] **Step 1: Add Edition type to shared types**

In `shared/types.ts`, add at the top of the file after the existing type aliases:

```typescript
export type Edition = 'community' | 'official';
```

- [ ] **Step 2: Add edition to config**

In `server/src/config.ts`, add `edition` to the config object after the `host` line (line 45):

```typescript
edition: (env('EDITION', 'community') as 'community' | 'official'),
```

- [ ] **Step 3: Create edition helper**

Create `server/src/edition.ts`:

```typescript
import { config } from './config.js';

export function isOfficial(): boolean {
  return config.edition === 'official';
}
```

- [ ] **Step 4: Verify server starts**

Run: `npm run dev:server`
Expected: Server starts without errors. No `EDITION` env var set, so it defaults to `community`.

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts server/src/config.ts server/src/edition.ts
git commit -m "feat: add edition config with community/official modes"
```

---

### Task 2: Gate Billing Routes Behind Edition

**Files:**
- Modify: `server/src/index.ts:33,253`
- Modify: `server/src/routes/billing.ts:35`

- [ ] **Step 1: Conditionally register billing routes**

In `server/src/index.ts`, add the import at line 36 (after the other local imports):

```typescript
import { isOfficial } from './edition.js';
```

Then change line 253 from:

```typescript
await app.register(billingRoutes);
```

to:

```typescript
if (isOfficial()) {
  await app.register(billingRoutes);
}
```

- [ ] **Step 2: Verify billing routes are hidden in community mode**

Run: `npm run dev:server`

Then test:
```bash
curl -s http://localhost:3000/api/billing/status
```
Expected: `{"error":"Not found"}` (404) — billing routes are not registered.

- [ ] **Step 3: Verify billing routes work in official mode**

Stop server, then:
```bash
EDITION=official npm run dev:server
```

Then test:
```bash
curl -s http://localhost:3000/api/billing/status
```
Expected: 401 (unauthorized, but the route exists — not 404).

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: gate billing routes behind official edition"
```

---

### Task 3: Add Public Instance Info Endpoint

**Files:**
- Modify: `server/src/index.ts:211-230` (add to existing public section)

- [ ] **Step 1: Add the endpoint**

In `server/src/index.ts`, after the existing `/api/public/instance/info` endpoint (after line 230), add:

```typescript
// Public instance info with edition — used by client to show/hide features
app.get('/api/instance-info', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => {
  const settings = db.prepare(
    'SELECT instance_name, allow_registration, allow_server_creation, terms_url, privacy_url FROM instance_settings WHERE id = 1'
  ).get() as { instance_name: string; allow_registration: number; allow_server_creation: number; terms_url: string; privacy_url: string } | undefined;

  return {
    edition: config.edition,
    instanceName: settings?.instance_name || 'SellServ Voice',
    allowRegistration: settings ? !!settings.allow_registration : true,
    allowServerCreation: settings ? !!settings.allow_server_creation : true,
    termsUrl: settings?.terms_url || null,
    privacyUrl: settings?.privacy_url || null,
  };
});
```

- [ ] **Step 2: Verify endpoint works in community mode**

Run: `npm run dev:server`

```bash
curl -s http://localhost:3000/api/instance-info | jq
```

Expected:
```json
{
  "edition": "community",
  "instanceName": "SellServ Voice",
  "allowRegistration": true,
  "allowServerCreation": true,
  "termsUrl": null,
  "privacyUrl": null
}
```

- [ ] **Step 3: Verify endpoint works in official mode**

```bash
EDITION=official npm run dev:server
curl -s http://localhost:3000/api/instance-info | jq
```

Expected: Same but with `"edition": "official"`.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: add public /api/instance-info endpoint with edition"
```

---

### Task 4: Client — Fetch and Store Edition Info

**Files:**
- Create: `client/src/lib/stores/instance.ts`

- [ ] **Step 1: Create the instance store**

Create `client/src/lib/stores/instance.ts`:

```typescript
import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';

interface InstanceInfo {
  edition: 'community' | 'official';
  instanceName: string;
  allowRegistration: boolean;
  allowServerCreation: boolean;
  termsUrl: string | null;
  privacyUrl: string | null;
}

const defaultInfo: InstanceInfo = {
  edition: 'community',
  instanceName: 'SellServ Voice',
  allowRegistration: true,
  allowServerCreation: true,
  termsUrl: null,
  privacyUrl: null,
};

export const instanceInfo = writable<InstanceInfo>(defaultInfo);

export const isOfficial = derived(instanceInfo, ($info) => $info.edition === 'official');

export async function fetchInstanceInfo() {
  try {
    const info = await api.get<InstanceInfo>('/api/instance-info');
    instanceInfo.set(info);
  } catch {
    // Fallback to defaults (community) if endpoint unavailable
  }
}
```

- [ ] **Step 2: Call fetchInstanceInfo on app init**

Find where the app initializes (the root layout or main entry point) and add:

```typescript
import { fetchInstanceInfo } from '$lib/stores/instance';
```

Call `fetchInstanceInfo()` alongside any existing init calls (e.g., where auth check or WebSocket connect happens).

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`

Open browser devtools network tab, confirm `/api/instance-info` is called on load and the store has the correct edition.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/stores/instance.ts client/src/routes/+layout.svelte
git commit -m "feat: add client instance info store with edition awareness"
```

---

### Task 5: Client — Hide Billing UI in Community Edition

**Files:**
- Modify: `client/src/lib/components/SettingsModal.svelte` (billing section)
- Modify: `client/src/routes/admin/+page.svelte` (alpha billing toggle)

- [ ] **Step 1: Hide billing section in SettingsModal**

In `client/src/lib/components/SettingsModal.svelte`, import the store:

```typescript
import { isOfficial } from '$lib/stores/instance';
```

Wrap the billing/subscription section in an `{#if $isOfficial}` block so it only renders when edition is official. The billing status fetch call should also be gated behind this check.

- [ ] **Step 2: Hide alpha billing toggle in admin page**

In `client/src/routes/admin/+page.svelte`, import the store:

```typescript
import { isOfficial } from '$lib/stores/instance';
```

Wrap the alpha billing toggle section (around lines 60-77) in `{#if $isOfficial}` so self-hosters don't see a toggle that does nothing for them.

- [ ] **Step 3: Verify in browser**

Run `npm run dev` (no EDITION set, defaults to community):
- Open Settings modal — billing section should be hidden
- Open /admin — alpha billing toggle should be hidden

Run `EDITION=official npm run dev:server` (keep client running):
- Reload — billing section should appear
- Admin page — alpha billing toggle should appear

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/components/SettingsModal.svelte client/src/routes/admin/+page.svelte
git commit -m "feat: hide billing UI in community edition"
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

Standalone admin console for the official SellServ Voice instance. Deployed at `admin.sellserv.net`.

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

### Task 7: Update CORS for Admin Console Origins

**Files:**
- Modify: `server/src/index.ts:56-73` (CORS config)

- [ ] **Step 1: CORS already handles this**

The existing CORS config reads from `CORS_ORIGINS` env var (comma-separated list). No code changes needed — just add the admin console origins to the env var on the VPS:

```
CORS_ORIGINS=https://chat.sellserv.net,https://staging.sellserv.net,https://admin.sellserv.net,https://admin-staging.sellserv.net
```

- [ ] **Step 2: Document the required env vars**

Create or update a `.env.example` file (if one exists) to include:

```bash
# Edition: 'community' (default) or 'official'
EDITION=community

# CORS origins — add admin console domains for official edition
# CORS_ORIGINS=https://chat.sellserv.net,https://admin.sellserv.net
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document edition and admin console CORS in env example"
```

---

### Task 8: Update CI/CD for Edition

**Files:**
- Modify: `.github/workflows/deploy-staging.yml`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: No workflow changes needed yet**

The deploy workflows SSH into the VPS and run `npm run build`. The `EDITION` env var is set in the `.env` file on the VPS, not in the workflow. Since the admin console is just a placeholder workspace with no-op build scripts, there's nothing to change in CI yet.

When the admin console is fully implemented, the workflows will need additional steps to:
1. Build the admin console: `npm run build --workspace=admin-console`
2. Deploy the admin console build output to its domain

For now, just ensure `EDITION=official` is in the `.env` files on both staging and production VPS.

- [ ] **Step 2: Verify staging deploy works**

Push to staging and confirm the deploy succeeds with the new code. The health check should pass — billing routes are only gated, not broken.

- [ ] **Step 3: Commit (if any changes were needed)**

No commit needed for this task unless env example was updated in Task 7.
