import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import * as OTPAuth from 'otpauth';
import db from '../db/connection.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSession, revokeSession, revokeAllUserSessions } from '../auth/sessions.js';
import {
  signToken,
  setAuthCookie,
  setCsrfCookie,
  clearAuthCookie,
  verifyToken,
} from '../auth/jwt.js';
import { requireAuth, isInstanceAdmin } from '../auth/middleware.js';
import { config } from '../config.js';
import { createEmailCode, validateEmailCode } from '../email/codes.js';
import { sendEmail } from '../email/sender.js';
import {
  verificationEmail,
  mfaEmail,
  passwordResetEmail,
  accountLockedEmail,
} from '../email/templates.js';
import {
  isPasswordStrong,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH
} from '../auth/policy.js';
import type { RegisterBody, LoginBody, UserRow, InviteCode } from '@voip-server/shared';
import { logAuditEvent } from '../audit/log.js';
import { sendWelcomeMessages } from '../bots/welcomeBot.js';
import { verifyTurnstile, isTurnstileEnabled, isDesktopClient } from '../auth/turnstile.js';

const authRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '15 minutes',
      keyGenerator: (request: any) => request.ip,
    },
  },
};

// Track login attempt backoff per username (exponential backoff)
const loginBackoff = new Map<string, { attempts: number; nextAllowedAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of loginBackoff) {
    if (now > state.nextAllowedAt + 60 * 60 * 1000) loginBackoff.delete(key);
  }
}, 60 * 1000);

// Track used TOTP codes with per-entry expiry to prevent replay (keyed by userId:code)
const usedTotpCodes = new Map<string, number>(); // key -> expiresAt (ms)
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of usedTotpCodes) {
    if (now > expiresAt) usedTotpCodes.delete(key);
  }
}, 60 * 1000);

// Track failed MFA attempts per user to prevent brute force
const mfaAttempts = new Map<string, { count: number; resetAt: number }>();
const MFA_MAX_ATTEMPTS = 5;
const MFA_WINDOW_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [userId, state] of mfaAttempts) {
    if (now > state.resetAt) mfaAttempts.delete(userId);
  }
}, 60 * 1000);

function checkMfaRateLimit(userId: string): boolean {
  const now = Date.now();
  const state = mfaAttempts.get(userId);
  if (!state || now > state.resetAt) return true;
  return state.count < MFA_MAX_ATTEMPTS;
}

function recordMfaFailure(userId: string): void {
  const now = Date.now();
  const state = mfaAttempts.get(userId);
  if (!state || now > state.resetAt) {
    mfaAttempts.set(userId, { count: 1, resetAt: now + MFA_WINDOW_MS });
  } else {
    state.count++;
  }
}

