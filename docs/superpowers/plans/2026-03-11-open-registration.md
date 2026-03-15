# Open Registration + Safeguards Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow account creation without invite codes, protected by Cloudflare Turnstile CAPTCHA and a 1-hour new-user cooldown on DMs and uploads.

**Architecture:** Three changes layered onto the existing auth system: (1) make invite_code optional in the registration transaction, (2) add server-side Turnstile verification as a pre-registration check, (3) add account-age checks to the upload route and DM WebSocket handler. The Turnstile site key is served to the client via the existing setup-status endpoint.

**Tech Stack:** Fastify (server), SvelteKit/Svelte 5 (client), Cloudflare Turnstile (CAPTCHA), SQLite (existing DB)

---

## File Structure

**Modified files:**
- `server/src/config.ts` — Add `turnstileSiteKey` and `turnstileSecretKey` config vars
- `server/src/routes/auth.ts` — Remove invite code requirement, add Turnstile verification, expose site key
- `server/src/routes/upload.ts` — Add new-user cooldown check
- `server/src/ws/handlers.ts` — Add new-user cooldown check to `handleDmOpen`
- `shared/types.ts` — Add `captcha_token` to `RegisterBody`
- `client/src/lib/stores/auth.ts` — Pass `captcha_token` in register call
- `client/src/lib/components/LoginPage.svelte` — Add Turnstile widget, make invite code optional
- `client/src/app.html` — Add Turnstile script tag
- `.env.example` — Document new env vars
- `server/src/index.ts` — Update CSP for Turnstile domains

**New files:**
- `server/src/auth/cooldown.ts` — Shared cooldown check helper (used by upload route and WS handler)
- `server/src/auth/turnstile.ts` — Turnstile token verification helper

---

## Chunk 1: Server-Side Changes

### Task 1: Add Turnstile config vars

**Files:**
- Modify: `server/src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add Turnstile env vars to config.ts**

In `server/src/config.ts`, add to the config object (after `emailFrom`):

```typescript
turnstileSiteKey: env('TURNSTILE_SITE_KEY', ''),
turnstileSecretKey: env('TURNSTILE_SECRET_KEY', ''),
```

- [ ] **Step 2: Add Turnstile env vars to .env.example**

Add after the Email section:

```
# Cloudflare Turnstile (optional — CAPTCHA disabled without it)
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

- [ ] **Step 3: Commit**

```bash
git add server/src/config.ts .env.example
git commit -m "feat: add Turnstile config vars"
```

---

### Task 2: Create Turnstile verification helper

**Files:**
- Create: `server/src/auth/turnstile.ts`

- [ ] **Step 1: Create the Turnstile verification module**

Create `server/src/auth/turnstile.ts`:

```typescript
import { config } from '../config.js';

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Verify a Cloudflare Turnstile token.
 * Returns true if verification succeeds or if Turnstile is not configured.
 */
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!config.turnstileSecretKey) return true; // Skip if not configured

  if (!token) return false;

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      secret: config.turnstileSecretKey,
      response: token,
      remoteip: ip,
    }),
  });

  const data = (await res.json()) as TurnstileResponse;
  return data.success;
}

/**
 * Whether Turnstile CAPTCHA is enabled (both keys configured).
 */
export function isTurnstileEnabled(): boolean {
  return !!(config.turnstileSiteKey && config.turnstileSecretKey);
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/auth/turnstile.ts
git commit -m "feat: add Turnstile verification helper"
```

---

### Task 3: Create account-age cooldown helper

**Files:**
- Create: `server/src/auth/cooldown.ts`

- [ ] **Step 1: Create the cooldown module**

Create `server/src/auth/cooldown.ts`:

```typescript
import db from '../db/connection.js';

const NEW_USER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

interface CooldownResult {
  restricted: boolean;
  minutesRemaining?: number;
}

/**
 * Check if a user is within the new-account cooldown period.
 * Admins are exempt.
 */
export function checkNewUserCooldown(userId: string): CooldownResult {
  const user = db
    .prepare('SELECT role, created_at FROM users WHERE id = ?')
    .get(userId) as { role: string; created_at: string } | undefined;

  if (!user) return { restricted: false };
  if (user.role === 'admin') return { restricted: false };

  const createdAt = new Date(user.created_at + 'Z').getTime();
  const elapsed = Date.now() - createdAt;

  if (elapsed < NEW_USER_COOLDOWN_MS) {
    const minutesRemaining = Math.ceil((NEW_USER_COOLDOWN_MS - elapsed) / 60000);
    return { restricted: true, minutesRemaining };
  }

  return { restricted: false };
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/auth/cooldown.ts
git commit -m "feat: add new-user cooldown helper"
```

