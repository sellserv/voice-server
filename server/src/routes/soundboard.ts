import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { openSync, readSync, closeSync } from 'fs';
import { resolve } from 'path';
import db from '../db/connection.js';
import { config } from '../config.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { hasPermission, isAppEnabled } from '../auth/permissions.js';
import { broadcast } from '../ws/index.js';

export default async function soundboardRoutes(app: FastifyInstance) {
  // List sounds — server-scoped
  app.get(
    '/api/servers/:serverId/soundboard',
    {
      preHandler: async (request: any, reply: any) => {
        await requireAuth(request, reply);
        if (reply.sent) return;
        await requireServerMember(request, reply, () => {});
        if (reply.sent) return;
        if (!hasPermission(request.user.userId, 'use_apps')) {
          return reply.code(403).send({ error: 'Missing permission: use_apps' });
        }
        if (!isAppEnabled('soundboard')) {
          return reply.code(403).send({ error: 'This app is not enabled on this server' });
        }
      },
    },
    async (request) => {
      const serverId = getServerId(request);
      return db
        .prepare(
          `SELECT s.*, f.stored_name, f.original_name, f.mime_type,
              ef.stored_name AS emoji_stored_name
       FROM soundboard_sounds s
       JOIN files f ON f.id = s.file_id
       LEFT JOIN custom_emojis ce ON ce.id = s.emoji_id
       LEFT JOIN files ef ON ef.id = ce.file_id
       WHERE s.server_id = ?
       ORDER BY s.created_at DESC`,
        )
        .all(serverId);
    },
  );

  // Add sound — server-scoped
  app.post<{ Body: { name: string; file_id: string; emoji_id?: string; emoji?: string } }>(
    '/api/servers/:serverId/soundboard',
    { preHandler: [requirePermission('manage_soundboard'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { name, file_id, emoji_id, emoji } = request.body;

      if (!name || name.length < 1 || name.length > 64) {
        return reply.code(400).send({ error: 'Sound name must be 1-64 characters' });
      }

      const file = db
        .prepare('SELECT id, mime_type, stored_name FROM files WHERE id = ?')
        .get(file_id) as any;
      if (!file) {
        return reply.code(400).send({ error: 'File not found' });
      }
      if (!file.mime_type.startsWith('audio/')) {
        return reply.code(400).send({ error: 'File must be an audio file' });
      }

      // Validate emoji_id if provided
      if (emoji_id) {
        const emoji = db.prepare('SELECT id FROM custom_emojis WHERE id = ?').get(emoji_id);
        if (!emoji) {
          return reply.code(400).send({ error: 'Custom emoji not found' });
        }
      }

      // Validate duration for WAV files (client always exports WAV)
      if (
        file.mime_type === 'audio/wav' ||
        file.mime_type === 'audio/wave' ||
        file.stored_name.endsWith('.wav')
      ) {
        try {
          const filePath = resolve(config.uploadDir, file.stored_name);
          const fd = openSync(filePath, 'r');
          const header = Buffer.alloc(44);
          readSync(fd, header, 0, 44, 0);
          closeSync(fd);

          const byteRate = header.readUInt32LE(28);
          const dataSize = header.readUInt32LE(40);
          if (byteRate > 0) {
            const duration = dataSize / byteRate;
            if (duration > 7.1) {
              return reply.code(400).send({ error: 'Sound must be 7 seconds or less' });
            }
          }
        } catch {
          // If header parsing fails, allow the upload (non-standard format)
        }
      }

      const id = randomUUID();
      db.prepare(
        'INSERT INTO soundboard_sounds (id, name, file_id, uploaded_by, emoji_id, emoji, server_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, name, file_id, request.user.userId, emoji_id || null, emoji || null, serverId);

      const sound = db
        .prepare(
          `SELECT s.*, f.stored_name, f.original_name, f.mime_type,
                ef.stored_name AS emoji_stored_name
         FROM soundboard_sounds s
         JOIN files f ON f.id = s.file_id
         LEFT JOIN custom_emojis ce ON ce.id = s.emoji_id
         LEFT JOIN files ef ON ef.id = ce.file_id
         WHERE s.id = ?`,
        )
        .get(id);

      broadcast({ type: 'soundboard:created', sound });
      return reply.code(201).send(sound);
    },
  );

  // Delete sound — server-scoped
  app.delete<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/soundboard/:id',
    { preHandler: [requirePermission('manage_soundboard'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const soundId = request.params.id;
      const result = db.prepare('DELETE FROM soundboard_sounds WHERE id = ? AND server_id = ?').run(soundId, serverId);
      if (result.changes === 0) {
        return reply.code(404).send({ error: 'Sound not found' });
      }
      broadcast({ type: 'soundboard:deleted', soundId });
      return { ok: true };
    },
  );
}
