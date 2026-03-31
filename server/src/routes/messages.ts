import type { FastifyInstance } from 'fastify';
import { getDb } from '../adapters/index.js';
import { requireAuth } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { hasChannelAccess } from '../auth/permissions.js';
import type { Message, PaginatedMessages } from '@voip-server/shared';

async function attachReactions(messages: Message[]): Promise<void> {
  if (messages.length === 0) return;

  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactions = await getDb().query<{ message_id: string; emoji: string; user_ids: string; count: number }>(
    `
      SELECT message_id, emoji, GROUP_CONCAT(user_id) as user_ids, COUNT(*) as count
      FROM reactions
      WHERE message_id IN (${placeholders})
      GROUP BY message_id, emoji
    `,
    ids,
  );

  const reactionsByMessage = new Map<
    string,
    { emoji: string; count: number; userIds: string[] }[]
  >();
  for (const r of reactions) {
    if (!reactionsByMessage.has(r.message_id)) reactionsByMessage.set(r.message_id, []);
    reactionsByMessage.get(r.message_id)!.push({
      emoji: r.emoji,
      count: r.count,
      userIds: r.user_ids.split(','),
    });
  }

  for (const msg of messages) {
    msg.reactions = reactionsByMessage.get(msg.id) || [];
  }
}

async function fetchMessages(channelId: string, before: string | undefined, limit: number): Promise<Message[]> {
  let messages: Message[];
  if (before) {
    messages = await getDb().query<Message>(
      `
        SELECT m.id, m.channel_id, m.user_id, m.content, m.file_id, m.reply_to_id, m.invite_id, m.poll_id, m.created_at, m.edited_at, m.pinned, m.pinned_by, m.type, m.metadata,
               u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color,
               f.mime_type as file_mime_type,
               ru.username as reply_to_username, ru.display_name as reply_to_display_name,
               rm.content as reply_to_content
        FROM messages m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN files f ON f.id = m.file_id
        LEFT JOIN messages rm ON rm.id = m.reply_to_id
        LEFT JOIN users ru ON ru.id = rm.user_id
        WHERE m.channel_id = ? AND m.created_at < ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `,
      [channelId, before, limit + 1],
    );
  } else {
    messages = await getDb().query<Message>(
      `
        SELECT m.id, m.channel_id, m.user_id, m.content, m.file_id, m.reply_to_id, m.invite_id, m.poll_id, m.created_at, m.edited_at, m.pinned, m.pinned_by, m.type, m.metadata,
               u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color,
               f.mime_type as file_mime_type,
               ru.username as reply_to_username, ru.display_name as reply_to_display_name,
               rm.content as reply_to_content
        FROM messages m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN files f ON f.id = m.file_id
        LEFT JOIN messages rm ON rm.id = m.reply_to_id
        LEFT JOIN users ru ON ru.id = rm.user_id
        WHERE m.channel_id = ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `,
      [channelId, limit + 1],
    );
  }

  // Truncate reply_to_content to 200 chars
  for (const msg of messages) {
    if (msg.reply_to_content && msg.reply_to_content.length > 200) {
      msg.reply_to_content = msg.reply_to_content.slice(0, 200) + '...';
    }
  }

  const hasMore = messages.length > limit;
  if (hasMore) messages.pop();
  messages.reverse();

  await attachReactions(messages);

  return messages;
}

