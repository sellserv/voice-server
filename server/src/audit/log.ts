import { getDb } from '../adapters/index.js';

export type AuditEventType =
  | 'failed_login'
  | 'successful_login'
  | 'password_change'
  | 'mfa_enable'
  | 'mfa_disable'
  | 'role_change'
  | 'user_kick'
  | 'user_ban'
  | 'user_unban'
  | 'permission_change'
  | 'admin_settings_change'
  | 'invite_create'
  | 'invite_delete'
  | 'platform_ban'
  | 'platform_unban'
  | 'report_submitted'
  | 'report_resolved'
  | 'server_deleted'
  | 'username_change';

export async function logAuditEvent(
  eventType: AuditEventType,
  userId: string | null,
  targetId: string | null,
  ip: string | null,
  details?: Record<string, unknown>,
  serverId?: string,
): Promise<void> {
  const detailsJson = details ? JSON.stringify(details) : null;
  if (serverId) {
    await getDb().run(
      'INSERT INTO audit_log (event_type, user_id, target_id, ip, details, server_id) VALUES (?, ?, ?, ?, ?, ?)',
      [eventType, userId, targetId, ip, detailsJson, serverId],
    );
  } else {
    await getDb().run(
      'INSERT INTO audit_log (event_type, user_id, target_id, ip, details) VALUES (?, ?, ?, ?, ?)',
      [eventType, userId, targetId, ip, detailsJson],
    );
  }
}

export async function getAuditLog(opts: {
  page?: number;
  limit?: number;
  eventType?: string;
  userId?: string;
  serverId?: string;
}): Promise<{ entries: any[]; total: number; page: number; limit: number }> {
  const { page = 1, limit = 50, eventType, userId, serverId } = opts;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (eventType) {
    conditions.push('a.event_type = ?');
    params.push(eventType);
  }
  if (userId) {
    conditions.push('a.user_id = ?');
    params.push(userId);
  }
  if (serverId) {
    conditions.push('a.server_id = ?');
    params.push(serverId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await getDb().query(
    `SELECT a.*, u.username as actor_name,
          COALESCE(t.username, r.name, ch.name, cg.name) as target_name
   FROM audit_log a
   LEFT JOIN users u ON u.id = a.user_id
   LEFT JOIN users t ON t.id = a.target_id
   LEFT JOIN roles r ON r.id = a.target_id
   LEFT JOIN channels ch ON ch.id = a.target_id
   LEFT JOIN channel_groups cg ON cg.id = a.target_id
   ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const countRow = await getDb().queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM audit_log a ${where}`,
    params,
  );

  return { entries: rows, total: countRow?.count ?? 0, page, limit };
}

export async function cleanupOldAuditEntries(): Promise<void> {
  await getDb().run("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')");
}
