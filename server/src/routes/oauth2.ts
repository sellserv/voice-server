import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, randomBytes } from 'crypto';
import { config } from '../config.js';
import { verifyToken } from '../auth/jwt.js';
import { getSessionByToken } from '../auth/sessions.js';
import { isInstanceAdmin } from '../auth/middleware.js';
import { getDb } from '../adapters/index.js';

function generateCode(): string {
  return randomBytes(32).toString('hex');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    const session = await getSessionByToken(payload.jti);
    if (!session || session.user_id !== payload.userId) return null;
    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}

async function cleanupExpiredCodes() {
  await getDb().run("DELETE FROM oauth2_codes WHERE expires_at < datetime('now')");
}

async function cleanupExpiredTokens() {
  await getDb().run("DELETE FROM oauth2_tokens WHERE expires_at < datetime('now')");
}

export default async function oauth2Routes(app: FastifyInstance) {
  // Cleanup expired entries periodically
  setInterval(() => {
    cleanupExpiredCodes().catch(() => {});
    cleanupExpiredTokens().catch(() => {});
  }, 60 * 60 * 1000);

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
      maxAge: 300,
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
    <p>wants to access your account as <span class="user">${escapeHtml(user.username)}</span></p>
    <div class="buttons">
      <form method="POST" action="/oauth2/authorize">
        <input type="hidden" name="client_id" value="${escapeHtml(client_id)}" />
        <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}" />
        <input type="hidden" name="scope" value="${escapeHtml(scope || 'admin')}" />
        <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />
        <button type="submit" class="approve">Approve</button>
      </form>
      <form method="GET" action="${escapeHtml(redirect_uri)}">
        <input type="hidden" name="error" value="access_denied" />
        <input type="hidden" name="state" value="${escapeHtml(state || '')}" />
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

    const cookieCsrf = request.cookies?.oauth2_csrf;
    if (!cookieCsrf || cookieCsrf !== csrf_token) {
      return reply.code(403).send({ error: 'Invalid CSRF token' });
    }

    reply.clearCookie('oauth2_csrf', { path: '/oauth2' });

    if (!validateClient(client_id, redirect_uri)) {
      return reply.code(400).send({ error: 'Invalid client_id or redirect_uri' });
    }

    const user = await getAuthenticatedUser(request);
    if (!user || !isInstanceAdmin(user.userId)) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await getDb().run(
      'INSERT INTO oauth2_codes (code, user_id, client_id, redirect_uri, scope, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [code, user.userId, client_id, redirect_uri, scope || 'admin', state || '', expiresAt],
    );

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

    if (client_id !== config.oauth2.clientId || client_secret !== config.oauth2.clientSecret) {
      return reply.code(401).send({ error: 'invalid_client' });
    }

    const authCode = await getDb().queryOne(
      'SELECT * FROM oauth2_codes WHERE code = ? AND used = 0',
      [code],
    ) as any;

    if (!authCode) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
    }

    if (new Date(authCode.expires_at) < new Date()) {
      await getDb().run('DELETE FROM oauth2_codes WHERE code = ?', [code]);
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Authorization code expired' });
    }

    if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
      return reply.code(400).send({ error: 'invalid_grant', error_description: 'Client mismatch' });
    }

    await getDb().run('UPDATE oauth2_codes SET used = 1 WHERE code = ?', [code]);

    const tokenId = randomUUID();
    const accessToken = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await getDb().run(
      'INSERT INTO oauth2_tokens (id, user_id, client_id, access_token, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [tokenId, authCode.user_id, client_id, accessToken, authCode.scope, expiresAt],
    );

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
    const tokenRow = await getDb().queryOne(
      'SELECT * FROM oauth2_tokens WHERE access_token = ? AND revoked = 0',
      [accessToken],
    ) as any;

    if (!tokenRow || new Date(tokenRow.expires_at) < new Date()) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const user = await getDb().queryOne(
      'SELECT id, username, display_name, email, avatar_url FROM users WHERE id = ?',
      [tokenRow.user_id],
    ) as any;

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

    await getDb().run('UPDATE oauth2_tokens SET revoked = 1 WHERE access_token = ?', [token]);

    return { success: true };
  });
}
