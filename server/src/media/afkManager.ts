import db from '../db/connection.js';
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
export function onUserIdle(userId: string) {
  if (afkTimers.has(userId)) return;

  const currentChannelId = userVoiceChannels.get(userId);
  if (!currentChannelId) return;

  const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(currentChannelId) as { server_id: string | null } | undefined;
  if (!channel?.server_id) return;

  const server = db.prepare('SELECT afk_channel_id, afk_timeout FROM servers WHERE id = ?').get(channel.server_id) as { afk_channel_id: string | null; afk_timeout: number } | undefined;
  if (!server?.afk_channel_id) return;

  if (currentChannelId === server.afk_channel_id) return;

  const afkChannelId = server.afk_channel_id;
  const timeout = (server.afk_timeout || 300) * 1000;

  const timer = setTimeout(() => {
    afkTimers.delete(userId);
    // Re-read current AFK settings in case they changed while timer was running
    const currentChannel = userVoiceChannels.get(userId);
    if (!currentChannel) return;
    const ch = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(currentChannel) as { server_id: string | null } | undefined;
    if (!ch?.server_id) return;
    const srv = db.prepare('SELECT afk_channel_id FROM servers WHERE id = ?').get(ch.server_id) as { afk_channel_id: string | null } | undefined;
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

  const afkChannel = db.prepare('SELECT id FROM channels WHERE id = ?').get(afkChannelId);
  if (!afkChannel) return;

  // Skip if user can't see or connect to the AFK channel
  if (!hasChannelPermission(userId, afkChannelId, 'view_channel') ||
      !hasChannelPermission(userId, afkChannelId, 'connect_voice')) return;

  const userRow = db.prepare('SELECT username, role FROM users WHERE id = ?').get(userId) as { username: string; role: string } | undefined;
  if (!userRow) return;

  const user: JwtPayload = { userId, username: userRow.username, role: userRow.role };

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
export function isAfkChannel(channelId: string): boolean {
  const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as { server_id: string | null } | undefined;
  if (!channel?.server_id) return false;
  const server = db.prepare('SELECT afk_channel_id FROM servers WHERE id = ?').get(channel.server_id) as { afk_channel_id: string | null } | undefined;
  return server?.afk_channel_id === channelId;
}
