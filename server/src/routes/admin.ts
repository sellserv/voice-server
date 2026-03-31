import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import { getDb } from '../adapters/index.js';
import { requirePermission, requireAdmin, requireAuth, isInstanceAdmin } from '../auth/middleware.js';
import { hasPermission } from '../auth/permissions.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { broadcast, disconnectUser, getOnlineUsers, sendToMany, injectFakeClient, removeFakeClient } from '../ws/index.js';
import type { InviteCode } from '@voip-server/shared';
import { logAuditEvent, getAuditLog } from '../audit/log.js';

async function getServerMemberUserIds(serverId: string): Promise<string[]> {
  const rows = await getDb().query<{ user_id: string }>('SELECT user_id FROM server_members WHERE server_id = ?', [serverId]);
  return rows.map(r => r.user_id);
}

const adminRateLimit = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => request.ip,
    },
  },
};

export default async function adminRoutes(app: FastifyInstance) {
  // ─── Instance Admin ─────────────────────────────────────

  // Platform stats overview
  app.get(
    '/api/admin/stats',
    { ...adminRateLimit, preHandler: requireAdmin },
    async () => {
      const userCount = (await getDb().queryOne<any>('SELECT COUNT(*) as c FROM users'))?.c;
      const serverCount = (await getDb().queryOne<any>('SELECT COUNT(*) as c FROM servers'))?.c;
      const messageCount = (await getDb().queryOne<any>('SELECT COUNT(*) as c FROM messages'))?.c;
      const fileCount = (await getDb().queryOne<any>('SELECT COUNT(*) as c FROM files'))?.c;
      const diskUsage = (await getDb().queryOne<any>('SELECT COALESCE(SUM(size_bytes), 0) as total FROM files'))?.total;
      const onlineCount = (await getOnlineUsers()).length;
      const openReports = (await getDb().queryOne<any>("SELECT COUNT(*) as c FROM reports WHERE status = 'open'"))?.c;

      return {
        users: userCount,
        servers: serverCount,
        messages: messageCount,
        files: fileCount,
        disk_usage_bytes: diskUsage,
        online: onlineCount,
        open_reports: openReports,
      };
    },
  );

  // List all platform users (with detail)
  app.get(
    '/api/admin/users',
    { ...adminRateLimit, preHandler: requireAdmin },
    async () => {
      return await getDb().query(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.email, u.banned, u.created_at,
                (SELECT COUNT(*) FROM server_members WHERE user_id = u.id) as server_count,
                (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as message_count,
                (SELECT ip FROM audit_log WHERE user_id = u.id AND event_type = 'successful_login' ORDER BY created_at DESC LIMIT 1) as last_ip
         FROM users u ORDER BY u.created_at DESC`,
      );
    },
  );

  // Get single user detail
  app.get<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params;
      const user = await getDb().queryOne<any>(
        `SELECT u.id, u.username, u.display_name, u.email, u.avatar_url, u.bio, u.banned, u.ban_reason, u.created_at,
                (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as message_count,
                (SELECT ip FROM audit_log WHERE user_id = u.id AND event_type = 'successful_login' ORDER BY created_at DESC LIMIT 1) as last_ip
         FROM users u WHERE u.id = ?`,
        [id],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      user.servers = await getDb().query(
        `SELECT s.id, s.name FROM servers s
         JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = ?`,
        [id],
      );
      return user;
    },
  );

  // Platform-wide ban
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/admin/users/:id/ban',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params;
      const { reason } = request.body || {};

      if (id === request.user.userId) {
        return reply.code(400).send({ error: 'Cannot ban yourself' });
      }

      const user = await getDb().queryOne<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE id = ?',
        [id],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      if (isInstanceAdmin(user.id)) {
        return reply.code(400).send({ error: 'Cannot ban an instance admin' });
      }

      const trimmedReason = reason?.trim().slice(0, 1000) || null;
      await getDb().run('UPDATE users SET banned = 1, ban_reason = ? WHERE id = ?', [trimmedReason, id]);
      await logAuditEvent('platform_ban', request.user.userId, id, request.ip, { reason: trimmedReason });
      broadcast({ type: 'user:banned', userId: id });
      disconnectUser(id);

      return { ok: true };
    },
  );

  // Platform-wide unban
  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/unban',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params;

      const user = await getDb().queryOne('SELECT id FROM users WHERE id = ?', [id]);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      await getDb().run('UPDATE users SET banned = 0, ban_reason = NULL WHERE id = ?', [id]);
      await logAuditEvent('platform_unban', request.user.userId, id, request.ip);

      return { ok: true };
    },
  );

  // List all platform servers
  app.get(
    '/api/admin/servers',
    { ...adminRateLimit, preHandler: requireAdmin },
    async () => {
      const rows = await getDb().query<any>(
        `SELECT s.id, s.name, s.icon_file_id, s.owner_id, s.created_at,
                u.username as owner_username,
                f.stored_name as icon_stored_name,
                (SELECT COUNT(*) FROM server_members WHERE server_id = s.id) as member_count,
                (SELECT COUNT(*) FROM channels WHERE server_id = s.id AND type != 'dm') as channel_count
         FROM servers s LEFT JOIN users u ON u.id = s.owner_id
         LEFT JOIN files f ON f.id = s.icon_file_id
         ORDER BY s.created_at DESC`,
      );
      return rows.map((r: any) => ({
        ...r,
        icon_url: r.icon_stored_name ? '/uploads/' + r.icon_stored_name : null,
      }));
    },
  );

  // Delete server (instance admin)
  app.delete<{ Params: { id: string } }>(
    '/api/admin/servers/:id',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params;

      const server = await getDb().queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM servers WHERE id = ?',
        [id],
      );
      if (!server) {
        return reply.code(404).send({ error: 'Server not found' });
      }

      const memberIds = await getServerMemberUserIds(id);

      await getDb().transaction(async (tx) => {
        await tx.run('DELETE FROM invite_codes WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM channel_permission_overrides WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM group_permission_overrides WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM custom_emojis WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM soundboard_sounds WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM bots WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM audit_log WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM reports WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM server_bans WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM channel_groups WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM channels WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM roles WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM server_members WHERE server_id = ?', [id]);
        await tx.run('DELETE FROM servers WHERE id = ?', [id]);
      });

      await logAuditEvent('server_deleted', request.user.userId, null, request.ip, { name: server.name });
      sendToMany(memberIds, { type: 'server:deleted', serverId: id });

      return { ok: true };
    },
  );

  // Global audit log (all events across all servers)
  app.get(
    '/api/admin/audit-log',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request) => {
      const { page, limit, event_type, user_id } = request.query as {
        page?: string;
        limit?: string;
        event_type?: string;
        user_id?: string;
      };
      return await getAuditLog({
        page: page ? (parseInt(page, 10) || 1) : undefined,
        limit: limit ? Math.min(parseInt(limit, 10) || 50, 100) : undefined,
        eventType: event_type,
        userId: user_id,
      });
    },
  );

  // ─── Reports ────────────────────────────────────────────

  // Submit a report (any authenticated user)
  app.post<{ Body: { message_id: string; reason: string } }>(
    '/api/reports',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { message_id, reason } = request.body || {};

      if (!message_id || !reason?.trim()) {
        return reply.code(400).send({ error: 'Message ID and reason are required' });
      }

      if (reason.trim().length > 1000) {
        return reply.code(400).send({ error: 'Reason must be 1000 characters or less' });
      }

      const message = await getDb().queryOne<any>(
        `SELECT m.id, m.user_id, m.content, m.channel_id, c.server_id
         FROM messages m LEFT JOIN channels c ON c.id = m.channel_id
         WHERE m.id = ?`,
        [message_id],
      );

      if (!message) {
        return reply.code(404).send({ error: 'Message not found' });
      }

      if (message.user_id === request.user.userId) {
        return reply.code(400).send({ error: 'Cannot report your own message' });
      }

      // Prevent duplicate open reports for same message by same user
      const existing = await getDb().queryOne(
        "SELECT id FROM reports WHERE reporter_id = ? AND message_id = ? AND status = 'open'",
        [request.user.userId, message_id],
      );
      if (existing) {
        return reply.code(409).send({ error: 'You have already reported this message' });
      }

      const id = randomUUID();
      await getDb().run(
        `INSERT INTO reports (id, reporter_id, message_id, reported_user_id, channel_id, server_id, reason, message_content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, request.user.userId, message_id, message.user_id, message.channel_id, message.server_id, reason.trim(), message.content],
      );

      await logAuditEvent('report_submitted', request.user.userId, message.user_id, request.ip, { message_id, reason: reason.trim() }, message.server_id);

      return { ok: true };
    },
  );

  // List reports (instance admin)
  app.get(
    '/api/admin/reports',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { status } = request.query as { status?: string };
      const validStatuses = ['open', 'resolved', 'dismissed'];
      if (status && !validStatuses.includes(status)) {
        return reply.code(400).send({ error: 'Invalid status filter' });
      }
      const filter = status ? "WHERE r.status = ?" : "";
      const params = status ? [status] : [];

      return await getDb().query(
        `SELECT r.*,
                reporter.username as reporter_username,
                reported.username as reported_username,
                s.name as server_name
         FROM reports r
         LEFT JOIN users reporter ON reporter.id = r.reporter_id
         LEFT JOIN users reported ON reported.id = r.reported_user_id
         LEFT JOIN servers s ON s.id = r.server_id
         ${filter}
         ORDER BY r.created_at DESC`,
        params,
      );
    },
  );

  // Resolve/dismiss a report (instance admin)
  app.post<{ Params: { id: string }; Body: { status: 'resolved' | 'dismissed'; note?: string } }>(
    '/api/admin/reports/:id',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params;
      const { status, note } = request.body || {};

      if (status !== 'resolved' && status !== 'dismissed') {
        return reply.code(400).send({ error: 'Status must be resolved or dismissed' });
      }

      const report = await getDb().queryOne<any>('SELECT id, reported_user_id, status FROM reports WHERE id = ?', [id]);
      if (!report) {
        return reply.code(404).send({ error: 'Report not found' });
      }
      if (report.status !== 'open') {
        return reply.code(400).send({ error: 'Report is already ' + report.status });
      }

      await getDb().run(
        "UPDATE reports SET status = ?, resolved_by = ?, resolution_note = ?, resolved_at = datetime('now') WHERE id = ?",
        [status, request.user.userId, note || null, id],
      );

      await logAuditEvent('report_resolved', request.user.userId, report.reported_user_id, request.ip, { report_id: id, status, note });

      return { ok: true };
    },
  );

  // ─── Server-Scoped Admin ────────────────────────────────

  // Kick user (remove from server, can rejoin)
  app.post<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/admin/kick/:id',
    { preHandler: [requirePermission('kick_members'), requireServerMember] },
    async (request, reply) => {
      const { id } = request.params;
      const serverId = getServerId(request);

      if (id === request.user.userId) {
        return reply.code(400).send({ error: 'Cannot kick yourself' });
      }

      const user = await getDb().queryOne<{ id: string; is_bot: number }>(
        'SELECT id, is_bot FROM users WHERE id = ?',
        [id],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      if (user.is_bot) {
        return reply.code(400).send({ error: 'Bots cannot be kicked. Disable them in Bot Settings.' });
      }

      // Can't kick someone with administrator permission
      if (await hasPermission(id, 'administrator', serverId)) {
        return reply.code(400).send({ error: 'Cannot kick an administrator' });
      }

      // Check they're actually a member
      const isMember = await getDb().queryOne(
        'SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?',
        [serverId, id],
      );
      if (!isMember) {
        return reply.code(400).send({ error: 'User is not a member of this server' });
      }

      // Remove from server (no ban record — they can rejoin)
      await getDb().run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, id]);

      await logAuditEvent('user_kick', request.user.userId, id, request.ip, undefined, serverId);

      const memberIds = await getServerMemberUserIds(serverId);
      sendToMany(memberIds, { type: 'server:memberLeft', serverId, userId: id });
      // Also notify the kicked user so their client removes the server
      sendToMany([id], { type: 'server:memberLeft', serverId, userId: id });

      return { ok: true };
    },
  );

  // Ban user (remove from server)
  app.post<{ Params: { serverId: string; id: string }; Body: { reason?: string } }>(
    '/api/servers/:serverId/admin/ban/:id',
    { preHandler: [requirePermission('ban_members'), requireServerMember] },
    async (request, reply) => {
      const { id } = request.params;
      const { reason } = request.body || {};
      const serverId = getServerId(request);

      if (id === request.user.userId) {
        return reply.code(400).send({ error: 'Cannot ban yourself' });
      }

      const user = await getDb().queryOne<{ id: string; role: string; is_bot: number }>(
        'SELECT id, role, is_bot FROM users WHERE id = ?',
        [id],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      if (user.is_bot) {
        return reply.code(400).send({ error: 'Bots cannot be banned. Disable them in Bot Settings.' });
      }

      // Can't ban someone with administrator permission
      if (await hasPermission(id, 'administrator')) {
        return reply.code(400).send({ error: 'Cannot ban an administrator' });
      }

      const trimmedReason = reason?.trim().slice(0, 1000) || null;

      await getDb().transaction(async (tx) => {
        // Record the ban
        await tx.run(
          'INSERT OR REPLACE INTO server_bans (server_id, user_id, reason, banned_by) VALUES (?, ?, ?, ?)',
          [serverId, id, trimmedReason, request.user.userId],
        );

        // Remove user from this server's membership
        await tx.run('DELETE FROM server_members WHERE server_id = ? AND user_id = ?', [
          serverId,
          id,
        ]);
      });

      await logAuditEvent('user_ban', request.user.userId, id, request.ip, { reason: trimmedReason }, serverId);

      // Notify only members of this server (not all connected users)
      const memberIds = await getServerMemberUserIds(serverId);
      sendToMany(memberIds, { type: 'server:memberLeft', serverId, userId: id });

      return { ok: true };
    },
  );

  // Unban user (re-add to server)
  app.post<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/admin/unban/:id',
    { preHandler: [requirePermission('ban_members'), requireServerMember] },
    async (request, reply) => {
      const { id } = request.params;
      const serverId = getServerId(request);

      const user = await getDb().queryOne('SELECT id FROM users WHERE id = ?', [id]);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Remove from server_bans
      await getDb().run(
        'DELETE FROM server_bans WHERE server_id = ? AND user_id = ?',
        [serverId, id],
      );

      await logAuditEvent('user_unban', request.user.userId, id, request.ip, undefined, serverId);
      return { ok: true };
    },
  );

  // ─── Invite Codes ────────────────────────────────────────

  // Create invite code
  app.post<{ Params: { serverId: string }; Body: { max_uses?: number; expires_at?: string } }>(
    '/api/servers/:serverId/admin/invite-codes',
    { preHandler: [requirePermission('manage_invite_codes'), requireServerMember] },
    async (request, reply) => {
      const { max_uses, expires_at } = request.body || {};
      const serverId = getServerId(request);

      const id = randomUUID();
      const code = nanoid(8);
      const defaultExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await getDb().run(
        'INSERT INTO invite_codes (id, code, created_by, max_uses, expires_at, server_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, code, request.user.userId, max_uses ?? null, expires_at ?? defaultExpiry, serverId],
      );

      await logAuditEvent('invite_create', request.user.userId, null, request.ip, { code }, serverId);
      return await getDb().queryOne<InviteCode>('SELECT * FROM invite_codes WHERE id = ?', [id]);
    },
  );

  // List invite codes
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/admin/invite-codes',
    { preHandler: [requirePermission('manage_invite_codes'), requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      return await getDb().query<InviteCode>(
        'SELECT * FROM invite_codes WHERE server_id = ? ORDER BY created_at DESC',
        [serverId],
      );
    },
  );

  // Get instance settings
  app.get('/api/admin/instance-settings', { preHandler: requireAdmin }, async () => {
    const settings = await getDb().queryOne<any>('SELECT allow_server_creation, allow_registration, instance_name, alpha_billing, terms_url, privacy_url FROM instance_settings WHERE id = 1');
    return settings || { allow_server_creation: 1, allow_registration: 1, instance_name: 'SellServ Voice', alpha_billing: 0, terms_url: '', privacy_url: '' };
  });

  // Update instance settings
  app.patch<{ Body: { allow_registration?: boolean; instance_name?: string; alpha_billing?: boolean; terms_url?: string; privacy_url?: string } }>(
    '/api/admin/instance-settings',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { allow_registration, instance_name, alpha_billing, terms_url, privacy_url } = request.body;
      if (allow_registration !== undefined) {
        await getDb().run('UPDATE instance_settings SET allow_registration = ? WHERE id = 1', [allow_registration ? 1 : 0]);
      }
      if (instance_name !== undefined) {
        const trimmed = instance_name.trim().slice(0, 100);
        if (!trimmed) {
          return reply.code(400).send({ error: 'Instance name cannot be empty' });
        }
        await getDb().run('UPDATE instance_settings SET instance_name = ? WHERE id = 1', [trimmed]);
      }
      if (alpha_billing !== undefined) {
        await getDb().run('UPDATE instance_settings SET alpha_billing = ? WHERE id = 1', [alpha_billing ? 1 : 0]);
      }
      if (terms_url !== undefined) {
        await getDb().run('UPDATE instance_settings SET terms_url = ? WHERE id = 1', [terms_url.trim().slice(0, 500)]);
      }
      if (privacy_url !== undefined) {
        await getDb().run('UPDATE instance_settings SET privacy_url = ? WHERE id = 1', [privacy_url.trim().slice(0, 500)]);
      }
      const settings = await getDb().queryOne<any>('SELECT allow_server_creation, allow_registration, instance_name, alpha_billing, terms_url, privacy_url FROM instance_settings WHERE id = 1');
      return settings;
    },
  );

  // Delete invite code
  app.delete<{ Params: { serverId: string; id: string } }>(
    '/api/servers/:serverId/admin/invite-codes/:id',
    { preHandler: [requirePermission('manage_invite_codes'), requireServerMember] },
    async (request, reply) => {
      const { id } = request.params;
      const serverId = getServerId(request);
      const result = await getDb().run('DELETE FROM invite_codes WHERE id = ? AND server_id = ?', [id, serverId]);
      if (result.changes === 0) {
        return reply.code(404).send({ error: 'Invite code not found' });
      }
      await logAuditEvent('invite_delete', request.user.userId, null, request.ip, { id }, serverId);
      return { ok: true };
    },
  );

  // ─── Global Role Management ─────────────────────────────

  // List all global roles (server_id IS NULL)
  app.get(
    '/api/admin/global-roles',
    { ...adminRateLimit, preHandler: requireAdmin },
    async () => {
      return await getDb().query(
        'SELECT id, name, color, position, permissions, is_default, pro FROM roles WHERE server_id IS NULL ORDER BY position ASC',
      );
    },
  );

  // Toggle a global role for a user
  app.patch<{ Params: { userId: string }; Body: { roleId: string; action: 'add' | 'remove' } }>(
    '/api/admin/users/:userId/global-roles',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { userId } = request.params;
      const { roleId, action } = request.body || {};

      if (!roleId || !action || !['add', 'remove'].includes(action)) {
        return reply.code(400).send({ error: 'roleId and action (add/remove) are required' });
      }

      const user = await getDb().queryOne<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE id = ?',
        [userId],
      );
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const role = await getDb().queryOne<{ id: string; name: string; pro: number }>(
        'SELECT id, name, pro FROM roles WHERE id = ? AND server_id IS NULL',
        [roleId],
      );
      if (!role) {
        return reply.code(404).send({ error: 'Global role not found' });
      }

      if (action === 'add') {
        await getDb().run('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
      } else {
        await getDb().run('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
      }

      // Update cached premium_tier on users table
      const hasPro = await getDb().queryOne(
        `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.pro = 1`,
        [userId],
      );
      await getDb().run('UPDATE users SET premium_tier = ? WHERE id = ?', [hasPro ? 'pro' : 'free', userId]);

      await logAuditEvent('role_change', request.user.userId, userId, request.ip, {
        role: role.name,
        action,
        global: true,
      });

      // Notify all connected clients so badges update in real-time
      broadcast({ type: 'user:updated', userId });

      // Return updated global roles for this user
      const userGlobalRoles = await getDb().query(
        `SELECT r.id, r.name, r.color, r.pro FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND r.server_id IS NULL`,
        [userId],
      );

      return { ok: true, globalRoles: userGlobalRoles, premiumTier: hasPro ? 'pro' : 'free' };
    },
  );

  // Get global roles for a specific user
  app.get<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/global-roles',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { userId } = request.params;
      const user = await getDb().queryOne('SELECT id FROM users WHERE id = ?', [userId]);
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }
      const roles = await getDb().query(
        `SELECT r.id, r.name, r.color, r.pro FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND r.server_id IS NULL`,
        [userId],
      );
      return roles;
    },
  );

  // Toggle pro flag on a global role
  app.patch<{ Params: { roleId: string }; Body: { pro: boolean } }>(
    '/api/admin/global-roles/:roleId',
    { ...adminRateLimit, preHandler: requireAdmin },
    async (request, reply) => {
      const { roleId } = request.params;
      const { pro } = request.body || {};

      if (typeof pro !== 'boolean') {
        return reply.code(400).send({ error: 'pro (boolean) is required' });
      }

      const role = await getDb().queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM roles WHERE id = ? AND server_id IS NULL',
        [roleId],
      );
      if (!role) {
        return reply.code(404).send({ error: 'Global role not found' });
      }

      await getDb().run('UPDATE roles SET pro = ? WHERE id = ?', [pro ? 1 : 0, roleId]);

      // Recalculate premium_tier for all users who have this role
      const affectedUsers = await getDb().query<{ user_id: string }>(
        'SELECT user_id FROM user_roles WHERE role_id = ?',
        [roleId],
      );

      for (const { user_id } of affectedUsers) {
        const hasPro = await getDb().queryOne(
          `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.pro = 1`,
          [user_id],
        );
        await getDb().run('UPDATE users SET premium_tier = ? WHERE id = ?', [hasPro ? 'pro' : 'free', user_id]);
        broadcast({ type: 'user:updated', userId: user_id });
      }

      await logAuditEvent('permission_change', request.user.userId, null, request.ip, {
        role: role.name,
        pro,
        global: true,
      });

      return { ok: true };
    },
  );

  // ─── Demo Fake Presence ─────────────────────────────

  // Inject fake online presence for demo users (screenshot purposes)
  app.post<{ Body: { users: { userId: string; activity?: string; status?: string }[]; voiceChannelId?: string; voiceUserIds?: string[] } }>(
    '/api/admin/demo-presence',
    { preHandler: requireAdmin },
    async (request) => {
      const { users, voiceChannelId, voiceUserIds } = request.body;
      let injected = 0;

      for (const entry of users) {
        const user = await getDb().queryOne<{ id: string; username: string; display_name: string }>(
          'SELECT id, username, display_name FROM users WHERE id = ?',
          [entry.userId],
        );
        if (!user) continue;

        const serverRows = await getDb().query<{ server_id: string }>(
          'SELECT server_id FROM server_members WHERE user_id = ?',
          [user.id],
        );
        const serverIds = serverRows.map((r) => r.server_id);

        injectFakeClient(user.id, {
          username: user.username,
          display_name: user.display_name,
          status: (entry.status as any) || 'online',
          serverIds,
          activity: entry.activity,
        });
        injected++;
      }

      // Broadcast presence:update for each injected user so clients see them online
      for (const entry of users) {
        const user = await getDb().queryOne<{ id: string; username: string; display_name: string }>(
          'SELECT id, username, display_name FROM users WHERE id = ?',
          [entry.userId],
        );
        if (!user) continue;

        broadcast({
          type: 'presence:update',
          userId: user.id,
          username: user.username,
          display_name: user.display_name,
          online: true,
          status: entry.status || 'online',
        } as any);

        if (entry.activity) {
          broadcast({
            type: 'presence:activity',
            userId: user.id,
            activity: entry.activity,
          } as any);
        }
      }

      // Fake voice channel members
      if (voiceChannelId && voiceUserIds && voiceUserIds.length > 0) {
        const voiceMembers: Record<string, any[]> = {};
        voiceMembers[voiceChannelId] = [];
        for (const vuId of voiceUserIds) {
          const vu = await getDb().queryOne<{ id: string; username: string; display_name: string; avatar_url: string | null }>(
            'SELECT id, username, display_name, avatar_url FROM users WHERE id = ?',
            [vuId],
          );
          if (vu) {
            voiceMembers[voiceChannelId].push({
              userId: vu.id,
              username: vu.username,
              display_name: vu.display_name,
              avatar_url: vu.avatar_url,
              muted: false,
              deafened: false,
            });
          }
        }
        broadcast({ type: 'voice:channelMembers', channels: voiceMembers } as any);
      }

      return { ok: true, injected };
    },
  );

  // Remove all fake demo presence
  app.delete(
    '/api/admin/demo-presence',
    { preHandler: requireAdmin },
    async () => {
      const demoUsers = await getDb().query<{ id: string }>("SELECT id FROM users WHERE id LIKE 'demo_%'");
      let removed = 0;
      for (const u of demoUsers) {
        removeFakeClient(u.id);
        removed++;
      }
      // Broadcast offline for each removed user
      for (const u of demoUsers) {
        const user = await getDb().queryOne<{ username: string; display_name: string }>(
          'SELECT username, display_name FROM users WHERE id = ?',
          [u.id],
        );
        if (user) {
          broadcast({
            type: 'presence:update',
            userId: u.id,
            username: user.username,
            display_name: user.display_name,
            online: false,
          } as any);
        }
      }
      return { ok: true, removed };
    },
  );

}
