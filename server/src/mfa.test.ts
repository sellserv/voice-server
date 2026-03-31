import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'crypto';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import * as OTPAuth from 'otpauth';
import authRoutes from './routes/auth.js';
import mfaRoutes from './routes/mfa.js';
import { config } from './config.js';
import { setupTestDb, getTestRawDb } from './test-helpers.js';

function hashCode(code: string): string {
  return createHmac('sha256', config.jwtSecret).update(code).digest('hex');
}

describe('MFA Integration (TOTP)', () => {
  const app = Fastify();

  beforeAll(async () => {
    await setupTestDb();
    await app.register(fastifyCookie);
    await app.register(authRoutes);
    await app.register(mfaRoutes);
    const raw = getTestRawDb();
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare('DELETE FROM users').run();
    raw.prepare('DELETE FROM auth_sessions').run();
    raw.exec('PRAGMA foreign_keys = ON');
  });

  afterAll(async () => {
    await app.close();
  });

  let userId: string;
  let authCookies: Record<string, string>;

  it('should register and verify a user', async () => {
    const raw = getTestRawDb();
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'mfauser',
        password: 'TestPassword123!',
        email: 'mfa@example.com',
      },
    });
    userId = JSON.parse(regRes.body).user_id;
    raw.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  });

  it('should setup TOTP MFA', async () => {
    const raw = getTestRawDb();

    // 1. Login to get initial session
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'mfauser', password: 'TestPassword123!' }
    });

    // 2. Overwrite email MFA code
    const testMfaCode = '111222';
    raw.prepare("UPDATE email_codes SET code = ? WHERE user_id = ? AND type = 'mfa'").run(hashCode(testMfaCode), userId);

    // 3. Verify email MFA
    const mfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login/mfa',
      payload: { user_id: userId, code: testMfaCode }
    });
    authCookies = mfaRes.cookies.reduce((acc, c) => ({ ...acc, [c.name]: c.value }), {});

    const csrf = mfaRes.cookies.find(c => c.name === 'csrf')?.value;

    // 4. Setup TOTP
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/mfa/setup',
      cookies: authCookies,
      headers: { 'x-csrf-token': csrf }
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret } = JSON.parse(setupRes.body);
    expect(secret).toBeDefined();

    // 5. Generate TOTP code
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const totpCode = totp.generate();

    // 6. Verify TOTP setup
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/mfa/verify',
      cookies: authCookies,
      headers: { 'x-csrf-token': csrf },
      payload: { totp_code: totpCode }
    });
    expect(verifyRes.statusCode).toBe(200);

    // 7. Check user table for TOTP status
    const user = raw.prepare('SELECT totp_enabled, mfa_method FROM users WHERE id = ?').get(userId) as any;
    expect(user.totp_enabled).toBe(1);
    expect(user.mfa_method).toBe('totp');
  });

  it('should login with TOTP MFA', async () => {
    const raw = getTestRawDb();

    // 1. Initial Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'mfauser', password: 'TestPassword123!' }
    });
    expect(JSON.parse(loginRes.body).mfa_method).toBe('totp');

    // 2. Generate TOTP code
    const user = raw.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as any;
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(user.totp_secret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const totpCode = totp.generate();

    // 3. Verify MFA
    const mfaRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login/mfa',
      payload: { user_id: userId, code: totpCode }
    });
    expect(mfaRes.statusCode).toBe(200);
    expect(JSON.parse(mfaRes.body).username).toBe('mfauser');
  });
});
