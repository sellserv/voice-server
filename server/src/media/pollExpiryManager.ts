import { getDb } from '../adapters/index.js';
import { randomUUID } from 'crypto';
import { broadcastToChannel, sendToMany } from '../ws/index.js';

async function getServerMemberUserIds(serverId: string): Promise<string[]> {
  return (await getDb().query<{ user_id: string }>('SELECT user_id FROM server_members WHERE server_id = ?', [serverId]))
    .map(r => r.user_id);
}

export async function checkExpiredPolls() {
  const now = new Date().toISOString();

  const expiredPolls = await getDb().query<any>(`
    SELECT * FROM polls
    WHERE is_active = 1
    AND ends_at IS NOT NULL
    AND ends_at <= ?
  `, [now]);

  for (const poll of expiredPolls) {
    // 1. Close the poll
    await getDb().run('UPDATE polls SET is_active = 0 WHERE id = ?', [poll.id]);

    // 2. Get options and vote counts
    const options = await getDb().query<any>(`
      SELECT o.*, (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count
      FROM poll_options o
      WHERE o.poll_id = ?
    `, [poll.id]);

    // 3. Determine winner(s)
    let maxVotes = -1;
    let winners: string[] = [];

    for (const opt of options) {
      if (opt.vote_count > maxVotes) {
        maxVotes = opt.vote_count;
        winners = [opt.text];
      } else if (opt.vote_count === maxVotes && maxVotes > 0) {
        winners.push(opt.text);
      }
    }

    // 4. Create announcement message
    let resultText = '';
    if (maxVotes === 0) {
      resultText = 'The poll ended with no votes.';
    } else if (winners.length === 1) {
      resultText = `The poll has ended! The winner is: **${winners[0]}** with ${maxVotes} votes.`;
    } else {
      resultText = `The poll has ended! It's a tie between: **${winners.join(', ')}** with ${maxVotes} votes each.`;
    }

    if (poll.channel_id) {
      const messageId = randomUUID();
      await getDb().run(`
        INSERT INTO messages (id, channel_id, user_id, content)
        VALUES (?, ?, ?, ?)
      `, [messageId, poll.channel_id, poll.creator_id, resultText]);

      // Fetch message for broadcast
      const message = await getDb().queryOne<any>(`
        SELECT m.*, u.username, u.display_name, u.avatar_url,
               r.color as role_color
        FROM messages m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE m.id = ?
      `, [messageId]);

      if (message) {
        await broadcastToChannel(poll.channel_id, {
          type: 'chat:message',
          message: {
            ...message,
            pinned: !!message.pinned
          }
        } as any);
      }
    }

    // 5. Broadcast poll update to server (include isActive so clients close it)
    const memberIds = await getServerMemberUserIds(poll.server_id);
    const totalVotesRow = await getDb().queryOne<any>('SELECT COUNT(DISTINCT user_id) as c FROM poll_votes WHERE poll_id = ?', [poll.id]);
    sendToMany(memberIds, {
      type: 'poll:updated',
      serverId: poll.server_id,
      pollId: poll.id,
      options: options.map(o => ({ id: o.id, vote_count: o.vote_count })),
      totalVotes: totalVotesRow.c,
      isActive: false
    } as any);
  }
}

export function initPollExpiryManager() {
  // Check every 1 minute
  setInterval(checkExpiredPolls, 60 * 1000);
  // Also run once at startup
  checkExpiredPolls();
}
