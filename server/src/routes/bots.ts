import type { FastifyInstance } from 'fastify';
import db from '../db/connection.js';
import { requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import type { Bot } from '@voip-server/shared';
import { broadcastToServer } from '../ws/index.js';

export default async function botRoutes(app: FastifyInstance) {
  // List all bots (admin only) — server-scoped
  app.get('/api/servers/:serverId/bots', { preHandler: [requirePermission('manage_bots'), requireServerMember] }, async (request) => {
    const serverId = getServerId(request);
    const rows = db
      .prepare(
        `SELECT b.id, b.user_id, b.type, b.name, b.channel_id, b.enabled, b.greeting, b.dm_enabled, b.dm_greeting, b.config, u.avatar_url
       FROM bots b JOIN users u ON u.id = b.user_id
       WHERE b.server_id = ?`,
      )
      .all(serverId) as any[];

    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      type: r.type,
      name: r.name,
      avatar_url: r.avatar_url,
      channel_id: r.channel_id,
      enabled: r.enabled === 1,
      greeting: r.greeting,
      dm_enabled: r.dm_enabled === 1,
      dm_greeting: r.dm_greeting,
      config: r.config,
    })) as Bot[];
  });

  // Update a bot (admin only) — server-scoped
  app.put<{
    Params: { serverId: string; id: string };
    Body: {
      name?: string;
      channel_id?: string | null;
      enabled?: boolean;
      greeting?: string;
      avatar_url?: string | null;
      dm_enabled?: boolean;
      dm_greeting?: string;
      config?: string | null;
    };
  }>('/api/servers/:serverId/bots/:id', { preHandler: [requirePermission('manage_bots'), requireServerMember] }, async (request, reply) => {
    const serverId = getServerId(request);
    const { id } = request.params;
    const { name, channel_id, enabled, greeting, avatar_url, dm_enabled, dm_greeting, config } =
      request.body;

    const existingBot = db.prepare('SELECT id, user_id FROM bots WHERE id = ? AND server_id = ?').get(id, serverId) as any;
    if (!existingBot) {
      return reply.code(404).send({ error: 'Bot not found' });
    }

    if (name !== undefined) {
      if (!name || name.length > 32) {
        return reply.code(400).send({ error: 'Bot name must be 1-32 characters' });
      }
      db.prepare('UPDATE bots SET name = ? WHERE id = ? AND server_id = ?').run(name, id, serverId);
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, existingBot.user_id);
    }

    if (channel_id !== undefined) {
      if (channel_id !== null) {
        const channel = db
          .prepare("SELECT id FROM channels WHERE id = ? AND type = 'text' AND server_id = ?")
          .get(channel_id, serverId);
        if (!channel) {
          return reply.code(400).send({ error: 'Text channel not found' });
        }
      }
      db.prepare('UPDATE bots SET channel_id = ? WHERE id = ? AND server_id = ?').run(channel_id, id, serverId);
    }

    if (enabled !== undefined) {
      db.prepare('UPDATE bots SET enabled = ? WHERE id = ? AND server_id = ?').run(enabled ? 1 : 0, id, serverId);
    }

    if (greeting !== undefined) {
      if (!greeting || greeting.length > 500) {
        return reply.code(400).send({ error: 'Greeting must be 1-500 characters' });
      }
      db.prepare('UPDATE bots SET greeting = ? WHERE id = ? AND server_id = ?').run(greeting, id, serverId);
    }

    if (dm_enabled !== undefined) {
      db.prepare('UPDATE bots SET dm_enabled = ? WHERE id = ? AND server_id = ?').run(dm_enabled ? 1 : 0, id, serverId);
    }

    if (dm_greeting !== undefined) {
      if (!dm_greeting || dm_greeting.length > 500) {
        return reply.code(400).send({ error: 'DM greeting must be 1-500 characters' });
      }
      db.prepare('UPDATE bots SET dm_greeting = ? WHERE id = ? AND server_id = ?').run(dm_greeting, id, serverId);
    }

    if (config !== undefined) {
      // Basic validation for config if it's JSON
      if (config !== null) {
        try {
          JSON.parse(config);
        } catch {
          return reply.code(400).send({ error: 'Config must be valid JSON' });
        }
      }
      db.prepare('UPDATE bots SET config = ? WHERE id = ? AND server_id = ?').run(config, id, serverId);
    }

    if (avatar_url !== undefined) {
      if (avatar_url !== null) {
        // Allow the built-in default bot avatar
        if (avatar_url === '/bot-avatar.svg') {
          // valid static asset, no further check needed
        } else if (
          typeof avatar_url !== 'string' ||
          !avatar_url.startsWith('/uploads/') ||
          avatar_url.length > 255
        ) {
          return reply.code(400).send({ error: 'Invalid avatar URL' });
        } else {
          const storedName = avatar_url.replace('/uploads/', '');
          const file = db.prepare('SELECT id, user_id FROM files WHERE stored_name = ?').get(storedName) as { id: string; user_id: string } | undefined;
          if (!file) {
            return reply.code(400).send({ error: 'File not found' });
          }
          if (file.user_id !== request.user.userId) {
            return reply.code(403).send({ error: 'You can only use your own uploaded files' });
          }
        }
      }
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(
        avatar_url,
        existingBot.user_id,
      );
    }

    const updated = db
      .prepare(
        `SELECT b.id, b.user_id, b.type, b.name, b.channel_id, b.enabled, b.greeting, b.dm_enabled, b.dm_greeting, b.config, u.avatar_url
         FROM bots b JOIN users u ON u.id = b.user_id WHERE b.id = ?`,
      )
      .get(id) as any;

    const bot: Bot = {
      id: updated.id,
      user_id: updated.user_id,
      type: updated.type,
      name: updated.name,
      avatar_url: updated.avatar_url,
      channel_id: updated.channel_id,
      enabled: updated.enabled === 1,
      greeting: updated.greeting,
      dm_enabled: updated.dm_enabled === 1,
      dm_greeting: updated.dm_greeting,
      config: updated.config,
    };
    broadcastToServer(serverId, { type: 'bot:updated', bot });

    // Update presence list when bot is enabled/disabled
    if (enabled !== undefined) {
      if (bot.enabled) {
        broadcastToServer(serverId, {
          type: 'presence:update',
          userId: bot.user_id,
          username: bot.name,
          display_name: bot.name,
          online: true,
          status: 'online',
        });
      } else {
        broadcastToServer(serverId, {
          type: 'presence:update',
          userId: bot.user_id,
          username: bot.name,
          display_name: bot.name,
          online: false,
        });
      }
    }

    return bot;
  });
}
