import { getDb } from '../adapters/index.js';
import { sendTo } from '../ws/index.js';
import { leaveVoiceChannel, handleVoiceEvent } from './signaling.js';
import { userVoiceChannels } from '../ws/handlers.js';
import { hasChannelPermission } from '../auth/permissions.js';
import type { JwtPayload } from '../auth/jwt.js';

// Map of userId -> AFK timer
const afkTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Called when a user's status changes to 'idle'.
 * Starts an AFK timer if they're in a voice channel with an AFK channel configured.
 */
export async function onUserIdle(userId: string) {
  if (afkTimers.has(userId)) return;

  const currentChannelId = userVoiceChannels.get(userId);
  if (!currentChannelId) return;

  const channel = await getDb().queryOne<{ server_id: string | null }>('SELECT server_id FROM channels WHERE id = ?', [currentChannelId]);
  if (!channel?.server_id) return;

  const server = await getDb().queryOne<{ afk_channel_id: string | null; afk_timeout: number }>('SELECT afk_channel_id, afk_timeout FROM servers WHERE id = ?', [channel.server_id]);
  if (!server?.afk_channel_id) return;

  if (currentChannelId === server.afk_channel_id) return;

  const afkChannelId = server.afk_channel_id;
  const timeout = (server.afk_timeout || 300) * 1000;

  const timer = setTimeout(async () => {
    afkTimers.delete(userId);
    // Re-read current AFK settings in case they changed while timer was running
    const currentChannel = userVoiceChannels.get(userId);
    if (!currentChannel) return;
    const ch = await getDb().queryOne<{ server_id: string | null }>('SELECT server_id FROM channels WHERE id = ?', [currentChannel]);
    if (!ch?.server_id) return;
    const srv = await getDb().queryOne<{ afk_channel_id: string | null }>('SELECT afk_channel_id FROM servers WHERE id = ?', [ch.server_id]);
    if (!srv?.afk_channel_id || currentChannel === srv.afk_channel_id) return;
    moveUserToAfk(userId, srv.afk_channel_id).catch((err) => {
      console.error('Failed to move user to AFK channel:', err);
    });
  }, timeout);

  afkTimers.set(userId, timer);
}

/**
 * Called when a user's status changes back to 'online' (or any non-idle status).
 */
export function onUserActive(userId: string) {
  clearAfkTimer(userId);
}

/**
 * Called when a user disconnects or leaves voice.
 */
export function clearAfkTimer(userId: string) {
  const timer = afkTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    afkTimers.delete(userId);
  }
}

/**
 * Move a user from their current voice channel to the AFK channel.
 */
async function moveUserToAfk(userId: string, afkChannelId: string) {
  const currentChannelId = userVoiceChannels.get(userId);
  if (!currentChannelId) return;
  if (currentChannelId === afkChannelId) return;

  const afkChannel = await getDb().queryOne<any>('SELECT id FROM channels WHERE id = ?', [afkChannelId]);
  if (!afkChannel) return;

  // Skip if user can't see or connect to the AFK channel
  if (!await hasChannelPermission(userId, afkChannelId, 'view_channel') ||
      !await hasChannelPermission(userId, afkChannelId, 'connect_voice')) return;

  const userRow = await getDb().queryOne<{ username: string; role: string }>('SELECT username, role FROM users WHERE id = ?', [userId]);
  if (!userRow) return;

  const user: JwtPayload = { userId, username: userRow.username, role: userRow.role, jti: '' };

  // Leave current channel
  leaveVoiceChannel(userId);

  // Join AFK channel
  await handleVoiceEvent(user, { type: 'voice:join', channelId: afkChannelId });

  // Notify the moved user
  sendTo(userId, { type: 'voice:afkMoved', channelId: afkChannelId });
}

/**
 * Check if a channel is the AFK channel for its server.
 */
export async function isAfkChannel(channelId: string): Promise<boolean> {
  const channel = await getDb().queryOne<{ server_id: string | null }>('SELECT server_id FROM channels WHERE id = ?', [channelId]);
  if (!channel?.server_id) return false;
  const server = await getDb().queryOne<{ afk_channel_id: string | null }>('SELECT afk_channel_id FROM servers WHERE id = ?', [channel.server_id]);
  return server?.afk_channel_id === channelId;
}
