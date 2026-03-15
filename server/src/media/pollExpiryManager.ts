import db from '../db/connection.js';
import { randomUUID } from 'crypto';
import { broadcastToChannel, sendToMany } from '../ws/index.js';

function getServerMemberUserIds(serverId: string): string[] {
  return (db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId) as { user_id: string }[])
    .map(r => r.user_id);
}

export async function checkExpiredPolls() {
  const now = new Date().toISOString();
  
  const expiredPolls = db.prepare(`
    SELECT * FROM polls 
    WHERE is_active = 1 
    AND ends_at IS NOT NULL 
    AND ends_at <= ?
  `).all(now) as any[];

  for (const poll of expiredPolls) {
    db.transaction(() => {
      // 1. Close the poll
      db.prepare('UPDATE polls SET is_active = 0 WHERE id = ?').run(poll.id);

      // 2. Get options and vote counts
      const options = db.prepare(`
        SELECT o.*, (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count
        FROM poll_options o
        WHERE o.poll_id = ?
      `).all(poll.id) as any[];

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
        db.prepare(`
          INSERT INTO messages (id, channel_id, user_id, content)
          VALUES (?, ?, ?, ?)
        `).run(messageId, poll.channel_id, poll.creator_id, resultText);

        // Fetch message for broadcast
        const message = db.prepare(`
          SELECT m.*, u.username, u.display_name, u.avatar_url,
                 r.color as role_color
          FROM messages m
          JOIN users u ON u.id = m.user_id
          LEFT JOIN roles r ON r.id = u.role_id
          WHERE m.id = ?
        `).get(messageId) as any;

        if (message) {
          broadcastToChannel(poll.channel_id, {
            type: 'chat:message',
            message: {
              ...message,
              pinned: !!message.pinned
            }
          } as any);
        }
      }

      // 5. Broadcast poll update to server (include isActive so clients close it)
      const memberIds = getServerMemberUserIds(poll.server_id);
      sendToMany(memberIds, {
        type: 'poll:updated',
        serverId: poll.server_id,
        pollId: poll.id,
        options: options.map(o => ({ id: o.id, vote_count: o.vote_count })),
        totalVotes: db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM poll_votes WHERE poll_id = ?').get(poll.id).c,
        isActive: false
      } as any);
    })();
  }
}

export function initPollExpiryManager() {
  // Check every 1 minute
  setInterval(checkExpiredPolls, 60 * 1000);
  // Also run once at startup
  checkExpiredPolls();
}