function clearMfaAttempts(userId: string): void {
  mfaAttempts.delete(userId);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function authRoutes(app: FastifyInstance) {
  // Setup status — returns public config for the login page
  app.get('/api/auth/setup-status', authRateLimit, async (_request, reply) => {
    const instanceSettings = db.prepare('SELECT allow_registration FROM instance_settings WHERE id = 1').get() as { allow_registration: number } | undefined;
    return reply.send({
      turnstileSiteKey: isTurnstileEnabled() ? config.turnstileSiteKey : null,
      registrationOpen: instanceSettings ? !!instanceSettings.allow_registration : true,
    });
  });

  // Register
  app.post<{ Body: RegisterBody }>('/api/auth/register', authRateLimit, async (request, reply) => {
    // Check if registration is enabled
    const instanceSettings = db.prepare('SELECT allow_registration FROM instance_settings WHERE id = 1').get() as { allow_registration: number } | undefined;
    if (instanceSettings && !instanceSettings.allow_registration) {
      return reply.code(403).send({ error: 'Registration is currently closed' });
    }

    const { username, password, email, display_name, invite_code } = request.body;

    if (!username || !password) {
      return reply.code(400).send({ error: 'Username and password required' });
    }
    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }
    if (!isValidEmail(email)) {
      return reply.code(400).send({ error: 'Invalid email format' });
    }
    if (username.length < 2 || username.length > 24) {
      return reply.code(400).send({ error: 'Username must be 2-24 characters' });
    }
    if (!isPasswordStrong(password)) {
      return reply.code(400).send({
        error: `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and include at least one uppercase letter, one lowercase letter, one number, and one special character`
      });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return reply.code(400).send({ error: 'Username can only contain letters, numbers, _ and -' });
    }

    // Verify CAPTCHA before any DB lookups (prevents enumeration without CAPTCHA)
    // Skip for desktop (Electron) clients — Turnstile can't run on localhost origins
    if (!isDesktopClient(request.headers['user-agent'])) {
      const captchaValid = await verifyTurnstile(request.body.captcha_token, request.ip);
      if (!captchaValid) {
        return reply.code(400).send({ error: 'CAPTCHA verification failed' });
      }
    }

    // Block registration of reserved admin usernames
    if (config.adminUsers.includes(username.toLowerCase())) {
      const existingAdmin = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(username.toLowerCase());
      if (!existingAdmin) {
        return reply.code(403).send({ error: 'This username is reserved' });
      }
    }

    const existing = db.prepare('SELECT id, email_verified, created_at FROM users WHERE username = ? OR email = ?').get(username, email) as { id: string; email_verified: number; created_at: string } | undefined;
    if (existing) {
      if (!existing.email_verified) {
        // Only allow re-registration over unverified accounts after a cooldown (30 minutes)
        const createdAt = new Date(existing.created_at + 'Z').getTime();
        const cooldownMs = 30 * 60 * 1000;
        if (Date.now() - createdAt < cooldownMs) {
          return reply.code(409).send({ error: 'Username or email already in use. Please try again later.' });
        }
        db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(existing.id);
        db.prepare('DELETE FROM email_codes WHERE user_id = ?').run(existing.id);
        db.prepare('DELETE FROM server_members WHERE user_id = ?').run(existing.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
      } else {
        return reply.code(409).send({ error: 'Username or email already in use' });
      }
    }

    // Check if banned
    const bannedUser = db
      .prepare('SELECT id FROM users WHERE username = ? AND banned = 1')
      .get(username);
    if (bannedUser) {
      return reply.code(403).send({ error: 'This account is banned' });
    }

    const id = randomUUID();
    const password_hash = await hashPassword(password);

    // Validate display_name if provided
    const sanitizedDisplayName = display_name?.trim() || username;
    if (sanitizedDisplayName.length < 1 || sanitizedDisplayName.length > 32) {
      return reply.code(400).send({ error: 'Display name must be 1-32 characters' });
    }

    // Atomic transaction: validate invite code AND insert user
    const insertResult = db.transaction(() => {
      // Validate invite code if provided (optional for open registration)
      let inviteRow: InviteCode | undefined;
      if (invite_code) {
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

      const defaultRole = db
        .prepare('SELECT id FROM roles WHERE is_default = 1 LIMIT 1')
        .get() as { id: string } | undefined;
      const roleId = defaultRole?.id || null;

      db.prepare(
        "INSERT INTO users (id, username, display_name, password_hash, role, role_id, email, email_verified, mfa_method, password_changed_at) VALUES (?, ?, ?, ?, 'member', ?, ?, 0, 'email', datetime('now'))",
      ).run(id, username, sanitizedDisplayName, password_hash, roleId, email);

      // Also insert into user_roles junction table
      if (roleId) {
        db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId);
      }

      // Join server if invite code provided
      if (inviteRow?.server_id) {
        // Member registering with invite code: add to the invite's server
        db.prepare(
          'INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)'
        ).run(inviteRow.server_id, id);

        // Assign the server's default role to the user
        const serverDefaultRole = db.prepare(
          'SELECT id FROM roles WHERE server_id = ? AND is_default = 1'
        ).get(inviteRow.server_id) as any;
        if (serverDefaultRole) {
          db.prepare(
            'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)'
          ).run(id, serverDefaultRole.id);
        }
      }

      if (inviteRow) {
        db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?').run(
          inviteRow.id,
        );
      }

      return { ok: true, joinedServerId: inviteRow?.server_id || null } as const;
    })();

    if ('error' in insertResult) {
      return reply.code(400).send({ error: insertResult.error });
    }

    // Send welcome message if user joined a server during registration
    if (insertResult.joinedServerId) {
      sendWelcomeMessages(id, insertResult.joinedServerId);
    }

    // Send verification email — no JWT until verified
    const code = createEmailCode(id, 'verification');
    const template = verificationEmail(code);
    try {
      await sendEmail(email, template.subject, template.html);
    } catch (e) {
      console.error('[Auth] Failed to send verification email:', (e as Error).message);
      return reply.code(500).send({ error: 'Failed to send verification email' });
    }

    return reply.send({ verification_required: true, user_id: id });
  });

  // Login
  app.post<{ Body: LoginBody }>('/api/auth/login', authRateLimit, async (request, reply) => {
    const { username, password } = request.body;

    if (!username || !password) {
      return reply.code(400).send({ error: 'Username and password required' });
    }
    if (password.length > 72) {
      return reply.code(400).send({ error: 'Invalid credentials' });
    }

    // Exponential backoff per username
    const backoffState = loginBackoff.get(username.toLowerCase());
    if (backoffState && Date.now() < backoffState.nextAllowedAt) {
      const waitSecs = Math.ceil((backoffState.nextAllowedAt - Date.now()) / 1000);
      return reply.code(429).send({ error: `Too many login attempts. Try again in ${waitSecs} seconds.` });
    }

    const user = db
      .prepare(
        'SELECT id, username, display_name, password_hash, role, role_id, banned, ban_reason, totp_enabled, totp_secret, password_changed_at, created_at, avatar_url, email, email_verified, mfa_method, failed_login_attempts, locked_at FROM users WHERE username = ?',
      )
      .get(username) as any;

    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    if (user.banned) {
      return reply.code(403).send({ error: 'Account banned' });
    }

    // Account locked — must unlock via 2FA
    if (user.locked_at) {
      const mfaMethod = user.mfa_method || 'email';
      return reply.send({ account_locked: true, user_id: user.id, mfa_method: mfaMethod });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      // Track exponential backoff
      const key = username.toLowerCase();
      const prev = loginBackoff.get(key);
      const attempts = (prev?.attempts || 0) + 1;
      const backoffMs = Math.min(1000 * Math.pow(2, attempts - 1), 15 * 60 * 1000); // max 15 min
      loginBackoff.set(key, { attempts, nextAllowedAt: Date.now() + backoffMs });

      const dbAttempts = (user.failed_login_attempts || 0) + 1;
      if (dbAttempts >= 5) {
        db.prepare(
          "UPDATE users SET failed_login_attempts = ?, locked_at = datetime('now') WHERE id = ?",
        ).run(attempts, user.id);
        const mfaMethod = user.mfa_method || 'email';
        // Send unlock code via email if that's their method
        if (mfaMethod === 'email' && user.email && user.email_verified) {
          try {
            const code = createEmailCode(user.id, 'mfa');
            const template = accountLockedEmail(code);
            await sendEmail(user.email, template.subject, template.html);
          } catch (e) {
            console.error('[Auth] Failed to send account locked email:', (e as Error).message);
          }
        }
        return reply.send({ account_locked: true, user_id: user.id, mfa_method: mfaMethod });
      }
      db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?').run(dbAttempts, user.id);
      logAuditEvent('failed_login', null, null, request.ip, { username });
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    // Successful password — reset counter and backoff
    if (user.failed_login_attempts > 0) {
      db.prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = ?').run(user.id);
    }
    loginBackoff.delete(username.toLowerCase());

    // Existing user with no email — prompt them to add one
    if (!user.email) {
      return reply.send({ email_required: true, user_id: user.id });
    }

    // Email not verified — block login
    if (!user.email_verified) {
      return reply.send({ email_not_verified: true, user_id: user.id });
    }

    // MFA check based on mfa_method
    const mfaMethod = user.mfa_method || 'email';
    if (mfaMethod === 'totp' && user.totp_enabled) {
      return reply.send({ mfa_required: true, mfa_user_id: user.id, mfa_method: 'totp' as const });
    }

    // Email MFA (default)
    if (mfaMethod === 'email') {
      const code = createEmailCode(user.id, 'mfa');
      const template = mfaEmail(code);
      try {
        await sendEmail(user.email, template.subject, template.html);
      } catch (e) {
        console.error('[Auth] Failed to send MFA email:', (e as Error).message);
        return reply.code(500).send({ error: 'Failed to send verification email' });
      }
      return reply.send({ mfa_required: true, mfa_user_id: user.id, mfa_method: 'email' as const });
    }

    const jti = createSession(user.id, request.ip, request.headers['user-agent'] || null);
    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      jti,
      pwc: user.password_changed_at || undefined,
    });
    setAuthCookie(reply, token);
    const csrf = setCsrfCookie(reply);
    logAuditEvent('successful_login', user.id, null, request.ip);

    return reply.send({
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      role_id: user.role_id || null,
      avatar_url: user.avatar_url,
      totp_enabled: !!user.totp_enabled,
      email: user.email,
      mfa_method: mfaMethod,
      banned: false,
      created_at: user.created_at,
      token,
      csrf,
    });
  });

  // MFA verification (second step of login)
  app.post<{ Body: { user_id: string; code: string; mfa_method?: string; totp_code?: string } }>(
    '/api/auth/login/mfa',
    authRateLimit,
    async (request, reply) => {
      const { user_id, totp_code } = request.body;
      const code = request.body.code || totp_code; // backward compat
      const mfaMethod = request.body.mfa_method;

      if (!user_id || !code) {
        return reply.code(400).send({ error: 'User ID and code required' });
      }

      // Per-user MFA brute force protection
      if (!checkMfaRateLimit(user_id)) {
        return reply.code(429).send({ error: 'Too many failed attempts. Try again later.' });
      }

      const user = db
        .prepare(
          'SELECT id, username, display_name, password_hash, role, role_id, avatar_url, banned, ban_reason, totp_enabled, totp_secret, password_changed_at, created_at, email, email_verified, mfa_method FROM users WHERE id = ?',
        )
        .get(user_id) as any;

      if (!user) {
        recordMfaFailure(user_id);
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      if (user.banned) {
        return reply.code(403).send({ error: 'Account banned' });
      }

      const method = mfaMethod || user.mfa_method || 'email';

      if (method === 'totp') {
        if (!user.totp_enabled || !user.totp_secret) {
          return reply.code(400).send({ error: 'TOTP not enabled for this account' });
        }

        const totp = new OTPAuth.TOTP({
          secret: OTPAuth.Secret.fromBase32(user.totp_secret),
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        });

        const totpKey = `${user.id}:${code}`;
        if (usedTotpCodes.has(totpKey)) {
          recordMfaFailure(user_id);
          return reply.code(401).send({ error: 'Invalid code' });
        }
        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) {
          recordMfaFailure(user_id);
          return reply.code(401).send({ error: 'Invalid code' });
        }
        usedTotpCodes.set(totpKey, Date.now() + 90 * 1000); // 90s = TOTP window
      } else {
        // Email MFA
        const valid = validateEmailCode(user_id, code, 'mfa');
        if (!valid) {
          recordMfaFailure(user_id);
          return reply.code(401).send({ error: 'Invalid or expired code' });
        }
      }

      clearMfaAttempts(user_id);
      logAuditEvent('successful_login', user.id, null, request.ip);

      const jti = createSession(user.id, request.ip, request.headers['user-agent'] || null);
      const token = signToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        jti,
        pwc: user.password_changed_at || undefined,
      });
      setAuthCookie(reply, token);
      const csrf = setCsrfCookie(reply);

      return reply.send({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        role_id: user.role_id || null,
        avatar_url: user.avatar_url,
        totp_enabled: !!user.totp_enabled,
        email: user.email,
        mfa_method: user.mfa_method || 'email',
        banned: false,
        created_at: user.created_at,
        token,
        csrf,
      });
    },
  );

  // Unlock account (after lockout from failed password attempts)
  app.post<{ Body: { user_id: string; code: string; mfa_method: string } }>(
    '/api/auth/unlock-account',
    authRateLimit,
    async (request, reply) => {
      const { user_id, code, mfa_method } = request.body;

      if (!user_id || !code) {
        return reply.code(400).send({ error: 'User ID and code required' });
      }

      // Per-user MFA brute force protection
      if (!checkMfaRateLimit(user_id)) {
        return reply.code(429).send({ error: 'Too many failed attempts. Try again later.' });
      }

      const user = db
        .prepare(
          'SELECT id, locked_at, totp_enabled, totp_secret, mfa_method, email, email_verified FROM users WHERE id = ?',
        )
        .get(user_id) as any;
      if (!user) {
        recordMfaFailure(user_id);
        return reply.code(401).send({ error: 'Invalid request' });
      }

      if (!user.locked_at) {
        return reply.code(400).send({ error: 'Account is not locked' });
      }

      const method = mfa_method || user.mfa_method || 'email';

      if (method === 'totp') {
        if (!user.totp_enabled || !user.totp_secret) {
          return reply.code(400).send({ error: 'TOTP not enabled for this account' });
        }

        const totp = new OTPAuth.TOTP({
          secret: OTPAuth.Secret.fromBase32(user.totp_secret),
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        });

        const totpKey2 = `${user.id}:${code}`;
        if (usedTotpCodes.has(totpKey2)) {
          recordMfaFailure(user_id);
          return reply.code(401).send({ error: 'Invalid code' });
        }
        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) {
          recordMfaFailure(user_id);
          return reply.code(401).send({ error: 'Invalid code' });
        }
        usedTotpCodes.set(totpKey2, Date.now() + 90 * 1000);
      } else {
        const valid = validateEmailCode(user_id, code, 'mfa');
        if (!valid) {
          recordMfaFailure(user_id);
          return reply.code(401).send({ error: 'Invalid or expired code' });
        }
      }

      clearMfaAttempts(user_id);
      db.prepare('UPDATE users SET failed_login_attempts = 0, locked_at = NULL WHERE id = ?').run(
        user_id,
      );

      return reply.send({ ok: true });
    },
  );

  // Set email (for existing users who have no email)
  app.post<{ Body: { user_id: string; email: string; password: string } }>(
    '/api/auth/set-email',
    authRateLimit,
    async (request, reply) => {
      const { user_id, email, password } = request.body;

      if (!user_id || !email || !password) {
        return reply.code(400).send({ error: 'User ID, email, and password required' });
      }
      if (!isValidEmail(email)) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }

      const user = db
        .prepare('SELECT id, email, email_verified, password_hash FROM users WHERE id = ?')
        .get(user_id) as any;
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Verify password to prove ownership
      const validPassword = await verifyPassword(password, user.password_hash);
      if (!validPassword) {
        return reply.code(401).send({ error: 'Invalid password' });
      }

      if (user.email && user.email_verified) {
        return reply.code(400).send({ error: 'Email already verified — change it in settings' });
      }

      // Check uniqueness
      const existingEmail = db
        .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email, user_id);
      if (existingEmail) {
        return reply.code(409).send({ error: 'Email already in use' });
      }

      db.prepare('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?').run(email, user_id);

      const code = createEmailCode(user_id, 'verification');
      const template = verificationEmail(code);
      try {
        await sendEmail(email, template.subject, template.html);
      } catch (e) {
        console.error('[Auth] Failed to send verification email:', (e as Error).message);
        return reply.code(500).send({ error: 'Failed to send verification email' });
      }

      return reply.send({ verification_required: true, user_id });
    },
  );

  // Change email (for authenticated users)
  app.post<{ Body: { email: string } }>(
    '/api/auth/change-email',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { email } = request.body;
      const userId = request.user.userId;

      if (!email) {
        return reply.code(400).send({ error: 'Email required' });
      }
      if (!isValidEmail(email)) {
        return reply.code(400).send({ error: 'Invalid email format' });
      }

      // Check uniqueness
      const existingEmail = db
        .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email, userId);
      if (existingEmail) {
        return reply.code(409).send({ error: 'Email already in use' });
      }

      db.prepare('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?').run(email, userId);

      const code = createEmailCode(userId, 'verification');
      const template = verificationEmail(code);
      try {
        await sendEmail(email, template.subject, template.html);
      } catch (e) {
        console.error('[Auth] Failed to send verification email:', (e as Error).message);
        return reply.code(500).send({ error: 'Failed to send verification email' });
      }

      return reply.send({ ok: true, verification_required: true });
    },
  );

  // Verify email change (authenticated)
  app.post<{ Body: { code: string } }>(
    '/api/auth/verify-email',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { code } = request.body;
      const userId = request.user.userId;

      if (!code) {
        return reply.code(400).send({ error: 'Code required' });
      }

      const valid = validateEmailCode(userId, code, 'verification');
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid or expired code' });
      }

      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);

      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as any;
      return reply.send({ ok: true, email: user.email });
    },
  );

  // Forgot password — step 1: request reset
  app.post<{ Body: { username: string } }>(
    '/api/auth/forgot-password',
    authRateLimit,
    async (request, reply) => {
      const { username } = request.body;

      if (!username) {
        return reply.code(400).send({ error: 'Username required' });
      }

      const user = db
        .prepare(
          'SELECT id, email, email_verified, mfa_method, totp_enabled FROM users WHERE username = ?',
        )
        .get(username) as any;

      // Always return identical shape regardless of whether user exists (anti-enumeration)
      if (!user) {
        return reply.send({ ok: true });
      }

      const mfaMethod = user.mfa_method || 'email';

      if (mfaMethod === 'email' && user.email && user.email_verified) {
        try {
          const code = createEmailCode(user.id, 'password_reset');
          const template = passwordResetEmail(code);
          await sendEmail(user.email, template.subject, template.html);
        } catch (e) {
          console.error('[Auth] Failed to send password reset email:', (e as Error).message);
        }
      }

      return reply.send({ ok: true });
    },
  );

  // Forgot password — step 2: verify 2FA code
  app.post<{ Body: { username: string; code: string } }>(
    '/api/auth/forgot-password/verify',
    authRateLimit,
    async (request, reply) => {
      const { username, code } = request.body;

      if (!username || !code) {
        return reply.code(400).send({ error: 'Username and code required' });
      }

      const user = db
        .prepare('SELECT id, totp_enabled, totp_secret, mfa_method FROM users WHERE username = ?')
        .get(username) as any;
      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Per-user MFA brute force protection
      if (!checkMfaRateLimit(user.id)) {
        return reply.code(429).send({ error: 'Too many failed attempts. Try again later.' });
      }

      const method = user.mfa_method || 'email';

      if (method === 'totp') {
        if (!user.totp_enabled || !user.totp_secret) {
          recordMfaFailure(user.id);
          return reply.code(401).send({ error: 'Invalid credentials' });
        }

        const totp = new OTPAuth.TOTP({
          secret: OTPAuth.Secret.fromBase32(user.totp_secret),
          algorithm: 'SHA1',
          digits: 6,
          period: 30,
        });

        const totpKey3 = `${user.id}:${code}`;
        if (usedTotpCodes.has(totpKey3)) {
          recordMfaFailure(user.id);
          return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const delta = totp.validate({ token: code, window: 1 });
        if (delta === null) {
          recordMfaFailure(user.id);
          return reply.code(401).send({ error: 'Invalid credentials' });
        }
        usedTotpCodes.set(totpKey3, Date.now() + 90 * 1000);
      } else {
        const valid = validateEmailCode(user.id, code, 'password_reset');
        if (!valid) {
          recordMfaFailure(user.id);
          return reply.code(401).send({ error: 'Invalid credentials' });
        }
      }

      clearMfaAttempts(user.id);

      // Issue a short-lived reset token with a unique JTI to prevent reuse
      const jti = randomUUID();
      const resetToken = jwt.sign(
        { userId: user.id, purpose: 'password_reset', jti },
        config.jwtSecret,
        { expiresIn: '5m' },
      );

      // Store JTI in DB for replay prevention (survives server restarts)
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
      db.prepare(
        'INSERT INTO used_reset_tokens (jti, user_id, expires_at) VALUES (?, ?, ?)',
      ).run(jti, user.id, expiresAt);

      return reply.send({ reset_token: resetToken });
    },
  );

  // Reset password — step 3: set new password
  app.post<{ Body: { reset_token: string; new_password: string } }>(
    '/api/auth/reset-password',
    authRateLimit,
    async (request, reply) => {
      const { reset_token, new_password } = request.body;

      if (!reset_token || !new_password) {
        return reply.code(400).send({ error: 'Reset token and new password required' });
      }

      if (!isPasswordStrong(new_password)) {
        return reply.code(400).send({
          error: `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and include at least one uppercase letter, one lowercase letter, one number, and one special character`
        });
      }

      let payload: any;
      try {
        payload = jwt.verify(reset_token, config.jwtSecret);
      } catch {
        return reply.code(401).send({ error: 'Invalid or expired reset token' });
      }

      if (payload.purpose !== 'password_reset') {
        return reply.code(401).send({ error: 'Invalid reset token' });
      }

      // Prevent token reuse via DB (survives server restarts)
      if (!payload.jti) {
        return reply.code(401).send({ error: 'Invalid reset token' });
      }
      const tokenRow = db.prepare(
        'SELECT used FROM used_reset_tokens WHERE jti = ?',
      ).get(payload.jti) as { used: number } | undefined;
      if (!tokenRow) {
        return reply.code(401).send({ error: 'Invalid reset token' });
      }
      if (tokenRow.used) {
        return reply.code(401).send({ error: 'Reset token has already been used' });
      }
      db.prepare('UPDATE used_reset_tokens SET used = 1 WHERE jti = ?').run(payload.jti);

      const newHash = await hashPassword(new_password);
      db.prepare(
        "UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?",
      ).run(newHash, payload.userId);

      // Revoke all existing sessions after password reset
      revokeAllUserSessions(payload.userId);

      return reply.send({ ok: true });
    },
  );

  // Change password (authenticated users only — expired passwords use the reset flow)
  app.post<{ Body: { current_password: string; new_password: string } }>(
    '/api/auth/change-password',
    authRateLimit,
    async (request, reply) => {
      const { current_password, new_password } = request.body;

      // Always require authentication
      await requireAuth(request, reply);
      if (reply.sent) return;
      const userId = request.user?.userId;
      if (!current_password || !new_password) {
        return reply.code(400).send({ error: 'Current and new password required' });
      }

      if (!isPasswordStrong(new_password)) {
        return reply.code(400).send({
          error: `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters and include at least one uppercase letter, one lowercase letter, one number, and one special character`
        });
      }

      const user = db
        .prepare(
          'SELECT id, username, display_name, password_hash, role, role_id, avatar_url, totp_enabled, created_at, email, mfa_method FROM users WHERE id = ?',
        )
        .get(userId) as any;

      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      const valid = await verifyPassword(current_password, user.password_hash);
      if (!valid) {
        return reply.code(401).send({ error: 'Current password is incorrect' });
      }

      const newHash = await hashPassword(new_password);
      db.prepare(
        "UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?",
      ).run(newHash, userId);

      logAuditEvent('password_change', userId, null, request.ip);

      // Revoke all other sessions after password change
      revokeAllUserSessions(userId);

      // Re-fetch to get the updated password_changed_at for the new JWT
      const freshUser = db
        .prepare('SELECT password_changed_at FROM users WHERE id = ?')
        .get(userId) as { password_changed_at: string };
      const newJti = createSession(user.id, request.ip, request.headers['user-agent'] || null);
      const token = signToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        jti: newJti,
        pwc: freshUser.password_changed_at,
      });
      setAuthCookie(reply, token);
      const csrf = setCsrfCookie(reply);

      return reply.send({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        role_id: user.role_id || null,
        avatar_url: user.avatar_url,
        totp_enabled: !!user.totp_enabled,
        email: user.email,
        mfa_method: user.mfa_method || 'email',
        banned: false,
        created_at: user.created_at,
        token,
        csrf,
      });
    },
  );

  // Logout
  app.post('/api/auth/logout', async (request, reply) => {
    let token = request.cookies.token;
    if (!token) {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }
    }

    if (token) {
      try {
        const payload = verifyToken(token);
        revokeSession(payload.jti);
      } catch {
        // Ignore invalid token on logout
      }
    }

    clearAuthCookie(reply);
    return reply.send({ ok: true });
  });

  // Current user
  app.get('/api/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.avatar_url, u.bio, u.banner_url, u.totp_enabled, u.created_at, u.email, u.mfa_method,
              u.name_font, u.name_color, r.name as role_name, r.color as role_color
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(request.user.userId) as any;

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    user.totp_enabled = !!user.totp_enabled;

    // Attach role arrays
    const userRoles = db
      .prepare(
        `SELECT r.id as role_id, r.name as role_name, r.color as role_color
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.position`,
      )
      .all(request.user.userId) as { role_id: string; role_name: string; role_color: string }[];

    user.role_ids = userRoles.map((r) => r.role_id);
    user.role_names = userRoles.map((r) => r.role_name);
    user.role_colors = userRoles.map((r) => r.role_color);

    user.is_instance_admin = isInstanceAdmin(user.username);

    // Include token and CSRF for desktop app
    // Bearer token auth: read from Authorization header since cross-origin cookies aren't sent
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      user.token = authHeader.slice(7);
    } else {
      user.token = request.cookies.token;
    }
    user.csrf = request.cookies.csrf;

    return user;
  });
}