---

### Task 4: Update registration route — open registration + Turnstile

**Files:**
- Modify: `server/src/routes/auth.ts`
- Modify: `shared/types.ts`

- [ ] **Step 1: Add `captcha_token` to RegisterBody in shared types**

In `shared/types.ts`, update the `RegisterBody` interface (around line 869):

```typescript
export interface RegisterBody {
  username: string;
  password: string;
  email: string;
  display_name?: string;
  invite_code?: string;
  setup_token?: string;
  captcha_token?: string;
}
```

- [ ] **Step 2: Add Turnstile import to auth.ts**

At the top of `server/src/routes/auth.ts`, add after the existing imports:

```typescript
import { verifyTurnstile, isTurnstileEnabled } from '../auth/turnstile.js';
```

- [ ] **Step 3: Add Turnstile verification before registration logic**

In `server/src/routes/auth.ts`, in the register handler, after the banned-user check (after line 154) and before `const id = randomUUID();` (line 156), add:

```typescript
    // Verify CAPTCHA (skip for first-user setup)
    const userCountForCaptcha = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_bot = 0').get() as { c: number };
    if (userCountForCaptcha.c > 0) {
      const captchaValid = await verifyTurnstile(request.body.captcha_token, request.ip);
      if (!captchaValid) {
        return reply.code(400).send({ error: 'CAPTCHA verification failed' });
      }
    }
```

- [ ] **Step 4: Make invite code optional in the registration transaction**

In `server/src/routes/auth.ts`, inside the `db.transaction()` callback, replace the invite code validation block (lines 191-207):

**Old code (lines 190-207):**
```typescript
      // Validate invite code inside transaction for atomicity
      let inviteRow: InviteCode | undefined;
      if (role === 'member') {
        if (!invite_code) {
          return { error: 'Invite code required' } as const;
        }
        inviteRow = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(invite_code) as
          | InviteCode
          | undefined;
        if (!inviteRow) {
          return { error: 'Invalid invite code' } as const;
        }
        if (inviteRow.expires_at && new Date(inviteRow.expires_at) < new Date()) {
          return { error: 'Invite code has expired' } as const;
        }
        if (inviteRow.max_uses !== null && inviteRow.use_count >= inviteRow.max_uses) {
          return { error: 'Invite code has reached maximum uses' } as const;
        }
      }
```

**New code:**
```typescript
      // Validate invite code if provided (optional for open registration)
      let inviteRow: InviteCode | undefined;
      if (role === 'member' && invite_code) {
        inviteRow = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(invite_code) as
          | InviteCode
          | undefined;
        if (!inviteRow) {
          return { error: 'Invalid invite code' } as const;
        }
        if (inviteRow.expires_at && new Date(inviteRow.expires_at) < new Date()) {
          return { error: 'Invite code has expired' } as const;
        }
        if (inviteRow.max_uses !== null && inviteRow.use_count >= inviteRow.max_uses) {
          return { error: 'Invite code has reached maximum uses' } as const;
        }
      }
```

The key change: removed the `if (!invite_code) return { error: 'Invite code required' }` check.

- [ ] **Step 5: Update setup-status endpoint to include Turnstile site key**

In `server/src/routes/auth.ts`, update the setup-status handler (around line 104-109). Add the Turnstile import usage:

**Old:**
```typescript
    return reply.send({ needsSetup: userCount.c === 0 });
```

**New:**
```typescript
    return reply.send({
      needsSetup: userCount.c === 0,
      turnstileSiteKey: isTurnstileEnabled() ? config.turnstileSiteKey : null,
    });
```

Also add at the top of the file with other imports:

```typescript
import { config } from '../config.js';
```

