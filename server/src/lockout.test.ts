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

describe('Account Lockout Integration', () => {
  const app = Fastify();
  
  beforeAll(async () => {
    await app.register(fastifyCookie);
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

  let userId: string;

  it('should register and verify a user', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'lockuser',
        password: 'Password12345678', // Strong
        email: 'lock@example.com',
      },
    });
    expect(regRes.statusCode).toBe(200);
    userId = JSON.parse(regRes.body).user_id;
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  });

  it('should lock account after 5 failed attempts', async () => {
    // 4 failed attempts
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'lockuser', password: 'WrongPassword12345' } // Valid length but wrong
      });
      expect(res.statusCode).toBe(401);
    }

    // 5th attempt should lock
    const lockRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lockuser', password: 'WrongPassword12345' }
    });
    expect(JSON.parse(lockRes.body).account_locked).toBe(true);

    // Verify in DB
    const user = db.prepare('SELECT locked_at, failed_login_attempts FROM users WHERE id = ?').get(userId) as any;
    expect(user.locked_at).not.toBeNull();
    expect(user.failed_login_attempts).toBe(5);
  });

  it('should block login even with correct password when locked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lockuser', password: 'Password12345678' }
    });
    expect(JSON.parse(res.body).account_locked).toBe(true);
  });

  it('should unlock account via MFA code', async () => {
    // 1. Get code from DB (it was sent during the 5th failed attempt or subsequent login attempt)
    // Overwrite with known code
    const testUnlockCode = '999888';
    db.prepare("UPDATE email_codes SET code = ? WHERE user_id = ? AND type = 'mfa'").run(hashCode(testUnlockCode), userId);

    // 2. Unlock
    const unlockRes = await app.inject({
      method: 'POST',
      url: '/api/auth/unlock-account',
      payload: { user_id: userId, code: testUnlockCode, mfa_method: 'email' }
    });
    expect(unlockRes.statusCode).toBe(200);

    // 3. Verify in DB
    const user = db.prepare('SELECT locked_at, failed_login_attempts FROM users WHERE id = ?').get(userId) as any;
    expect(user.locked_at).toBeNull();
    expect(user.failed_login_attempts).toBe(0);

    // 4. Try login again
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lockuser', password: 'Password12345678' }
    });
    expect(JSON.parse(loginRes.body).mfa_required).toBe(true);
  });
});
