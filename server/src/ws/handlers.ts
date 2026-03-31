import { randomUUID } from 'crypto';
import { getDb } from '../adapters/index.js';
import {
  broadcast,
  sendTo,
  sendToMany,
  setClientStatus,
  getDmParticipantIds,
  broadcastToChannel,
  broadcastToServer,
  getClient,
  getDisplayName,
  isUserOnline,
} from './index.js';
import { sendDataPush } from '../push/index.js';
import { shouldNotifyUser } from '../push/pending.js';
import { ensureDmChannel, notifyDmCreated } from './dmUtils.js';
import { handleVoiceEvent, leaveVoiceChannel, getPeersInChannel } from '../media/signaling.js';
import { hasPermission, hasChannelPermission, isAppEnabled, isPremium } from '../auth/permissions.js';
import type { JwtPayload } from '../auth/jwt.js';
import type { ClientEvent, Message } from '@voip-server/shared';
import { clearAfkTimer } from '../media/afkManager.js';
import { checkNewUserCooldown } from '../auth/cooldown.js';
import { processMessageForBots } from '../bots/botEngine.js';

// Limits
const FREE_MAX_MESSAGE_LENGTH = 2000;
const PRO_MAX_MESSAGE_LENGTH = 4000;
const MAX_EMOJI_LENGTH = 32;
const MAX_REPLY_PREVIEW_LENGTH = 200;

// Typing state: Map<channelId, Set<userId>>
const typingUsers = new Map<string, Set<string>>();
/** Clean up typing state for a deleted channel */
export function clearTypingForChannel(channelId: string) {
  typingUsers.delete(channelId);
}
// Track which voice channel each user is in
export const userVoiceChannels = new Map<string, string>();
// Voice departure tracking for missed call notifications
const voiceChannelDepartures = new Map<string, { userId: string; leftAt: number }[]>();

function recordVoiceDeparture(userId: string) {
  const channelId = userVoiceChannels.get(userId);
  if (!channelId) return;
  const departures = voiceChannelDepartures.get(channelId) || [];
  departures.push({ userId, leftAt: Date.now() });
  voiceChannelDepartures.set(
    channelId,
    departures.filter((d) => d.leftAt > Date.now() - 5 * 60 * 1000),
  );
}

// Watch Party sessions: Map<channelId, session data>
interface WatchSessionData {
  hostUserId: string;
  hostUsername: string;
  currentVideoId: string | null;
  queue: { videoId: string; title?: string; addedBy: string; addedByUsername: string }[];
  viewers: Set<string>;
  playbackState: 'playing' | 'paused';
  playbackTime: number;
  stateUpdatedAt: number;
}
const watchSessions = new Map<string, WatchSessionData>();

function getCurrentPlaybackTime(session: WatchSessionData): number {
  if (session.playbackState === 'paused') return session.playbackTime;
  return session.playbackTime + (Date.now() - session.stateUpdatedAt) / 1000;
}

async function getChannelServerId(channelId: string): Promise<string | null> {
  const row = await getDb().queryOne<{ server_id: string | null }>('SELECT server_id FROM channels WHERE id = ?', [channelId]);
  return row?.server_id ?? null;
}

async function isServerMember(userId: string, serverId: string): Promise<boolean> {
  return !!await getDb().queryOne<any>('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?', [serverId, userId]);
}

// Active soundboard playbacks: userId → Set of playbackIds
const activeSoundboardPlaybacks = new Map<string, Set<string>>();

// Effects rate limiting: userId → { count, windowStart }
const effectRateLimit = new Map<string, { count: number; windowStart: number }>();
const VALID_EFFECTS = ['confetti', 'fireworks', 'hearts', 'snow', 'money'];

// Call sessions
interface CallSession {
  id: string;
  callerId: string;
  recipientId: string;
  status: 'ringing' | 'active';
  timeout: ReturnType<typeof setTimeout>;
  video: boolean;
  startedAt?: number;
}
const activeCalls = new Map<string, CallSession>();

async function insertCallMessage(
  callerId: string,
  recipientId: string,
  callType: 'voice' | 'video',
  callStatus: 'missed' | 'rejected' | 'completed',
  duration?: number,
) {
  const channelId = await ensureDmChannel(callerId, recipientId);
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const metadata = JSON.stringify({
    call_type: callType,
    call_status: callStatus,
    ...(duration != null ? { duration } : {}),
  });

  await getDb().run(
    "INSERT INTO messages (id, channel_id, user_id, content, type, metadata, created_at) VALUES (?, ?, ?, '', 'call', ?, ?)",
    [id, channelId, callerId, metadata, now],
  );

  const callerRow = await getDb().queryOne<any>(
    'SELECT u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [callerId],
  );

  const message: Message = {
    id,
    channel_id: channelId,
    user_id: callerId,
    content: '',
    file_id: null,
    created_at: now,
    edited_at: null,
    username: callerRow?.username,
    display_name: callerRow?.display_name,
    avatar_url: callerRow?.avatar_url,
    role_color: callerRow?.role_color,
    name_font: callerRow?.name_font,
    name_color: callerRow?.name_color,
    type: 'call',
    metadata,
  };

  const participantIds = await getDmParticipantIds(channelId);
  sendToMany(participantIds, { type: 'chat:message', message });

  // Notify dm:created if channel is new (no prior messages)
  const msgCount = await getDb().queryOne<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?',
    [channelId],
  );
  if (msgCount && msgCount.cnt <= 1) {
    for (const uid of participantIds) {
      await notifyDmCreated(uid, channelId);
    }
  }
}

// Per-user message queue to serialize async voice/RTC events
const userQueues = new Map<string, Promise<void>>();

function enqueueForUser(userId: string, fn: () => Promise<void>) {
  const prev = userQueues.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn even if previous rejected
  userQueues.set(userId, next);
}

