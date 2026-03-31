import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import type { Channel, CreateChannelBody, ChannelPermissionOverride } from '@voip-server/shared';
import {
  sendTo,
  broadcastToServer,
  broadcastToChannel,
  broadcastChannelAccessChange,
  invalidateChannelCache,
} from '../ws/index.js';
import {
  hasPermission,
  hasChannelAccess,
  getUsersWithChannelAccess,
  invalidateChannelAccessCache,
  getUserRoleIds,
} from '../auth/permissions.js';
import { clearTypingForChannel } from '../ws/handlers.js';
import { logAuditEvent } from '../audit/log.js';

async function getChannelOverrides(channelId: string): Promise<ChannelPermissionOverride[]> {
  const rows = await getDb().query<any>(
    'SELECT * FROM channel_permission_overrides WHERE channel_id = ?',
    [channelId],
  );
  return rows.map((row) => ({
    id: row.id,
    channel_id: row.channel_id,
    target_type: row.target_type,
    target_id: row.target_id,
    view_channel: row.view_channel === null ? null : !!row.view_channel,
    send_messages: row.send_messages === null ? null : !!row.send_messages,
    upload_files: row.upload_files === null ? null : !!row.upload_files,
    add_reactions: row.add_reactions === null ? null : !!row.add_reactions,
    use_custom_emoji: row.use_custom_emoji === null ? null : !!row.use_custom_emoji,
    manage_messages: row.manage_messages === null ? null : !!row.manage_messages,
    pin_messages: row.pin_messages === null ? null : !!row.pin_messages,
    connect_voice: row.connect_voice === null ? null : !!row.connect_voice,
    speak: row.speak === null ? null : !!row.speak,
    share_screen: row.share_screen === null ? null : !!row.share_screen,
  }));
}

async function enrichChannel(channel: Channel): Promise<Channel> {
  if (channel.type === 'dm') return channel;
  // Legacy fields for backward compat
  const restricted = (channel as any).restricted;
  channel.restricted = !!restricted;
  if (channel.restricted) {
    channel.allowed_role_ids = (
      await getDb().query<{ role_id: string }>(
        'SELECT role_id FROM channel_access_roles WHERE channel_id = ?',
        [channel.id],
      )
    ).map((r) => r.role_id);
    channel.allowed_user_ids = (
      await getDb().query<{ user_id: string }>(
        'SELECT user_id FROM channel_access_users WHERE channel_id = ?',
        [channel.id],
      )
    ).map((r) => r.user_id);
  } else {
    channel.allowed_role_ids = [];
    channel.allowed_user_ids = [];
  }
  // New override system
  channel.permission_overrides = await getChannelOverrides(channel.id);
  // Computed access list (accounts for all permission sources including group overrides)
  channel.accessible_user_ids = await getUsersWithChannelAccess(channel.id);
  return channel;
}

