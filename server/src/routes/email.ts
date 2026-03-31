import type { FastifyInstance } from 'fastify';
import { getDb } from '../adapters/index.js';
import { validateEmailCode, createEmailCode } from '../email/codes.js';
import { sendEmail } from '../email/sender.js';
import { verificationEmail, mfaEmail } from '../email/templates.js';
import { broadcast } from '../ws/index.js';

const emailRateLimit = {
  config: {
    rateLimit: {
      max: 3,
      timeWindow: '15 minutes',
      keyGenerator: (request: any) => request.ip,
    },
  },
};

// Per-user rate limiting on verification code attempts
const verifyAttempts = new Map<string, { count: number; resetAt: number }>();
const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of verifyAttempts) {
    if (now > state.resetAt) verifyAttempts.delete(key);
  }
}, 60 * 1000);

export default async function emailRoutes(app: FastifyInstance) {
  // Verify email with code
  app.post<{ Body: { user_id: string; code: string } }>(
    '/api/email/verify',
    emailRateLimit,
    async (request, reply) => {
      const { user_id, code } = request.body;

      if (!user_id || !code) {
        return reply.code(400).send({ error: 'User ID and code required' });
      }

      // Per-user brute force protection
      const now = Date.now();
      const attempt = verifyAttempts.get(user_id);
      if (attempt && now < attempt.resetAt && attempt.count >= VERIFY_MAX_ATTEMPTS) {
        return reply.code(429).send({ error: 'Too many failed attempts. Try again later.' });
      }

      const valid = await validateEmailCode(user_id, code, 'verification');
      if (!valid) {
        // Track failed attempt
        const existing = verifyAttempts.get(user_id);
        if (!existing || now > existing.resetAt) {
          verifyAttempts.set(user_id, { count: 1, resetAt: now + VERIFY_WINDOW_MS });
        } else {
          existing.count++;
        }
        return reply.code(401).send({ error: 'Invalid or expired code' });
      }

      // Clear attempts on success
      verifyAttempts.delete(user_id);

      await getDb().run('UPDATE users SET email_verified = 1 WHERE id = ?', [user_id]);

      return { ok: true };
    },
  );

  // Resend verification email
  app.post<{ Body: { user_id: string } }>(
    '/api/email/resend-verification',
    emailRateLimit,
    async (request, reply) => {
      const { user_id } = request.body;

      if (!user_id) {
        return reply.code(400).send({ error: 'User ID required' });
      }

      // Always return ok to avoid leaking whether user_id is valid
      const user = await getDb().queryOne<{ email: string; email_verified: number }>(
        'SELECT email, email_verified FROM users WHERE id = ?',
        [user_id],
      );
      if (user?.email && !user.email_verified) {
        const code = await createEmailCode(user_id, 'verification');
        const template = await verificationEmail(code);
        await sendEmail(user.email, template.subject, template.html);
      }

      return { ok: true };
    },
  );

  // Resend MFA login code
  app.post<{ Body: { user_id: string } }>(
    '/api/email/resend-mfa',
    emailRateLimit,
    async (request, reply) => {
      const { user_id } = request.body;

      if (!user_id) {
        return reply.code(400).send({ error: 'User ID required' });
      }

      // Always return ok to avoid leaking whether user_id is valid
      const user = await getDb().queryOne<{ email: string; email_verified: number }>(
        'SELECT email, email_verified FROM users WHERE id = ?',
        [user_id],
      );
      if (user?.email && user.email_verified) {
        const code = await createEmailCode(user_id, 'mfa');
        const template = await mfaEmail(code);
        await sendEmail(user.email, template.subject, template.html);
      }

      return { ok: true };
    },
  );
}
