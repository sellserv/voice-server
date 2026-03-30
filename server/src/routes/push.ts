import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { requireAuth } from '../auth/middleware.js';

export default async function pushRoutes(app: FastifyInstance) {
  // Register device token
  app.post(
    '/api/push/register',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { token, platform } = request.body as { token: string; platform?: string };
      const userId = request.user.userId;

      if (!token) {
        return reply.code(400).send({ error: 'Token required' });
      }

      // Upsert: if token exists for different user, reassign it
      db.prepare('DELETE FROM device_tokens WHERE token = ?').run(token);
      db.prepare(
        'INSERT INTO device_tokens (id, user_id, token, platform) VALUES (?, ?, ?, ?)',
      ).run(randomUUID(), userId, token, platform || 'android');

      return { ok: true };
    },
  );

  // Unregister device token (on logout)
  app.post(
    '/api/push/unregister',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { token } = request.body as { token: string };
      const userId = request.user.userId;

      if (!token) {
        return reply.code(400).send({ error: 'Token required' });
      }

      db.prepare(
        'DELETE FROM device_tokens WHERE user_id = ? AND token = ?',
      ).run(userId, token);

      return { ok: true };
    },
  );

  // Fetch pending notification content (data-only push)
  app.get<{ Params: { id: string } }>(
    '/api/push/notification/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.userId;

      const { fetchAndDeletePending } = await import('../push/pending.js');
      const notification = fetchAndDeletePending(id, userId);

      if (!notification) {
        return reply.code(404).send({ error: 'Notification not found or expired' });
      }

      return notification;
    },
  );
}