async function enrichChannelsBatch(channels: Channel[]): Promise<Channel[]> {
  const nonDm = channels.filter((ch) => ch.type !== 'dm');
  if (nonDm.length === 0) return channels;

  const restrictedIds = nonDm.filter((ch) => (ch as any).restricted).map((ch) => ch.id);

  // Legacy fields
  const roleMap = new Map<string, string[]>();
  const userMap = new Map<string, string[]>();
  if (restrictedIds.length > 0) {
    const placeholders = restrictedIds.map(() => '?').join(',');
    const roleRows = await getDb().query<{ channel_id: string; role_id: string }>(
      `SELECT channel_id, role_id FROM channel_access_roles WHERE channel_id IN (${placeholders})`,
      restrictedIds,
    );
    const userRows = await getDb().query<{ channel_id: string; user_id: string }>(
      `SELECT channel_id, user_id FROM channel_access_users WHERE channel_id IN (${placeholders})`,
      restrictedIds,
    );

    for (const r of roleRows) {
      if (!roleMap.has(r.channel_id)) roleMap.set(r.channel_id, []);
      roleMap.get(r.channel_id)!.push(r.role_id);
    }
    for (const r of userRows) {
      if (!userMap.has(r.channel_id)) userMap.set(r.channel_id, []);
      userMap.get(r.channel_id)!.push(r.user_id);
    }
  }

  // Batch load overrides for all non-DM channels
  const nonDmIds = nonDm.map((ch) => ch.id);
  const overridePlaceholders = nonDmIds.map(() => '?').join(',');
  const overrideRows =
    nonDmIds.length > 0
      ? await getDb().query<any>(
          `SELECT * FROM channel_permission_overrides WHERE channel_id IN (${overridePlaceholders})`,
          nonDmIds,
        )
      : [];

  const overrideMap = new Map<string, ChannelPermissionOverride[]>();
  for (const row of overrideRows) {
    if (!overrideMap.has(row.channel_id)) overrideMap.set(row.channel_id, []);
    overrideMap.get(row.channel_id)!.push({
      id: row.id,
      channel_id: row.channel_id,
      target_type: row.target_type,
      target_id: row.target_id,
      view_channel: row.view_channel === null ? null : !!row.view_channel,
      send_messages: row.send_messages === null ? null : !!row.send_messages,
      upload_files: row.upload_files === null ? null : !!row.upload_files,
      add_reactions: row.add_reactions === null ? null : !!row.add_reactions,
      use_custom_emoji: row.use_custom_emoji === null ? null : !!row.use_custom_emoji,
      manage_messages: row.manage_messages === null ? null : !!row.manage_messages,
      pin_messages: row.pin_messages === null ? null : !!row.pin_messages,
      connect_voice: row.connect_voice === null ? null : !!row.connect_voice,
      speak: row.speak === null ? null : !!row.speak,
      share_screen: row.share_screen === null ? null : !!row.share_screen,
    });
  }

  const result: Channel[] = [];
  for (const ch of channels) {
    if (ch.type === 'dm') {
      result.push(ch);
      continue;
    }
    ch.restricted = !!(ch as any).restricted;
    ch.allowed_role_ids = roleMap.get(ch.id) ?? [];
    ch.allowed_user_ids = userMap.get(ch.id) ?? [];
    ch.permission_overrides = overrideMap.get(ch.id) ?? [];
    ch.accessible_user_ids = await getUsersWithChannelAccess(ch.id);
    result.push(ch);
  }
  return result;
}

