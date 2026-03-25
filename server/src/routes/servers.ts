import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { requireAuth, isInstanceAdmin } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { hasPermission } from '../auth/permissions.js';
import { sendTo, sendToMany, getServerMemberUserIds } from '../ws/index.js';
import { ensureDmChannel, notifyDmCreated } from '../ws/dmUtils.js';
import { sendWelcomeMessages } from '../bots/welcomeBot.js';
import type { Server, ServerInvitation, Message } from '@voip-server/shared';

const ALL_PERMISSIONS = JSON.stringify({
  manage_channels_groups: true,
  manage_roles: true,
  ban_members: true,
  manage_messages: true,
  manage_invite_codes: true,
  manage_soundboard: true,
  manage_emojis: true,
  administrator: true,
  send_messages: true,
  upload_files: true,
  add_reactions: true,
  connect_voice: true,
  speak: true,
  share_screen: true,
  use_custom_emoji: true,
  change_nickname: true,
  pin_messages: true,
  view_channel: true,
  use_apps: true,
  view_audit_log: true,
  manage_bots: true,
  manage_server: true,
});

const MEMBER_PERMISSIONS = JSON.stringify({
  manage_channels_groups: false,
  manage_roles: false,
  ban_members: false,
  manage_messages: false,
  manage_invite_codes: false,
  manage_soundboard: false,
  manage_emojis: false,
  administrator: false,
  send_messages: true,
  upload_files: true,
  add_reactions: true,
  connect_voice: true,
  speak: true,
  share_screen: true,
  use_custom_emoji: true,
  change_nickname: true,
  pin_messages: false,
  view_channel: true,
  use_apps: false,
  view_audit_log: false,
  manage_bots: false,
  manage_server: false,
});

