import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import type { ChannelGroup, GroupPermissionOverride } from '@voip-server/shared';
import { broadcast, broadcastToServer, broadcastChannelAccessChange, invalidateChannelCache } from '../ws/index.js';
import {
  hasPermission,
  getUsersWithChannelAccess,
  invalidateChannelAccessCache,
  getUserRoleIds,
} from '../auth/permissions.js';
import { logAuditEvent } from '../audit/log.js';

function toChannelGroup(row: any): ChannelGroup {
  return { ...row, permissions_enabled: !!row.permissions_enabled };
}

function getGroupOverrides(groupId: string): GroupPermissionOverride[] {
  const rows = db
    .prepare('SELECT * FROM group_permission_overrides WHERE group_id = ?')
    .all(groupId) as any[];
  return rows.map((row) => ({
    id: row.id,
    group_id: row.group_id,
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

function getChannelsInGroup(groupId: string): { id: string }[] {
  return db.prepare('SELECT id FROM channels WHERE group_id = ?').all(groupId) as { id: string }[];
}

function invalidateGroupChannelCaches(groupId: string) {
  const channels = getChannelsInGroup(groupId);
  for (const ch of channels) {
    invalidateChannelCache(ch.id);
    invalidateChannelAccessCache(ch.id);
  }
}

export default async function channelGroupRoutes(app: FastifyInstance) {
  // List all channel groups (auth only) — server-scoped
  app.get('/api/servers/:serverId/channel-groups', { preHandler: [requireAuth, requireServerMember] }, async (request) => {
    const serverId = getServerId(request);
    const rows = db.prepare('SELECT * FROM channel_groups WHERE server_id = ? ORDER BY sort_order, created_at').all(serverId);
    return rows.map(toChannelGroup);
  });

  // Create channel group — server-scoped
  app.post<{ Body: { name: string } }>(
    '/api/servers/:serverId/channel-groups',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { name } = request.body;

      if (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32) {
        return reply.code(400).send({ error: 'Group name must be 1-32 characters' });
      }

      const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM channel_groups WHERE server_id = ?').get(serverId) as {
        m: number | null;
      };
      const id = randomUUID();

      db.prepare('INSERT INTO channel_groups (id, name, sort_order, server_id) VALUES (?, ?, ?, ?)').run(
        id,
        name.trim(),
        (maxOrder.m ?? -1) + 1,
        serverId,
      );

      const group = toChannelGroup(db.prepare('SELECT * FROM channel_groups WHERE id = ?').get(id));
      broadcastToServer(serverId, { type: 'channelGroup:created', group, serverId });

      reply.code(201);
      return group;
    },
  );

  // Update channel group (name, permissions_enabled) — server-scoped
  app.patch<{ Params: { serverId: string; id: string }; Body: { name?: string; permissions_enabled?: boolean } }>(
    '/api/servers/:serverId/channel-groups/:id',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const { name, permissions_enabled } = request.body;

      if (
        name !== undefined &&
        (!name || typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 32)
      ) {
        return reply.code(400).send({ error: 'Group name must be 1-32 characters' });
      }

      const existing = db.prepare('SELECT * FROM channel_groups WHERE id = ? AND server_id = ?').get(id, serverId);
      if (!existing) {
        return reply.code(404).send({ error: 'Channel group not found' });
      }

      if (name !== undefined) {
        db.prepare('UPDATE channel_groups SET name = ? WHERE id = ? AND server_id = ?').run(name.trim(), id, serverId);
      }

      if (permissions_enabled !== undefined) {
        db.prepare('UPDATE channel_groups SET permissions_enabled = ? WHERE id = ? AND server_id = ?').run(
          permissions_enabled ? 1 : 0,
          id,
          serverId,
        );

        // Invalidate caches for all channels in the group since permission resolution changed
        invalidateGroupChannelCaches(id);

        // Broadcast access changes for all channels in the group
        const groupChannels = getChannelsInGroup(id);
        for (const ch of groupChannels) {
          const afterUsers = getUsersWithChannelAccess(ch.id);
          const afterSet = afterUsers.length > 0 ? new Set(afterUsers) : null;
          const channelData = db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id) as any;
          broadcastChannelAccessChange(ch.id, null, afterSet, channelData);
        }
      }

      const raw = db.prepare('SELECT * FROM channel_groups WHERE id = ?').get(id) as any;
      const group: ChannelGroup = { ...raw, permissions_enabled: !!raw.permissions_enabled };
      broadcastToServer(serverId, { type: 'channelGroup:updated', group, serverId });

      return group;
    },
  );

  // Delete channel group (channels become ungrouped) — server-scoped
  app.delete<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/channel-groups/:id',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;

      const existing = db.prepare('SELECT * FROM channel_groups WHERE id = ? AND server_id = ?').get(id, serverId);
      if (!existing) {
        return reply.code(404).send({ error: 'Channel group not found' });
      }

      db.prepare('DELETE FROM channel_groups WHERE id = ? AND server_id = ?').run(id, serverId);
      broadcastToServer(serverId, { type: 'channelGroup:deleted', groupId: id, serverId });

      return { ok: true };
    },
  );

  // Reorder channel groups — server-scoped
  app.put<{ Body: { order: string[] } }>(
    '/api/servers/:serverId/channel-groups/reorder',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { order } = request.body;
      if (!Array.isArray(order)) {
        return reply.code(400).send({ error: 'order must be an array of group IDs' });
      }

      const update = db.prepare('UPDATE channel_groups SET sort_order = ? WHERE id = ? AND server_id = ?');
      const txn = db.transaction(() => {
        order.forEach((id, i) => update.run(i, id, serverId));
      });
      txn();

      broadcastToServer(serverId, { type: 'channelGroups:reordered', order, serverId });

      return { ok: true };
    },
  );

  // ─── Group Permission Overrides ───

  // Get all overrides for a group — server-scoped
  app.get<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/channel-groups/:id/permissions',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const group = db.prepare('SELECT id FROM channel_groups WHERE id = ? AND server_id = ?').get(id, serverId);
      if (!group) {
        return reply.code(404).send({ error: 'Channel group not found' });
      }
      return getGroupOverrides(id);
    },
  );

  // Create or update an override for a group — server-scoped
  app.put<{
    Params: { serverId: string; id: string };
    Body: {
      target_type: 'role' | 'user';
      target_id: string;
      permissions: Record<string, boolean | null>;
    };
  }>(
    '/api/servers/:serverId/channel-groups/:id/permissions',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
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

      const group = db.prepare('SELECT id FROM channel_groups WHERE id = ? AND server_id = ?').get(id, serverId);
      if (!group) {
        return reply.code(404).send({ error: 'Channel group not found' });
      }

      // Validate target exists
      if (target_type === 'role') {
        const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(target_id);
        if (!role) return reply.code(400).send({ error: 'Role not found' });
      } else {
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(target_id);
        if (!user) return reply.code(400).send({ error: 'User not found' });
      }

      // Compute "before" access for all channels in this group
      const groupChannels = getChannelsInGroup(id);
      const beforeSets = new Map<string, Set<string> | null>();
      for (const ch of groupChannels) {
        const users = getUsersWithChannelAccess(ch.id);
        beforeSets.set(ch.id, users.length > 0 ? new Set(users) : null);
      }

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
      const existing = db
        .prepare(
          'SELECT id FROM group_permission_overrides WHERE group_id = ? AND target_type = ? AND target_id = ?',
        )
        .get(id, target_type, target_id) as { id: string } | undefined;

      if (existing) {
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
          db.prepare(`UPDATE group_permission_overrides SET ${sets.join(', ')} WHERE id = ?`).run(
            ...values,
          );
        }
      } else {
        const overrideId = randomUUID();
        const cols = ['id', 'group_id', 'target_type', 'target_id'];
        const vals: (string | number | null)[] = [overrideId, id, target_type, target_id];

        for (const col of PERM_COLS) {
          cols.push(col);
          const val = permissions[col];
          vals.push(val === undefined || val === null ? null : val ? 1 : 0);
        }

        const placeholders = cols.map(() => '?').join(', ');
        db.prepare(
          `INSERT INTO group_permission_overrides (${cols.join(', ')}) VALUES (${placeholders})`,
        ).run(...vals);
      }

      // Invalidate caches for all channels in the group
      invalidateGroupChannelCaches(id);

      // If view_channel was affected, broadcast access changes for all channels in the group
      if ('view_channel' in permissions) {
        for (const ch of groupChannels) {
          const afterUsers = getUsersWithChannelAccess(ch.id);
          const afterSet = afterUsers.length > 0 ? new Set(afterUsers) : null;
          const channelData = db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id) as any;
          broadcastChannelAccessChange(ch.id, beforeSets.get(ch.id) ?? null, afterSet, channelData);
        }
      }

      logAuditEvent('permission_change', request.user.userId, id, request.ip, {
        action: 'set_group',
        targetType: target_type,
        targetId: target_id,
      });

      // Broadcast group overrides update
      const overrides = getGroupOverrides(id);
      broadcast({ type: 'groupOverrides:updated', groupId: id, overrides });

      return overrides;
    },
  );

  // Delete a specific group override — server-scoped
  app.delete<{ Params: { serverId: string; id: string; targetType: string; targetId: string } }>(
    '/api/servers/:serverId/channel-groups/:id/permissions/:targetType/:targetId',
    { preHandler: [requirePermission('manage_channel_groups'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id, targetType, targetId } = request.params;

      if (!['role', 'user'].includes(targetType)) {
        return reply.code(400).send({ error: 'targetType must be "role" or "user"' });
      }

      const group = db.prepare('SELECT id FROM channel_groups WHERE id = ? AND server_id = ?').get(id, serverId);
      if (!group) {
        return reply.code(404).send({ error: 'Channel group not found' });
      }

      // Compute "before" access for all channels in this group
      const groupChannels = getChannelsInGroup(id);
      const beforeSets = new Map<string, Set<string> | null>();
      for (const ch of groupChannels) {
        const users = getUsersWithChannelAccess(ch.id);
        beforeSets.set(ch.id, users.length > 0 ? new Set(users) : null);
      }

      db.prepare(
        'DELETE FROM group_permission_overrides WHERE group_id = ? AND target_type = ? AND target_id = ?',
      ).run(id, targetType, targetId);

      // Invalidate caches for all channels in the group
      invalidateGroupChannelCaches(id);

      // Broadcast access changes for all channels in the group
      for (const ch of groupChannels) {
        const afterUsers = getUsersWithChannelAccess(ch.id);
        const afterSet = afterUsers.length > 0 ? new Set(afterUsers) : null;
        const channelData = db.prepare('SELECT * FROM channels WHERE id = ?').get(ch.id) as any;
        broadcastChannelAccessChange(ch.id, beforeSets.get(ch.id) ?? null, afterSet, channelData);
      }

      logAuditEvent('permission_change', request.user.userId, id, request.ip, {
        action: 'delete_group',
        targetType,
        targetId,
      });

      // Broadcast group overrides update
      const overrides = getGroupOverrides(id);
      broadcast({ type: 'groupOverrides:updated', groupId: id, overrides });

      return { ok: true };
    },
  );

  // Bulk get group overrides — server-scoped
  app.get('/api/servers/:serverId/group-overrides', { preHandler: [requireAuth, requireServerMember] }, async (request) => {
    const serverId = getServerId(request);
    const userId = request.user.userId;
    const canManage =
      hasPermission(userId, 'manage_channel_groups') || hasPermission(userId, 'administrator');

    let rows: any[];
    if (canManage) {
      rows = db.prepare(
        `SELECT gpo.* FROM group_permission_overrides gpo
         JOIN channel_groups cg ON cg.id = gpo.group_id
         WHERE cg.server_id = ?`
      ).all(serverId) as any[];
    } else {
      const roleIds = getUserRoleIds(userId);
      if (roleIds.length > 0) {
        const placeholders = roleIds.map(() => '?').join(',');
        rows = db
          .prepare(
            `SELECT gpo.* FROM group_permission_overrides gpo
             JOIN channel_groups cg ON cg.id = gpo.group_id
             WHERE cg.server_id = ?
               AND ((gpo.target_type = 'user' AND gpo.target_id = ?)
                 OR (gpo.target_type = 'role' AND gpo.target_id IN (${placeholders})))`,
          )
          .all(serverId, userId, ...roleIds) as any[];
      } else {
        rows = db
          .prepare(
            `SELECT gpo.* FROM group_permission_overrides gpo
             JOIN channel_groups cg ON cg.id = gpo.group_id
             WHERE cg.server_id = ?
               AND gpo.target_type = 'user' AND gpo.target_id = ?`,
          )
          .all(serverId, userId) as any[];
      }
    }

    return rows.map((row) => ({
      id: row.id,
      group_id: row.group_id,
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
}