export default async function messageRoutes(app: FastifyInstance) {
  // ─── Server-scoped message routes ───

  // Get message history for a server channel
  app.get<{
    Params: { serverId: string; id: string };
    Querystring: { before?: string; limit?: string };
  }>('/api/servers/:serverId/channels/:id/messages', { preHandler: [requireAuth, requireServerMember] }, async (request, reply) => {
    const serverId = getServerId(request);
    const { id: channelId } = request.params;
    const before = request.query.before;
    const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);

    // Verify channel exists and belongs to this server
    const channel = await getDb().queryOne<{ id: string; server_id: string | null }>(
      'SELECT id, server_id FROM channels WHERE id = ?',
      [channelId],
    );
    if (!channel || channel.server_id !== serverId) {
      return reply.code(404).send({ error: 'Channel not found in this server' });
    }

    // Channel access control check
    if (!await hasChannelAccess(request.user.userId, channelId)) {
      return reply.code(403).send({ error: 'You do not have access to this channel' });
    }

    const messages = await fetchMessages(channelId, before, limit);
    const hasMore = messages.length === limit;

    const result: PaginatedMessages = { messages, hasMore };
    return result;
  });

  // Get pinned messages for a server channel
  app.get<{
    Params: { serverId: string; id: string };
  }>('/api/servers/:serverId/channels/:id/pins', { preHandler: [requireAuth, requireServerMember] }, async (request, reply) => {
    const serverId = getServerId(request);
    const { id: channelId } = request.params;

    // Verify channel exists and belongs to this server
    const channel = await getDb().queryOne<{ id: string; server_id: string | null }>(
      'SELECT id, server_id FROM channels WHERE id = ?',
      [channelId],
    );
    if (!channel || channel.server_id !== serverId) {
      return reply.code(404).send({ error: 'Channel not found in this server' });
    }

    if (!await hasChannelAccess(request.user.userId, channelId)) {
      return reply.code(403).send({ error: 'You do not have access to this channel' });
    }

    const messages = await getDb().query<Message>(
      `
      SELECT m.id, m.channel_id, m.user_id, m.content, m.file_id, m.reply_to_id, m.invite_id, m.poll_id, m.created_at, m.edited_at, m.pinned, m.pinned_by, m.type, m.metadata,
             u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color,
             f.mime_type as file_mime_type
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN files f ON f.id = m.file_id
      WHERE m.channel_id = ? AND m.pinned = 1
      ORDER BY m.created_at DESC
    `,
      [channelId],
    );

    return { messages };
  });

  // Search messages within a server using FTS5
  app.get<{
    Params: { serverId: string };
    Querystring: { q?: string; limit?: string };
  }>('/api/servers/:serverId/search', { preHandler: [requireAuth, requireServerMember] }, async (request, reply) => {
    const serverId = getServerId(request);
    const q = request.query.q?.trim();
    if (!q) {
      return reply.code(400).send({ error: 'Search query is required' });
    }

    const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);

    // Escape FTS5 special characters and wrap in quotes for literal matching
    const safeQuery = '"' + q.replace(/"/g, '""') + '"';

    let rowids: { rowid: number }[];
    try {
      rowids = await getDb().query<{ rowid: number }>(
        'SELECT rowid FROM messages_fts WHERE content MATCH ?',
        [safeQuery],
      );
    } catch {
      // FTS5 table may not exist yet
      return { messages: [] };
    }

    if (rowids.length === 0) {
      return { messages: [] };
    }

    const ids = rowids.slice(0, limit).map((r) => r.rowid);
    const placeholders = ids.map(() => '?').join(',');

    // Only return messages from channels belonging to this server
    const messages = await getDb().query<Message>(
      `
      SELECT m.id, m.channel_id, m.user_id, m.content, m.file_id, m.reply_to_id, m.invite_id, m.poll_id, m.created_at, m.edited_at, m.pinned, m.pinned_by, m.type, m.metadata,
             u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color,
             f.mime_type as file_mime_type
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN files f ON f.id = m.file_id
      JOIN channels c ON c.id = m.channel_id
      WHERE m.rowid IN (${placeholders}) AND c.server_id = ?
      ORDER BY m.created_at DESC
    `,
      [...ids, serverId],
    );

    // Filter to only channels the user has access to
    const filtered: Message[] = [];
    for (const msg of messages) {
      if (await hasChannelAccess(request.user.userId, msg.channel_id)) {
        filtered.push(msg);
      }
    }

    return { messages: filtered };
  });

  // ─── DM message routes (global, not server-scoped) ───

  // Get message history for a DM channel
  app.get<{
    Params: { id: string };
    Querystring: { before?: string; limit?: string };
  }>('/api/channels/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { id: channelId } = request.params;
    const before = request.query.before;
    const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);

    // Verify channel exists
    const channel = await getDb().queryOne<{ id: string; type: string }>(
      'SELECT id, type FROM channels WHERE id = ?',
      [channelId],
    );
    if (!channel) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    // DM authorization: verify the requesting user is a participant
    if (channel.type === 'dm') {
      const userId = request.user.userId;
      const participant = await getDb().queryOne(
        'SELECT 1 FROM dm_participants WHERE channel_id = ? AND user_id = ?',
        [channelId, userId],
      );
      if (!participant) {
        return reply.code(403).send({ error: 'Not a participant of this DM' });
      }
    }

    // Channel access control check
    if (channel.type !== 'dm' && !await hasChannelAccess(request.user.userId, channelId)) {
      return reply.code(403).send({ error: 'You do not have access to this channel' });
    }

    const messages = await fetchMessages(channelId, before, limit);
    const hasMore = messages.length === limit;

    const result: PaginatedMessages = { messages, hasMore };
    return result;
  });

  // Get pinned messages for a channel (DM-compatible, global path)
  app.get<{
    Params: { id: string };
  }>('/api/channels/:id/pins', { preHandler: requireAuth }, async (request, reply) => {
    const { id: channelId } = request.params;

    const channel = await getDb().queryOne<{ id: string; type: string }>(
      'SELECT id, type FROM channels WHERE id = ?',
      [channelId],
    );
    if (!channel) {
      return reply.code(404).send({ error: 'Channel not found' });
    }

    if (channel.type !== 'dm' && !await hasChannelAccess(request.user.userId, channelId)) {
      return reply.code(403).send({ error: 'You do not have access to this channel' });
    }

    const messages = await getDb().query<Message>(
      `
      SELECT m.id, m.channel_id, m.user_id, m.content, m.file_id, m.reply_to_id, m.invite_id, m.poll_id, m.created_at, m.edited_at, m.pinned, m.pinned_by, m.type, m.metadata,
             u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color,
             f.mime_type as file_mime_type
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN files f ON f.id = m.file_id
      WHERE m.channel_id = ? AND m.pinned = 1
      ORDER BY m.created_at DESC
    `,
      [channelId],
    );

    return { messages };
  });

  // Search messages using FTS5 (global, not server-scoped)
  app.get<{
    Querystring: { q?: string; limit?: string };
  }>('/api/messages/search', { preHandler: requireAuth }, async (request, reply) => {
    const q = request.query.q?.trim();
    if (!q) {
      return reply.code(400).send({ error: 'Search query is required' });
    }

    const limit = Math.min(parseInt(request.query.limit || '50', 10), 100);

    // Escape FTS5 special characters and wrap in quotes for literal matching
    const safeQuery = '"' + q.replace(/"/g, '""') + '"';

    let rowids: { rowid: number }[];
    try {
      rowids = await getDb().query<{ rowid: number }>(
        'SELECT rowid FROM messages_fts WHERE content MATCH ?',
        [safeQuery],
      );
    } catch {
      // FTS5 table may not exist yet
      return { messages: [] };
    }

    if (rowids.length === 0) {
      return { messages: [] };
    }

    const ids = rowids.slice(0, limit).map((r) => r.rowid);
    const placeholders = ids.map(() => '?').join(',');

    const messages = await getDb().query<Message>(
      `
      SELECT m.id, m.channel_id, m.user_id, m.content, m.file_id, m.reply_to_id, m.invite_id, m.poll_id, m.created_at, m.edited_at, m.pinned, m.pinned_by, m.type, m.metadata,
             u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color,
             f.mime_type as file_mime_type
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN files f ON f.id = m.file_id
      WHERE m.rowid IN (${placeholders})
      ORDER BY m.created_at DESC
    `,
      ids,
    );

    // Filter to only channels the user has access to
    const filtered: Message[] = [];
    for (const msg of messages) {
      if (await hasChannelAccess(request.user.userId, msg.channel_id)) {
        filtered.push(msg);
      }
    }

    return { messages: filtered };
  });
}
