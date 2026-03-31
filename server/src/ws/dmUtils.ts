import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';
import { sendTo } from './index.js';

/**
 * Ensures a DM channel exists between two users.
 * Returns the channel ID.
 */
export async function ensureDmChannel(user1Id: string, user2Id: string): Promise<string> {
  // Check if DM already exists
  const existing = await getDb().queryOne<{ channel_id: string }>(
    `
    SELECT dp1.channel_id FROM dm_participants dp1
    JOIN dm_participants dp2 ON dp1.channel_id = dp2.channel_id
    JOIN channels c ON c.id = dp1.channel_id
    WHERE dp1.user_id = ? AND dp2.user_id = ? AND c.type = 'dm'
  `,
    [user1Id, user2Id],
  );

  if (existing) {
    return existing.channel_id;
  }

  // Create new DM channel
  const id = randomUUID();
  await getDb().run("INSERT INTO channels (id, name, type, sort_order) VALUES (?, '', 'dm', 0)", [id]);
  await getDb().run('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)', [
    id,
    user1Id,
  ]);
  await getDb().run('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)', [
    id,
    user2Id,
  ]);

  return id;
}

export async function notifyDmCreated(userId: string, channelId: string) {
  const channel = await getDb().queryOne<any>('SELECT * FROM channels WHERE id = ?', [channelId]);
  const participantIds = await getDb().query<{ user_id: string }>('SELECT user_id FROM dm_participants WHERE channel_id = ?', [channelId]);

  channel.dm_participant_ids = participantIds.map(p => p.user_id);
  channel.dm_participants = await getDb().query(
    `
    SELECT u.id, u.username, u.display_name, u.avatar_url
    FROM dm_participants dp JOIN users u ON u.id = dp.user_id
    WHERE dp.channel_id = ?
  `,
    [channelId],
  );

  sendTo(userId, { type: 'dm:created', channel });
}
