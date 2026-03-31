import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { extname, basename, relative } from 'path';
import { resolve } from 'path';
import { getDb } from '../adapters/index.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { checkNewUserCooldown } from '../auth/cooldown.js';
import { isPremium } from '../auth/permissions.js';
import type { FileRecord } from '@voip-server/shared';

const FREE_FILE_SIZE = 25 * 1024 * 1024;  // 25MB
const PRO_FILE_SIZE = 100 * 1024 * 1024;   // 100MB

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.mp3',
  '.ogg',
  '.wav',
  '.webm',
  '.mp4',
  '.pdf',
  '.txt',
  '.csv',
  '.md',
]);

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
]);

export default async function uploadRoutes(app: FastifyInstance) {
  // Upload file
  app.post('/api/upload', { preHandler: requireAuth }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    // New-user cooldown: block uploads for accounts < 1 hour old
    const cooldown = await checkNewUserCooldown(request.user.userId);
    if (cooldown.restricted) {
      return reply.code(403).send({
        error: `New accounts cannot upload files yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
      });
    }

    if (!ALLOWED_MIMES.has(data.mimetype)) {
      return reply.code(400).send({ error: `File type not allowed: ${data.mimetype}` });
    }

    // Check daily upload limit
    const today = new Date().toISOString().split('T')[0];
    const dailyUsage = await getDb().queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(size_bytes), 0) as total FROM files
       WHERE user_id = ? AND created_at >= ?`,
      [request.user.userId, today],
    );

    if ((dailyUsage?.total ?? 0) >= config.maxDailyUploadPerUser) {
      return reply.code(429).send({ error: 'Daily upload limit reached' });
    }

    // Check total disk usage
    const totalDisk = await getDb().queryOne<{ total: number }>(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files',
    );

    if ((totalDisk?.total ?? 0) >= config.maxTotalDisk) {
      return reply.code(507).send({ error: 'Server storage full' });
    }

    const id = randomUUID();
    // Sanitize filename: strip path components, only keep the base name
    const safeOriginalName = basename(data.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = extname(safeOriginalName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return reply.code(400).send({ error: `File extension not allowed: ${ext}` });
    }

    const storedName = `${id}${ext}`;
    const filePath = resolve(config.uploadDir, storedName);

    // Verify the resolved path is within uploadDir (prevent path traversal and symlink attacks)
    const rel = relative(resolve(config.uploadDir), filePath);
    if (rel.startsWith('..') || rel.startsWith('/') || rel.includes('..')) {
      return reply.code(400).send({ error: 'Invalid file path' });
    }

    // Stream to disk
    try {
      await pipeline(data.file, createWriteStream(filePath));
    } catch (err) {
      await unlink(filePath).catch(() => {});
      throw err;
    }

    const sizeBytes = data.file.bytesRead;
    const userIsPremium = await isPremium(request.user.userId);
    const maxSize = userIsPremium ? PRO_FILE_SIZE : FREE_FILE_SIZE;
    if (sizeBytes > maxSize) {
      await unlink(filePath).catch(() => {});
      const limitMB = Math.round(maxSize / (1024 * 1024));
      return reply.code(413).send({
        error: `File too large. ${userIsPremium ? 'Pro' : 'Free'} limit is ${limitMB}MB.`,
        premiumRequired: !userIsPremium,
      });
    }

    await getDb().run(
      `INSERT INTO files (id, user_id, original_name, stored_name, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, request.user.userId, safeOriginalName, storedName, data.mimetype, sizeBytes],
    );

    const file = await getDb().queryOne<FileRecord>('SELECT * FROM files WHERE id = ?', [id]);
    return reply.code(201).send(file);
  });

  // Get file info
  app.get<{ Params: { id: string } }>(
    '/api/files/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const file = await getDb().queryOne<FileRecord>(
        'SELECT * FROM files WHERE id = ?',
        [request.params.id],
      );
      if (!file) {
        return reply.code(404).send({ error: 'File not found' });
      }
      // Only allow file owner to view metadata
      if (file.user_id !== request.user.userId) {
        return reply.code(403).send({ error: 'Access denied' });
      }
      return file;
    },
  );
}
