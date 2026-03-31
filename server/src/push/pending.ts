import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';

interface PendingData {
  [key: string]: string | undefined;
}

export async function createPendingNotification(
  userId: string,
  type: string,
  data: PendingData,
): Promise<string> {
  const id = randomUUID();
  await getDb().run(
    'INSERT INTO pending_notifications (id, user_id, type, data) VALUES (?, ?, ?, ?)',
    [id, userId, type, JSON.stringify(data)],
  );
  return id;
}

export async function fetchAndDeletePending(
  id: string,
  userId: string,
): Promise<{ type: string; data: PendingData } | null> {
  const row = await getDb().queryOne<{ type: string; data: string }>(
    'SELECT type, data FROM pending_notifications WHERE id = ? AND user_id = ? AND fetched = 0',
    [id, userId],
  );

  if (!row) return null;

  await getDb().run('UPDATE pending_notifications SET fetched = 1 WHERE id = ?', [id]);

  return { type: row.type, data: JSON.parse(row.data) };
}

export async function cleanExpiredNotifications(): Promise<void> {
  await getDb().run(
    "DELETE FROM pending_notifications WHERE created_at < datetime('now', '-5 minutes')",
  );
}

export async function shouldNotifyUser(
  userId: string,
  channelId: string | null,
  serverId: string | null,
  type: string,
): Promise<boolean> {
  // Calls always notify
  if (type === 'incoming_call' || type === 'missed_call') return true;

  // DMs: always notify unless muted
  if (type === 'dm') {
    if (!channelId) return true;
    const dmOverride = await getDb().queryOne<{ muted_until: string | null }>(
      'SELECT muted_until FROM dm_notification_overrides WHERE user_id = ? AND channel_id = ?',
      [userId, channelId],
    );
    if (dmOverride?.muted_until) {
      if (dmOverride.muted_until > new Date().toISOString()) return false;
    }
    return true;
  }

  // Server channels — need serverId
  if (!serverId || !channelId) return true;

  // Get server member settings
  const member = await getDb().queryOne<{
    notification_level: string;
    suppress_everyone: number;
    muted_until: string | null;
  }>(
    'SELECT notification_level, suppress_everyone, muted_until FROM server_members WHERE server_id = ? AND user_id = ?',
    [serverId, userId],
  );

  if (!member) return false;

  // Check server mute — muted servers still allow direct @mentions
  const serverMuted = member.muted_until && member.muted_until > new Date().toISOString();
  if (serverMuted && type !== 'mention') return false;

  // Check channel override
  const channelOverride = await getDb().queryOne<{ level: string; muted_until: string | null }>(
    'SELECT level, muted_until FROM channel_notification_overrides WHERE user_id = ? AND channel_id = ?',
    [userId, channelId],
  );

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