export async function handleMessage(user: JwtPayload, event: ClientEvent) {
  switch (event.type) {
    case 'chat:send':
      await handleChatSend(user, event.channelId, event.content, event.fileId, event.replyToId);
      break;
    case 'chat:edit':
      await handleChatEdit(user, event.messageId, event.content);
      break;
    case 'chat:delete':
      await handleChatDelete(user, event.messageId);
      break;
    case 'typing:start':
      await handleTyping(user, event.channelId, true);
      break;
    case 'typing:stop':
      await handleTyping(user, event.channelId, false);
      break;
    case 'message:react':
      await handleReact(user, event.messageId, event.emoji);
      break;
    case 'message:unreact':
      await handleUnreact(user, event.messageId, event.emoji);
      break;
    case 'dm:open':
      await handleDmOpen(user, event.targetUserId);
      break;
    case 'presence:setStatus':
      await setClientStatus(user.userId, event.status);
      break;
    case 'presence:activity':
      handlePresenceActivity(user, event.game, event.visibility, event.serverIds);
      break;
    case 'ws:ping':
      sendTo(user.userId, { type: 'ws:pong', timestamp: event.timestamp });
      break;
    case 'voice:join':
      clearAfkTimer(user.userId);
      if (!event.channelId.startsWith('call:')) {
        const voiceServerId = await getChannelServerId(event.channelId);
        if (voiceServerId && !await isServerMember(user.userId, voiceServerId)) {
          sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
          break;
        }
        if (!await hasChannelPermission(user.userId, event.channelId, 'connect_voice')) {
          sendTo(user.userId, {
            type: 'error',
            message: 'You do not have permission to join voice channels',
          });
          break;
        }
        if (!await hasChannelPermission(user.userId, event.channelId, 'view_channel')) {
          sendTo(user.userId, { type: 'error', message: 'You do not have access to this channel' });
          break;
        }
      }
      enqueueForUser(user.userId, async () => {
        await handleVoiceEvent(user, event);
        // Late-joiner: send existing watch session data
        const joinedChannel = userVoiceChannels.get(user.userId);
        if (joinedChannel) {
          const session = watchSessions.get(joinedChannel);
          if (session) {
            sendTo(user.userId, {
              type: 'watch:started',
              channelId: joinedChannel,
              hostUserId: session.hostUserId,
              hostUsername: await getHostUsername(session.hostUserId),
              videoId: session.currentVideoId,
            });
            sendTo(user.userId, {
              type: 'watch:queueUpdated',
              channelId: joinedChannel,
              queue: session.queue,
              currentVideoId: session.currentVideoId,
            });
            sendTo(user.userId, {
              type: 'watch:viewersUpdated',
              channelId: joinedChannel,
              viewers: await getViewerDetails(session.viewers),
            });
            // Send current playback position so late joiner can seek
            sendTo(user.userId, {
              type: 'watch:synced',
              state: session.playbackState,
              time: getCurrentPlaybackTime(session),
            });
          }

          // Missed call push notifications for recently departed users
          const recentlyLeft = voiceChannelDepartures.get(joinedChannel) || [];
          const fiveMinAgo = Date.now() - 5 * 60 * 1000;
          const ch = await getDb().queryOne<{ name: string; server_id: string | null }>('SELECT name, server_id FROM channels WHERE id = ?', [joinedChannel]);
          if (ch) {
            for (const departure of recentlyLeft) {
              if (departure.leftAt > fiveMinAgo && departure.userId !== user.userId && !isUserOnline(departure.userId)) {
                sendDataPush(departure.userId, 'missed_call', {
                  channelId: joinedChannel,
                  serverId: ch.server_id || '',
                  callerName: await getDisplayName(user.userId) || user.username,
                  channelName: ch.name,
                }).catch(() => {});
              }
            }
          }
        }
      });
      break;
    case 'screen:start': {
      const screenChannelId = userVoiceChannels.get(user.userId);
      if (!screenChannelId || !await hasChannelPermission(user.userId, screenChannelId, 'share_screen')) {
        sendTo(user.userId, {
          type: 'error',
          message: 'You do not have permission to share your screen',
        });
        break;
      }
      enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      break;
    }
    case 'voice:leave': {
      clearAfkTimer(user.userId);
      recordVoiceDeparture(user.userId);
      removeWatchViewer(user.userId);
      cleanupWatchSession(user.userId);
      enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      break;
    }
    case 'voice:disconnect':
      if (!await hasPermission(user.userId, 'administrator')) {
        sendTo(user.userId, {
          type: 'error',
          message: 'You do not have permission to disconnect users',
        });
        break;
      }
      clearAfkTimer(event.userId);
      removeWatchViewer(event.userId);
      cleanupWatchSession(event.userId);
      recordVoiceDeparture(event.userId);
      leaveVoiceChannel(event.userId);
      break;
    case 'voice:mute':
    case 'voice:deafen':
    case 'rtc:getRouterCapabilities':
    case 'rtc:createTransport':
    case 'rtc:connectTransport':
    case 'rtc:produce':
    case 'rtc:consume':
    case 'rtc:resumeConsumer':
      enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      break;
    case 'watch:start':
      await handleWatchStart(user, event.videoUrl);
      break;
    case 'watch:sync':
      handleWatchSync(user, event.state, event.time, event.pingMs);
      break;
    case 'watch:stop':
      handleWatchStop(user);
      break;
    case 'watch:queue':
      await handleWatchQueue(user, event.videoUrl);
      break;
    case 'watch:skip':
      handleWatchSkip(user);
      break;
    case 'watch:next':
      handleWatchNext(user);
      break;
    case 'watch:join':
      await handleWatchJoin(user);
      break;
    case 'watch:leave':
      handleWatchLeave(user);
      break;
    case 'watch:transferHost':
      await handleWatchTransferHost(user, event.targetUserId);
      break;
    case 'call:initiate':
      await handleCallInitiate(user, event.targetUserId, !!event.video);
      break;
    case 'call:accept':
      handleCallAccept(user, event.callId);
      break;
    case 'call:reject':
      await handleCallReject(user, event.callId);
      break;
    case 'call:end':
      await handleCallEnd(user, event.callId);
      break;
    case 'message:pin':
      await handleMessagePin(user, event.messageId);
      break;
    case 'message:unpin':
      await handleMessageUnpin(user, event.messageId);
      break;
    case 'effect:send':
      await handleEffectSend(user, event.channelId, event.effect);
      break;
    case 'poll:vote':
      await handlePollVote(user, event.pollId, event.optionIds);
      break;
    default:
      if (event.type === 'soundboard:play') {
        await handleSoundboardPlay(user, event.soundId);
      } else if (event.type === 'screen:stop') {
        enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      } else {
        sendTo(user.userId, { type: 'error', message: 'Unknown event type' });
      }
  }
}