export default async function channelRoutes(app: FastifyInstance) {
  // List channels (exclude DMs) — server-scoped
  app.get('/api/servers/:serverId/channels', { preHandler: [requireAuth, requireServerMember] }, async (request) => {
    const serverId = getServerId(request);
    const userId = request.user.userId;
    const allChannels = await getDb().query<Channel>(
      "SELECT * FROM channels WHERE type != 'dm' AND server_id = ? ORDER BY sort_order, created_at",
      [serverId],
    );
    const filtered: Channel[] = [];
    for (const ch of allChannels) {
      if (await hasChannelAccess(userId, ch.id)) {
        filtered.push(ch);
      }
    }
    return await enrichChannelsBatch(filtered);
  });

  // Create channel (manage_channels_groups) — server-scoped
  app.post<{ Body: CreateChannelBody }>(
    '/api/servers/:serverId/channels',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { name, type, group_id } = request.body;

      if (!name || !type) {
        return reply.code(400).send({ error: 'Name and type required' });
      }
      if (!['text', 'voice'].includes(type)) {
        return reply.code(400).send({ error: 'Type must be text or voice' });
      }
      if (name.length < 1 || name.length > 32) {
        return reply.code(400).send({ error: 'Channel name must be 1-32 characters' });
      }

      if (group_id) {
        const group = await getDb().queryOne(
          'SELECT id FROM channel_groups WHERE id = ? AND server_id = ?',
          [group_id, serverId],
        );
        if (!group) {
          return reply.code(400).send({ error: 'Channel group not found' });
        }
      }

      const maxOrder = await getDb().queryOne<{ m: number | null }>(
        'SELECT MAX(sort_order) as m FROM channels WHERE server_id = ?',
        [serverId],
      );
      const id = randomUUID();

      await getDb().run(
        'INSERT INTO channels (id, name, type, sort_order, group_id, server_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, type, (maxOrder?.m ?? -1) + 1, group_id || null, serverId],
      );

      const channel = (await getDb().queryOne<Channel>('SELECT * FROM channels WHERE id = ?', [id]))!;
      broadcastToServer(serverId, { type: 'channel:created', channel, serverId });

      reply.code(201);
      return channel;
    },
  );

  // Update channel (manage_channels_groups) - supports name, topic, and group_id — server-scoped
  app.patch<{
    Params: { serverId: string; id: string };
    Body: { name?: string; topic?: string; group_id?: string | null };
  }>(
    '/api/servers/:serverId/channels/:id',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const { name, topic, group_id } = request.body;

      if (
        name !== undefined &&
        (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32)
      ) {
        return reply.code(400).send({ error: 'Channel name must be 1-32 characters' });
      }

      if (topic !== undefined && typeof topic !== 'string') {
        return reply.code(400).send({ error: 'Topic must be a string' });
      }

      if (topic !== undefined && topic.length > 512) {
        return reply.code(400).send({ error: 'Topic must be 512 characters or less' });
      }

      const existing = await getDb().queryOne(
        'SELECT * FROM channels WHERE id = ? AND server_id = ?',
        [id, serverId],
      );
      if (!existing) {
        return reply.code(404).send({ error: 'Channel not found' });
      }

      if (group_id !== undefined) {
        if (group_id !== null) {
          const group = await getDb().queryOne(
            'SELECT id FROM channel_groups WHERE id = ? AND server_id = ?',
            [group_id, serverId],
          );
          if (!group) {
            return reply.code(400).send({ error: 'Channel group not found' });
          }
        }
        await getDb().run(
          'UPDATE channels SET group_id = ? WHERE id = ? AND server_id = ?',
          [group_id, id, serverId],
        );
      }

      if (name !== undefined) {
        await getDb().run(
          'UPDATE channels SET name = ? WHERE id = ? AND server_id = ?',
          [name.trim(), id, serverId],
        );
      }
      if (topic !== undefined) {
        await getDb().run(
          'UPDATE channels SET topic = ? WHERE id = ? AND server_id = ?',
          [topic.trim() || null, id, serverId],
        );
      }

      const channel = await enrichChannel(
        (await getDb().queryOne<Channel>('SELECT * FROM channels WHERE id = ?', [id]))!,
      );
      await broadcastToChannel(id, { type: 'channel:updated', channel, serverId });

      return channel;
    },
  );

  // Delete channel (manage_channels_groups) — server-scoped
  app.delete<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/channels/:id',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;

      const channel = await getDb().queryOne(
        'SELECT * FROM channels WHERE id = ? AND server_id = ?',
        [id, serverId],
      );
      if (!channel) {
        return reply.code(404).send({ error: 'Channel not found' });
      }

      broadcastToServer(serverId, { type: 'channel:deleted', channelId: id, serverId });
      await getDb().run('DELETE FROM channels WHERE id = ? AND server_id = ?', [id, serverId]);
      clearTypingForChannel(id);
      invalidateChannelCache(id);

      return { ok: true };
    },
  );

  // Reorder channels (manage_channels_groups) — server-scoped
  app.put<{ Body: { order: string[] } }>(
    '/api/servers/:serverId/channels/reorder',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { order } = request.body;
      if (!Array.isArray(order)) {
        return reply.code(400).send({ error: 'order must be an array of channel IDs' });
      }

      await getDb().transaction(async (tx) => {
        for (let i = 0; i < order.length; i++) {
          await tx.run(
            'UPDATE channels SET sort_order = ? WHERE id = ? AND server_id = ?',
            [i, order[i], serverId],
          );
        }
      });

      broadcastToServer(serverId, { type: 'channels:reordered', order, serverId });

      return { ok: true };
    },
  );

  // Legacy: Update channel access control (manage_channels_groups) — server-scoped
  app.patch<{
    Params: { serverId: string; id: string };
    Body: { restricted: boolean; allowed_role_ids?: string[]; allowed_user_ids?: string[] };
  }>(
    '/api/servers/:serverId/channels/:id/access',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const { restricted, allowed_role_ids = [], allowed_user_ids = [] } = request.body;

      const existing = await getDb().queryOne<Channel>(
        'SELECT * FROM channels WHERE id = ? AND server_id = ?',
        [id, serverId],
      );
      if (!existing || existing.type === 'dm') {
        return reply.code(404).send({ error: 'Channel not found' });
      }

      // Compute "before" access set
      const beforeUsers = await getUsersWithChannelAccess(id);
      const beforeSet = beforeUsers.length > 0 ? new Set(beforeUsers) : null;

      // Update restricted flag
      await getDb().run(
        'UPDATE channels SET restricted = ? WHERE id = ? AND server_id = ?',
        [restricted ? 1 : 0, id, serverId],
      );

      // Rebuild junction tables atomically
      await getDb().transaction(async (tx) => {
        await tx.run('DELETE FROM channel_access_roles WHERE channel_id = ?', [id]);
        await tx.run('DELETE FROM channel_access_users WHERE channel_id = ?', [id]);

        if (restricted) {
          for (const roleId of allowed_role_ids) {
            await tx.run(
              'INSERT OR IGNORE INTO channel_access_roles (channel_id, role_id) VALUES (?, ?)',
              [id, roleId],
            );
          }
          for (const userId of allowed_user_ids) {
            await tx.run(
              'INSERT OR IGNORE INTO channel_access_users (channel_id, user_id) VALUES (?, ?)',
              [id, userId],
            );
          }
        }
      });

      // Invalidate cache after access change
      invalidateChannelCache(id);

      // Compute "after" access set
      const afterUsers = await getUsersWithChannelAccess(id);
      const afterSet = afterUsers.length > 0 ? new Set(afterUsers) : null;

      const channel = await enrichChannel(
        (await getDb().queryOne<Channel>('SELECT * FROM channels WHERE id = ?', [id]))!,
      );
      await broadcastChannelAccessChange(id, beforeSet, afterSet, channel);

      return channel;
    },
  );

  // ─── Channel Permission Overrides ───

  // Get all overrides for a channel — server-scoped
  app.get<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/channels/:id/permissions',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const channel = await getDb().queryOne(
        'SELECT id FROM channels WHERE id = ? AND server_id = ?',
        [id, serverId],
      );
      if (!channel) {
        return reply.code(404).send({ error: 'Channel not found' });
      }
      return await getChannelOverrides(id);
    },
  );

  // Create or update an override for a channel — server-scoped
  app.put<{
    Params: { serverId: string; id: string };
    Body: {
      target_type: 'role' | 'user';
      target_id: string;
      permissions: Record<string, boolean | null>;
    };
  }>(
    '/api/servers/:serverId/channels/:id/permissions',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const { target_type, target_id, permissions } = request.body;

      if (!target_type || !target_id || !permissions) {
        return reply
          .code(400)
          .send({ error: 'target_type, target_id, and permissions are required' });
      }
      if (!['role', 'user'].includes(target_type)) {
        return reply.code(400).send({ error: 'target_type must be "role" or "user"' });
      }

      const channel = await getDb().queryOne<{ id: string; type: string }>(
        'SELECT id, type FROM channels WHERE id = ? AND server_id = ?',
        [id, serverId],
      );
      if (!channel || channel.type === 'dm') {
        return reply.code(404).send({ error: 'Channel not found' });
      }

      // Validate target exists
      if (target_type === 'role') {
        const role = await getDb().queryOne('SELECT id FROM roles WHERE id = ?', [target_id]);
        if (!role) return reply.code(400).send({ error: 'Role not found' });
      } else {
        const user = await getDb().queryOne('SELECT id FROM users WHERE id = ?', [target_id]);
        if (!user) return reply.code(400).send({ error: 'User not found' });
      }

      // Compute "before" access set
      const beforeUsers = await getUsersWithChannelAccess(id);
      const beforeSet = beforeUsers.length > 0 ? new Set(beforeUsers) : null;

      const PERM_COLS = [
        'view_channel',
        'send_messages',
        'upload_files',
        'add_reactions',
        'use_custom_emoji',
        'manage_messages',
        'pin_messages',
        'connect_voice',
        'speak',
        'share_screen',
      ] as const;

      // Check if override already exists
      const existing = await getDb().queryOne<{ id: string }>(
        'SELECT id FROM channel_permission_overrides WHERE channel_id = ? AND target_type = ? AND target_id = ?',
        [id, target_type, target_id],
      );

      if (existing) {
        // Update existing override
        const sets: string[] = [];
        const values: (number | null)[] = [];
        for (const col of PERM_COLS) {
          if (col in permissions) {
            sets.push(`${col} = ?`);
            const val = permissions[col];
            values.push(val === null ? null : val ? 1 : 0);
          }
        }
        if (sets.length > 0) {
          values.push(existing.id as any);
          await getDb().run(
            `UPDATE channel_permission_overrides SET ${sets.join(', ')} WHERE id = ?`,
            values,
          );
        }
      } else {
        // Create new override
        const overrideId = randomUUID();
        const cols = ['id', 'channel_id', 'target_type', 'target_id'];
        const vals: (string | number | null)[] = [overrideId, id, target_type, target_id];

        for (const col of PERM_COLS) {
          cols.push(col);
          const val = permissions[col];
          vals.push(val === undefined || val === null ? null : val ? 1 : 0);
        }

        const placeholders = cols.map(() => '?').join(', ');
        await getDb().run(
          `INSERT INTO channel_permission_overrides (${cols.join(', ')}) VALUES (${placeholders})`,
          vals,
        );
      }

      // Invalidate cache after access change
      invalidateChannelCache(id);
      invalidateChannelAccessCache(id);

      // Compute "after" access set
      const afterUsers = await getUsersWithChannelAccess(id);
      const afterSet = afterUsers.length > 0 ? new Set(afterUsers) : null;

      const channelData = await enrichChannel(
        (await getDb().queryOne<Channel>('SELECT * FROM channels WHERE id = ?', [id]))!,
      );
      await broadcastChannelAccessChange(id, beforeSet, afterSet, channelData);

      await logAuditEvent('permission_change', request.user.userId, id, request.ip, {
        action: 'set',
        targetType: target_type,
        targetId: target_id,
      });

      // Broadcast overrides update
      const overrides = await getChannelOverrides(id);
      broadcastToServer(serverId, { type: 'channelOverrides:updated', channelId: id, overrides });

      return overrides;
    },
  );

  // Delete a specific override — server-scoped
  app.delete<{ Params: { serverId: string; id: string; targetType: string; targetId: string } }>(
    '/api/servers/:serverId/channels/:id/permissions/:targetType/:targetId',
    { preHandler: [requirePermission('manage_channels_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id, targetType, targetId } = request.params;

      if (!['role', 'user'].includes(targetType)) {
        return reply.code(400).send({ error: 'targetType must be "role" or "user"' });
      }

      const channel = await getDb().queryOne<{ id: string; type: string }>(
        'SELECT id, type FROM channels WHERE id = ? AND server_id = ?',
        [id, serverId],
      );
      if (!channel || channel.type === 'dm') {
        return reply.code(404).send({ error: 'Channel not found' });
      }

      // Compute "before" access set
      const beforeUsers = await getUsersWithChannelAccess(id);
      const beforeSet = beforeUsers.length > 0 ? new Set(beforeUsers) : null;

      await getDb().run(
        'DELETE FROM channel_permission_overrides WHERE channel_id = ? AND target_type = ? AND target_id = ?',
        [id, targetType, targetId],
      );

      // Invalidate cache after access change
      invalidateChannelCache(id);
      invalidateChannelAccessCache(id);

      // Compute "after" access set
      const afterUsers = await getUsersWithChannelAccess(id);
      const afterSet = afterUsers.length > 0 ? new Set(afterUsers) : null;

      await logAuditEvent('permission_change', request.user.userId, id, request.ip, {
        action: 'delete',
        targetType,
        targetId,
      });

      const channelData = await enrichChannel(
        (await getDb().queryOne<Channel>('SELECT * FROM channels WHERE id = ?', [id]))!,
      );
      await broadcastChannelAccessChange(id, beforeSet, afterSet, channelData);

      // Broadcast overrides update
      const overrides = await getChannelOverrides(id);
      broadcastToServer(serverId, { type: 'channelOverrides:updated', channelId: id, overrides });

      return { ok: true };
    },
  );

  // Bulk get channel overrides — server-scoped
  app.get('/api/servers/:serverId/channel-overrides', { preHandler: [requireAuth, requireServerMember] }, async (request) => {
    const serverId = getServerId(request);
    const userId = request.user.userId;
    const canManage =
      await hasPermission(userId, 'manage_channels_groups') || await hasPermission(userId, 'administrator');

    let rows: any[];
    if (canManage) {
      rows = await getDb().query(
        `SELECT cpo.* FROM channel_permission_overrides cpo
         JOIN channels c ON c.id = cpo.channel_id
         WHERE c.server_id = ?`,
        [serverId],
      );
    } else {
      // Return overrides targeting this user or any of their roles
      const roleIds = await getUserRoleIds(userId);
      if (roleIds.length > 0) {
        const placeholders = roleIds.map(() => '?').join(',');
        rows = await getDb().query(
          `SELECT cpo.* FROM channel_permission_overrides cpo
             JOIN channels c ON c.id = cpo.channel_id
             WHERE c.server_id = ?
               AND ((cpo.target_type = 'user' AND cpo.target_id = ?)
                 OR (cpo.target_type = 'role' AND cpo.target_id IN (${placeholders})))`,
          [serverId, userId, ...roleIds],
        );
      } else {
        rows = await getDb().query(
          `SELECT cpo.* FROM channel_permission_overrides cpo
             JOIN channels c ON c.id = cpo.channel_id
             WHERE c.server_id = ?
               AND cpo.target_type = 'user' AND cpo.target_id = ?`,
          [serverId, userId],
        );
      }
    }

    return rows.map((row) => ({
      id: row.id,
      channel_id: row.channel_id,
      target_type: row.target_type,
      target_id: row.target_id,
      view_channel: row.view_channel === null ? null : !!row.view_channel,
      send_messages: row.send_messages === null ? null : !!row.send_messages,
      upload_files: row.upload_files === null ? null : !!row.upload_files,
      add_reactions: row.add_reactions === null ? null : !!row.add_reactions,
      use_custom_emoji: row.use_custom_emoji === null ? null : !!row.use_custom_emoji,
      manage_messages: row.manage_messages === null ? null : !!row.manage_messages,
      pin_messages: row.pin_messages === null ? null : !!row.pin_messages,
      connect_voice: row.connect_voice === null ? null : !!row.connect_voice,
      speak: row.speak === null ? null : !!row.speak,
      share_screen: row.share_screen === null ? null : !!row.share_screen,
    }));
  });

  // Open or create a DM channel (NOT server-scoped)
  app.post<{ Body: { targetUserId: string } }>(
    '/api/dm',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { targetUserId } = request.body;

      if (!targetUserId) {
        return reply.code(400).send({ error: 'targetUserId is required' });
      }
      if (targetUserId === userId) {
        return reply.code(400).send({ error: 'Cannot DM yourself' });
      }

      // Check target user exists
      const targetUser = await getDb().queryOne<{ id: string; is_bot: number }>(
        'SELECT id, is_bot FROM users WHERE id = ?',
        [targetUserId],
      );
      if (!targetUser) {
        return reply.code(404).send({ error: 'User not found' });
      }
      if (targetUser.is_bot) {
        return reply.code(400).send({ error: 'Cannot message bots' });
      }

      // Check if DM channel already exists between the two users
      const existing = await getDb().queryOne<{ channel_id: string }>(
        `
      SELECT dp1.channel_id FROM dm_participants dp1
      JOIN dm_participants dp2 ON dp1.channel_id = dp2.channel_id
      JOIN channels c ON c.id = dp1.channel_id
      WHERE dp1.user_id = ? AND dp2.user_id = ? AND c.type = 'dm'
    `,
        [userId, targetUserId],
      );

      if (existing) {
        const channel = (await getDb().queryOne<Channel>(
          'SELECT * FROM channels WHERE id = ?',
          [existing.channel_id],
        ))!;
        channel.dm_participant_ids = [userId, targetUserId];
        channel.dm_participants = await getDmParticipants(channel.id);
        return channel;
      }

      // Create new DM channel
      const id = randomUUID();
      await getDb().run(
        "INSERT INTO channels (id, name, type, sort_order) VALUES (?, '', 'dm', 0)",
        [id],
      );
      await getDb().run(
        'INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)',
        [id, userId],
      );
      await getDb().run(
        'INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)',
        [id, targetUserId],
      );

      const channel = (await getDb().queryOne<Channel>(
        'SELECT * FROM channels WHERE id = ?',
        [id],
      ))!;
      channel.dm_participant_ids = [userId, targetUserId];
      channel.dm_participants = await getDmParticipants(channel.id);

      // Only notify the opener — recipient will see DM when first message arrives
      sendTo(userId, { type: 'dm:created', channel });

      reply.code(201);
      return channel;
    },
  );

  // Close/remove a DM channel for the requesting user (NOT server-scoped)
  app.delete<{ Params: { channelId: string } }>(
    '/api/dm/:channelId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { channelId } = request.params;

      // Verify the user is a participant
      const participant = await getDb().queryOne(
        'SELECT 1 FROM dm_participants WHERE channel_id = ? AND user_id = ?',
        [channelId, userId],
      );
      if (!participant) {
        return reply.code(404).send({ error: 'DM channel not found' });
      }

      // Remove the user's participation
      await getDb().run(
        'DELETE FROM dm_participants WHERE channel_id = ? AND user_id = ?',
        [channelId, userId],
      );

      // If no participants remain, delete the channel itself
      const remaining = await getDb().queryOne<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM dm_participants WHERE channel_id = ?',
        [channelId],
      );
      if (remaining!.cnt === 0) {
        await getDb().run('DELETE FROM messages WHERE channel_id = ?', [channelId]);
        await getDb().run('DELETE FROM channels WHERE id = ?', [channelId]);
      }

      return { ok: true };
    },
  );

  // List user's DM channels (NOT server-scoped)
  app.get('/api/dm', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.userId;

    const rows = await getDb().query<Channel & { last_message_at: string | null }>(
      `
      SELECT c.*, MAX(m.created_at) as last_message_at
      FROM channels c
      JOIN dm_participants dp ON dp.channel_id = c.id
      LEFT JOIN messages m ON m.channel_id = c.id
      WHERE dp.user_id = ? AND c.type = 'dm'
      GROUP BY c.id
      ORDER BY last_message_at DESC NULLS LAST
    `,
      [userId],
    );

    if (rows.length === 0) return [];

    // Batch load all participants for all DM channels in two queries
    const channelIds = rows.map((r) => r.id);
    const placeholders = channelIds.map(() => '?').join(',');

    const allParticipantIds = await getDb().query<{ channel_id: string; user_id: string }>(
      `SELECT channel_id, user_id FROM dm_participants WHERE channel_id IN (${placeholders})`,
      channelIds,
    );

    const allParticipantDetails = await getDb().query<{
      channel_id: string;
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
    }>(
      `SELECT dp.channel_id, u.id, u.username, u.display_name, u.avatar_url
       FROM dm_participants dp JOIN users u ON u.id = dp.user_id
       WHERE dp.channel_id IN (${placeholders})`,
      channelIds,
    );

    // Group by channel
    const idsMap = new Map<string, string[]>();
    for (const r of allParticipantIds) {
      if (!idsMap.has(r.channel_id)) idsMap.set(r.channel_id, []);
      idsMap.get(r.channel_id)!.push(r.user_id);
    }
    const detailsMap = new Map<
      string,
      { id: string; username: string; display_name: string; avatar_url: string | null }[]
    >();
    for (const r of allParticipantDetails) {
      if (!detailsMap.has(r.channel_id)) detailsMap.set(r.channel_id, []);
      detailsMap
        .get(r.channel_id)!
        .push({
          id: r.id,
          username: r.username,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
        });
    }

    return rows.map((row) => {
      const { last_message_at, ...channel } = row;
      channel.dm_participant_ids = idsMap.get(channel.id) ?? [];
      channel.dm_participants = detailsMap.get(channel.id) ?? [];
      return channel;
    });
  });
}

async function getDmParticipants(channelId: string) {
  return await getDb().query<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `
    SELECT u.id, u.username, u.display_name, u.avatar_url
    FROM dm_participants dp
    JOIN users u ON u.id = dp.user_id
    WHERE dp.channel_id = ?
  `,
    [channelId],
  );
}
