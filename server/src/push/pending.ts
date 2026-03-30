import { randomUUID } from 'crypto';
import db from '../db/connection.js';

interface PendingData {
  [key: string]: string | undefined;
}

export function createPendingNotification(
  userId: string,
  type: string,
  data: PendingData,
): string {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO pending_notifications (id, user_id, type, data) VALUES (?, ?, ?, ?)',
  ).run(id, userId, type, JSON.stringify(data));
  return id;
}

export function fetchAndDeletePending(
  id: string,
  userId: string,
): { type: string; data: PendingData } | null {
  const row = db
    .prepare(
      'SELECT type, data FROM pending_notifications WHERE id = ? AND user_id = ? AND fetched = 0',
    )
    .get(id, userId) as { type: string; data: string } | undefined;

  if (!row) return null;

  db.prepare('UPDATE pending_notifications SET fetched = 1 WHERE id = ?').run(id);

  return { type: row.type, data: JSON.parse(row.data) };
}

export function cleanExpiredNotifications(): void {
  db.prepare(
    "DELETE FROM pending_notifications WHERE created_at < datetime('now', '-5 minutes')",
  ).run();
}

export function shouldNotifyUser(
  userId: string,
  channelId: string | null,
  serverId: string | null,
  type: string,
): boolean {
  // Calls always notify
  if (type === 'incoming_call' || type === 'missed_call') return true;

  // DMs: always notify unless muted
  if (type === 'dm') {
    if (!channelId) return true;
    const dmOverride = db
      .prepare('SELECT muted_until FROM dm_notification_overrides WHERE user_id = ? AND channel_id = ?')
      .get(userId, channelId) as { muted_until: string | null } | undefined;
    if (dmOverride?.muted_until) {
      if (dmOverride.muted_until > new Date().toISOString()) return false;
    }
    return true;
  }

  // Server channels — need serverId
  if (!serverId || !channelId) return true;

  // Get server member settings
  const member = db
    .prepare(
      'SELECT notification_level, suppress_everyone, muted_until FROM server_members WHERE server_id = ? AND user_id = ?',
    )
    .get(serverId, userId) as {
    notification_level: string;
    suppress_everyone: number;
    muted_until: string | null;
  } | undefined;

  if (!member) return false;

  // Check server mute — muted servers still allow direct @mentions
  const serverMuted = member.muted_until && member.muted_until > new Date().toISOString();
  if (serverMuted && type !== 'mention') return false;

  // Check channel override
  const channelOverride = db
    .prepare(
      'SELECT level, muted_until FROM channel_notification_overrides WHERE user_id = ? AND channel_id = ?',
    )
    .get(userId, channelId) as { level: string; muted_until: string | null } | undefined;

  // Channel mute blocks everything
  if (channelOverride?.muted_until && channelOverride.muted_until > new Date().toISOString()) {
    return false;
  }

  // Determine effective level: channel override > server setting
  const level =
    channelOverride && channelOverride.level !== 'default'
      ? channelOverride.level
      : member.notification_level;

  // Suppress @everyone/@here
  if (type === 'everyone' && member.suppress_everyone) return false;

  // Apply level
  switch (level) {
    case 'nothing':
      return false;
    case 'all':
      return true;
    case 'mentions':
    default:
      return type === 'mention' || type === 'everyone';
  }
}