async function handleChatSend(
  user: JwtPayload,
  channelId: string,
  content: string,
  fileId?: string,
  replyToId?: string,
) {
  if (!await hasChannelPermission(user.userId, channelId, 'send_messages')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to send messages' });
    return;
  }
  if (fileId && !await hasChannelPermission(user.userId, channelId, 'upload_files')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to upload files' });
    return;
  }
  if (!content?.trim() && !fileId) {
    sendTo(user.userId, { type: 'error', message: 'Message cannot be empty' });
    return;
  }

  // Validate message content length (#13)
  const maxLen = await isPremium(user.userId) ? PRO_MAX_MESSAGE_LENGTH : FREE_MAX_MESSAGE_LENGTH;
  if (content && content.length > maxLen) {
    sendTo(user.userId, {
      type: 'error',
      message: `Message too long (max ${maxLen} characters)`,
    });
    return;
  }

  const channel = await getDb().queryOne<{ id: string; type: string; server_id: string | null; name: string }>(
    'SELECT id, type, server_id, name FROM channels WHERE id = ?',
    [channelId],
  );
  if (!channel || channel.type === 'voice') {
    sendTo(user.userId, { type: 'error', message: 'Text channel not found' });
    return;
  }

  // Verify server membership for server channels
  if (channel.server_id && !await isServerMember(user.userId, channel.server_id)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  // Channel access control check
  if (channel.type !== 'dm' && !await hasChannelPermission(user.userId, channelId, 'view_channel')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have access to this channel' });
    return;
  }

  // For DM channels, verify sender is a participant and enforce new-user cooldown
  if (channel.type === 'dm') {
    const participant = await getDb().queryOne<any>(
      'SELECT 1 FROM dm_participants WHERE channel_id = ? AND user_id = ?',
      [channelId, user.userId],
    );
    if (!participant) {
      sendTo(user.userId, { type: 'error', message: 'Not a participant of this DM' });
      return;
    }
    const cooldown = await checkNewUserCooldown(user.userId);
    if (cooldown.restricted) {
      sendTo(user.userId, {
        type: 'error',
        message: `New accounts cannot send direct messages yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
      });
      return;
    }
  }

  // Validate file ownership (#9)
  if (fileId) {
    const file = await getDb().queryOne<{ user_id: string }>(
      'SELECT user_id FROM files WHERE id = ?',
      [fileId],
    );
    if (!file || file.user_id !== user.userId) {
      sendTo(user.userId, { type: 'error', message: 'Invalid file attachment' });
      return;
    }
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  // Validate reply reference — must be in the same channel
  let validReplyToId: string | null = null;
  if (replyToId) {
    const replyMsg = await getDb().queryOne<any>(
      'SELECT id FROM messages WHERE id = ? AND channel_id = ?',
      [replyToId, channelId],
    );
    if (replyMsg) validReplyToId = replyToId;
  }

  await getDb().run(
    'INSERT INTO messages (id, channel_id, user_id, content, file_id, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, channelId, user.userId, content?.trim() || '', fileId || null, validReplyToId, now],
  );

  // Resolve file MIME type for attachments
  let fileMimeType: string | null = null;
  if (fileId) {
    const fileRow = await getDb().queryOne<{ mime_type: string }>(
      'SELECT mime_type FROM files WHERE id = ?',
      [fileId],
    );
    fileMimeType = fileRow?.mime_type ?? null;
  }

  // Resolve reply preview data
  let replyData: Record<string, string | undefined> = {};
  if (validReplyToId) {
    const replyRow = await getDb().queryOne<any>(
      'SELECT rm.content, ru.username, ru.display_name FROM messages rm JOIN users ru ON ru.id = rm.user_id WHERE rm.id = ?',
      [validReplyToId],
    );
    if (replyRow) {
      replyData = {
        reply_to_username: replyRow.username,
        reply_to_display_name: replyRow.display_name,
        reply_to_content: replyRow.content,
      };
    }
  }

  const userRow = await getDb().queryOne<any>(
    'SELECT u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [user.userId],
  );

  const message: Message = {
    id,
    channel_id: channelId,
    user_id: user.userId,
    content: content?.trim() || '',
    file_id: fileId || null,
    file_mime_type: fileMimeType,
    created_at: now,
    edited_at: null,
    username: userRow.username,
    display_name: userRow.display_name,
    avatar_url: userRow.avatar_url,
    role_color: userRow.role_color,
    name_font: userRow.name_font,
    name_color: userRow.name_color,
    reply_to_id: validReplyToId,
    invite_id: null,
    ...replyData,
  };

  // Bot processing (#14 Automod, etc)
  if (channel.server_id) {
    const shouldDelete = await processMessageForBots(channel.server_id, message);
    if (shouldDelete) {
      await getDb().run('DELETE FROM messages WHERE id = ?', [id]);
      return;
    }
  }

  // Scope delivery: DM channels send only to participants, restricted channels to allowed users
  if (channel.type === 'dm') {
    const participantIds = await getDmParticipantIds(channelId);
    // On first message, notify the other participant so the DM appears in their list
    const msgCount = await getDb().queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM messages WHERE channel_id = ?',
      [channelId],
    );
    if (msgCount && msgCount.count <= 1) {
      const dmChannel = await getDb().queryOne<any>('SELECT * FROM channels WHERE id = ?', [channelId]);
      dmChannel.dm_participant_ids = participantIds;
      dmChannel.dm_participants = await getDb().query(
        'SELECT u.id, u.username, u.display_name, u.avatar_url FROM dm_participants dp JOIN users u ON u.id = dp.user_id WHERE dp.channel_id = ?',
        [channelId],
      );
      for (const pid of participantIds) {
        if (pid !== user.userId) {
          sendTo(pid, { type: 'dm:created', channel: dmChannel });
        }
      }
    }
    sendToMany(participantIds, { type: 'chat:message', message });

    // Push notifications for offline DM participants
    for (const pid of participantIds) {
      if (pid !== user.userId && !isUserOnline(pid) && await shouldNotifyUser(pid, channelId, null, 'dm')) {
        sendDataPush(pid, 'dm', {
          channelId,
          senderId: user.userId,
          senderName: userRow.display_name || userRow.username,
        }).catch((err) => console.error('Push notification failed:', err));
      }
    }
  } else {
    await broadcastToChannel(channelId, { type: 'chat:message', message, ...(channel.server_id ? { serverId: channel.server_id } : {}) });

    // Push notifications for @mentions to offline users
    const mentionRegex = /<@([^>]+)>/g;
    let mentionMatch;
    const mentionedUserIds = new Set<string>();
    while ((mentionMatch = mentionRegex.exec(content || '')) !== null) {
      const mentionedUserId = mentionMatch[1];
      if (mentionedUserId !== user.userId && !mentionedUserIds.has(mentionedUserId) && !isUserOnline(mentionedUserId) && await shouldNotifyUser(mentionedUserId, channelId, channel.server_id, 'mention')) {
        mentionedUserIds.add(mentionedUserId);
        sendDataPush(mentionedUserId, 'mention', {
          channelId,
          serverId: channel.server_id || '',
          senderName: userRow.display_name || userRow.username,
          channelName: channel.name,
        }).catch((err) => console.error('Push notification failed:', err));
      }
    }

    // Push notifications for @everyone/@here
    if (content && (content.includes('@everyone') || content.includes('@here'))) {
      const serverMembers = await getDb().query<{ user_id: string }>('SELECT user_id FROM server_members WHERE server_id = ?', [channel.server_id]);
      for (const { user_id: memberId } of serverMembers) {
        if (memberId !== user.userId && !mentionedUserIds.has(memberId) && !isUserOnline(memberId) && await shouldNotifyUser(memberId, channelId, channel.server_id, 'everyone')) {
          sendDataPush(memberId, 'everyone', {
            channelId,
            serverId: channel.server_id || '',
            senderName: userRow.display_name || userRow.username,
            channelName: channel.name,
          }).catch((err) => console.error('Push notification failed:', err));
        }
      }
    }

    // Push notifications for guild channel messages (users with 'all' notification level)
    if (channel.server_id) {
      const serverMembers = await getDb().query<{ user_id: string }>('SELECT user_id FROM server_members WHERE server_id = ?', [channel.server_id]);
      for (const { user_id: memberId } of serverMembers) {
        if (memberId !== user.userId && !mentionedUserIds.has(memberId) && !isUserOnline(memberId) && await shouldNotifyUser(memberId, channelId, channel.server_id, 'channel_message')) {
          sendDataPush(memberId, 'channel_message', {
            channelId,
            serverId: channel.server_id || '',
            senderName: userRow.display_name || userRow.username,
            channelName: channel.name,
          }).catch((err) => console.error('Push notification failed:', err));
        }
      }
    }
  }

  // Clear typing for this user in this channel
  await handleTyping(user, channelId, false);
}

async function handleChatEdit(user: JwtPayload, messageId: string, content: string) {
  const editMaxLen = await isPremium(user.userId) ? PRO_MAX_MESSAGE_LENGTH : FREE_MAX_MESSAGE_LENGTH;
  if (!content || content.length > editMaxLen) {
    sendTo(user.userId, {
      type: 'error',
      message: `Message must be 1-${editMaxLen} characters`,
    });
    return;
  }

  const msg = await getDb().queryOne<any>('SELECT * FROM messages WHERE id = ?', [messageId]);
  if (!msg) return;

  // Verify server membership
  const editServerId = await getChannelServerId(msg.channel_id);
  if (editServerId && !await isServerMember(user.userId, editServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  if (
    msg.user_id !== user.userId &&
    !await hasChannelPermission(user.userId, msg.channel_id, 'manage_messages')
  ) {
    sendTo(user.userId, { type: 'error', message: "Cannot edit others' messages" });
    return;
  }

  const now = new Date().toISOString();
  await getDb().run('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?', [
    content.trim(),
    now,
    messageId,
  ]);

  const userRow = await getDb().queryOne<any>(
    'SELECT u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    [msg.user_id],
  );

  const updated: Message = {
    ...msg,
    content: content.trim(),
    edited_at: now,
    username: userRow.username,
    display_name: userRow.display_name,
    avatar_url: userRow.avatar_url,
    role_color: userRow.role_color,
    name_font: userRow.name_font,
    name_color: userRow.name_color,
  };

  const ch = await getDb().queryOne<{ type: string }>('SELECT type FROM channels WHERE id = ?', [msg.channel_id]);
  if (ch?.type === 'dm') {
    sendToMany(await getDmParticipantIds(msg.channel_id), { type: 'chat:edited', message: updated });
  } else {
    await broadcastToChannel(msg.channel_id, { type: 'chat:edited', message: updated, ...(editServerId ? { serverId: editServerId } : {}) });
  }
}

async function handleChatDelete(user: JwtPayload, messageId: string) {
  const msg = await getDb().queryOne<any>('SELECT * FROM messages WHERE id = ?', [messageId]);
  if (!msg) return;

  // Verify server membership
  const deleteServerId = await getChannelServerId(msg.channel_id);
  if (deleteServerId && !await isServerMember(user.userId, deleteServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  // Users with manage_messages or administrators can delete any message, users can delete their own
  if (
    msg.user_id !== user.userId &&
    !await hasChannelPermission(user.userId, msg.channel_id, 'manage_messages')
  ) {
    sendTo(user.userId, { type: 'error', message: "Cannot delete others' messages" });
    return;
  }

  await getDb().run('DELETE FROM messages WHERE id = ?', [messageId]);

  const ch = await getDb().queryOne<{ type: string }>('SELECT type FROM channels WHERE id = ?', [msg.channel_id]);
  if (ch?.type === 'dm') {
    sendToMany(await getDmParticipantIds(msg.channel_id), {
      type: 'chat:deleted',
      messageId,
      channelId: msg.channel_id,
    });
  } else {
    await broadcastToChannel(msg.channel_id, {
      type: 'chat:deleted',
      messageId,
      channelId: msg.channel_id,
      ...(deleteServerId ? { serverId: deleteServerId } : {}),
    });
  }
}

async function handleTyping(user: JwtPayload, channelId: string, isTyping: boolean) {
  // Verify channel access
  if (!await hasChannelPermission(user.userId, channelId, 'view_channel')) return;

  if (isTyping) {
    if (!typingUsers.has(channelId)) typingUsers.set(channelId, new Set());
    typingUsers.get(channelId)!.add(user.userId);
  } else {
    typingUsers.get(channelId)?.delete(user.userId);
  }

  const ch = await getDb().queryOne<{ type: string }>('SELECT type FROM channels WHERE id = ?', [channelId]);
  if (ch?.type === 'dm') {
    sendToMany(
      await getDmParticipantIds(channelId),
      { type: 'typing:update', channelId, userId: user.userId, username: user.username, isTyping },
      user.userId,
    );
  } else {
    await broadcastToChannel(
      channelId,
      { type: 'typing:update', channelId, userId: user.userId, username: user.username, isTyping },
      user.userId,
    );
  }
}

async function handleReact(user: JwtPayload, messageId: string, emoji: string) {
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) {
    sendTo(user.userId, { type: 'error', message: 'Invalid emoji' });
    return;
  }

  const msg = await getDb().queryOne<any>('SELECT channel_id FROM messages WHERE id = ?', [messageId]);
  if (!msg) return;

  // Verify channel access
  if (!await hasChannelPermission(user.userId, msg.channel_id, 'view_channel')) return;

  if (!await hasChannelPermission(user.userId, msg.channel_id, 'add_reactions')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to add reactions' });
    return;
  }

  await getDb().run('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [
    messageId,
    user.userId,
    emoji,
  ]);

  const ch = await getDb().queryOne<{ type: string }>('SELECT type FROM channels WHERE id = ?', [msg.channel_id]);
  if (ch?.type === 'dm') {
    sendToMany(await getDmParticipantIds(msg.channel_id), {
      type: 'message:reacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  } else {
    await broadcastToChannel(msg.channel_id, {
      type: 'message:reacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  }
}

async function handleUnreact(user: JwtPayload, messageId: string, emoji: string) {
  const msg = await getDb().queryOne<any>('SELECT channel_id FROM messages WHERE id = ?', [messageId]);
  if (!msg) return;

  // Verify channel access
  if (!await hasChannelPermission(user.userId, msg.channel_id, 'view_channel')) return;

  await getDb().run('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [
    messageId,
    user.userId,
    emoji,
  ]);

  const ch = await getDb().queryOne<{ type: string }>('SELECT type FROM channels WHERE id = ?', [msg.channel_id]);
  if (ch?.type === 'dm') {
    sendToMany(await getDmParticipantIds(msg.channel_id), {
      type: 'message:unreacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  } else {
    await broadcastToChannel(msg.channel_id, {
      type: 'message:unreacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  }
}

async function handleSoundboardPlay(user: JwtPayload, soundId: string) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const serverId = await getChannelServerId(channelId);
  if (!await hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !await isAppEnabled('soundboard', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Soundboard is not available' });
    return;
  }

  const sound = await getDb().queryOne<any>(
    'SELECT s.*, f.stored_name FROM soundboard_sounds s JOIN files f ON f.id = s.file_id WHERE s.id = ?',
    [soundId],
  );
  if (!sound) {
    sendTo(user.userId, { type: 'error', message: 'Sound not found' });
    return;
  }

  // Verify server membership for the voice channel
  const sbServerId = await getChannelServerId(channelId);
  if (sbServerId && !await isServerMember(user.userId, sbServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  const playbackId = randomUUID();

  // Track this playback for the user
  if (!activeSoundboardPlaybacks.has(user.userId)) {
    activeSoundboardPlaybacks.set(user.userId, new Set());
  }
  activeSoundboardPlaybacks.get(user.userId)!.add(playbackId);

  // Get all peers in the channel
  const peers = getPeersInChannel(channelId);
  const soundUrl = `/uploads/${sound.stored_name}`;

  for (const peerId of peers) {
    sendTo(peerId, {
      type: 'soundboard:play',
      playbackId,
      soundUrl,
      soundName: sound.name,
      userId: user.userId,
      username: user.username,
    });
  }
}

export function cleanupSoundboardForUser(userId: string) {
  const playbackIds = activeSoundboardPlaybacks.get(userId);
  if (!playbackIds || playbackIds.size === 0) return;

  const channelId = userVoiceChannels.get(userId);
  if (!channelId) {
    activeSoundboardPlaybacks.delete(userId);
    return;
  }

  const peers = getPeersInChannel(channelId);
  for (const playbackId of playbackIds) {
    for (const peerId of peers) {
      sendTo(peerId, { type: 'soundboard:stop', playbackId });
    }
  }
  activeSoundboardPlaybacks.delete(userId);
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // youtube.com/watch?v=ID
    if (
      (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com') &&
      parsed.pathname === '/watch'
    ) {
      return parsed.searchParams.get('v') || null;
    }
    // youtube.com/shorts/ID
    if (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com') {
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
    // youtu.be/ID
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function handleWatchStart(user: JwtPayload, videoUrl?: string) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) {
    sendTo(user.userId, {
      type: 'error',
      message: 'Must be in a voice channel or call to start Watch Party',
    });
    return;
  }

  const serverId = await getChannelServerId(channelId);
  if (!await hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !await isAppEnabled('watch-party', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Watch Party is not available' });
    return;
  }

  let videoId: string | null = null;
  if (videoUrl) {
    videoId = extractYouTubeVideoId(videoUrl);
    if (!videoId) {
      sendTo(user.userId, { type: 'error', message: 'Invalid YouTube URL' });
      return;
    }
  }

  // Store session with expanded data
  const session: WatchSessionData = {
    hostUserId: user.userId,
    hostUsername: user.username,
    currentVideoId: videoId,
    queue: [],
    viewers: new Set([user.userId]),
    playbackState: 'paused',
    playbackTime: 0,
    stateUpdatedAt: Date.now(),
  };
  watchSessions.set(channelId, session);

  // Broadcast to all peers in channel
  const peers = getPeersInChannel(channelId);
  for (const peerId of peers) {
    sendTo(peerId, {
      type: 'watch:started',
      channelId,
      hostUserId: user.userId,
      hostUsername: user.username,
      videoId,
    });
  }

  broadcastViewers(channelId);
  broadcastQueue(channelId);
}

function handleWatchSync(
  user: JwtPayload,
  state: 'playing' | 'paused',
  time: number,
  pingMs?: number,
) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const session = watchSessions.get(channelId);
  if (!session || session.hostUserId !== user.userId) return;

  // Validate bounds
  if (!Number.isFinite(time) || time < 0) return;
  const clampedPing = Math.max(0, Math.min(pingMs ?? 0, 10000));

  // Adjust incoming time by host's half-RTT to compensate for network delay
  const adjustedTime = time + clampedPing / 2 / 1000;

  // Store authoritative playback state
  session.playbackState = state;
  session.playbackTime = adjustedTime;
  session.stateUpdatedAt = Date.now();

  // Broadcast computed current time to peers except the host
  const peers = getPeersInChannel(channelId);
  const currentTime = getCurrentPlaybackTime(session);
  for (const peerId of peers) {
    if (peerId !== user.userId) {
      sendTo(peerId, { type: 'watch:synced', state, time: currentTime });
    }
  }
}

function handleWatchStop(user: JwtPayload) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const session = watchSessions.get(channelId);
  if (!session || session.hostUserId !== user.userId) return;

  watchSessions.delete(channelId);

  const peers = getPeersInChannel(channelId);
  for (const peerId of peers) {
    sendTo(peerId, { type: 'watch:stopped', channelId });
  }
}

async function fetchYouTubeTitle(videoId: string): Promise<string | undefined> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return data.title || undefined;
    }
  } catch {}
  return undefined;
}

async function handleWatchQueue(user: JwtPayload, videoUrl: string) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const serverId = await getChannelServerId(channelId);
  if (!await hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !await isAppEnabled('watch-party', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Watch Party is not available' });
    return;
  }

  const session = watchSessions.get(channelId);
  if (!session) return;

  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    sendTo(user.userId, { type: 'error', message: 'Invalid YouTube URL' });
    return;
  }

  const title = await fetchYouTubeTitle(videoId);

  // If no current video, auto-play it
  if (!session.currentVideoId) {
    session.currentVideoId = videoId;
    broadcastSessionUpdated(channelId);
  } else {
    session.queue.push({ videoId, title, addedBy: user.userId, addedByUsername: user.username });
  }

  broadcastQueue(channelId);
}

function handleWatchSkip(user: JwtPayload) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const session = watchSessions.get(channelId);
  if (!session || session.hostUserId !== user.userId) return;

  advanceQueue(channelId);
}

function handleWatchNext(user: JwtPayload) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const session = watchSessions.get(channelId);
  if (!session || session.hostUserId !== user.userId) return;

  advanceQueue(channelId);
}

function advanceQueue(channelId: string) {
  const session = watchSessions.get(channelId);
  if (!session) return;

  const next = session.queue.shift();
  session.currentVideoId = next?.videoId ?? null;

  // Reset playback state for the new video
  session.playbackState = 'paused';
  session.playbackTime = 0;
  session.stateUpdatedAt = Date.now();

  broadcastSessionUpdated(channelId);
  broadcastQueue(channelId);
}

async function handleWatchJoin(user: JwtPayload) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const serverId = await getChannelServerId(channelId);
  if (!await hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !await isAppEnabled('watch-party', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Watch Party is not available' });
    return;
  }

  const session = watchSessions.get(channelId);
  if (!session) return;

  session.viewers.add(user.userId);
  broadcastViewers(channelId);

  // Send current queue to just this user
  sendTo(user.userId, {
    type: 'watch:queueUpdated',
    channelId,
    queue: session.queue,
    currentVideoId: session.currentVideoId,
  });
}

function handleWatchLeave(user: JwtPayload) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const session = watchSessions.get(channelId);
  if (!session) return;

  session.viewers.delete(user.userId);
  broadcastViewers(channelId);
}

async function handleWatchTransferHost(user: JwtPayload, targetUserId: string) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const session = watchSessions.get(channelId);
  if (!session || session.hostUserId !== user.userId) return;

  // Verify target is in the same voice channel
  const targetChannel = userVoiceChannels.get(targetUserId);
  if (targetChannel !== channelId) {
    sendTo(user.userId, { type: 'error', message: 'Target user is not in the same voice channel' });
    return;
  }

  const targetRow = await getDb().queryOne<{ username: string }>('SELECT username FROM users WHERE id = ?', [targetUserId]);
  if (!targetRow) return;

  session.hostUserId = targetUserId;
  session.hostUsername = targetRow.username;

  broadcastSessionUpdated(channelId);
}

async function broadcastViewers(channelId: string) {
  const session = watchSessions.get(channelId);
  if (!session) return;

  const viewers = await getViewerDetails(session.viewers);

  const peers = getPeersInChannel(channelId);
  for (const peerId of peers) {
    sendTo(peerId, { type: 'watch:viewersUpdated', channelId, viewers });
  }
}

function broadcastQueue(channelId: string) {
  const session = watchSessions.get(channelId);
  if (!session) return;

  const peers = getPeersInChannel(channelId);
  for (const peerId of peers) {
    sendTo(peerId, {
      type: 'watch:queueUpdated',
      channelId,
      queue: session.queue,
      currentVideoId: session.currentVideoId,
    });
  }
}

function broadcastSessionUpdated(channelId: string) {
  const session = watchSessions.get(channelId);
  if (!session) return;

  const peers = getPeersInChannel(channelId);
  for (const peerId of peers) {
    sendTo(peerId, {
      type: 'watch:sessionUpdated',
      channelId,
      hostUserId: session.hostUserId,
      hostUsername: session.hostUsername,
      videoId: session.currentVideoId,
    });
  }
}

function removeWatchViewer(userId: string) {
  for (const [channelId, session] of watchSessions) {
    if (session.viewers.has(userId)) {
      session.viewers.delete(userId);
      broadcastViewers(channelId);
      break;
    }
  }
}

async function getHostUsername(hostUserId: string): Promise<string> {
  const row = await getDb().queryOne<{ username: string }>('SELECT username FROM users WHERE id = ?', [hostUserId]);
  return row?.username ?? 'Unknown';
}

async function getViewerDetails(
  viewers: Set<string>,
): Promise<{ userId: string; username: string; display_name?: string; avatar_url?: string | null }[]> {
  const results = await Promise.all(Array.from(viewers).map(async (userId) => {
    // Use cached client data when available, fall back to DB for offline users
    const client = getClient(userId);
    if (client) {
      return {
        userId,
        username: client.user.username,
        display_name: client.display_name,
        avatar_url: client.avatar_url,
      };
    }
    const row = await getDb().queryOne<any>('SELECT id, username, display_name, avatar_url FROM users WHERE id = ?', [userId]);
    return row
      ? {
          userId: row.id,
          username: row.username,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
        }
      : null;
  }));
  return results.filter((v): v is NonNullable<typeof v> => v !== null);
}

export function cleanupWatchSession(userId: string) {
  // Find and clean up any watch session hosted by this user
  for (const [channelId, session] of watchSessions) {
    if (session.hostUserId === userId) {
      watchSessions.delete(channelId);
      const peers = getPeersInChannel(channelId);
      for (const peerId of peers) {
        sendTo(peerId, { type: 'watch:stopped', channelId });
      }
      break;
    }
  }
}

async function handleEffectSend(user: JwtPayload, channelId: string, effect: string) {
  const serverId = await getChannelServerId(channelId);
  if (!await hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !await isAppEnabled('effects', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Effects are not available' });
    return;
  }

  if (!VALID_EFFECTS.includes(effect)) {
    sendTo(user.userId, { type: 'error', message: 'Invalid effect' });
    return;
  }

  // Verify server membership
  const effectServerId = await getChannelServerId(channelId);
  if (effectServerId && !await isServerMember(user.userId, effectServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  if (!await hasChannelPermission(user.userId, channelId, 'view_channel')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have access to this channel' });
    return;
  }

  // Rate limit: 3 per 10 seconds
  const now = Date.now();
  let rate = effectRateLimit.get(user.userId);
  if (!rate || now - rate.windowStart > 10_000) {
    rate = { count: 0, windowStart: now };
    effectRateLimit.set(user.userId, rate);
  }
  rate.count++;
  if (rate.count > 3) {
    sendTo(user.userId, { type: 'error', message: 'Too many effects, slow down!' });
    return;
  }

  await broadcastToChannel(channelId, {
    type: 'effect:play',
    channelId,
    effect,
    userId: user.userId,
    username: user.username,
  });
}

async function handleMessagePin(user: JwtPayload, messageId: string) {
  const msg = await getDb().queryOne<any>('SELECT * FROM messages WHERE id = ?', [messageId]);
  if (!msg) return;

  if (!await hasChannelPermission(user.userId, msg.channel_id, 'pin_messages')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to pin messages' });
    return;
  }

  await getDb().run('UPDATE messages SET pinned = 1, pinned_by = ? WHERE id = ?', [
    user.userId,
    messageId,
  ]);

  await broadcastToChannel(msg.channel_id, {
    type: 'message:pinned',
    messageId,
    channelId: msg.channel_id,
    pinnedBy: user.userId,
  });
}

async function handleMessageUnpin(user: JwtPayload, messageId: string) {
  const msg = await getDb().queryOne<any>('SELECT * FROM messages WHERE id = ?', [messageId]);
  if (!msg) return;

  if (!await hasChannelPermission(user.userId, msg.channel_id, 'pin_messages')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to unpin messages' });
    return;
  }

  await getDb().run('UPDATE messages SET pinned = 0, pinned_by = NULL WHERE id = ?', [messageId]);

  await broadcastToChannel(msg.channel_id, {
    type: 'message:unpinned',
    messageId,
    channelId: msg.channel_id,
  });
}

async function handleDmOpen(user: JwtPayload, targetUserId: string) {
  if (!targetUserId || targetUserId === user.userId) {
    sendTo(user.userId, { type: 'error', message: 'Invalid DM target' });
    return;
  }

  const targetUser = await getDb().queryOne<any>('SELECT id FROM users WHERE id = ?', [targetUserId]);
  if (!targetUser) {
    sendTo(user.userId, { type: 'error', message: 'User not found' });
    return;
  }

  // New-user cooldown: block DM creation for accounts < 1 hour old
  const cooldown = await checkNewUserCooldown(user.userId);
  if (cooldown.restricted) {
    sendTo(user.userId, {
      type: 'error',
      message: `New accounts cannot send direct messages yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
    });
    return;
  }

  try {
    const channelId = await ensureDmChannel(user.userId, targetUserId);
    await notifyDmCreated(user.userId, channelId);
  } catch (err) {
    console.error('Failed to open DM:', err);
    sendTo(user.userId, { type: 'error', message: 'Failed to open DM' });
  }
}

// ===== Call Handlers =====

async function handleCallInitiate(user: JwtPayload, targetUserId: string, video = false) {
  // New-user cooldown: block calls for accounts < 1 hour old
  const cooldown = await checkNewUserCooldown(user.userId);
  if (cooldown.restricted) {
    sendTo(user.userId, {
      type: 'error',
      message: `New accounts cannot make calls yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
    });
    return;
  }

  // Check if caller is already in a call
  for (const call of activeCalls.values()) {
    if (
      (call.callerId === user.userId || call.recipientId === user.userId) &&
      call.status !== 'ringing'
    ) {
      sendTo(user.userId, { type: 'call:ended', callId: '', reason: 'busy' });
      return;
    }
  }

  // Check if target is a bot
  const targetUser = await getDb().queryOne<{ is_bot: number }>('SELECT is_bot FROM users WHERE id = ?', [targetUserId]);
  if (targetUser?.is_bot) {
    sendTo(user.userId, { type: 'call:ended', callId: '', reason: 'busy' });
    return;
  }

  // Check if target is in DND mode
  const targetClient = getClient(targetUserId);
  if (targetClient?.status === 'dnd') {
    sendTo(user.userId, { type: 'call:ended', callId: '', reason: 'busy' });
    return;
  }

  // Check if target is already in a call
  for (const call of activeCalls.values()) {
    if (call.callerId === targetUserId || call.recipientId === targetUserId) {
      sendTo(user.userId, { type: 'call:ended', callId: '', reason: 'busy' });
      return;
    }
  }

  const callId = randomUUID();
  const callerRow = await getDb().queryOne<{ display_name: string; username: string; avatar_url: string | null }>(
    'SELECT display_name, username, avatar_url FROM users WHERE id = ?',
    [user.userId],
  );

  const timeout = setTimeout(async () => {
    const call = activeCalls.get(callId);
    if (call && call.status === 'ringing') {
      activeCalls.delete(callId);
      sendTo(call.callerId, { type: 'call:ended', callId, reason: 'timeout' });
      sendTo(call.recipientId, { type: 'call:ended', callId, reason: 'timeout' });
      await insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'missed');
    }
  }, 15000);

  activeCalls.set(callId, {
    id: callId,
    callerId: user.userId,
    recipientId: targetUserId,
    status: 'ringing',
    timeout,
    video,
  });

  sendTo(user.userId, {
    type: 'call:ringing',
    callId,
    targetUserId,
    video,
  });

  sendTo(targetUserId, {
    type: 'call:incoming',
    callId,
    callerId: user.userId,
    callerName: callerRow?.display_name || callerRow?.username || 'Unknown',
    callerAvatar: callerRow?.avatar_url ?? null,
    video,
  });

  // Push notification for incoming call (if recipient is offline)
  if (!isUserOnline(targetUserId)) {
    sendDataPush(targetUserId, 'incoming_call', {
      callerId: user.userId,
      callerName: callerRow?.display_name || callerRow?.username || 'Unknown',
    }).catch(() => {});
  }
}

function handleCallAccept(user: JwtPayload, callId: string) {
  const call = activeCalls.get(callId);
  if (!call || call.recipientId !== user.userId || call.status !== 'ringing') return;

  clearTimeout(call.timeout);
  call.status = 'active';
  call.startedAt = Date.now();
  const channelId = `call:${callId}`;

  sendTo(call.callerId, { type: 'call:accepted', callId, channelId });
  sendTo(call.recipientId, { type: 'call:accepted', callId, channelId });
}

async function handleCallReject(user: JwtPayload, callId: string) {
  const call = activeCalls.get(callId);
  if (!call || call.recipientId !== user.userId) return;

  clearTimeout(call.timeout);
  activeCalls.delete(callId);
  sendTo(call.callerId, { type: 'call:ended', callId, reason: 'rejected' });
  await insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'rejected');
}

async function handleCallEnd(user: JwtPayload, callId: string) {
  const call = activeCalls.get(callId);
  if (!call) return;
  if (call.callerId !== user.userId && call.recipientId !== user.userId) return;

  clearTimeout(call.timeout);
  activeCalls.delete(callId);
  const otherUserId = call.callerId === user.userId ? call.recipientId : call.callerId;
  sendTo(otherUserId, { type: 'call:ended', callId, reason: 'ended' });

  if (call.status === 'active' && call.startedAt) {
    const duration = Math.round((Date.now() - call.startedAt) / 1000);
    await insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'completed', duration);
  } else {
    await insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'missed');
  }
}

async function cleanupCallsForUser(userId: string) {
  for (const [callId, call] of activeCalls) {
    if (call.callerId === userId || call.recipientId === userId) {
      clearTimeout(call.timeout);
      activeCalls.delete(callId);
      const otherUserId = call.callerId === userId ? call.recipientId : call.callerId;
      sendTo(otherUserId, { type: 'call:ended', callId, reason: 'ended' });

      if (call.status === 'active' && call.startedAt) {
        const duration = Math.round((Date.now() - call.startedAt) / 1000);
        await insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'completed', duration);
      } else {
        await insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'missed');
      }
    }
  }
}

export async function handleDisconnect(user: JwtPayload) {
  clearAfkTimer(user.userId);

  // Clean up active calls
  await cleanupCallsForUser(user.userId);

  // Clean up typing state and broadcast stop for each channel they were typing in
  for (const [channelId, users] of typingUsers) {
    if (users.has(user.userId)) {
      users.delete(user.userId);
      await broadcastToChannel(
        channelId,
        {
          type: 'typing:update',
          channelId,
          userId: user.userId,
          username: user.username,
          isTyping: false,
        },
        user.userId,
      );
    }
  }

  // Clean up user queue
  userQueues.delete(user.userId);

  // Clean up watch viewer and session if host
  removeWatchViewer(user.userId);
  cleanupWatchSession(user.userId);

  // Clean up soundboard playbacks and leave voice channel
  // (leaveVoiceChannel also calls cleanupSoundboardForUser, but we call it here
  // in case the user disconnects without being in voice)
  recordVoiceDeparture(user.userId);
  leaveVoiceChannel(user.userId);
}

async function handlePollVote(user: JwtPayload, pollId: string, optionIds: string[]) {
  const poll = await getDb().queryOne<any>('SELECT server_id, is_active, allow_multiple, ends_at FROM polls WHERE id = ?', [pollId]);
  if (!poll || !poll.is_active) return;

  // On-the-fly expiry check
  if (poll.ends_at && new Date(poll.ends_at) <= new Date()) {
    await getDb().run('UPDATE polls SET is_active = 0 WHERE id = ?', [pollId]);
    return;
  }

  if (!await isServerMember(user.userId, poll.server_id)) return;

  // Clear existing votes for this user in this poll
  await getDb().run('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, user.userId]);

  if (poll.allow_multiple) {
    for (const oid of optionIds) {
      await getDb().run('INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)', [pollId, user.userId, oid]);
    }
  } else if (optionIds.length > 0) {
    await getDb().run('INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)', [pollId, user.userId, optionIds[0]]);
  }

  // Get updated stats
  const options = await getDb().query<any>(`
    SELECT o.id,
           (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count
    FROM poll_options o
    WHERE o.poll_id = ?
  `, [pollId]);

  const totalVotesRow = await getDb().queryOne<any>('SELECT COUNT(DISTINCT user_id) as c FROM poll_votes WHERE poll_id = ?', [pollId]);

  // Broadcast update
  const memberIds = await getServerMemberUserIds(poll.server_id);
  sendToMany(memberIds, {
    type: 'poll:updated',
    serverId: poll.server_id,
    pollId,
    options: options.map(o => ({ id: o.id, vote_count: o.vote_count })),
    totalVotes: totalVotesRow.c
  } as any);
}

async function getServerMemberUserIds(serverId: string): Promise<string[]> {
  return (await getDb().query<{ user_id: string }>('SELECT user_id FROM server_members WHERE server_id = ?', [serverId]))
    .map(r => r.user_id);
}

function handlePresenceActivity(user: JwtPayload, game: string | null, visibility: 'all' | 'selected', serverIds?: string[]) {
  const client = getClient(user.userId);
  if (!client) return;

  client.activity = game;
  client.activityVisibility = visibility;
  client.activityServerIds = serverIds;

  if (visibility === 'all') {
    broadcast({
      type: 'presence:activity',
      userId: user.userId,
      activity: game,
    } as any);
  } else if (serverIds && serverIds.length > 0) {
    for (const serverId of serverIds) {
      broadcastToServer(serverId, {
        type: 'presence:activity',
        userId: user.userId,
        activity: game,
      } as any);
    }
  }
}
