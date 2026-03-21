import type { FastifyInstance } from 'fastify';
import db from '../db/connection.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { broadcastToServer } from '../ws/index.js';
import type { ServerSettings } from '@voip-server/shared';
import { logAuditEvent } from '../audit/log.js';

function getServerSettings(serverId: string): ServerSettings {
  const row = db
    .prepare(
      `SELECT s.name, s.icon_file_id, s.afk_channel_id, s.afk_timeout, s.enabled_apps,
              f.stored_name AS icon_stored_name
       FROM servers s LEFT JOIN files f ON f.id = s.icon_file_id
       WHERE s.id = ?`,
    )
    .get(serverId) as any;

  let enabledApps: string[] = [];
  try {
    enabledApps = JSON.parse(row?.enabled_apps || '[]');
  } catch {}

  const result: ServerSettings = {
    name: row?.name || 'SellServ Voice',
    icon_url: row?.icon_stored_name ? `/uploads/${row.icon_stored_name}` : null,
    enabled_apps: enabledApps,
    afk_channel_id: row?.afk_channel_id || null,
    afk_timeout: row?.afk_timeout ?? 300,
  };
  return result;
}

export default async function serverSettingsRoutes(app: FastifyInstance) {
  // Public instance info (name only, no auth required) — used on login/register page
  app.get('/api/server-settings/public', async () => {
    const row = db
      .prepare('SELECT instance_name, min_app_version FROM instance_settings WHERE id = 1')
      .get() as any;
    return {
      name: row?.instance_name || 'SellServ Voice',
      icon_url: null,
      min_app_version: row?.min_app_version || '0.0.0',
    };
  });

  // Get server settings
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/settings',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      return getServerSettings(serverId);
    },
  );

  // Update server settings (administrator / manage_server only)
  app.put<{ Params: { serverId: string }; Body: { name?: string; icon_file_id?: string | null; enabled_apps?: string[]; afk_channel_id?: string | null; afk_timeout?: number } }>(
    '/api/servers/:serverId/settings',
    { preHandler: [requirePermission('manage_server'), requireServerMember] },
    async (request, reply) => {
      const serverId = getServerId(request);
      const { name, icon_file_id, enabled_apps, afk_channel_id, afk_timeout } = request.body;

      if (name !== undefined) {
        if (!name || name.length < 1 || name.length > 64) {
          return reply.code(400).send({ error: 'Server name must be 1-64 characters' });
        }
        db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(name, serverId);
      }

      if (icon_file_id !== undefined) {
        if (icon_file_id !== null) {
          const file = db.prepare('SELECT id FROM files WHERE id = ?').get(icon_file_id);
          if (!file) {
            return reply.code(400).send({ error: 'File not found' });
          }
        }
        db.prepare('UPDATE servers SET icon_file_id = ? WHERE id = ?').run(icon_file_id, serverId);
      }

      if (enabled_apps !== undefined) {
        const KNOWN_APPS = ['soundboard', 'watch-party', 'voice-changer', 'effects', 'polls'];
        const validApps = enabled_apps.filter((a) => KNOWN_APPS.includes(a));
        db.prepare('UPDATE servers SET enabled_apps = ? WHERE id = ?').run(
          JSON.stringify(validApps),
          serverId,
        );
      }

      if (afk_channel_id !== undefined) {
        if (afk_channel_id !== null) {
          const ch = db.prepare('SELECT type FROM channels WHERE id = ? AND server_id = ?').get(afk_channel_id, serverId) as { type: string } | undefined;
          if (!ch || ch.type !== 'voice') {
            return reply.code(400).send({ error: 'AFK channel must be a voice channel in this server' });
          }
        }
        db.prepare('UPDATE servers SET afk_channel_id = ? WHERE id = ?').run(afk_channel_id, serverId);
      }

      if (afk_timeout !== undefined) {
        if (typeof afk_timeout !== 'number' || afk_timeout < 60 || afk_timeout > 3600) {
          return reply.code(400).send({ error: 'AFK timeout must be between 60 and 3600 seconds' });
        }
        db.prepare('UPDATE servers SET afk_timeout = ? WHERE id = ?').run(afk_timeout, serverId);
      }

      logAuditEvent('admin_settings_change', request.user.userId, null, request.ip, undefined, serverId);

      const settings = getServerSettings(serverId);
      broadcastToServer(serverId, { type: 'server:settingsUpdated', serverId, settings });
      return settings;
    },
  );
}
