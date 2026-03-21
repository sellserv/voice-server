import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import { broadcastToChannel, sendTo, sendToMany } from '../ws/index.js';

/**
 * Send welcome messages (channel + DM) for a user joining a specific server.
 * Safe to call multiple times — skips if bot is disabled or unconfigured.
 */
export function sendWelcomeMessages(userId: string, serverId: string) {
  const welcomeBot = db
    .prepare(
      `SELECT b.id, b.user_id, b.name, b.greeting, b.channel_id, b.dm_enabled, b.dm_greeting, b.server_id
       FROM bots b
       WHERE b.type = 'welcome' AND b.enabled = 1 AND b.server_id = ?`,
    )
    .get(serverId) as any;

  if (!welcomeBot) return;

  const newUser = db
    .prepare('SELECT username, display_name, avatar_url FROM users WHERE id = ?')
    .get(userId) as any;
  const botUser = db
    .prepare('SELECT username, avatar_url FROM users WHERE id = ?')
    .get(welcomeBot.user_id) as any;

  if (!newUser || !botUser) return;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Channel greeting
  if (welcomeBot.channel_id) {
    const channel = db.prepare('SELECT id FROM channels WHERE id = ?').get(welcomeBot.channel_id);
    if (channel) {
      const greeting = welcomeBot.greeting.replace(/\{user\}/g, `<@${userId}>`);
      const msgId = randomUUID();
      db.prepare(
        'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(msgId, welcomeBot.channel_id, welcomeBot.user_id, greeting, now);
      broadcastToChannel(welcomeBot.channel_id, {
        type: 'chat:message',
        message: {
          id: msgId,
          channel_id: welcomeBot.channel_id,
          user_id: welcomeBot.user_id,
          content: greeting,
          file_id: null,
          created_at: now,
          edited_at: null,
          username: botUser.username,
          display_name: welcomeBot.name,
          avatar_url: botUser.avatar_url,
        },
      });
    }
  }

  // DM greeting
  if (welcomeBot.dm_enabled && welcomeBot.dm_greeting) {
    const dmGreeting = welcomeBot.dm_greeting.replace(
      /\{user\}/g,
      newUser.display_name || newUser.username,
    );

    try {
      const dmChannelId = randomUUID();
      const dmMsgId = randomUUID();

      db.transaction(() => {
        db.prepare(
          "INSERT INTO channels (id, name, type, sort_order) VALUES (?, '', 'dm', 0)",
        ).run(dmChannelId);
        db.prepare('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)').run(
          dmChannelId,
          welcomeBot.user_id,
        );
        db.prepare('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)').run(
          dmChannelId,
          userId,
        );
        db.prepare(
          'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(dmMsgId, dmChannelId, welcomeBot.user_id, dmGreeting, now);
      })();

      const dmChannel = {
        id: dmChannelId,
        name: '',
        type: 'dm' as const,
        sort_order: 0,
        dm_participant_ids: [welcomeBot.user_id, userId],
        dm_participants: [
          {
            user_id: welcomeBot.user_id,
            username: botUser.username,
            display_name: welcomeBot.name,
            avatar_url: botUser.avatar_url,
          },
          {
            user_id: userId,
            username: newUser.username,
            display_name: newUser.display_name,
            avatar_url: newUser.avatar_url,
          },
        ],
      };

      sendTo(userId, { type: 'dm:created', channel: dmChannel } as any);

      const dmMessage = {
        id: dmMsgId,
        channel_id: dmChannelId,
        user_id: welcomeBot.user_id,
        content: dmGreeting,
        file_id: null,
        created_at: now,
        edited_at: null,
        username: botUser.username,
        display_name: welcomeBot.name,
        avatar_url: botUser.avatar_url,
      };
      sendToMany([welcomeBot.user_id, userId], {
        type: 'chat:message',
        message: dmMessage,
      } as any);
    } catch (err) {
      console.error('Failed to create welcome DM:', err);
    }
  }
}