Wait — `config` is already imported at line 15. So just add `isTurnstileEnabled` to the turnstile import.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts server/src/routes/auth.ts
git commit -m "feat: open registration with optional invite code and Turnstile CAPTCHA"
```

---

### Task 5: Add new-user cooldown to upload route

**Files:**
- Modify: `server/src/routes/upload.ts`

- [ ] **Step 1: Add cooldown check to upload route**

In `server/src/routes/upload.ts`, add the import at the top:

```typescript
import { checkNewUserCooldown } from '../auth/cooldown.js';
```

Then in the upload handler, after `const data = await request.file();` check (line 50-53), add the cooldown check before the MIME type check:

```typescript
    // New-user cooldown: block uploads for accounts < 1 hour old
    const cooldown = checkNewUserCooldown(request.user.userId);
    if (cooldown.restricted) {
      return reply.code(403).send({
        error: `New accounts cannot upload files yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
      });
    }
```

- [ ] **Step 2: Commit**

```bash
git add server/src/routes/upload.ts
git commit -m "feat: add new-user cooldown to file uploads"
```

---

### Task 6: Add new-user cooldown to DM handler

**Files:**
- Modify: `server/src/ws/handlers.ts`

- [ ] **Step 1: Add cooldown check to handleDmOpen**

In `server/src/ws/handlers.ts`, add the import at the top (with other imports):

```typescript
import { checkNewUserCooldown } from '../auth/cooldown.js';
```

Then in the `handleDmOpen` function (line 1192), after the target user validation (line 1198-1202), add before the "Check if DM already exists" block:

```typescript
  // New-user cooldown: block DM creation for accounts < 1 hour old
  const cooldown = checkNewUserCooldown(user.userId);
  if (cooldown.restricted) {
    sendTo(user.userId, {
      type: 'error',
      message: `New accounts cannot send direct messages yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
    });
    return;
  }
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ws/handlers.ts
git commit -m "feat: add new-user cooldown to DM creation"
```

---

### Task 7: Update CSP for Turnstile

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Update Content-Security-Policy to allow Turnstile**

In `server/src/index.ts`, update the CSP (lines 87-99). Turnstile needs `https://challenges.cloudflare.com` in `script-src`, `frame-src`, and `connect-src`:

**Old CSP array:**
```typescript
    [
      "default-src 'self'",
      "script-src 'self' https://www.youtube.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' blob: data: https://*.giphy.com https://img.youtube.com",
      "media-src 'self' blob:",
      "connect-src 'self' wss: https://api.giphy.com",
      'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
    ].join('; '),
```

**New CSP array:**
```typescript
    [
      "default-src 'self'",
      "script-src 'self' https://www.youtube.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' blob: data: https://*.giphy.com https://img.youtube.com",
      "media-src 'self' blob:",
      "connect-src 'self' wss: https://api.giphy.com https://challenges.cloudflare.com",
      'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com',
    ].join('; '),
```

