import Database from 'better-sqlite3';
import db from '../db/connection.js';

export type AuditEventType =
  | 'failed_login'
  | 'successful_login'
  | 'password_change'
  | 'mfa_enable'
  | 'mfa_disable'
  | 'role_change'
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
  | 'server_deleted';

let insertStmt: Database.Statement | null = null;
let insertStmtWithServer: Database.Statement | null = null;

function getInsertStmt() {
  if (!insertStmt) {
    insertStmt = db.prepare(
      'INSERT INTO audit_log (event_type, user_id, target_id, ip, details) VALUES (?, ?, ?, ?, ?)',
    );
  }
  return insertStmt;
}

function getInsertStmtWithServer() {
  if (!insertStmtWithServer) {
    insertStmtWithServer = db.prepare(
      'INSERT INTO audit_log (event_type, user_id, target_id, ip, details, server_id) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }
  return insertStmtWithServer;
}

export function logAuditEvent(
  eventType: AuditEventType,
  userId: string | null,
  targetId: string | null,
  ip: string | null,
  details?: Record<string, unknown>,
  serverId?: string,
) {
  const detailsJson = details ? JSON.stringify(details) : null;
  if (serverId) {
    getInsertStmtWithServer().run(eventType, userId, targetId, ip, detailsJson, serverId);
  } else {
    getInsertStmt().run(eventType, userId, targetId, ip, detailsJson);
  }
}

export function getAuditLog(opts: {
  page?: number;
  limit?: number;
  eventType?: string;
  userId?: string;
  serverId?: string;
}) {
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

  const rows = db
    .prepare(
      `SELECT a.*, u.username as actor_name,
            COALESCE(t.username, r.name, ch.name, cg.name) as target_name
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN users t ON t.id = a.target_id
     LEFT JOIN roles r ON r.id = a.target_id
     LEFT JOIN channels ch ON ch.id = a.target_id
     LEFT JOIN channel_groups cg ON cg.id = a.target_id
     ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  const countRow = db
    .prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
    .get(...params) as { count: number };

  return { entries: rows, total: countRow.count, page, limit };
}

export function cleanupOldAuditEntries() {
  db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-90 days')").run();
}
