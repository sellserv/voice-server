import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { hasPermission, invalidateChannelAccessCache } from '../auth/permissions.js';
import type { RolePermissions } from '@voip-server/shared';
import { logAuditEvent } from '../audit/log.js';
import { broadcast } from '../ws/index.js';

let rolesCache: any[] | null = null;

function invalidateRolesCache() {
  rolesCache = null;
}

const VALID_PERMISSIONS: (keyof RolePermissions)[] = [
  'manage_channels',
  'manage_roles',
  'ban_members',
  'manage_messages',
  'manage_invite_codes',
  'create_invites',
  'manage_soundboard',
  'manage_emojis',
  'administrator',
  'send_messages',
  'upload_files',
  'add_reactions',
  'connect_voice',
  'speak',
  'share_screen',
  'use_custom_emoji',
  'change_nickname',
  'pin_messages',
  'manage_channel_groups',
  'view_channel',
  'use_apps',
  'view_audit_log',
  'manage_bots',
  'manage_server',
];

function parsePermissions(row: any) {
  return {
    ...row,
    permissions: JSON.parse(row.permissions),
    is_default: !!row.is_default,
  };
}

export default async function roleRoutes(app: FastifyInstance) {
  // List all roles — server-scoped
  app.get('/api/servers/:serverId/roles', { preHandler: [requireAuth, requireServerMember] }, async (request) => {
    const serverId = getServerId(request);
    const rows = db.prepare('SELECT * FROM roles WHERE server_id = ? ORDER BY position').all(serverId) as any[];
    return rows.map(parsePermissions);
  });

  // Create role — server-scoped
  app.post<{ Body: { name: string; color?: string; permissions?: Partial<RolePermissions> } }>(
    '/api/servers/:serverId/roles',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { name, color, permissions } = request.body;

      if (!name || name.length < 1 || name.length > 32) {
        return reply.code(400).send({ error: 'Role name must be 1-32 characters' });
      }

      const existing = db.prepare('SELECT id FROM roles WHERE name = ? AND server_id = ?').get(name, serverId);
      if (existing) {
        return reply.code(400).send({ error: 'Role name already exists' });
      }

      // Only administrators can grant the administrator permission
      if (permissions?.administrator && !hasPermission(request.user.userId, 'administrator')) {
        return reply
          .code(403)
          .send({ error: 'Only administrators can grant the administrator permission' });
      }

      // Validate color format
      if (
        color !== undefined &&
        color !== null &&
        !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)
      ) {
        return reply.code(400).send({ error: 'Color must be a valid hex color (e.g. #ff0000)' });
      }

      const maxPos = db.prepare('SELECT MAX(position) as m FROM roles WHERE server_id = ?').get(serverId) as {
        m: number | null;
      };
      const id = randomUUID();
      const permsObj: Record<string, boolean> = {};
      for (const key of VALID_PERMISSIONS) {
        permsObj[key as string] = permissions?.[key] ?? false;
      }

      db.prepare(
        'INSERT INTO roles (id, name, color, position, permissions, is_default, server_id) VALUES (?, ?, ?, ?, ?, 0, ?)',
      ).run(id, name, color || '#99aab5', (maxPos.m ?? -1) + 1, JSON.stringify(permsObj), serverId);
      invalidateRolesCache();

      const row = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
      invalidateChannelAccessCache();
      logAuditEvent('role_change', request.user.userId, id, request.ip, { action: 'create', name });
      const role = parsePermissions(row);
      broadcast({ type: 'role:created', role });
      return reply.code(201).send(role);
    },
  );

  // Reorder roles — server-scoped
  app.put<{ Body: { order: string[] } }>(
    '/api/servers/:serverId/roles/reorder',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { order } = request.body;
      if (!Array.isArray(order)) {
        return reply.code(400).send({ error: 'order must be an array of role IDs' });
      }

      const update = db.prepare('UPDATE roles SET position = ? WHERE id = ? AND server_id = ?');
      const txn = db.transaction(() => {
        order.forEach((id, i) => update.run(i, id, serverId));
      });
      txn();
      invalidateRolesCache();

      const rows = db.prepare('SELECT * FROM roles WHERE server_id = ? ORDER BY position').all(serverId) as any[];
      const roles = rows.map(parsePermissions);
      broadcast({ type: 'roles:reordered', roles });

      return { ok: true };
    },
  );

  // Set default role — server-scoped
  app.put<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/roles/:id/default',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;

      const existing = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(id, serverId) as any;
      if (!existing) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      const txn = db.transaction(() => {
        db.prepare('UPDATE roles SET is_default = 0 WHERE server_id = ?').run(serverId);
        db.prepare('UPDATE roles SET is_default = 1 WHERE id = ? AND server_id = ?').run(id, serverId);
      });
      txn();
      invalidateRolesCache();

      const updated = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
      const result = parsePermissions(updated);
      // Broadcast all roles since is_default changed on multiple
      const allRows = db.prepare('SELECT * FROM roles WHERE server_id = ? ORDER BY position').all(serverId) as any[];
      broadcast({ type: 'roles:reordered', roles: allRows.map(parsePermissions) });
      return result;
    },
  );

  // Update role — server-scoped
  app.put<{
    Params: { serverId: string; id: string };
    Body: { name?: string; color?: string; permissions?: Partial<RolePermissions> };
  }>(
    '/api/servers/:serverId/roles/:id',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;
      const { name, color, permissions } = request.body;

      const existingRole = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(id, serverId) as any;
      if (!existingRole) {
        return reply.code(404).send({ error: 'Role not found' });
      }

      if (name !== undefined) {
        if (name.length < 1 || name.length > 32) {
          return reply.code(400).send({ error: 'Role name must be 1-32 characters' });
        }
        const dup = db.prepare('SELECT id FROM roles WHERE name = ? AND id != ? AND server_id = ?').get(name, id, serverId);
        if (dup) {
          return reply.code(400).send({ error: 'Role name already exists' });
        }
        db.prepare('UPDATE roles SET name = ? WHERE id = ? AND server_id = ?').run(name, id, serverId);
      }

      if (color !== undefined) {
        if (color !== null && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
          return reply.code(400).send({ error: 'Color must be a valid hex color (e.g. #ff0000)' });
        }
        db.prepare('UPDATE roles SET color = ? WHERE id = ? AND server_id = ?').run(color, id, serverId);
      }

      if (permissions !== undefined) {
        // Only administrators can grant the administrator permission
        if (permissions.administrator && !hasPermission(request.user.userId, 'administrator')) {
          return reply
            .code(403)
            .send({ error: 'Only administrators can grant the administrator permission' });
        }
        const existingPerms = JSON.parse(existingRole.permissions);
        for (const key of VALID_PERMISSIONS) {
          if (permissions[key] !== undefined) {
            existingPerms[key] = permissions[key];
          }
        }
        db.prepare('UPDATE roles SET permissions = ? WHERE id = ? AND server_id = ?').run(
          JSON.stringify(existingPerms),
          id,
          serverId,
        );
      }
      invalidateRolesCache();

      const updated = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
      invalidateChannelAccessCache();
      logAuditEvent('role_change', request.user.userId, id, request.ip, { action: 'update' });
      const updatedRole = parsePermissions(updated);
      broadcast({ type: 'role:updated', role: updatedRole });
      return updatedRole;
    },
  );

  // Delete role (cannot delete default role) — server-scoped
  app.delete<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/roles/:id',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;

      const role = db.prepare('SELECT * FROM roles WHERE id = ? AND server_id = ?').get(id, serverId) as any;
      if (!role) {
        return reply.code(404).send({ error: 'Role not found' });
      }
      if (role.is_default) {
        return reply.code(400).send({ error: 'Cannot delete the default role' });
      }

      // Remove this role from user_roles junction table
      const affectedUsers = db
        .prepare('SELECT user_id FROM user_roles WHERE role_id = ?')
        .all(id) as { user_id: string }[];
      db.prepare('DELETE FROM user_roles WHERE role_id = ?').run(id);

      // For users who now have no roles, assign the default role
      const defaultRole = db.prepare('SELECT id FROM roles WHERE is_default = 1 AND server_id = ?').get(serverId) as
        | { id: string }
        | undefined;
      if (defaultRole && affectedUsers.length > 0) {
        // Batch: find users who now have no roles and assign default
        const placeholders = affectedUsers.map(() => '?').join(',');
        const userIds = affectedUsers.map((u) => u.user_id);
        const usersWithRoles = new Set(
          (db.prepare(`SELECT DISTINCT user_id FROM user_roles WHERE user_id IN (${placeholders})`).all(...userIds) as { user_id: string }[])
            .map((r) => r.user_id),
        );
        const insertDefault = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
        for (const { user_id } of affectedUsers) {
          if (!usersWithRoles.has(user_id)) {
            insertDefault.run(user_id, defaultRole.id);
          }
        }
      }

      // Batch recalculate display role for affected users
      if (affectedUsers.length > 0) {
        const updateStmt = db.prepare('UPDATE users SET role_id = ? WHERE id = ?');
        const topRoleStmt = db.prepare(
          `SELECT r.id FROM roles r
           JOIN user_roles ur ON ur.role_id = r.id
           WHERE ur.user_id = ?
           ORDER BY r.position ASC LIMIT 1`,
        );
        for (const { user_id } of affectedUsers) {
          const topRole = topRoleStmt.get(user_id) as { id: string } | undefined;
          updateStmt.run(topRole?.id ?? defaultRole?.id ?? null, user_id);
        }
      }

      db.prepare('DELETE FROM roles WHERE id = ? AND server_id = ?').run(id, serverId);
      invalidateRolesCache();
      invalidateChannelAccessCache();
      logAuditEvent('role_change', request.user.userId, id, request.ip, { action: 'delete' });
      broadcast({ type: 'role:deleted', roleId: id });
      return { ok: true };
    },
  );
}