function getServerMemberUserIds(serverId: string): string[] {
  const rows = db
    .prepare('SELECT user_id FROM server_members WHERE server_id = ?')
    .all(serverId) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export default async function serverRoutes(app: FastifyInstance) {
  // List servers the user is a member of
  app.get('/api/servers', { preHandler: requireAuth }, async (request) => {
    const userId = request.user.userId;
    const rows = db
      .prepare(
        `SELECT servers.*, sm.notification_level, COUNT(sm2.user_id) as member_count, f.stored_name as icon_stored_name
         FROM servers
         JOIN server_members sm ON sm.server_id = servers.id AND sm.user_id = ?
         LEFT JOIN server_members sm2 ON sm2.server_id = servers.id
         LEFT JOIN files f ON f.id = servers.icon_file_id
         GROUP BY servers.id`,
      )
      .all(userId) as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      icon_file_id: row.icon_file_id,
      icon_url: row.icon_stored_name ? '/uploads/' + row.icon_stored_name : null,
      owner_id: row.owner_id,
      member_count: row.member_count,
      created_at: row.created_at,
      notification_level: row.notification_level || 'default',
    })) as Server[];
  });

  // Create a new server
  app.post<{ Body: { name: string; icon_file_id?: string } }>(
    '/api/servers',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;

      // Check instance_settings.allow_server_creation
      const settings = db
        .prepare('SELECT allow_server_creation FROM instance_settings WHERE id = 1')
        .get() as { allow_server_creation: number } | undefined;
      if (settings && !settings.allow_server_creation) {
        // Only instance admins can create servers when disabled
        if (!isInstanceAdmin(request.user.username) && !hasPermission(userId, 'administrator')) {
          return reply.code(403).send({ error: 'Server creation is disabled' });
        }
      }

      const { name, icon_file_id } = request.body;
      if (!name || typeof name !== 'string' || name.trim().length < 1) {
        return reply.code(400).send({ error: 'Server name is required' });
      }
      if (name.trim().length > 100) {
        return reply.code(400).send({ error: 'Server name must be 100 characters or less' });
      }

      const serverId = randomUUID();
      const adminRoleId = randomUUID();
      const memberRoleId = randomUUID();
      const generalChannelId = randomUUID();
      const voiceChannelId = randomUUID();

      const user = db
        .prepare('SELECT username FROM users WHERE id = ?')
        .get(userId) as { username: string };

      const createServer = db.transaction(() => {
        // Create the server
        db.prepare(
          'INSERT INTO servers (id, name, icon_file_id, owner_id) VALUES (?, ?, ?, ?)',
        ).run(serverId, name.trim(), icon_file_id || null, userId);

        // Create default roles
        db.prepare(
          'INSERT INTO roles (id, name, color, position, permissions, is_default, server_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(adminRoleId, 'Admin', '#e74c3c', 0, ALL_PERMISSIONS, 0, serverId);
        db.prepare(
          'INSERT INTO roles (id, name, color, position, permissions, is_default, server_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(memberRoleId, 'Member', '#99aab5', 1, MEMBER_PERMISSIONS, 1, serverId);

        // Create default channels
        db.prepare(
          'INSERT INTO channels (id, name, type, sort_order, server_id) VALUES (?, ?, ?, ?, ?)',
        ).run(generalChannelId, 'general', 'text', 0, serverId);
        db.prepare(
          'INSERT INTO channels (id, name, type, sort_order, server_id) VALUES (?, ?, ?, ?, ?)',
        ).run(voiceChannelId, 'General Voice', 'voice', 1, serverId);

        // Add creator as server member
        db.prepare(
          'INSERT INTO server_members (server_id, user_id) VALUES (?, ?)',
        ).run(serverId, userId);

        // Assign creator the Admin role
        db.prepare(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        ).run(userId, adminRoleId);

        // Create welcome bot for this server
        const botUser = db.prepare("SELECT id FROM users WHERE id = 'bot-welcome'").get();
        if (botUser) {
          const botId = randomUUID();
          db.prepare(
            "INSERT INTO bots (id, user_id, type, name, enabled, greeting, server_id, created_at) VALUES (?, 'bot-welcome', 'welcome', 'Welcome Bot', 0, 'Welcome to the server, {user}! 👋', ?, datetime('now'))",
          ).run(botId, serverId);
        }
      });
      createServer();

      // Broadcast to the creator
      sendToMany([userId], {
        type: 'server:memberJoined',
        serverId,
        userId,
        username: user.username,
      });

      // Build response
      const server: Server = {
        id: serverId,
        name: name.trim(),
        icon_file_id: icon_file_id || null,
        icon_url: null,
        owner_id: userId,
        member_count: 1,
        created_at: new Date().toISOString(),
      };

      // Resolve icon_url if icon_file_id was provided
      if (icon_file_id) {
        const file = db
          .prepare('SELECT stored_name FROM files WHERE id = ?')
          .get(icon_file_id) as { stored_name: string } | undefined;
        if (file) {
          server.icon_url = '/uploads/' + file.stored_name;
        }
      }

      reply.code(201);
      return server;
    },
  );

  // Get server details
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const row = db
        .prepare(
          `SELECT servers.*, COUNT(sm.user_id) as member_count, f.stored_name as icon_stored_name
           FROM servers
           LEFT JOIN server_members sm ON sm.server_id = servers.id
           LEFT JOIN files f ON f.id = servers.icon_file_id
           WHERE servers.id = ?
           GROUP BY servers.id`,
        )
        .get(serverId) as any;

      if (!row) {
        return reply.code(404).send({ error: 'Server not found' });
      }

      return {
        id: row.id,
        name: row.name,
        icon_file_id: row.icon_file_id,
        icon_url: row.icon_stored_name ? '/uploads/' + row.icon_stored_name : null,
        owner_id: row.owner_id,
        member_count: row.member_count,
        created_at: row.created_at,
      } as Server;
    },
  );

  // Update server
  app.patch<{ Params: { serverId: string }; Body: { name?: string; icon_file_id?: string } }>(
    '/api/servers/:serverId',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const userId = request.user.userId;

      // Check: user must be server owner OR have administrator permission
      const server = db
        .prepare('SELECT owner_id FROM servers WHERE id = ?')
        .get(serverId) as { owner_id: string } | undefined;
      if (!server) {
        return reply.code(404).send({ error: 'Server not found' });
      }
      if (server.owner_id !== userId && !hasPermission(userId, 'administrator')) {
        return reply.code(403).send({ error: 'Only the server owner or an administrator can update the server' });
      }

      const { name, icon_file_id } = request.body;

      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length < 1) {
          return reply.code(400).send({ error: 'Server name is required' });
        }
        if (name.trim().length > 100) {
          return reply.code(400).send({ error: 'Server name must be 100 characters or less' });
        }
        db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name.trim(), serverId);
      }

      if (icon_file_id !== undefined) {
        db.prepare('UPDATE servers SET icon_file_id = ? WHERE id = ?').run(
          icon_file_id || null,
          serverId,
        );
      }

      // Fetch updated server
      const row = db
        .prepare(
          `SELECT servers.*, COUNT(sm.user_id) as member_count, f.stored_name as icon_stored_name
           FROM servers
           LEFT JOIN server_members sm ON sm.server_id = servers.id
           LEFT JOIN files f ON f.id = servers.icon_file_id
           WHERE servers.id = ?
           GROUP BY servers.id`,
        )
        .get(serverId) as any;

      if (!row) {
        return reply.code(404).send({ error: 'Server not found' });
      }

      const updatedServer: Server = {
        id: row.id,
        name: row.name,
        icon_file_id: row.icon_file_id,
        icon_url: row.icon_stored_name ? '/uploads/' + row.icon_stored_name : null,
        owner_id: row.owner_id,
        member_count: row.member_count,
        created_at: row.created_at,
      };

      // Broadcast to all server members
      const memberIds = getServerMemberUserIds(serverId);
      sendToMany(memberIds, { type: 'server:updated', server: updatedServer });

      return updatedServer;
    },
  );

  // Delete server (owner only)
  app.delete<{ Params: { serverId: string } }>(
    '/api/servers/:serverId',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const userId = request.user.userId;

      const server = db
        .prepare('SELECT owner_id FROM servers WHERE id = ?')
        .get(serverId) as { owner_id: string } | undefined;
      if (!server) {
        return reply.code(404).send({ error: 'Server not found' });
      }
      if (server.owner_id !== userId) {
        return reply.code(403).send({ error: 'Only the server owner can delete the server' });
      }

      // Get all member IDs before deletion for broadcast
      const memberIds = getServerMemberUserIds(serverId);

      const deleteServer = db.transaction(() => {
        // Delete all server-scoped data (no ON DELETE CASCADE for server_id columns)
        db.prepare('DELETE FROM invite_codes WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM channel_permission_overrides WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM group_permission_overrides WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM custom_emojis WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM soundboard_sounds WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM bots WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM audit_log WHERE server_id = ?').run(serverId);
        db.prepare('DELETE FROM channel_groups WHERE server_id = ?').run(serverId);
        // Delete channels (messages/reactions cascade via FK)
        db.prepare('DELETE FROM channels WHERE server_id = ?').run(serverId);
        // Delete roles (user_roles cascade via FK)
        db.prepare('DELETE FROM roles WHERE server_id = ?').run(serverId);
        // Delete server members
        db.prepare('DELETE FROM server_members WHERE server_id = ?').run(serverId);
        // Delete the server
        db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
      });
      deleteServer();

      // Broadcast to all former members
      sendToMany(memberIds, { type: 'server:deleted', serverId });

      return { ok: true };
    },
  );

  // Join a server via invite code
  app.post<{ Body: { invite_code: string } }>(
    '/api/servers/join',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user.userId;
      const { invite_code } = request.body;

      if (!invite_code || typeof invite_code !== 'string') {
        return reply.code(400).send({ error: 'Invite code is required' });
      }

      // Find the invite code
      const invite = db
        .prepare('SELECT * FROM invite_codes WHERE code = ?')
        .get(invite_code) as any;
      if (!invite) {
        return reply.code(404).send({ error: 'Invalid invite code' });
      }

      // Check expiration
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return reply.code(410).send({ error: 'Invite code has expired' });
      }

      const serverId = invite.server_id;
      if (!serverId) {
        return reply.code(400).send({ error: 'Invite code is not associated with a server' });
      }

      // Check if user is banned from this server
      const isBanned = db.prepare(
        'SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?'
      ).get(serverId, userId);

      if (isBanned) {
        return reply.code(403).send({ error: 'You are banned from this server' });
      }

      // Check if already a member
      const existingMember = db
        .prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?')
        .get(serverId, userId);

      if (existingMember) {
        // Already a member, return the server
        const row = db
          .prepare(
            `SELECT servers.*, COUNT(sm.user_id) as member_count, f.stored_name as icon_stored_name
             FROM servers
             LEFT JOIN server_members sm ON sm.server_id = servers.id
             LEFT JOIN files f ON f.id = servers.icon_file_id
             WHERE servers.id = ?
             GROUP BY servers.id`,
          )
          .get(serverId) as any;

        return {
          id: row.id,
          name: row.name,
          icon_file_id: row.icon_file_id,
          icon_url: row.icon_stored_name ? '/uploads/' + row.icon_stored_name : null,
          owner_id: row.owner_id,
          member_count: row.member_count,
          created_at: row.created_at,
        } as Server;
      }

      const user = db
        .prepare('SELECT username FROM users WHERE id = ?')
        .get(userId) as { username: string };

      const joinServer = db.transaction(() => {
        // Re-check max_uses inside transaction to prevent race condition
        if (invite.max_uses !== null) {
          const current = db.prepare('SELECT use_count FROM invite_codes WHERE id = ?').get(invite.id) as { use_count: number };
          if (current.use_count >= invite.max_uses) {
            throw new Error('Invite code has reached maximum uses');
          }
        }

        // Add user as server member
        db.prepare(
          'INSERT INTO server_members (server_id, user_id) VALUES (?, ?)',
        ).run(serverId, userId);

        // Increment invite use_count
        db.prepare(
          'UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?',
        ).run(invite.id);

        // Assign default role for this server
        const defaultRole = db
          .prepare('SELECT id FROM roles WHERE server_id = ? AND is_default = 1')
          .get(serverId) as { id: string } | undefined;
        if (defaultRole) {
          db.prepare(
            'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
          ).run(userId, defaultRole.id);
        }
      });

      try {
        joinServer();
      } catch (e: any) {
        if (e.message === 'Invite code has reached maximum uses') {
          return reply.code(410).send({ error: e.message });
        }
        throw e;
      }

      // Broadcast to all server members
      const memberIds = getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'server:memberJoined',
        serverId,
        userId,
        username: user.username,
      });

      // Send welcome bot messages
      sendWelcomeMessages(userId, serverId);

      // Return the server
      const row = db
        .prepare(
          `SELECT servers.*, COUNT(sm.user_id) as member_count, f.stored_name as icon_stored_name
           FROM servers
           LEFT JOIN server_members sm ON sm.server_id = servers.id
           LEFT JOIN files f ON f.id = servers.icon_file_id
           WHERE servers.id = ?
           GROUP BY servers.id`,
        )
        .get(serverId) as any;

      return {
        id: row.id,
        name: row.name,
        icon_file_id: row.icon_file_id,
        icon_url: row.icon_stored_name ? '/uploads/' + row.icon_stored_name : null,
        owner_id: row.owner_id,
        member_count: row.member_count,
        created_at: row.created_at,
      } as Server;
    },
  );

  // Leave a server
  app.post<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/leave',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const userId = request.user.userId;

      // Cannot leave if you're the owner
      const server = db
        .prepare('SELECT owner_id FROM servers WHERE id = ?')
        .get(serverId) as { owner_id: string } | undefined;
      if (!server) {
        return reply.code(404).send({ error: 'Server not found' });
      }
      if (server.owner_id === userId) {
        return reply.code(400).send({ error: 'Server owner cannot leave. Transfer ownership first.' });
      }

      const leaveServer = db.transaction(() => {
        // Remove from server_members
        db.prepare(
          'DELETE FROM server_members WHERE server_id = ? AND user_id = ?',
        ).run(serverId, userId);

        // Remove server-specific user_roles
        const serverRoles = db
          .prepare('SELECT id FROM roles WHERE server_id = ?')
          .all(serverId) as { id: string }[];
        if (serverRoles.length > 0) {
          const placeholders = serverRoles.map(() => '?').join(',');
          db.prepare(
            `DELETE FROM user_roles WHERE user_id = ? AND role_id IN (${placeholders})`,
          ).run(userId, ...serverRoles.map((r) => r.id));
        }
      });
      leaveServer();

      // Broadcast to remaining server members
      const memberIds = getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'server:memberLeft',
        serverId,
        userId,
      });

      return { ok: true };
    },
  );

  // Update own server profile (nickname/avatar/banner)
  app.patch<{ Params: { serverId: string }; Body: { nickname?: string; avatar_url?: string; banner_url?: string } }>(
    '/api/servers/:serverId/members/me',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const userId = request.user.userId;
      const { nickname, avatar_url, banner_url } = request.body;

      const updates: string[] = [];
      const values: any[] = [];

      if (nickname !== undefined) {
        updates.push('nickname = ?');
        values.push(nickname || null);
      }
      if (avatar_url !== undefined) {
        updates.push('avatar_url = ?');
        values.push(avatar_url || null);
      }
      if (banner_url !== undefined) {
        updates.push('banner_url = ?');
        values.push(banner_url || null);
      }

      if (updates.length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      values.push(serverId, userId);
      db.prepare(
        `UPDATE server_members SET ${updates.join(', ')} WHERE server_id = ? AND user_id = ?`
      ).run(...values);

      // Broadcast update to all server members
      const memberIds = getServerMemberUserIds(serverId);
      sendToMany(memberIds, {
        type: 'server:memberUpdated',
        serverId,
        userId,
        nickname: nickname !== undefined ? (nickname || null) : undefined,
        avatar_url: avatar_url !== undefined ? (avatar_url || null) : undefined,
        banner_url: banner_url !== undefined ? (banner_url || null) : undefined,
      });

      return { ok: true };
    }
  );

  // List server members
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/members',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);

      const members = db
        .prepare(
          `SELECT sm.server_id, sm.user_id, sm.nickname, sm.avatar_url as member_avatar_url, sm.banner_url as member_banner_url, sm.joined_at,
                  u.username, u.display_name, u.avatar_url, u.status_preference, u.is_bot
           FROM server_members sm
           JOIN users u ON u.id = sm.user_id
           WHERE sm.server_id = ?`,
        )
        .all(serverId) as any[];

      return members.map((m: any) => ({
        server_id: m.server_id,
        user_id: m.user_id,
        nickname: m.nickname,
        joined_at: m.joined_at,
        username: m.username,
        display_name: m.display_name,
        avatar_url: m.member_avatar_url || m.avatar_url, // for general use
        member_avatar_url: m.member_avatar_url, // for settings
        member_banner_url: m.member_banner_url, // for settings
        status_preference: m.status_preference,
        is_bot: !!m.is_bot,
      }));
    },
  );

  // ─── Server Invitations (Direct User Invites) ──────────────────

  // Search platform users not in this server (for inviting)
  app.get<{ Params: { serverId: string }; Querystring: { q?: string } }>(
    '/api/servers/:serverId/invitable-users',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      const query = (request.query.q || '').trim();
      if (!query || query.length < 1) return [];

      const users = db.prepare(
        `SELECT u.id, u.username, u.display_name, u.avatar_url
         FROM users u
         WHERE u.is_bot = 0
           AND u.id NOT IN (SELECT user_id FROM server_members WHERE server_id = ?)
           AND (u.username LIKE ? OR u.display_name LIKE ?)
         LIMIT 10`
      ).all(serverId, `%${query}%`, `%${query}%`) as any[];

      return users;
    },
  );

  // Send an invitation to a user
  app.post<{ Params: { serverId: string }; Body: { userId: string } }>(
    '/api/servers/:serverId/invitations',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { userId } = request.body;

      if (!userId) {
        return reply.code(400).send({ error: 'userId is required' });
      }

      // Check inviter has permission to invite
      const canInvite = hasPermission(request.user.userId, 'create_invites', serverId);
      if (!canInvite) {
        return reply.code(403).send({ error: 'No permission to invite users' });
      }

      // Check target user exists
      const targetUser = db.prepare('SELECT id FROM users WHERE id = ? AND is_bot = 0').get(userId) as any;
      if (!targetUser) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if already a member
      const existing = db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
      if (existing) {
        return reply.code(400).send({ error: 'User is already a member' });
      }

      // Check if there's already a pending invitation
      const pendingInvite = db.prepare(
        "SELECT id FROM server_invitations WHERE server_id = ? AND invitee_id = ? AND status = 'pending'"
      ).get(serverId, userId);
      if (pendingInvite) {
        return reply.code(400).send({ error: 'Invitation already sent' });
      }

      const id = randomUUID();
      db.prepare(
        'INSERT INTO server_invitations (id, server_id, inviter_id, invitee_id) VALUES (?, ?, ?, ?)'
      ).run(id, serverId, request.user.userId, userId);

      // Build the invitation object
      const server = db.prepare('SELECT name, icon_file_id FROM servers WHERE id = ?').get(serverId) as any;
      const inviter = db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(request.user.userId) as any;
      let iconUrl: string | null = null;
      if (server.icon_file_id) {
        const file = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(server.icon_file_id) as any;
        if (file) iconUrl = `/uploads/${file.stored_name}`;
      }

      const invitation: ServerInvitation = {
        id,
        server_id: serverId,
        server_name: server.name,
        server_icon_url: iconUrl,
        inviter_id: request.user.userId,
        inviter_name: inviter.display_name || inviter.username,
        invitee_id: userId,
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      // Send real-time notification to invitee
      sendTo(userId, { type: 'server:invitation', invitation });

      // Automatically send a DM message with the invitation
      try {
        const dmChannelId = ensureDmChannel(request.user.userId, userId);
        const messageId = randomUUID();
        const msgNow = new Date().toISOString();
        const content = `I've invited you to join my server: **${server.name}**`;

        db.prepare(
          'INSERT INTO messages (id, channel_id, user_id, content, invite_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(messageId, dmChannelId, request.user.userId, content, id, msgNow);

        const msg: Message = {
          id: messageId,
          channel_id: dmChannelId,
          user_id: request.user.userId,
          content,
          file_id: null,
          invite_id: id,
          created_at: msgNow,
          edited_at: null,
          username: inviter.username,
          display_name: inviter.display_name,
          avatar_url: null, // Optional enhancement: fetch full inviter details if needed
        };

        // Notify both participants
        notifyDmCreated(request.user.userId, dmChannelId);
        notifyDmCreated(userId, dmChannelId);
        sendTo(request.user.userId, { type: 'chat:message', message: msg });
        sendTo(userId, { type: 'chat:message', message: msg });
      } catch (err) {
        console.error('Failed to send invite DM:', err);
      }

      return invitation;
    },
  );

  // Get all pending invitations for a server
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/pending-invitations',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      
      if (!hasPermission(request.user.userId, 'manage_invite_codes', serverId)) {
        return reply.code(403).send({ error: 'No permission to view invitations' });
      }

      const rows = db.prepare(
        `SELECT si.id, si.server_id, si.inviter_id, si.invitee_id, si.status, si.created_at,
                u_inviter.display_name as inviter_name, u_inviter.username as inviter_username,
                u_invitee.display_name as invitee_name, u_invitee.username as invitee_username,
                u_invitee.avatar_url as invitee_avatar_url
         FROM server_invitations si
         JOIN users u_inviter ON u_inviter.id = si.inviter_id
         JOIN users u_invitee ON u_invitee.id = si.invitee_id
         WHERE si.server_id = ? AND si.status = 'pending'
         ORDER BY si.created_at DESC`
      ).all(serverId) as any[];

      return rows.map(r => ({
        id: r.id,
        server_id: r.server_id,
        inviter_id: r.inviter_id,
        inviter_name: r.inviter_name || r.inviter_username,
        invitee_id: r.invitee_id,
        invitee_name: r.invitee_name || r.invitee_username,
        invitee_avatar_url: r.invitee_avatar_url,
        status: r.status,
        created_at: r.created_at,
      }));
    }
  );

  // Cancel an invitation (admin)
  app.post<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/invitations/:id/cancel',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { id } = request.params;

      if (!hasPermission(request.user.userId, 'manage_invite_codes', serverId)) {
        return reply.code(403).send({ error: 'No permission to manage invitations' });
      }

      const result = db.prepare(
        "UPDATE server_invitations SET status = 'cancelled' WHERE id = ? AND server_id = ? AND status = 'pending'"
      ).run(id, serverId);

      if (result.changes === 0) {
        return reply.code(404).send({ error: 'Invitation not found or already processed' });
      }

      return { success: true };
    }
  );

  // Get a single invitation by ID (for rich DM embeds)
  app.get<{ Params: { id: string } }>(
    '/api/invitations/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.userId;

      const r = db.prepare(
        `SELECT si.id, si.server_id, si.inviter_id, si.invitee_id, si.status, si.created_at,
                s.name as server_name, s.icon_file_id,
                u.display_name as inviter_display_name, u.username as inviter_username
         FROM server_invitations si
         JOIN servers s ON s.id = si.server_id
         JOIN users u ON u.id = si.inviter_id
         WHERE si.id = ? AND (si.invitee_id = ? OR si.inviter_id = ?)`
      ).get(id, userId, userId) as any;

      if (!r) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }

      let iconUrl: string | null = null;
      if (r.icon_file_id) {
        const file = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(r.icon_file_id) as any;
        if (file) iconUrl = `/uploads/${file.stored_name}`;
      }

      return {
        id: r.id,
        server_id: r.server_id,
        server_name: r.server_name,
        server_icon_url: iconUrl,
        inviter_id: r.inviter_id,
        inviter_name: r.inviter_display_name || r.inviter_username,
        invitee_id: r.invitee_id,
        status: r.status,
        created_at: r.created_at,
      } as ServerInvitation;
    }
  );

  // Get my pending invitations
  app.get(
    '/api/invitations',
    { preHandler: requireAuth },
    async (request) => {
      const rows = db.prepare(
        `SELECT si.id, si.server_id, si.inviter_id, si.invitee_id, si.status, si.created_at,
                s.name as server_name, s.icon_file_id,
                u.display_name as inviter_display_name, u.username as inviter_username
         FROM server_invitations si
         JOIN servers s ON s.id = si.server_id
         JOIN users u ON u.id = si.inviter_id
         WHERE si.invitee_id = ? AND si.status = 'pending'
         ORDER BY si.created_at DESC`
      ).all(request.user.userId) as any[];

      return rows.map((r: any) => {
        let iconUrl: string | null = null;
        if (r.icon_file_id) {
          const file = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(r.icon_file_id) as any;
          if (file) iconUrl = `/uploads/${file.stored_name}`;
        }
        return {
          id: r.id,
          server_id: r.server_id,
          server_name: r.server_name,
          server_icon_url: iconUrl,
          inviter_id: r.inviter_id,
          inviter_name: r.inviter_display_name || r.inviter_username,
          invitee_id: r.invitee_id,
          status: r.status,
          created_at: r.created_at,
        } as ServerInvitation;
      });
    },
  );

  // Accept an invitation
  app.post<{ Params: { id: string } }>(
    '/api/invitations/:id/accept',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.user.userId;

      const result = db.transaction(() => {
        const invitation = db.prepare(
          "SELECT * FROM server_invitations WHERE id = ? AND invitee_id = ? AND status = 'pending'"
        ).get(id, userId) as any;

        if (!invitation) return { error: 'invitation_not_found' };

        // Check if user is banned from this server
        const isBanned = db.prepare(
          'SELECT 1 FROM server_bans WHERE server_id = ? AND user_id = ?'
        ).get(invitation.server_id, userId);

        if (isBanned) {
          return { error: 'banned' };
        }

        db.prepare(
          'INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)'
        ).run(invitation.server_id, userId);

        const defaultRole = db.prepare(
          'SELECT id FROM roles WHERE server_id = ? AND is_default = 1'
        ).get(invitation.server_id) as any;
        if (defaultRole) {
          db.prepare(
            'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)'
          ).run(userId, defaultRole.id);
        }

        db.prepare("UPDATE server_invitations SET status = 'accepted' WHERE id = ?").run(id);
        return invitation;
      })();

      if (result?.error === 'invitation_not_found') {
        return reply.code(404).send({ error: 'Invitation not found' });
      }
      if (result?.error === 'banned') {
        return reply.code(403).send({ error: 'You are banned from this server' });
      }
      if (!result) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }

      // Get server data to return
      const server = db.prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count
         FROM servers s WHERE s.id = ?`
      ).get(result.server_id) as any;

      if (!server) {
        return reply.code(404).send({ error: 'Server not found' });
      }

      let iconUrl: string | null = null;
      if (server.icon_file_id) {
        const file = db.prepare('SELECT stored_name FROM files WHERE id = ?').get(server.icon_file_id) as any;
        if (file) iconUrl = `/uploads/${file.stored_name}`;
      }

      return {
        id: server.id,
        name: server.name,
        icon_file_id: server.icon_file_id,
        icon_url: iconUrl,
        owner_id: server.owner_id,
        member_count: server.member_count,
        created_at: server.created_at,
      } as Server;
    },
  );

  // Decline an invitation
  app.post<{ Params: { id: string } }>(
    '/api/invitations/:id/decline',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params;

      const result = db.prepare(
        "UPDATE server_invitations SET status = 'declined' WHERE id = ? AND invitee_id = ? AND status = 'pending'"
      ).run(id, request.user.userId);

      if (result.changes === 0) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }

      return { success: true };
    },
  );

  // Update per-server notification level
  app.patch<{ Params: { serverId: string }; Body: { notification_level: string } }>(
    '/api/servers/:serverId/members/me/notifications',
    { preHandler: [requireAuth, requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const userId = request.user.userId;
      const { notification_level } = request.body;

      const valid = ['default', 'all', 'mentions', 'nothing'];
      if (!notification_level || !valid.includes(notification_level)) {
        return reply.code(400).send({ error: 'Invalid notification_level' });
      }

      db.prepare(
        'UPDATE server_members SET notification_level = ? WHERE server_id = ? AND user_id = ?'
      ).run(notification_level, serverId, userId);

      return { ok: true };
    },
  );
}
