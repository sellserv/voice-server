# Open Core: Official Instance Toggle + Standalone Admin Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `OFFICIAL_INSTANCE` toggle that gates billing, OAuth2 provider, and a standalone admin console. Fix ADMIN_USERS to use user IDs. Build the full admin console as a SvelteKit app with OAuth2 authentication.

**Architecture:** Single env var `OFFICIAL_INSTANCE` (defaults `false`) controls what features register. OAuth2 provider on the server lets the standalone admin console authenticate via the main app. Admin console is a SvelteKit app (adapter-node) in the `admin-console/` workspace that talks to the existing admin API endpoints.

**Tech Stack:** Fastify, SvelteKit (Svelte 5), TypeScript, npm workspaces, OAuth2

---

### Task 1: Switch ADMIN_USERS to User IDs

**Files:**
- Modify: `server/src/config.ts:53`
- Modify: `server/src/auth/middleware.ts:86-90`
- Modify: `server/src/routes/auth.ts:152,669`

- [ ] **Step 1: Update isInstanceAdmin to check userId**

In `server/src/auth/middleware.ts`, change:

```typescript
export function isInstanceAdmin(username: string): boolean {
  return config.adminUsers.includes(username.toLowerCase());
}
```

to:

```typescript
export function isInstanceAdmin(userId: string): boolean {
  return config.adminUsers.includes(userId);
}
```

- [ ] **Step 2: Update requireAdmin to pass userId**

In `server/src/auth/middleware.ts`, change:

```typescript
if (!isInstanceAdmin(request.user.username)) {
```

to:

```typescript
if (!isInstanceAdmin(request.user.userId)) {
```

- [ ] **Step 3: Update auth routes that check adminUsers**

In `server/src/routes/auth.ts`, find the two places that check `config.adminUsers.includes(username.toLowerCase())` (lines 152 and 669). These set `is_instance_admin` on the user response. Change both to check by user ID instead:

Line 152 (login response):
```typescript
is_instance_admin: config.adminUsers.includes(user.id),
```

Line 669 (similar context):
```typescript
is_instance_admin: config.adminUsers.includes(user.id),
```

- [ ] **Step 4: Remove .toLowerCase() from config parsing**

In `server/src/config.ts`, change line 53:

```typescript
adminUsers: env('ADMIN_USERS', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
```

to:

```typescript
adminUsers: env('ADMIN_USERS', '').split(',').map(s => s.trim()).filter(Boolean),
```

UUIDs are case-insensitive but consistent — no need for toLowerCase.

- [ ] **Step 5: Update ADMIN_USERS env var on VPS**

Look up your user ID from the database and update the `.env` files on staging and production:

```bash
# On VPS:
sqlite3 data/voip-server.db "SELECT id, username FROM users WHERE username = 'carter'"
```

Then update `.env`:
```bash
ADMIN_USERS=<your-user-id-here>
```

- [ ] **Step 6: Verify**

Run: `npm run dev:server`

Test that admin endpoints still work with the updated ADMIN_USERS format.

- [ ] **Step 7: Commit**

```bash
git add server/src/config.ts server/src/auth/middleware.ts server/src/routes/auth.ts
git commit -m "security: switch ADMIN_USERS from usernames to user IDs"
```

---

### Task 2: Add OFFICIAL_INSTANCE Toggle and Gate Features

**Files:**
- Modify: `server/src/config.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add officialInstance to config**

In `server/src/config.ts`, add after the `host` line (line 45):

```typescript
officialInstance: env('OFFICIAL_INSTANCE', 'false') === 'true',
```

- [ ] **Step 2: Gate billing routes**

In `server/src/index.ts`, change line 253:

```typescript
await app.register(billingRoutes);
```

to:

```typescript
if (config.officialInstance) {
  await app.register(billingRoutes);
}
```

Ensure `config` is imported (add `import { config } from './config.js';` if not already present).

- [ ] **Step 3: Add features to public instance info endpoint**

In `server/src/index.ts`, in the existing `/api/public/instance/info` handler, add to the return object:

```typescript
features: {
  officialInstance: config.officialInstance,
},
```

- [ ] **Step 4: Verify**

Run: `npm run dev:server`

```bash
curl -s http://localhost:3000/api/public/instance/info | jq .features
# Expected: { "officialInstance": false }

curl -s http://localhost:3000/api/billing/status
# Expected: 404 (not registered)
```

- [ ] **Step 5: Commit**

```bash
git add server/src/config.ts server/src/index.ts
git commit -m "feat: add OFFICIAL_INSTANCE toggle, gate billing routes"
```

---

### Task 3: OAuth2 Database Schema

**Files:**
- Modify: `server/src/db/schema.ts`

- [ ] **Step 1: Add OAuth2 tables**

In `server/src/db/schema.ts`, add a new migration (follow the existing migration pattern) with two tables:

```sql
CREATE TABLE IF NOT EXISTS oauth2_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'admin',
  state TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth2_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  access_token TEXT UNIQUE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'admin',
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_access_token ON oauth2_tokens(access_token);
CREATE INDEX IF NOT EXISTS idx_oauth2_codes_expires ON oauth2_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_expires ON oauth2_tokens(expires_at);
```

- [ ] **Step 2: Verify migration runs**

Run: `npm run dev:server`
Expected: Server starts, new tables created without errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/db/schema.ts
git commit -m "feat: add OAuth2 authorization codes and tokens tables"
```

