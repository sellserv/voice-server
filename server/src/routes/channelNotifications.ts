import type { FastifyInstance } from 'fastify';
import db from '../db/connection.js';
import { requireAuth } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';

export default async function channelNotificationRoutes(app: FastifyInstance) {
  // Set channel notification override
  app.put<{ Params: { serverId: string; channelId: string }; Body: { level?: string; muted_until?: string | null } }>(
    '/api/servers/:serverId/channels/:channelId/notifications',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const userId = request.user.userId;
      const { channelId } = request.params;
      const { level, muted_until } = request.body;

      if (level !== undefined) {
        const valid = ['default', 'all', 'mentions', 'nothing'];
        if (!valid.includes(level)) {
          return reply.code(400).send({ error: 'Invalid level' });
        }
      }

      const serverId = getServerId(request);
      const channel = db.prepare('SELECT id FROM channels WHERE id = ? AND server_id = ?').get(channelId, serverId);
      if (!channel) {
        return reply.code(404).send({ error: 'Channel not found' });
      }

      db.prepare(`
        INSERT INTO channel_notification_overrides (user_id, channel_id, level, muted_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET
          level = COALESCE(?, level),
          muted_until = ?
      `).run(
        userId, channelId, level || 'default', muted_until || null,
        level, muted_until !== undefined ? muted_until : null,
      );

      return { ok: true };
    },
  );

  // Reset channel notification override
  app.delete<{ Params: { serverId: string; channelId: string } }>(
    '/api/servers/:serverId/channels/:channelId/notifications',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const userId = request.user.userId;
      const { channelId } = request.params;
      db.prepare('DELETE FROM channel_notification_overrides WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
      return { ok: true };
    },
  );

  // Mute a DM conversation
  app.put<{ Params: { channelId: string }; Body: { muted_until: string } }>(
    '/api/channels/:channelId/mute',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { channelId } = request.params;
      const { muted_until } = request.body;

      const dm = db.prepare(
        "SELECT c.id FROM channels c JOIN dm_participants dp ON dp.channel_id = c.id WHERE c.id = ? AND c.type = 'dm' AND dp.user_id = ?",
      ).get(channelId, userId);
      if (!dm) {
        return reply.code(404).send({ error: 'DM channel not found' });
      }

      db.prepare(`
        INSERT INTO dm_notification_overrides (user_id, channel_id, muted_until)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET muted_until = ?
      `).run(userId, channelId, muted_until, muted_until);

      return { ok: true };
    },
  );

  // Unmute a DM conversation
  app.delete<{ Params: { channelId: string } }>(
    '/api/channels/:channelId/mute',
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.user.userId;
      const { channelId } = request.params;
      db.prepare('DELETE FROM dm_notification_overrides WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
      return { ok: true };
    },
  );

  // Get all channel notification overrides for a server
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/notifications/channels',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const userId = request.user.userId;
      const serverId = getServerId(request);

      const overrides = db.prepare(`
        SELECT cno.channel_id, cno.level, cno.muted_until
        FROM channel_notification_overrides cno
        JOIN channels c ON c.id = cno.channel_id
        WHERE cno.user_id = ? AND c.server_id = ?
      `).all(userId, serverId) as { channel_id: string; level: string; muted_until: string | null }[];

      return overrides;
    },
  );
}
