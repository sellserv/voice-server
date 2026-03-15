import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { sendTo } from './index.js';

/**
 * Ensures a DM channel exists between two users.
 * Returns the channel ID.
 */
export function ensureDmChannel(user1Id: string, user2Id: string): string {
  // Check if DM already exists
  const existing = db
    .prepare(
      `
    SELECT dp1.channel_id FROM dm_participants dp1
    JOIN dm_participants dp2 ON dp1.channel_id = dp2.channel_id
    JOIN channels c ON c.id = dp1.channel_id
    WHERE dp1.user_id = ? AND dp2.user_id = ? AND c.type = 'dm'
  `,
    )
    .get(user1Id, user2Id) as { channel_id: string } | undefined;

  if (existing) {
    return existing.channel_id;
  }

  // Create new DM channel
  const id = randomUUID();
  db.prepare("INSERT INTO channels (id, name, type, sort_order) VALUES (?, '', 'dm', 0)").run(id);
  db.prepare('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)').run(
    id,
    user1Id,
  );
  db.prepare('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)').run(
    id,
    user2Id,
  );

  return id;
}

export function notifyDmCreated(userId: string, channelId: string) {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as any;
  const participantIds = db.prepare('SELECT user_id FROM dm_participants WHERE channel_id = ?').all(channelId) as { user_id: string }[];
  
  channel.dm_participant_ids = participantIds.map(p => p.user_id);
  channel.dm_participants = db
    .prepare(
      `
    SELECT u.id, u.username, u.display_name, u.avatar_url
    FROM dm_participants dp JOIN users u ON u.id = dp.user_id
    WHERE dp.channel_id = ?
  `,
    )
    .all(channelId);

  sendTo(userId, { type: 'dm:created', channel });
}
