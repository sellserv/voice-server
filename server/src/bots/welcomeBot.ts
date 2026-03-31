import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';
import { broadcastToChannel, sendTo, sendToMany } from '../ws/index.js';

/**
 * Send welcome messages (channel + DM) for a user joining a specific server.
 * Safe to call multiple times — skips if bot is disabled or unconfigured.
 */
export async function sendWelcomeMessages(userId: string, serverId: string) {
  const welcomeBot = await getDb().queryOne<any>(
    `SELECT b.id, b.user_id, b.name, b.greeting, b.channel_id, b.dm_enabled, b.dm_greeting, b.server_id
     FROM bots b
     WHERE b.type = 'welcome' AND b.enabled = 1 AND b.server_id = ?`,
    [serverId],
  );

  if (!welcomeBot) return;

  const newUser = await getDb().queryOne<any>(
    'SELECT username, display_name, avatar_url FROM users WHERE id = ?',
    [userId],
  );
  const botUser = await getDb().queryOne<any>(
    'SELECT username, avatar_url FROM users WHERE id = ?',
    [welcomeBot.user_id],
  );

  if (!newUser || !botUser) return;

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Channel greeting
  if (welcomeBot.channel_id) {
    const channel = await getDb().queryOne<{ id: string }>(
      'SELECT id FROM channels WHERE id = ?',
      [welcomeBot.channel_id],
    );
    if (channel) {
      const greeting = welcomeBot.greeting.replace(/\{user\}/g, `<@${userId}>`);
      const msgId = randomUUID();
      await getDb().run(
        'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
        [msgId, welcomeBot.channel_id, welcomeBot.user_id, greeting, now],
      );
      await broadcastToChannel(welcomeBot.channel_id, {
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

      await getDb().transaction(async (tx) => {
        await tx.run(
          "INSERT INTO channels (id, name, type, sort_order) VALUES (?, '', 'dm', 0)",
          [dmChannelId],
        );
        await tx.run('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)', [
          dmChannelId,
          welcomeBot.user_id,
        ]);
        await tx.run('INSERT INTO dm_participants (channel_id, user_id) VALUES (?, ?)', [
          dmChannelId,
          userId,
        ]);
        await tx.run(
          'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
          [dmMsgId, dmChannelId, welcomeBot.user_id, dmGreeting, now],
        );
      });

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