---

### Task 4: OAuth2 Provider Config

**Files:**
- Modify: `server/src/config.ts`

- [ ] **Step 1: Add OAuth2 config**

In `server/src/config.ts`, add to the config object:

```typescript
oauth2: {
  clientId: env('OAUTH2_CLIENT_ID', 'admin-console'),
  clientSecret: env('OAUTH2_CLIENT_SECRET', ''),
  redirectUri: env('OAUTH2_REDIRECT_URI', ''),
},
```

- [ ] **Step 2: Commit**

```bash
git add server/src/config.ts
git commit -m "feat: add OAuth2 client config for admin console"
```

---

### Task 5: OAuth2 Provider Endpoints

**Files:**
- Create: `server/src/routes/oauth2.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Create OAuth2 routes file**

Create `server/src/routes/oauth2.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, randomBytes } from 'crypto';
import { config } from '../config.js';
import { signToken, verifyToken } from '../auth/jwt.js';
import { getSessionByToken } from '../auth/sessions.js';
import { isInstanceAdmin } from '../auth/middleware.js';
import db from '../db/connection.js';

function generateCode(): string {
  return randomBytes(32).toString('hex');
}

function validateClient(clientId: string, redirectUri: string): boolean {
  return (
    clientId === config.oauth2.clientId &&
    redirectUri === config.oauth2.redirectUri
  );
}