- [ ] **Step 2: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: update CSP to allow Cloudflare Turnstile"
```

---

## Chunk 2: Client-Side Changes

### Task 8: Add Turnstile script to app.html

**Files:**
- Modify: `client/src/app.html`

- [ ] **Step 1: Add Turnstile script tag**

In `client/src/app.html`, add the Turnstile script in the `<head>` section, before `%sveltekit.head%` (line 83):

```html
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
```

Using `render=explicit` so we control when the widget renders in our Svelte component.

- [ ] **Step 2: Commit**

```bash
git add client/src/app.html
git commit -m "feat: add Turnstile script to app.html"
```

---

### Task 9: Update auth store to pass captcha_token

**Files:**
- Modify: `client/src/lib/stores/auth.ts`

- [ ] **Step 1: Add captcha_token parameter to register function**

In `client/src/lib/stores/auth.ts`, update the `register` function signature and body (lines 123-143):

**Old:**
```typescript
export async function register(
  username: string,
  password: string,
  email: string,
  display_name?: string,
  invite_code?: string,
  setup_token?: string,
) {
  const res = await api.post<LoginResponse>('/api/auth/register', {
    username,
    password,
    email,
    display_name,
    invite_code,
    setup_token,
  });
```

**New:**
```typescript
export async function register(
  username: string,
  password: string,
  email: string,
  display_name?: string,
  invite_code?: string,
  setup_token?: string,
  captcha_token?: string,
) {
  const res = await api.post<LoginResponse>('/api/auth/register', {
    username,
    password,
    email,
    display_name,
    invite_code,
    setup_token,
    captcha_token,
  });
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/stores/auth.ts
git commit -m "feat: pass captcha_token in register API call"
```

---

### Task 10: Update LoginPage — Turnstile widget and optional invite code

**Files:**
- Modify: `client/src/lib/components/LoginPage.svelte`

- [ ] **Step 1: Add Turnstile state and setup-status handling**

In `client/src/lib/components/LoginPage.svelte`, add state variables after line 34 (`let needsSetup = $state(false);`):

```typescript
  let turnstileSiteKey = $state<string | null>(null);
  let captchaToken = $state<string | null>(null);
  let turnstileWidgetId = $state<string | null>(null);
```

Update the `checkSetupStatus` function (lines 49-56) to also capture the Turnstile site key:

**Old:**
```typescript
  async function checkSetupStatus() {
    try {
      const res = await api.get<{ needsSetup: boolean }>('/api/auth/setup-status');
      needsSetup = res.needsSetup;
    } catch {
      needsSetup = false;
    }
  }
```

**New:**
```typescript
  async function checkSetupStatus() {
    try {
      const res = await api.get<{ needsSetup: boolean; turnstileSiteKey: string | null }>('/api/auth/setup-status');
      needsSetup = res.needsSetup;
      turnstileSiteKey = res.turnstileSiteKey ?? null;
    } catch {
      needsSetup = false;
    }
  }
```

- [ ] **Step 2: Add Turnstile render/reset helpers**

After `checkSetupStatus();` and `loadPublicSettings();` (around line 60), add:

```typescript
  function renderTurnstile(container: HTMLElement) {
    if (!turnstileSiteKey || !(window as any).turnstile) return;
    // Reset if already rendered
    if (turnstileWidgetId !== null) {
      (window as any).turnstile.reset(turnstileWidgetId);
      captchaToken = null;
      return;
    }
    turnstileWidgetId = (window as any).turnstile.render(container, {
      sitekey: turnstileSiteKey,
      callback: (token: string) => { captchaToken = token; },
      'expired-callback': () => { captchaToken = null; },
      theme: 'dark',
    });
  }

  function resetTurnstile() {
    if (turnstileWidgetId !== null && (window as any).turnstile) {
      (window as any).turnstile.reset(turnstileWidgetId);
      captchaToken = null;
    }
  }
```

- [ ] **Step 3: Update handleSubmit to pass captcha token and reset on failure**

Update `handleSubmit` (lines 90-119). Change the register call:

**Old:**
```typescript
        const result = await register(
          username,
          password,
          email,
          displayName || undefined,
          inviteCode || undefined,
          setupToken || undefined,
        );
```

**New:**
```typescript
        const result = await register(
          username,
          password,
          email,
          displayName || undefined,
          inviteCode || undefined,
          setupToken || undefined,
          captchaToken || undefined,
        );
```

In the `catch` block, add turnstile reset:

**Old:**
```typescript
    } catch (e: any) {
      error = e.message;
    } finally {
```

**New:**
```typescript
    } catch (e: any) {
      error = e.message;
      resetTurnstile();
    } finally {
```

- [ ] **Step 4: Update the registration form template**

In the template, replace the invite code section (lines 819-834):

**Old:**
```svelte
          {#if needsSetup}
            <label class="field">
              <span>Setup Token</span>
              <input
                type="password"
                bind:value={setupToken}
                placeholder="Enter setup token"
                autocomplete="off"
              />
            </label>
          {:else}
            <label class="field">
              <span>Invite Code</span>
              <input type="text" bind:value={inviteCode} placeholder="Enter invite code" />
            </label>
          {/if}
```

**New:**
```svelte
          {#if needsSetup}
            <label class="field">
              <span>Setup Token</span>
              <input
                type="password"
                bind:value={setupToken}
                placeholder="Enter setup token"
                autocomplete="off"
              />
            </label>
          {:else}
            <label class="field">
              <span>Invite Code <small>(optional)</small></span>
              <input type="text" bind:value={inviteCode} placeholder="Have an invite code?" />
            </label>
          {/if}

          {#if turnstileSiteKey}
            <div class="turnstile-container" use:renderTurnstile></div>
          {/if}
```

- [ ] **Step 5: Add turnstile container styling**

In the `<style>` section at the bottom of the file, add:

```css
  .turnstile-container {
    display: flex;
    justify-content: center;
    margin: 8px 0;
  }
```

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/components/LoginPage.svelte
git commit -m "feat: add Turnstile CAPTCHA widget and make invite code optional"
```

---

### Task 11: Manual testing checklist

- [ ] **Step 1: Test open registration without invite code**

1. Start dev server: `npm run dev`
2. Navigate to registration page
3. Register with username, email, password — no invite code
4. Verify account is created, email verification flow works
5. Verify user is not in any server after login
6. Verify user can join a server via invite code through the server join flow

- [ ] **Step 2: Test registration with invite code still works**

1. Create an invite code from an admin account
2. Register a new account providing that invite code
3. Verify user is added to the correct server

- [ ] **Step 3: Test Turnstile (if configured)**

1. Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in `.env`
2. Restart server
3. Verify Turnstile widget appears on registration form
4. Verify registration fails without completing CAPTCHA
5. Verify registration succeeds after completing CAPTCHA

- [ ] **Step 4: Test new-user cooldown**

1. Register a new account
2. Try to open a DM — should be blocked with time remaining message
3. Try to upload a file — should be blocked with time remaining message
4. Wait 1 hour (or temporarily change `NEW_USER_COOLDOWN_MS` to a short value) and verify both work

- [ ] **Step 5: Test admin bypass**

1. Login as admin
2. Verify DM creation and file uploads work regardless of account age

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: open registration with Turnstile CAPTCHA and new-user cooldown"
```
