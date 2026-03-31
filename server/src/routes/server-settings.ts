import type { FastifyInstance } from 'fastify';
import { getDb } from '../adapters/index.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireServerMember, getServerId } from '../auth/serverMiddleware.js';
import { broadcastToServer } from '../ws/index.js';
import type { ServerSettings } from '@voip-server/shared';
import { logAuditEvent } from '../audit/log.js';

async function getServerSettings(serverId: string): Promise<ServerSettings> {
  const row = await getDb().queryOne<any>(
    `SELECT s.name, s.icon_file_id, s.afk_channel_id, s.afk_timeout, s.enabled_apps,
            f.stored_name AS icon_stored_name
     FROM servers s LEFT JOIN files f ON f.id = s.icon_file_id
     WHERE s.id = ?`,
    [serverId],
  );

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
    const row = await getDb().queryOne<{ instance_name: string }>(
      'SELECT instance_name FROM instance_settings WHERE id = 1',
    );
    return {
      name: row?.instance_name || 'SellServ Voice',
      icon_url: null,
    };
  });

  // Get server settings
  app.get<{ Params: { serverId: string } }>(
    '/api/servers/:serverId/settings',
    { preHandler: [requireAuth, requireServerMember] },
    async (request) => {
      const serverId = getServerId(request);
      return await getServerSettings(serverId);
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
        await getDb().run('UPDATE servers SET name = ? WHERE id = ?', [name, serverId]);
      }

      if (icon_file_id !== undefined) {
        if (icon_file_id !== null) {
          const file = await getDb().queryOne('SELECT id FROM files WHERE id = ?', [icon_file_id]);
          if (!file) {
            return reply.code(400).send({ error: 'File not found' });
          }
        }
        await getDb().run('UPDATE servers SET icon_file_id = ? WHERE id = ?', [icon_file_id, serverId]);
      }

      if (enabled_apps !== undefined) {
        const KNOWN_APPS = ['soundboard', 'watch-party', 'voice-changer', 'effects', 'polls'];
        const validApps = enabled_apps.filter((a) => KNOWN_APPS.includes(a));
        await getDb().run('UPDATE servers SET enabled_apps = ? WHERE id = ?', [
          JSON.stringify(validApps),
          serverId,
        ]);
      }

      if (afk_channel_id !== undefined) {
        if (afk_channel_id !== null) {
          const ch = await getDb().queryOne<{ type: string }>('SELECT type FROM channels WHERE id = ? AND server_id = ?', [afk_channel_id, serverId]);
          if (!ch || ch.type !== 'voice') {
            return reply.code(400).send({ error: 'AFK channel must be a voice channel in this server' });
          }
        }
        await getDb().run('UPDATE servers SET afk_channel_id = ? WHERE id = ?', [afk_channel_id, serverId]);
      }

      if (afk_timeout !== undefined) {
        if (typeof afk_timeout !== 'number' || afk_timeout < 60 || afk_timeout > 3600) {
          return reply.code(400).send({ error: 'AFK timeout must be between 60 and 3600 seconds' });
        }
        await getDb().run('UPDATE servers SET afk_timeout = ? WHERE id = ?', [afk_timeout, serverId]);
      }

      await logAuditEvent('admin_settings_change', request.user.userId, null, request.ip, undefined, serverId);

      const settings = await getServerSettings(serverId);
      broadcastToServer(serverId, { type: 'server:settingsUpdated', serverId, settings });
      return settings;
    },
  );
}
