import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { broadcastToServer } from '../ws/index.js';

export default async function customEmojiRoutes(app: FastifyInstance) {
  // List all custom emojis — server-scoped
  app.get('/api/servers/:serverId/custom-emojis', { preHandler: [requireAuth, requireServerMember] }, async (request, reply) => {
    try {
      const serverId = getServerId(request);
      return await getDb().query(
        `SELECT e.id, e.name, e.file_id, e.server_id, e.uploaded_by, e.created_at, f.stored_name, f.mime_type
         FROM custom_emojis e JOIN files f ON f.id = e.file_id
         WHERE e.server_id = ?
         ORDER BY e.created_at DESC`,
        [serverId],
      );
    } catch (err: any) {
      console.error('Failed to list custom emojis:', err);
      return reply.code(500).send({ error: 'Failed to list custom emojis' });
    }
  });

  // Create custom emoji — server-scoped
  app.post<{ Body: { name: string; file_id: string } }>(
    '/api/servers/:serverId/admin/custom-emojis',
    { preHandler: [requirePermission('manage_emojis'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const name = request.body?.name;
      const file_id = request.body?.file_id;

      if (!name || !/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
        return reply
          .code(400)
          .send({ error: 'Emoji name must be 2-32 alphanumeric/underscore characters' });
      }

      if (!file_id) {
        return reply.code(400).send({ error: 'file_id is required' });
      }

      try {
        const existing = await getDb().queryOne('SELECT id FROM custom_emojis WHERE name = ? AND server_id = ?', [name, serverId]);
        if (existing) {
          return reply.code(400).send({ error: 'Emoji name already exists on this server' });
        }

        const file = await getDb().queryOne<{ id: string; mime_type: string }>('SELECT id, mime_type FROM files WHERE id = ?', [file_id]);
        if (!file) {
          return reply.code(400).send({ error: 'File not found' });
        }
        if (!file.mime_type.startsWith('image/')) {
          return reply.code(400).send({ error: 'File must be an image' });
        }

        const id = randomUUID();
        try {
          await getDb().run(
            'INSERT INTO custom_emojis (id, name, file_id, uploaded_by, server_id) VALUES (?, ?, ?, ?, ?)',
            [id, name, file_id, request.user.userId, serverId],
          );
        } catch (err: any) {
          if (err.message?.includes('UNIQUE constraint failed')) {
            return reply.code(400).send({ error: 'Emoji name already exists on this server' });
          }
          throw err;
        }

        const emoji = await getDb().queryOne(
          `SELECT e.id, e.name, e.file_id, e.server_id, e.uploaded_by, e.created_at, f.stored_name, f.mime_type
           FROM custom_emojis e JOIN files f ON f.id = e.file_id
           WHERE e.id = ?`,
          [id],
        );

        if (!emoji) {
          throw new Error('Failed to retrieve created emoji after insert');
        }

        try {
          broadcastToServer(serverId, { type: 'emoji:created', emoji: emoji as any });
        } catch (err) {
          console.error('Failed to broadcast emoji creation:', err);
        }
        return reply.code(201).send(emoji);
      } catch (err: any) {
        console.error('Failed to create custom emoji:', err);
        return reply.code(500).send({ error: err.message || 'Internal server error' });
      }
    },
  );

  // Delete custom emoji — server-scoped
  app.delete<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/admin/custom-emojis/:id',
    { preHandler: [requirePermission('manage_emojis'), requireServerMember] },
    async (request, reply) => {
      try {
        const serverId = getServerId(request);
        const emojiId = request.params.id;
        const result = await getDb().run('DELETE FROM custom_emojis WHERE id = ? AND server_id = ?', [emojiId, serverId]);
        if (result.changes === 0) {
          return reply.code(404).send({ error: 'Custom emoji not found' });
        }
        try {
          broadcastToServer(serverId, { type: 'emoji:deleted', emojiId });
        } catch (err) {
          console.error('Failed to broadcast emoji deletion:', err);
        }
        return { ok: true };
      } catch (err: any) {
        console.error('Failed to delete custom emoji:', err);
        return reply.code(500).send({ error: 'Failed to delete custom emoji' });
      }
    },
  );
}
