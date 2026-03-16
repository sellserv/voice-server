import type { FastifyInstance } from 'fastify';
import db from '../db/connection.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { hasPermission, invalidateChannelAccessCache } from '../auth/permissions.js';
import { broadcast, getClient } from '../ws/index.js';
import type { User } from '@voip-server/shared';

export default async function userRoutes(app: FastifyInstance) {
  // List users in a server (only members of that server)
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/users',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      const users = db
       .prepare(
         `SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.avatar_url, u.bio, u.banner_url, u.banned, u.created_at, u.is_bot,
               u.name_font, u.name_color,
               r.name as role_name, r.color as role_color,
               sm.nickname as server_nickname, sm.avatar_url as member_avatar_url
        FROM users u
        JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = ?         LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.is_bot = 0
            OR (u.is_bot = 1 AND EXISTS (SELECT 1 FROM bots b WHERE b.user_id = u.id AND b.enabled = 1))
         ORDER BY u.created_at`,
        )
        .all(serverId) as any[];

      // Attach role arrays for each user (scoped to this server's roles)
      const allUserRoles = db
        .prepare(
          `SELECT ur.user_id, r.id as role_id, r.name as role_name, r.color as role_color, r.position
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE r.server_id = ?
         ORDER BY r.position`,
        )
        .all(serverId) as {
        user_id: string;
        role_id: string;
        role_name: string;
        role_color: string;
        position: number;
      }[];

      const userRolesMap = new Map<
        string,
        { role_ids: string[]; role_names: string[]; role_colors: string[] }
      >();
      for (const ur of allUserRoles) {
        let entry = userRolesMap.get(ur.user_id);
        if (!entry) {
          entry = { role_ids: [], role_names: [], role_colors: [] };
          userRolesMap.set(ur.user_id, entry);
        }
        entry.role_ids.push(ur.role_id);
        entry.role_names.push(ur.role_name);
        entry.role_colors.push(ur.role_color);
      }

      for (const user of users) {
        const roles = userRolesMap.get(user.id);
        user.role_ids = roles?.role_ids ?? (user.role_id ? [user.role_id] : []);
        user.role_names = roles?.role_names ?? (user.role_name ? [user.role_name] : []);
        user.role_colors = roles?.role_colors ?? (user.role_color ? [user.role_color] : []);
        
        // Use server-specific avatar if set
        if (user.member_avatar_url) {
          user.avatar_url = user.member_avatar_url;
        }
      }

      return users;
    },
  );

  // Update user role (legacy — single role, kept for backward compat)
  app.patch<{ Params: { serverId: string; id: string }; Body: { role?: string; role_id?: string } }>(
    '/api/servers/:serverId/users/:id/role',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const { id } = request.params;
      const serverId = getServerId(request);
      const { role, role_id } = request.body;

      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Verify user is a member of this server
      const member = db.prepare(
        'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
      ).get(serverId, id);
      if (!member) {
        return reply.code(404).send({ error: 'User is not a member of this server' });
      }

      if (role_id) {
        const roleRow = db
          .prepare('SELECT id, permissions FROM roles WHERE id = ? AND server_id = ?')
          .get(role_id, serverId) as { id: string; permissions: string } | undefined;
        if (!roleRow) {
          return reply.code(400).send({ error: 'Role not found' });
        }
        try {
          const targetPerms = JSON.parse(roleRow.permissions);
          if (targetPerms.administrator && !hasPermission(request.user.userId, 'administrator')) {
            return reply
              .code(403)
              .send({
                error: 'Only administrators can assign roles with administrator permission',
              });
          }
        } catch {}
        db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role_id, id);
        // Sync user_roles junction table (only for this server's roles)
        db.prepare(
          `DELETE FROM user_roles WHERE user_id = ? AND role_id IN (SELECT id FROM roles WHERE server_id = ?)`,
        ).run(id, serverId);
        db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, role_id);
      }

      invalidateChannelAccessCache();
      broadcast({ type: 'user:updated', userId: id });
      return { ok: true };
    },
  );

  // Update user roles (multi-role assignment)
  app.put<{ Params: { serverId: string; id: string }; Body: { role_ids: string[]; main_role_id?: string } }>(
    '/api/servers/:serverId/users/:id/roles',
    { preHandler: [requirePermission('manage_roles'), requireServerMember] },
    async (request, reply) => {
      const { id } = request.params;
      const serverId = getServerId(request);
      const { role_ids, main_role_id } = request.body;

      if (!Array.isArray(role_ids) || role_ids.length === 0) {
        return reply.code(400).send({ error: 'At least one role is required' });
      }

      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Verify user is a member of this server
      const member = db.prepare(
        'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
      ).get(serverId, id);
      if (!member) {
        return reply.code(404).send({ error: 'User is not a member of this server' });
      }

      // Filter to only roles that belong to this server (client may send cross-server role IDs)
      const validRoleIds: string[] = [];
      for (const roleId of role_ids) {
        const roleRow = db.prepare('SELECT id, permissions FROM roles WHERE id = ? AND server_id = ?').get(roleId, serverId) as
          | { id: string; permissions: string }
          | undefined;
        if (!roleRow) continue; // Skip roles from other servers
        try {
          const targetPerms = JSON.parse(roleRow.permissions);
          if (targetPerms.administrator && !hasPermission(request.user.userId, 'administrator')) {
            return reply
              .code(403)
              .send({
                error: 'Only administrators can assign roles with administrator permission',
              });
          }
        } catch {}
        validRoleIds.push(roleId);
      }

      if (validRoleIds.length === 0) {
        return reply.code(400).send({ error: 'No valid roles for this server' });
      }

      db.transaction(() => {
        // Replace user roles for this server only (preserve roles from other servers)
        db.prepare(
          `DELETE FROM user_roles WHERE user_id = ? AND role_id IN (SELECT id FROM roles WHERE server_id = ?)`,
        ).run(id, serverId);
        const insert = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
        for (const roleId of validRoleIds) {
          insert.run(id, roleId);
        }

        // Set display role: use main_role_id if provided and valid, otherwise auto-calculate
        let displayRoleId: string | undefined;
        if (main_role_id && validRoleIds.includes(main_role_id)) {
          displayRoleId = main_role_id;
        } else {
          const autoRole = db
            .prepare(
              `SELECT r.id FROM roles r
             JOIN user_roles ur ON ur.role_id = r.id
             WHERE ur.user_id = ?
             ORDER BY r.position ASC LIMIT 1`,
            )
            .get(id) as { id: string } | undefined;
          displayRoleId = autoRole?.id;
        }

        if (displayRoleId) {
          db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(displayRoleId, id);
        }
      })();

      invalidateChannelAccessCache();
      broadcast({ type: 'user:updated', userId: id });
      return { ok: true };
    },
  );

  // Update own profile (display name and/or avatar) — GLOBAL, not server-scoped
  app.patch<{
    Body: {
      display_name?: string;
      avatar_url?: string | null;
      bio?: string;
      banner_url?: string | null;
      name_font?: string | null;
      name_color?: string | null;
    };
  }>('/api/users/me', { preHandler: requireAuth }, async (request, reply) => {
    const { display_name, avatar_url, bio, banner_url, name_font, name_color } = request.body;

    if (display_name !== undefined) {
      if (!hasPermission(request.user.userId, 'change_nickname')) {
        return reply
          .code(403)
          .send({ error: 'You do not have permission to change your nickname' });
      }
      if (display_name.length < 1 || display_name.length > 32) {
        return reply.code(400).send({ error: 'Display name must be 1-32 characters' });
      }
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(
        display_name,
        request.user.userId,
      );
    }

    if (avatar_url !== undefined) {
      // Only allow null (to clear) or valid /uploads/ paths that exist in files table
      if (avatar_url !== null) {
        if (
          typeof avatar_url !== 'string' ||
          !avatar_url.startsWith('/uploads/') ||
          avatar_url.length > 255
        ) {
          return reply
            .code(400)
            .send({ error: 'Invalid avatar URL — must be an uploaded file path' });
        }
        const storedName = avatar_url.replace('/uploads/', '');
        const file = db
          .prepare('SELECT id FROM files WHERE stored_name = ? AND user_id = ?')
          .get(storedName, request.user.userId);
        if (!file) {
          return reply.code(400).send({ error: 'File not found or not owned by you' });
        }
      }
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(
        avatar_url,
        request.user.userId,
      );
    }

    if (bio !== undefined) {
      if (typeof bio !== 'string' || bio.length > 190) {
        return reply.code(400).send({ error: 'Bio must be at most 190 characters' });
      }
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, request.user.userId);
    }

    if (banner_url !== undefined) {
      if (banner_url !== null) {
        if (typeof banner_url !== 'string' || banner_url.length > 512) {
          return reply.code(400).send({ error: 'Invalid banner URL' });
        }
        // Allow GIPHY URLs
        const isGiphy = /^https:\/\/(media\d?|i)\.giphy\.com\//.test(banner_url);
        if (isGiphy) {
          // valid external URL, no further check needed
        } else if (banner_url.startsWith('/uploads/')) {
          const storedName = banner_url.replace('/uploads/', '');
          const file = db
            .prepare('SELECT id FROM files WHERE stored_name = ? AND user_id = ?')
            .get(storedName, request.user.userId);
          if (!file) {
            return reply.code(400).send({ error: 'File not found or not owned by you' });
          }
        } else {
          return reply
            .code(400)
            .send({ error: 'Invalid banner URL — must be an uploaded file or GIPHY URL' });
        }
      }
      db.prepare('UPDATE users SET banner_url = ? WHERE id = ?').run(
        banner_url,
        request.user.userId,
      );
    }

    if (name_font !== undefined) {
      const allowedFonts = [
        null,
        "'Permanent Marker', cursive",
        "'Press Start 2P', monospace",
        "'Pacifico', cursive",
        "'Bangers', cursive",
        "'Creepster', cursive",
        "'Fredoka', sans-serif",
        "'Caveat', cursive",
        "'Special Elite', monospace",
        "'Orbitron', sans-serif",
        "'Silkscreen', monospace",
        "'Bebas Neue', sans-serif",
        "'Righteous', sans-serif",
      ];
      if (name_font !== null && !allowedFonts.includes(name_font)) {
        return reply.code(400).send({ error: 'Invalid font selection' });
      }
      db.prepare('UPDATE users SET name_font = ? WHERE id = ?').run(name_font, request.user.userId);
    }

    if (name_color !== undefined) {
      if (name_color !== null) {
        const hexPattern = /^#[0-9a-fA-F]{6}$/;
        const gradientPattern = /^gradient:#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}$/;
        if (typeof name_color !== 'string' || (!hexPattern.test(name_color) && !gradientPattern.test(name_color))) {
          return reply.code(400).send({ error: 'Invalid color — must be #rrggbb or gradient:#rrggbb,#rrggbb' });
        }
      }
      db.prepare('UPDATE users SET name_color = ? WHERE id = ?').run(
        name_color,
        request.user.userId,
      );
    }

    // Update the in-memory client cache so presence/voice events use new data
    const client = getClient(request.user.userId);
    if (client) {
      if (display_name !== undefined) client.display_name = display_name;
      if (avatar_url !== undefined) client.avatar_url = avatar_url;
    }

    broadcast({ type: 'user:updated', userId: request.user.userId });

    const user = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.role, u.role_id, u.avatar_url, u.bio, u.banner_url, u.name_font, u.name_color, u.totp_enabled, u.created_at, u.email, u.mfa_method,
                r.name as role_name, r.color as role_color
         FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(request.user.userId) as any;

    // Attach role arrays
    const userRoles = db
      .prepare(
        `SELECT r.id as role_id, r.name as role_name, r.color as role_color
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? ORDER BY r.position`,
      )
      .all(request.user.userId) as { role_id: string; role_name: string; role_color: string }[];

    user.role_ids = userRoles.map((r) => r.role_id);
    user.role_names = userRoles.map((r) => r.role_name);
    user.role_colors = userRoles.map((r) => r.role_color);

    return user;
  });
}
