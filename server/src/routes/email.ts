import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { validateEmailCode, createEmailCode } from '../email/codes.js';
import { sendEmail } from '../email/sender.js';
import { verificationEmail, mfaEmail } from '../email/templates.js';
import { broadcast, broadcastToChannel, sendTo, sendToMany } from '../ws/index.js';

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

      const valid = validateEmailCode(user_id, code, 'verification');
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

      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user_id);

      // Post welcome message from bot if configured
      // Find welcome bots for servers the user belongs to
      const welcomeBots = db
        .prepare(
          `SELECT b.id, b.user_id, b.name, b.greeting, b.channel_id, b.dm_enabled, b.dm_greeting, b.server_id
           FROM bots b
           JOIN server_members sm ON sm.server_id = b.server_id AND sm.user_id = ?
           WHERE b.type = 'welcome' AND b.enabled = 1`,
        )
        .all(user_id) as any[];
      const welcomeBot = welcomeBots[0];
      if (welcomeBot) {
        const newUser = db
          .prepare('SELECT username, display_name FROM users WHERE id = ?')
          .get(user_id) as any;
        const botUser = db
          .prepare('SELECT username, avatar_url FROM users WHERE id = ?')
          .get(welcomeBot.user_id) as any;
        if (newUser && botUser) {
          const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

          // Channel greeting
          if (welcomeBot.channel_id) {
            const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(welcomeBot.channel_id);
            if (!channel) {
              // Channel was deleted — skip channel greeting
            } else {
            const greeting = welcomeBot.greeting.replace(/\{user\}/g, `<@${user_id}>`);
            const msgId = randomUUID();
            db.prepare(
              'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
            ).run(msgId, welcomeBot.channel_id, welcomeBot.user_id, greeting, now);
            broadcastToChannel(welcomeBot.channel_id, {
              type: 'chat:message',
              message: {
                id: msgId,
                channel_id: welcomeBot.channel_id,
                user_id: welcomeBot.user_id,
                content: greeting,
                file_id: null,
                created_at: now,
                edited_at: null,
                username: botUser.username,
                display_name: welcomeBot.name,
                avatar_url: botUser.avatar_url,
              },
            });
            }
          }

          // DM greeting
          if (welcomeBot.dm_enabled && welcomeBot.dm_greeting) {
            const dmGreeting = welcomeBot.dm_greeting.replace(
              /\{user\}/g,
              newUser.display_name || newUser.username,
            );

            try {
              const dmChannelId = randomUUID();
              const dmMsgId = randomUUID();

              db.transaction(() => {
                db.prepare(
                  "INSERT INTO channels (id, name, type, sort_order) VALUES (?, '', 'dm', 0)",
                ).run(dmChannelId);
                db.prepare('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)').run(
                  dmChannelId,
                  welcomeBot.user_id,
                );
                db.prepare('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)').run(
                  dmChannelId,
                  user_id,
                );
                db.prepare(
                  'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
                ).run(dmMsgId, dmChannelId, welcomeBot.user_id, dmGreeting, now);
              })();

              // Build channel object for WS notification
              const dmChannel = {
                id: dmChannelId,
                name: '',
                type: 'dm' as const,
                sort_order: 0,
                dm_participant_ids: [welcomeBot.user_id, user_id],
                dm_participants: [
                  {
                    user_id: welcomeBot.user_id,
                    username: botUser.username,
                    display_name: welcomeBot.name,
                    avatar_url: botUser.avatar_url,
                  },
                  {
                    user_id,
                    username: newUser.username,
                    display_name: newUser.display_name,
                    avatar_url: null,
                  },
                ],
              };

              sendTo(user_id, { type: 'dm:created', channel: dmChannel } as any);

              const dmMessage = {
                id: dmMsgId,
                channel_id: dmChannelId,
                user_id: welcomeBot.user_id,
                content: dmGreeting,
                file_id: null,
                created_at: now,
                edited_at: null,
                username: botUser.username,
                display_name: welcomeBot.name,
                avatar_url: botUser.avatar_url,
              };
              sendToMany([welcomeBot.user_id, user_id], {
                type: 'chat:message',
                message: dmMessage,
              } as any);
            } catch (err) {
              console.error('Failed to create welcome DM:', err);
            }
          }
        }
      }

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
      const user = db
        .prepare('SELECT email, email_verified FROM users WHERE id = ?')
        .get(user_id) as any;
      if (user?.email && !user.email_verified) {
        const code = createEmailCode(user_id, 'verification');
        const template = verificationEmail(code);
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
      const user = db
        .prepare('SELECT email, email_verified FROM users WHERE id = ?')
        .get(user_id) as any;
      if (user?.email && user.email_verified) {
        const code = createEmailCode(user_id, 'mfa');
        const template = mfaEmail(code);
        await sendEmail(user.email, template.subject, template.html);
      }

      return { ok: true };
    },
  );
}
