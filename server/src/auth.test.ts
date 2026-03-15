import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { initSchema } from './db/schema.js';
import authRoutes from './routes/auth.js';
import db from './db/connection.js';

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

describe('Auth Integration', () => {
  const app = Fastify();
  
  beforeAll(async () => {
    await app.register(fastifyCookie);
    // Register routes with the correct prefix if needed, but the routes file seems to use /api/auth
    await app.register(authRoutes);
    initSchema();
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM auth_sessions').run();
    db.exec('PRAGMA foreign_keys = ON');
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register a new user and require verification', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'user_reg',
        password: 'Password12345678', // > 15 chars
        email: 'reg@example.com',
        display_name: 'Test User',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.verification_required).toBe(true);
    expect(body.user_id).toBeDefined();

    // Manually verify email in DB for next tests
    db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run('user_reg');
  });

  it('should login and create a session in auth_sessions table', async () => {
    // Register first
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'user_login',
        password: 'Password12345678',
        email: 'login@example.com',
      },
    });
    db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run('user_login');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'user_login',
        password: 'Password12345678',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = JSON.parse(loginRes.body);
    expect(loginBody.mfa_required).toBe(true);

    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('user_login') as { id: string };

    // Overwrite MFA code with a known one for testing
    const testCode = '123456';
    db.prepare("UPDATE email_codes SET code = ? WHERE user_id = ? AND type = 'mfa'").run(hashCode(testCode), user.id);
    
    // Verify MFA
    const mfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login/mfa',
      payload: {
        user_id: user.id,
        code: testCode,
      },
    });

    expect(mfaRes.statusCode).toBe(200);
    
    // Check if a session was created in auth_sessions table
    const session = db.prepare('SELECT * FROM auth_sessions WHERE user_id = ?').get(user.id);
    expect(session).toBeDefined();
  });

  it('should revoke session on logout', async () => {
    // Register & login
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'user_logout',
        password: 'Password12345678',
        email: 'logout@example.com',
      },
    });
    db.prepare('UPDATE users SET email_verified = 1 WHERE username = ?').run('user_logout');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'user_logout',
        password: 'Password12345678',
      },
    });
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('user_logout') as { id: string };

    // Overwrite MFA code
    const testCode = '123456';
    db.prepare("UPDATE email_codes SET code = ? WHERE user_id = ? AND type = 'mfa'").run(hashCode(testCode), user.id);
    
    const mfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login/mfa',
      payload: {
        user_id: user.id,
        code: testCode,
      },
    });

    const sessionsBefore = db.prepare('SELECT COUNT(*) as count FROM auth_sessions WHERE user_id = ?').get(user.id) as { count: number };
    expect(sessionsBefore.count).toBeGreaterThan(0);

    // Logout
    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: mfaRes.cookies.reduce((acc, c) => ({ ...acc, [c.name]: c.value }), {}),
    });

    // Check if session was removed from DB
    const sessionsAfter = db.prepare('SELECT COUNT(*) as count FROM auth_sessions WHERE user_id = ?').get(user.id) as { count: number };
    expect(sessionsAfter.count).toBe(0);
  });
});