// Get the currently logged-in user from the auth cookie (same as main app)
async function getAuthenticatedUser(request: FastifyRequest): Promise<{ userId: string; username: string } | null> {
  const token = request.cookies?.token;
  if (!token) return null;

  try {
    const payload = verifyToken(token);
    const session = getSessionByToken(payload.jti);
    if (!session || session.user_id !== payload.userId) return null;

    // Check session not expired
    if (new Date(session.expires_at) < new Date()) return null;

    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}

function cleanupExpiredCodes() {
  db.prepare("DELETE FROM oauth2_codes WHERE expires_at < datetime('now')").run();
}

function cleanupExpiredTokens() {
  db.prepare("DELETE FROM oauth2_tokens WHERE expires_at < datetime('now')").run();
}

export default async function oauth2Routes(app: FastifyInstance) {
  // Cleanup expired entries periodically
  setInterval(() => {
    cleanupExpiredCodes();
    cleanupExpiredTokens();
  }, 60 * 60 * 1000); // Every hour

  // ─── GET /oauth2/authorize — Show consent or redirect to login ───
  app.get('/oauth2/authorize', async (request: FastifyRequest<{
    Querystring: { client_id: string; redirect_uri: string; response_type: string; scope?: string; state?: string }
  }>, reply: FastifyReply) => {
    const { client_id, redirect_uri, response_type, scope, state } = request.query;

    if (response_type !== 'code') {
      return reply.code(400).send({ error: 'Only response_type=code is supported' });
    }

    if (!validateClient(client_id, redirect_uri)) {
      return reply.code(400).send({ error: 'Invalid client_id or redirect_uri' });
    }

    const user = await getAuthenticatedUser(request);

    if (!user) {
      // Not logged in — show a page directing them to log in on the main app
      return reply.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Admin Console - Login Required</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #16213e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; }
    h1 { font-size: 1.3rem; margin: 0 0 12px; }
    p { color: #a0a0b8; font-size: 0.9rem; line-height: 1.5; margin: 0 0 24px; }
    a { display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; }
    a:hover { filter: brightness(1.1); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin Console</h1>
    <p>You need to be logged in to the main app first.</p>
    <a href="/">Go to Login</a>
  </div>
</body>
</html>`);
    }

    if (!isInstanceAdmin(user.userId)) {
      return reply.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Admin Console - Access Denied</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #16213e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; }
    h1 { font-size: 1.3rem; margin: 0 0 12px; color: #ef4444; }
    p { color: #a0a0b8; font-size: 0.9rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Access Denied</h1>
    <p>Your account does not have instance admin privileges.</p>
  </div>
</body>
</html>`);
    }

    // Generate CSRF token for the consent form
    const csrfToken = randomBytes(32).toString('hex');
    reply.setCookie('oauth2_csrf', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/oauth2',
      maxAge: 300, // 5 minutes
    });

    // Show consent screen
    return reply.type('text/html').send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authorize Admin Console</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #16213e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 40px; max-width: 420px; text-align: center; }
    h1 { font-size: 1.3rem; margin: 0 0 8px; }
    .app-name { color: #6366f1; font-weight: 700; }
    p { color: #a0a0b8; font-size: 0.9rem; line-height: 1.5; margin: 0 0 24px; }
    .user { color: #6366f1; font-weight: 600; }
    .buttons { display: flex; gap: 12px; justify-content: center; }
    button { padding: 10px 24px; border-radius: 6px; font-weight: 600; font-size: 0.9rem; border: none; cursor: pointer; }
    .approve { background: #6366f1; color: white; }
    .approve:hover { filter: brightness(1.1); }
    .deny { background: #2a2a4a; color: #a0a0b8; }
    .deny:hover { background: #3a3a5a; }
  </style>
</head>
<body>
  <div class="card">
    <h1><span class="app-name">Admin Console</span></h1>
    <p>wants to access your account as <span class="user">${user.username}</span></p>
    <div class="buttons">
      <form method="POST" action="/oauth2/authorize">
        <input type="hidden" name="client_id" value="${client_id}" />
        <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
        <input type="hidden" name="scope" value="${scope || 'admin'}" />
        <input type="hidden" name="state" value="${state || ''}" />
        <input type="hidden" name="csrf_token" value="${csrfToken}" />
        <button type="submit" class="approve">Approve</button>
      </form>
      <form method="GET" action="${redirect_uri}">
        <input type="hidden" name="error" value="access_denied" />
        <input type="hidden" name="state" value="${state || ''}" />
        <button type="submit" class="deny">Deny</button>
      </form>
    </div>
  </div>
</body>
</html>`);
  });

  // ─── POST /oauth2/authorize — Handle consent approval ───
  app.post('/oauth2/authorize', async (request: FastifyRequest<{
    Body: { client_id: string; redirect_uri: string; scope: string; state: string; csrf_token: string }
  }>, reply: FastifyReply) => {
    const { client_id, redirect_uri, scope, state, csrf_token } = request.body as any;

    // Verify CSRF
    const cookieCsrf = request.cookies?.oauth2_csrf;
    if (!cookieCsrf || cookieCsrf !== csrf_token) {
      return reply.code(403).send({ error: 'Invalid CSRF token' });
    }

    // Clear CSRF cookie
    reply.clearCookie('oauth2_csrf', { path: '/oauth2' });

    if (!validateClient(client_id, redirect_uri)) {
      return reply.code(400).send({ error: 'Invalid client_id or redirect_uri' });
    }

    const user = await getAuthenticatedUser(request);
    if (!user || !isInstanceAdmin(user.userId)) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }

    // Generate authorization code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    db.prepare(
      'INSERT INTO oauth2_codes (code, user_id, client_id, redirect_uri, scope, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(code, user.userId, client_id, redirect_uri, scope || 'admin', state || '', expiresAt);

    // Redirect back to admin console with code
    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);

    return reply.redirect(url.toString());
  });

  // ─── POST /oauth2/token — Exchange code for access token ───
  app.post('/oauth2/token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { grant_type, code, client_id, client_secret, redirect_uri } = request.body as any;

    if (grant_type !== 'authorization_code') {
      return reply.code(400).send({ error: 'unsupported_grant_type' });
    }

    // Validate client credentials
    if (client_id !== config.oauth2.clientId || client_secret !== config.oauth2.clientSecret) {
      return reply.code(401).send({ error: 'invalid_client' });
    }

    // Look up and validate authorization code
    const authCode = db.prepare(
      'SELECT * FROM oauth2_codes WHERE code = ? AND used = 0'
    ).get(code) as any;

    if (!authCode) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }

    if (new Date(authCode.expires_at) < new Date()) {
      db.prepare('DELETE FROM oauth2_codes WHERE code = ?').run(code);
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Authorization code expired' });
    }

    if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Client mismatch' });
    }

    // Mark code as used
    db.prepare('UPDATE oauth2_codes SET used = 1 WHERE code = ?').run(code);

    // Generate access token
    const tokenId = randomUUID();
    const accessToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    db.prepare(
      'INSERT INTO oauth2_tokens (id, user_id, client_id, access_token, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(tokenId, authCode.user_id, client_id, accessToken, authCode.scope, expiresAt);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: authCode.scope,
    };
  });

  // ─── GET /oauth2/userinfo — Return user info for valid token ───
  app.get('/oauth2/userinfo', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing bearer token' });
    }

    const accessToken = auth.slice(7);
    const tokenRow = db.prepare(
      'SELECT * FROM oauth2_tokens WHERE access_token = ? AND revoked = 0'
    ).get(accessToken) as any;

    if (!tokenRow || new Date(tokenRow.expires_at) < new Date()) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const user = db.prepare(
      'SELECT id, username, display_name, email, avatar_url FROM users WHERE id = ?'
    ).get(tokenRow.user_id) as any;

    if (!user) {
      return reply.code(401).send({ error: 'User not found' });
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      email: user.email,
      avatarUrl: user.avatar_url,
      isAdmin: isInstanceAdmin(user.id),
    };
  });

  // ─── POST /oauth2/revoke — Revoke an access token ───
  app.post('/oauth2/revoke', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token, client_id, client_secret } = request.body as any;

    if (client_id !== config.oauth2.clientId || client_secret !== config.oauth2.clientSecret) {
      return reply.code(401).send({ error: 'invalid_client' });
    }

    db.prepare('UPDATE oauth2_tokens SET revoked = 1 WHERE access_token = ?').run(token);

    return { success: true };
  });
}
```

- [ ] **Step 2: Register OAuth2 routes behind toggle**

In `server/src/index.ts`, add the import:

```typescript
import oauth2Routes from './routes/oauth2.js';
```

Register conditionally near the billing routes:

```typescript
if (config.officialInstance) {
  await app.register(billingRoutes);
  await app.register(oauth2Routes);
}
```

- [ ] **Step 3: Add formbody parser for OAuth2 POST**

The consent form POSTs as `application/x-www-form-urlencoded`. Install and register the formbody parser:

```bash
npm install @fastify/formbody --workspace=server
```

In `server/src/index.ts`, add:

```typescript
import fastifyFormbody from '@fastify/formbody';
```

Register it with the other plugins (before routes):

```typescript
await app.register(fastifyFormbody);
```

- [ ] **Step 4: Verify OAuth2 authorize page**

Run: `OFFICIAL_INSTANCE=true npm run dev:server`

Visit `http://localhost:3000/oauth2/authorize?client_id=admin-console&redirect_uri=http://localhost:5174/auth/callback&response_type=code&state=test123`

Expected: If not logged in, shows "Login Required" page. If logged in as admin, shows consent screen.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/oauth2.ts server/src/index.ts package.json package-lock.json
git commit -m "feat: add OAuth2 provider for standalone admin console"
```

---

### Task 6: Scaffold Admin Console Workspace

**Files:**
- Create: `admin-console/package.json`
- Create: `admin-console/svelte.config.js`
- Create: `admin-console/vite.config.ts`
- Create: `admin-console/tsconfig.json`
- Create: `admin-console/src/app.html`
- Create: `admin-console/src/app.css`
- Create: `admin-console/static/favicon.png` (copy from client)
- Modify: `package.json` (root)

- [ ] **Step 1: Add workspace to root package.json**

In root `package.json`, add `"admin-console"` to workspaces:

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

- [ ] **Step 2: Create admin-console/package.json**

```json
{
  "name": "@voip-server/admin-console",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite dev --port 5174",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node build/index.js"
  },
  "dependencies": {
    "@sveltejs/adapter-node": "^5.0.0",
    "@sveltejs/kit": "^2.0.0",
    "@voip-server/shared": "*",
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "typescript": "^5.7.3",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create admin-console/svelte.config.js**

```javascript
import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ out: 'build' }),
  },
};

export default config;
```

- [ ] **Step 4: Create admin-console/vite.config.ts**

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
});
```

- [ ] **Step 5: Create admin-console/tsconfig.json**

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

- [ ] **Step 6: Create admin-console/src/app.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body>
    <div id="app">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 7: Create admin-console/src/app.css**

Define the CSS custom properties (matching the main app's theme):

```css
:root {
  --bg-darker: #111827;
  --bg-dark: #1f2937;
  --bg-mid: #283141;
  --bg-light: #374151;
  --bg-hover: #3f4a5c;
  --bg-darkest: #0d1117;
  --text: #f3f4f6;
  --text-muted: #9ca3af;
  --text-dim: #6b7280;
  --text-light: #d1d5db;
  --border: #374151;
  --accent: #6366f1;
  --danger: #ef4444;
  --success: #22c55e;
  --warning: #f59e0b;
  --radius-sm: 6px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg-darker);
  color: var(--text);
  min-height: 100vh;
}

a { color: inherit; text-decoration: none; }

button { font-family: inherit; }
```

- [ ] **Step 8: Install dependencies and verify**

```bash
npm install
cd admin-console && npx svelte-kit sync
npm run dev --workspace=admin-console
```

Expected: SvelteKit dev server starts on port 5174.

- [ ] **Step 9: Commit**

```bash
git add admin-console/ package.json package-lock.json
git commit -m "feat: scaffold admin-console SvelteKit workspace"
```

---

### Task 7: Admin Console Auth — OAuth2 Client + Session Management

**Files:**
- Create: `admin-console/src/lib/server/session.ts`
- Create: `admin-console/src/lib/server/oauth2.ts`
- Create: `admin-console/src/hooks.server.ts`
- Create: `admin-console/src/routes/auth/callback/+server.ts`
- Create: `admin-console/src/routes/auth/logout/+server.ts`

- [ ] **Step 1: Create session encryption utility**

Create `admin-console/src/lib/server/session.ts`:

```typescript
import { env } from '$env/dynamic/private';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionData {
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
  createdAt: number;
}

function getSecret(): Buffer {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  return Buffer.from(secret.slice(0, 32), 'utf-8');
}

export function encryptSession(data: SessionData): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getSecret(), iv);
  const json = JSON.stringify(data);
  let encrypted = cipher.update(json, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSession(value: string): SessionData | null {
  try {
    const [ivHex, authTagHex, encrypted] = value.split(':');
    if (!ivHex || !authTagHex || !encrypted) return null;

    const decipher = createDecipheriv(ALGORITHM, getSecret(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');

    const data: SessionData = JSON.parse(decrypted);

    // Check expiry
    if (Date.now() - data.createdAt > SESSION_MAX_AGE) return null;

    return data;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create OAuth2 client utility**

Create `admin-console/src/lib/server/oauth2.ts`:

```typescript
import { env } from '$env/dynamic/private';

export function getOAuth2Config() {
  return {
    clientId: env.OAUTH2_CLIENT_ID || 'admin-console',
    clientSecret: env.OAUTH2_CLIENT_SECRET || '',
    apiUrl: env.API_URL || 'http://localhost:3000',
    redirectUri: env.OAUTH2_REDIRECT_URI || 'http://localhost:5174/auth/callback',
  };
}

export function getAuthorizeUrl(state: string): string {
  const config = getOAuth2Config();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'admin',
    state,
  });
  return `${config.apiUrl}/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<{ access_token: string; expires_in: number }> {
  const config = getOAuth2Config();
  const res = await fetch(`${config.apiUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || 'Token exchange failed');
  }

  return res.json();
}

export async function getUserInfo(accessToken: string): Promise<{
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}> {
  const config = getOAuth2Config();
  const res = await fetch(`${config.apiUrl}/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error('Failed to get user info');
  return res.json();
}

export async function revokeToken(accessToken: string): Promise<void> {
  const config = getOAuth2Config();
  await fetch(`${config.apiUrl}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: accessToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
}
```

- [ ] **Step 3: Create SvelteKit hooks for auth middleware**

Create `admin-console/src/hooks.server.ts`:

```typescript
import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { randomBytes } from 'crypto';
import { decryptSession } from '$lib/server/session';
import { getAuthorizeUrl } from '$lib/server/oauth2';

export const handle: Handle = async ({ event, resolve }) => {
  // Allow auth callback routes through without session check
  if (event.url.pathname.startsWith('/auth/')) {
    return resolve(event);
  }

  // Check session cookie
  const sessionCookie = event.cookies.get('admin_session');
  if (!sessionCookie) {
    const state = randomBytes(16).toString('hex');
    event.cookies.set('oauth2_state', state, {
      httpOnly: true,
      secure: event.url.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    throw redirect(302, getAuthorizeUrl(state));
  }

  const session = decryptSession(sessionCookie);
  if (!session) {
    // Expired or invalid session — clear and redirect
    event.cookies.delete('admin_session', { path: '/' });
    const state = randomBytes(16).toString('hex');
    event.cookies.set('oauth2_state', state, {
      httpOnly: true,
      secure: event.url.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    throw redirect(302, getAuthorizeUrl(state));
  }

  // Attach session to locals
  event.locals.session = session;

  return resolve(event);
};
```

- [ ] **Step 4: Create app.d.ts for type safety**

Create `admin-console/src/app.d.ts`:

```typescript
declare global {
  namespace App {
    interface Locals {
      session: {
        userId: string;
        username: string;
        displayName: string;
        accessToken: string;
        createdAt: number;
      };
    }
  }
}

export {};
```

- [ ] **Step 5: Create OAuth2 callback route**

Create `admin-console/src/routes/auth/callback/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { exchangeCode, getUserInfo } from '$lib/server/oauth2';
import { encryptSession } from '$lib/server/session';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    throw redirect(302, '/?error=access_denied');
  }

  if (!code || !state) {
    throw redirect(302, '/?error=missing_params');
  }

  // Verify state matches
  const savedState = cookies.get('oauth2_state');
  cookies.delete('oauth2_state', { path: '/' });

  if (!savedState || savedState !== state) {
    throw redirect(302, '/?error=invalid_state');
  }

  // Exchange code for token
  const tokenResponse = await exchangeCode(code);

  // Get user info
  const userInfo = await getUserInfo(tokenResponse.access_token);

  if (!userInfo.isAdmin) {
    throw redirect(302, '/?error=not_admin');
  }

  // Create encrypted session cookie
  const sessionValue = encryptSession({
    userId: userInfo.id,
    username: userInfo.username,
    displayName: userInfo.displayName,
    accessToken: tokenResponse.access_token,
    createdAt: Date.now(),
  });

  cookies.set('admin_session', sessionValue, {
    httpOnly: true,
    secure: url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });

  throw redirect(302, '/');
};
```

- [ ] **Step 6: Create logout route**

Create `admin-console/src/routes/auth/logout/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { decryptSession } from '$lib/server/session';
import { revokeToken } from '$lib/server/oauth2';

export const POST: RequestHandler = async ({ cookies }) => {
  const sessionCookie = cookies.get('admin_session');
  if (sessionCookie) {
    const session = decryptSession(sessionCookie);
    if (session) {
      await revokeToken(session.accessToken).catch(() => {});
    }
    cookies.delete('admin_session', { path: '/' });
  }

  throw redirect(302, '/');
};
```

- [ ] **Step 7: Verify OAuth2 flow end-to-end**

Run both servers:

```bash
OFFICIAL_INSTANCE=true OAUTH2_CLIENT_SECRET=test-secret OAUTH2_REDIRECT_URI=http://localhost:5174/auth/callback npm run dev:server
```

```bash
SESSION_SECRET=a]32-char-minimum-secret-string!! API_URL=http://localhost:3000 OAUTH2_CLIENT_SECRET=test-secret OAUTH2_REDIRECT_URI=http://localhost:5174/auth/callback npm run dev --workspace=admin-console
```

Visit `http://localhost:5174`. Expected: redirects to main app OAuth2 authorize page → consent screen → callback → session set → admin console loads.

- [ ] **Step 8: Commit**

```bash
git add admin-console/src/
git commit -m "feat: admin console OAuth2 auth with encrypted sessions"
```

---

### Task 8: Admin Console API Client + Layout

**Files:**
- Create: `admin-console/src/lib/api.ts`
- Create: `admin-console/src/routes/+layout.svelte`
- Create: `admin-console/src/routes/+layout.server.ts`

- [ ] **Step 1: Create server-side layout load function**

Create `admin-console/src/routes/+layout.server.ts`:

```typescript
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: {
      userId: locals.session.userId,
      username: locals.session.username,
      displayName: locals.session.displayName,
    },
  };
};
```

- [ ] **Step 2: Create API client**

Create `admin-console/src/lib/api.ts`:

```typescript
export class ApiClient {
  constructor(private accessToken: string, private baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }

    return res.json();
  }

  get<T>(path: string) { return this.request<T>('GET', path); }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body); }
  patch<T>(path: string, body?: unknown) { return this.request<T>('PATCH', path, body); }
  delete<T>(path: string) { return this.request<T>('DELETE', path); }
}
```

- [ ] **Step 3: Create layout with sidebar navigation**

Create `admin-console/src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  import '../app.css';

  let { data, children } = $props();

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/users', label: 'Users' },
    { path: '/servers', label: 'Servers' },
    { path: '/reports', label: 'Reports' },
    { path: '/audit', label: 'Audit Log' },
  ];
</script>

<div class="admin-layout">
  <nav class="top-bar">
    <div class="top-left">
      <span class="brand">Admin Console</span>
    </div>
    <div class="top-right">
      <span class="user-name">{data.user.displayName || data.user.username}</span>
      <form method="POST" action="/auth/logout">
        <button type="submit" class="logout-btn">Logout</button>
      </form>
    </div>
  </nav>
  <div class="main">
    <aside class="sidebar">
      {#each navItems as item}
        <a
          href={item.path}
          class="nav-item"
          class:active={item.path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(item.path)}
        >
          {item.label}
        </a>
      {/each}
    </aside>
    <main class="content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .admin-layout {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-darker);
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 56px;
    background: var(--bg-dark);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .top-left { display: flex; align-items: center; gap: 16px; }

  .brand {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .top-right { display: flex; align-items: center; gap: 16px; }

  .user-name { color: var(--text-muted); font-size: 0.85rem; }

  .logout-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .logout-btn:hover { color: var(--text); border-color: var(--text-muted); }

  .main { display: flex; flex: 1; overflow: hidden; }

  .sidebar {
    width: 220px;
    background: var(--bg-dark);
    border-right: 1px solid var(--border);
    padding: 16px 8px;
    flex-shrink: 0;
  }

  .nav-item {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 500;
    transition: background 0.1s, color 0.1s;
  }

  .nav-item:hover { background: var(--bg-light); color: var(--text); }
  .nav-item.active { background: var(--bg-light); color: var(--text); }

  .content { flex: 1; padding: 32px; overflow-y: auto; }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add admin-console/src/
git commit -m "feat: admin console layout, API client, and server-side session loading"
```

---

### Task 9: Admin Console Pages — Dashboard + Settings

**Files:**
- Create: `admin-console/src/routes/+page.server.ts`
- Create: `admin-console/src/routes/+page.svelte`

- [ ] **Step 1: Create dashboard server load**

Create `admin-console/src/routes/+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const [stats, settings] = await Promise.all([
    api.get<any>('/api/admin/stats'),
    api.get<any>('/api/admin/instance-settings'),
  ]);
  return { stats, settings };
};
```

- [ ] **Step 2: Create dashboard page**

Create `admin-console/src/routes/+page.svelte`:

Port the existing dashboard from `client/src/routes/admin/+page.svelte`. The key difference: data comes from `data` prop (server-loaded) instead of client-side fetches. Settings mutations still use fetch calls to the API via a helper.

The page should include:
- Stats grid (online, users, servers, messages, files, disk usage, open reports)
- Platform settings (instance name, registration toggle, alpha billing toggle)
- Legal settings (terms URL, privacy URL)

Use the existing page's HTML structure and styles. Replace `api.get`/`api.patch` calls with `fetch` calls that include the Bearer token from the session (passed via a page-level `+page.server.ts` action or client-side fetch with credentials).

For mutations, create server actions in `+page.server.ts`:

```typescript
import type { Actions } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const actions: Actions = {
  updateSettings: async ({ request, locals }) => {
    const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
    const formData = await request.formData();
    const updates: Record<string, any> = {};

    for (const [key, value] of formData.entries()) {
      if (key === 'allow_registration' || key === 'alpha_billing') {
        updates[key] = value === 'true' ? 1 : 0;
      } else {
        updates[key] = value;
      }
    }

    const result = await api.patch<any>('/api/admin/instance-settings', updates);
    return { settings: result };
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add admin-console/src/routes/+page.server.ts admin-console/src/routes/+page.svelte
git commit -m "feat: admin console dashboard with stats and settings"
```

---

### Task 10: Admin Console Pages — Users

**Files:**
- Create: `admin-console/src/routes/users/+page.server.ts`
- Create: `admin-console/src/routes/users/+page.svelte`

- [ ] **Step 1: Create users page**

Port `client/src/routes/admin/users/+page.svelte` to the admin console. The page includes:

- Search box (by username, display name, or email)
- User list with avatars, names, message count, server count, join date
- User detail panel with: avatar, username, display name, banned status, email, last IP, message count, join date, servers list, global role toggles, ban/unban button

Server load in `+page.server.ts`:

```typescript
import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { ApiClient } from '$lib/api';

export const load: PageServerLoad = async ({ locals }) => {
  const api = new ApiClient(locals.session.accessToken, env.API_URL || 'http://localhost:3000');
  const [users, roles] = await Promise.all([
    api.get<any[]>('/api/admin/users'),
    api.get<any[]>('/api/admin/global-roles'),
  ]);
  return { users, roles };
};
```

Add server actions for ban, unban, and role changes.

API endpoints used:
- `GET /api/admin/users`
- `GET /api/admin/global-roles`
- `GET /api/admin/users/:userId`
- `GET /api/admin/users/:userId/global-roles`
- `PATCH /api/admin/users/:userId/global-roles` — `{ roleId, action: 'add'|'remove' }`
- `POST /api/admin/users/:userId/ban` — `{ reason? }`
- `POST /api/admin/users/:userId/unban`

- [ ] **Step 2: Commit**

```bash
git add admin-console/src/routes/users/
git commit -m "feat: admin console users page"
```

---

### Task 11: Admin Console Pages — Servers, Reports, Audit Log

**Files:**
- Create: `admin-console/src/routes/servers/+page.server.ts`
- Create: `admin-console/src/routes/servers/+page.svelte`
- Create: `admin-console/src/routes/reports/+page.server.ts`
- Create: `admin-console/src/routes/reports/+page.svelte`
- Create: `admin-console/src/routes/audit/+page.server.ts`
- Create: `admin-console/src/routes/audit/+page.svelte`

- [ ] **Step 1: Create servers page**

Port `client/src/routes/admin/servers/+page.svelte`. Features:
- Server list with icons, names, owner, member count, channel count, creation date
- Delete button with confirmation

API endpoints:
- `GET /api/admin/servers`
- `DELETE /api/admin/servers/:serverId`

- [ ] **Step 2: Create reports page**

Port `client/src/routes/admin/reports/+page.svelte`. Features:
- Filter tabs: Open | All
- Report cards with status badge, reporter/reported, timestamp, message preview, reason
- Actions: Resolve / Dismiss

API endpoints:
- `GET /api/admin/reports?status=open`
- `GET /api/admin/reports`
- `POST /api/admin/reports/:reportId` — `{ status: 'resolved'|'dismissed' }`

- [ ] **Step 3: Create audit log page**

Port `client/src/routes/admin/audit/+page.svelte`. Features:
- Paginated audit log (50 per page)
- Color-coded event type badges
- Shows event type, actor, target, IP, timestamp
- Previous/Next pagination

API endpoints:
- `GET /api/admin/audit-log?limit=50&page=N`

- [ ] **Step 4: Commit**

```bash
git add admin-console/src/routes/servers/ admin-console/src/routes/reports/ admin-console/src/routes/audit/
git commit -m "feat: admin console servers, reports, and audit log pages"
```

---

### Task 12: Client — Hide In-App Admin When Official, Hide Billing When Not

**Files:**
- Modify: `client/src/routes/admin/+layout.svelte`
- Modify: `client/src/lib/components/SettingsModal.svelte`
- Create or modify: file that fetches instance info on client init

- [ ] **Step 1: Fetch features on client init**

Find where the client fetches `/api/public/instance/info` (or add a fetch to the root layout). Store `features.officialInstance` in a writable store:

Create `client/src/lib/stores/features.ts`:

```typescript
import { writable, derived } from 'svelte/store';

export const officialInstance = writable(false);
```

Populate it from the instance info response's `features.officialInstance` field.

- [ ] **Step 2: Hide in-app admin when official**

In `client/src/routes/admin/+layout.svelte`, import the store and redirect to home if official instance:

```typescript
import { officialInstance } from '$lib/stores/features';

$effect(() => {
  if ($officialInstance) {
    goto('/');
  }
});
```

Also hide the admin link in the sidebar navigation (wherever it's rendered) when `$officialInstance` is true.

- [ ] **Step 3: Hide billing UI when not official**

In `client/src/lib/components/SettingsModal.svelte`, import the store and wrap billing sections in `{#if $officialInstance}`.

In `client/src/routes/admin/+page.svelte`, wrap the alpha billing toggle in `{#if $officialInstance}`.

- [ ] **Step 4: Verify**

Run `npm run dev` (no OFFICIAL_INSTANCE):
- `/admin` route should work
- Billing section should be hidden

Run with `OFFICIAL_INSTANCE=true`:
- `/admin` should redirect to home
- Billing section should show

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/stores/features.ts client/src/routes/admin/ client/src/lib/components/SettingsModal.svelte
git commit -m "feat: hide in-app admin when official, hide billing when not"
```

---

### Task 13: CI/CD — Deploy Admin Console

**Files:**
- Modify: `.github/workflows/deploy-staging.yml`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Update staging deploy**

In `.github/workflows/deploy-staging.yml`, add admin console build and restart after the existing steps. In the SSH script, after `npm run build`:

```bash
# Build admin console if OFFICIAL_INSTANCE is enabled
if [ -f admin-console/package.json ]; then
  npm run build --workspace=admin-console 2>/dev/null || true
fi
```

Add restart for the admin console service:

```bash
if systemctl is-enabled voip-admin-staging 2>/dev/null; then
  sudo systemctl restart voip-admin-staging
fi
```

- [ ] **Step 2: Update production deploy**

Same pattern in `.github/workflows/deploy.yml`:

```bash
if [ -f admin-console/package.json ]; then
  npm run build --workspace=admin-console 2>/dev/null || true
fi
```

```bash
if systemctl is-enabled voip-admin 2>/dev/null; then
  sudo systemctl restart voip-admin
fi
```

- [ ] **Step 3: Document VPS setup needed**

The admin console runs as a separate Node.js service on the VPS. Required setup:
- systemd service (`voip-admin-staging` / `voip-admin`) pointing to `admin-console/build/index.js`
- nginx config for `admin-staging.sellserv.net` / `admin.sellserv.net` proxying to the admin console port
- Environment variables: `SESSION_SECRET`, `API_URL`, `OAUTH2_CLIENT_ID`, `OAUTH2_CLIENT_SECRET`, `OAUTH2_REDIRECT_URI`, `PORT` (e.g. 3002 staging, 3003 production)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/
git commit -m "feat: add admin console build and deploy to CI workflows"
```

---

### Task 14: Document Feature Flags in .env.example

**Files:**
- Modify or create: `.env.example`

- [ ] **Step 1: Add documentation**

Add to `.env.example`:

```bash
# ── Official Instance ──────────────────────────────
# Set to true to enable billing, OAuth2 provider, and standalone admin console.
# Self-hosters should leave this as false. The in-app /admin page is always
# available when this is false.
OFFICIAL_INSTANCE=false

# ── Admin Users ────────────────────────────────────
# Comma-separated list of user IDs (UUIDs) that have instance admin access.
# Look up IDs: sqlite3 data/voip-server.db "SELECT id, username FROM users"
ADMIN_USERS=

# ── OAuth2 (only needed when OFFICIAL_INSTANCE=true) ──
OAUTH2_CLIENT_ID=admin-console
OAUTH2_CLIENT_SECRET=
OAUTH2_REDIRECT_URI=

# ── Admin Console (only needed when OFFICIAL_INSTANCE=true) ──
# These are set in the admin-console's own .env, not the server's:
# SESSION_SECRET=  (min 32 chars)
# API_URL=https://chat.sellserv.net
# PORT=3002
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document OFFICIAL_INSTANCE and OAuth2 config in .env.example"
```
