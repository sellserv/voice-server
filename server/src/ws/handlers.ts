import { randomUUID } from 'crypto';
import db from '../db/connection.js';
import {
  broadcast,
  sendTo,
  sendToMany,
  setClientStatus,
  getDmParticipantIds,
  broadcastToChannel,
  broadcastToServer,
  getClient,
} from './index.js';
import { ensureDmChannel, notifyDmCreated } from './dmUtils.js';
import { handleVoiceEvent, leaveVoiceChannel, getPeersInChannel } from '../media/signaling.js';
import { hasPermission, hasChannelPermission, isAppEnabled } from '../auth/permissions.js';
import type { JwtPayload } from '../auth/jwt.js';
import type { ClientEvent, Message } from '@voip-server/shared';
import { clearAfkTimer } from '../media/afkManager.js';
import { checkNewUserCooldown } from '../auth/cooldown.js';
import { processMessageForBots } from '../bots/botEngine.js';

// Limits
const MAX_MESSAGE_LENGTH = 4000;
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

function getChannelServerId(channelId: string): string | null {
  const row = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as { server_id: string | null } | undefined;
  return row?.server_id ?? null;
}

function isServerMember(userId: string, serverId: string): boolean {
  return !!db.prepare('SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?').get(serverId, userId);
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

function insertCallMessage(
  callerId: string,
  recipientId: string,
  callType: 'voice' | 'video',
  callStatus: 'missed' | 'rejected' | 'completed',
  duration?: number,
) {
  const channelId = ensureDmChannel(callerId, recipientId);
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const metadata = JSON.stringify({
    call_type: callType,
    call_status: callStatus,
    ...(duration != null ? { duration } : {}),
  });

  db.prepare(
    "INSERT INTO messages (id, channel_id, user_id, content, type, metadata, created_at) VALUES (?, ?, ?, '', 'call', ?, ?)",
  ).run(id, channelId, callerId, metadata, now);

  const callerRow = db
    .prepare('SELECT u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?')
    .get(callerId) as any;

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

  const participantIds = getDmParticipantIds(channelId);
  sendToMany(participantIds, { type: 'chat:message', message });

  // Notify dm:created if channel is new (no prior messages)
  const msgCount = db
    .prepare('SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?')
    .get(channelId) as { cnt: number };
  if (msgCount.cnt <= 1) {
    for (const uid of participantIds) {
      notifyDmCreated(uid, channelId);
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

export function handleMessage(user: JwtPayload, event: ClientEvent) {
  switch (event.type) {
    case 'chat:send':
      handleChatSend(user, event.channelId, event.content, event.fileId, event.replyToId);
      break;
    case 'chat:edit':
      handleChatEdit(user, event.messageId, event.content);
      break;
    case 'chat:delete':
      handleChatDelete(user, event.messageId);
      break;
    case 'typing:start':
      handleTyping(user, event.channelId, true);
      break;
    case 'typing:stop':
      handleTyping(user, event.channelId, false);
      break;
    case 'message:react':
      handleReact(user, event.messageId, event.emoji);
      break;
    case 'message:unreact':
      handleUnreact(user, event.messageId, event.emoji);
      break;
    case 'dm:open':
      handleDmOpen(user, event.targetUserId);
      break;
    case 'presence:setStatus':
      setClientStatus(user.userId, event.status);
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
        const voiceServerId = getChannelServerId(event.channelId);
        if (voiceServerId && !isServerMember(user.userId, voiceServerId)) {
          sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
          break;
        }
        if (!hasChannelPermission(user.userId, event.channelId, 'connect_voice')) {
          sendTo(user.userId, {
            type: 'error',
            message: 'You do not have permission to join voice channels',
          });
          break;
        }
        if (!hasChannelPermission(user.userId, event.channelId, 'view_channel')) {
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
              hostUsername: getHostUsername(session.hostUserId),
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
              viewers: getViewerDetails(session.viewers),
            });
            // Send current playback position so late joiner can seek
            sendTo(user.userId, {
              type: 'watch:synced',
              state: session.playbackState,
              time: getCurrentPlaybackTime(session),
            });
          }
        }
      });
      break;
    case 'screen:start': {
      const screenChannelId = userVoiceChannels.get(user.userId);
      if (!screenChannelId || !hasChannelPermission(user.userId, screenChannelId, 'share_screen')) {
        sendTo(user.userId, {
          type: 'error',
          message: 'You do not have permission to share your screen',
        });
        break;
      }
      enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      break;
    }
    case 'voice:leave':
      clearAfkTimer(user.userId);
      removeWatchViewer(user.userId);
      cleanupWatchSession(user.userId);
      enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      break;
    case 'voice:disconnect':
      if (!hasPermission(user.userId, 'administrator')) {
        sendTo(user.userId, {
          type: 'error',
          message: 'You do not have permission to disconnect users',
        });
        break;
      }
      clearAfkTimer(event.userId);
      removeWatchViewer(event.userId);
      cleanupWatchSession(event.userId);
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
      handleWatchStart(user, event.videoUrl);
      break;
    case 'watch:sync':
      handleWatchSync(user, event.state, event.time, event.pingMs);
      break;
    case 'watch:stop':
      handleWatchStop(user);
      break;
    case 'watch:queue':
      handleWatchQueue(user, event.videoUrl);
      break;
    case 'watch:skip':
      handleWatchSkip(user);
      break;
    case 'watch:next':
      handleWatchNext(user);
      break;
    case 'watch:join':
      handleWatchJoin(user);
      break;
    case 'watch:leave':
      handleWatchLeave(user);
      break;
    case 'watch:transferHost':
      handleWatchTransferHost(user, event.targetUserId);
      break;
    case 'call:initiate':
      handleCallInitiate(user, event.targetUserId, !!event.video);
      break;
    case 'call:accept':
      handleCallAccept(user, event.callId);
      break;
    case 'call:reject':
      handleCallReject(user, event.callId);
      break;
    case 'call:end':
      handleCallEnd(user, event.callId);
      break;
    case 'message:pin':
      handleMessagePin(user, event.messageId);
      break;
    case 'message:unpin':
      handleMessageUnpin(user, event.messageId);
      break;
    case 'effect:send':
      handleEffectSend(user, event.channelId, event.effect);
      break;
    case 'poll:vote':
      handlePollVote(user, event.pollId, event.optionIds);
      break;
    default:
      if (event.type === 'soundboard:play') {
        handleSoundboardPlay(user, event.soundId);
      } else if (event.type === 'screen:stop') {
        enqueueForUser(user.userId, () => handleVoiceEvent(user, event));
      } else {
        sendTo(user.userId, { type: 'error', message: 'Unknown event type' });
      }
  }
}

function handleChatSend(
  user: JwtPayload,
  channelId: string,
  content: string,
  fileId?: string,
  replyToId?: string,
) {
  if (!hasChannelPermission(user.userId, channelId, 'send_messages')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to send messages' });
    return;
  }
  if (fileId && !hasChannelPermission(user.userId, channelId, 'upload_files')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to upload files' });
    return;
  }
  if (!content?.trim() && !fileId) {
    sendTo(user.userId, { type: 'error', message: 'Message cannot be empty' });
    return;
  }

  // Validate message content length (#13)
  if (content && content.length > MAX_MESSAGE_LENGTH) {
    sendTo(user.userId, {
      type: 'error',
      message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
    });
    return;
  }

  const channel = db.prepare('SELECT id, type, server_id FROM channels WHERE id = ?').get(channelId) as
    | { id: string; type: string; server_id: string | null }
    | undefined;
  if (!channel || channel.type === 'voice') {
    sendTo(user.userId, { type: 'error', message: 'Text channel not found' });
    return;
  }

  // Verify server membership for server channels
  if (channel.server_id && !isServerMember(user.userId, channel.server_id)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  // Channel access control check
  if (channel.type !== 'dm' && !hasChannelPermission(user.userId, channelId, 'view_channel')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have access to this channel' });
    return;
  }

  // For DM channels, verify sender is a participant and enforce new-user cooldown
  if (channel.type === 'dm') {
    const participant = db
      .prepare('SELECT 1 FROM dm_participants WHERE channel_id = ? AND user_id = ?')
      .get(channelId, user.userId);
    if (!participant) {
      sendTo(user.userId, { type: 'error', message: 'Not a participant of this DM' });
      return;
    }
    const cooldown = checkNewUserCooldown(user.userId);
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
    const file = db.prepare('SELECT user_id FROM files WHERE id = ?').get(fileId) as
      | { user_id: string }
      | undefined;
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
    const replyMsg = db
      .prepare('SELECT id FROM messages WHERE id = ? AND channel_id = ?')
      .get(replyToId, channelId);
    if (replyMsg) validReplyToId = replyToId;
  }

  db.prepare(
    'INSERT INTO messages (id, channel_id, user_id, content, file_id, reply_to_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, channelId, user.userId, content?.trim() || '', fileId || null, validReplyToId, now);

  // Resolve file MIME type for attachments
  let fileMimeType: string | null = null;
  if (fileId) {
    const fileRow = db.prepare('SELECT mime_type FROM files WHERE id = ?').get(fileId) as
      | { mime_type: string }
      | undefined;
    fileMimeType = fileRow?.mime_type ?? null;
  }

  // Resolve reply preview data
  let replyData: Record<string, string | undefined> = {};
  if (validReplyToId) {
    const replyRow = db
      .prepare(
        'SELECT rm.content, ru.username, ru.display_name FROM messages rm JOIN users ru ON ru.id = rm.user_id WHERE rm.id = ?',
      )
      .get(validReplyToId) as any;
    if (replyRow) {
      replyData = {
        reply_to_username: replyRow.username,
        reply_to_display_name: replyRow.display_name,
        reply_to_content: replyRow.content,
      };
    }
  }

  const userRow = db
    .prepare(
      'SELECT u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    )
    .get(user.userId) as any;

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
    const shouldDelete = processMessageForBots(channel.server_id, message);
    if (shouldDelete) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(id);
      return;
    }
  }

  // Scope delivery: DM channels send only to participants, restricted channels to allowed users
  if (channel.type === 'dm') {
    const participantIds = getDmParticipantIds(channelId);
    // On first message, notify the other participant so the DM appears in their list
    const msgCount = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE channel_id = ?')
      .get(channelId) as { count: number };
    if (msgCount.count <= 1) {
      const dmChannel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId) as any;
      dmChannel.dm_participant_ids = participantIds;
      dmChannel.dm_participants = db
        .prepare(
          'SELECT u.id, u.username, u.display_name, u.avatar_url FROM dm_participants dp JOIN users u ON u.id = dp.user_id WHERE dp.channel_id = ?',
        )
        .all(channelId);
      for (const pid of participantIds) {
        if (pid !== user.userId) {
          sendTo(pid, { type: 'dm:created', channel: dmChannel });
        }
      }
    }
    sendToMany(participantIds, { type: 'chat:message', message });
  } else {
    broadcastToChannel(channelId, { type: 'chat:message', message, ...(channel.server_id ? { serverId: channel.server_id } : {}) });
  }

  // Clear typing for this user in this channel
  handleTyping(user, channelId, false);
}

function handleChatEdit(user: JwtPayload, messageId: string, content: string) {
  if (!content || content.length > MAX_MESSAGE_LENGTH) {
    sendTo(user.userId, {
      type: 'error',
      message: `Message must be 1-${MAX_MESSAGE_LENGTH} characters`,
    });
    return;
  }

  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
  if (!msg) return;

  // Verify server membership
  const editServerId = getChannelServerId(msg.channel_id);
  if (editServerId && !isServerMember(user.userId, editServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  if (
    msg.user_id !== user.userId &&
    !hasChannelPermission(user.userId, msg.channel_id, 'manage_messages')
  ) {
    sendTo(user.userId, { type: 'error', message: "Cannot edit others' messages" });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(
    content.trim(),
    now,
    messageId,
  );

  const userRow = db
    .prepare(
      'SELECT u.username, u.display_name, u.avatar_url, u.name_font, u.name_color, r.color as role_color FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?',
    )
    .get(msg.user_id) as any;

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

  const ch = db.prepare('SELECT type FROM channels WHERE id = ?').get(msg.channel_id) as
    | { type: string }
    | undefined;
  if (ch?.type === 'dm') {
    sendToMany(getDmParticipantIds(msg.channel_id), { type: 'chat:edited', message: updated });
  } else {
    broadcastToChannel(msg.channel_id, { type: 'chat:edited', message: updated, ...(editServerId ? { serverId: editServerId } : {}) });
  }
}

function handleChatDelete(user: JwtPayload, messageId: string) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
  if (!msg) return;

  // Verify server membership
  const deleteServerId = getChannelServerId(msg.channel_id);
  if (deleteServerId && !isServerMember(user.userId, deleteServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  // Users with manage_messages or administrators can delete any message, users can delete their own
  if (
    msg.user_id !== user.userId &&
    !hasChannelPermission(user.userId, msg.channel_id, 'manage_messages')
  ) {
    sendTo(user.userId, { type: 'error', message: "Cannot delete others' messages" });
    return;
  }

  db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);

  const ch = db.prepare('SELECT type FROM channels WHERE id = ?').get(msg.channel_id) as
    | { type: string }
    | undefined;
  if (ch?.type === 'dm') {
    sendToMany(getDmParticipantIds(msg.channel_id), {
      type: 'chat:deleted',
      messageId,
      channelId: msg.channel_id,
    });
  } else {
    broadcastToChannel(msg.channel_id, {
      type: 'chat:deleted',
      messageId,
      channelId: msg.channel_id,
      ...(deleteServerId ? { serverId: deleteServerId } : {}),
    });
  }
}

function handleTyping(user: JwtPayload, channelId: string, isTyping: boolean) {
  // Verify channel access
  if (!hasChannelPermission(user.userId, channelId, 'view_channel')) return;

  if (isTyping) {
    if (!typingUsers.has(channelId)) typingUsers.set(channelId, new Set());
    typingUsers.get(channelId)!.add(user.userId);
  } else {
    typingUsers.get(channelId)?.delete(user.userId);
  }

  const ch = db.prepare('SELECT type FROM channels WHERE id = ?').get(channelId) as
    | { type: string }
    | undefined;
  if (ch?.type === 'dm') {
    sendToMany(
      getDmParticipantIds(channelId),
      { type: 'typing:update', channelId, userId: user.userId, username: user.username, isTyping },
      user.userId,
    );
  } else {
    broadcastToChannel(
      channelId,
      { type: 'typing:update', channelId, userId: user.userId, username: user.username, isTyping },
      user.userId,
    );
  }
}

function handleReact(user: JwtPayload, messageId: string, emoji: string) {
  if (!emoji || emoji.length > MAX_EMOJI_LENGTH) {
    sendTo(user.userId, { type: 'error', message: 'Invalid emoji' });
    return;
  }

  const msg = db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(messageId) as any;
  if (!msg) return;

  // Verify channel access
  if (!hasChannelPermission(user.userId, msg.channel_id, 'view_channel')) return;

  if (!hasChannelPermission(user.userId, msg.channel_id, 'add_reactions')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to add reactions' });
    return;
  }

  db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)').run(
    messageId,
    user.userId,
    emoji,
  );

  const ch = db.prepare('SELECT type FROM channels WHERE id = ?').get(msg.channel_id) as
    | { type: string }
    | undefined;
  if (ch?.type === 'dm') {
    sendToMany(getDmParticipantIds(msg.channel_id), {
      type: 'message:reacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  } else {
    broadcastToChannel(msg.channel_id, {
      type: 'message:reacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  }
}

function handleUnreact(user: JwtPayload, messageId: string, emoji: string) {
  const msg = db.prepare('SELECT channel_id FROM messages WHERE id = ?').get(messageId) as any;
  if (!msg) return;

  // Verify channel access
  if (!hasChannelPermission(user.userId, msg.channel_id, 'view_channel')) return;

  db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(
    messageId,
    user.userId,
    emoji,
  );

  const ch = db.prepare('SELECT type FROM channels WHERE id = ?').get(msg.channel_id) as
    | { type: string }
    | undefined;
  if (ch?.type === 'dm') {
    sendToMany(getDmParticipantIds(msg.channel_id), {
      type: 'message:unreacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  } else {
    broadcastToChannel(msg.channel_id, {
      type: 'message:unreacted',
      messageId,
      channelId: msg.channel_id,
      emoji,
      userId: user.userId,
    });
  }
}

function handleSoundboardPlay(user: JwtPayload, soundId: string) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const serverId = getChannelServerId(channelId);
  if (!hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !isAppEnabled('soundboard', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Soundboard is not available' });
    return;
  }

  const sound = db
    .prepare(
      'SELECT s.*, f.stored_name FROM soundboard_sounds s JOIN files f ON f.id = s.file_id WHERE s.id = ?',
    )
    .get(soundId) as any;
  if (!sound) {
    sendTo(user.userId, { type: 'error', message: 'Sound not found' });
    return;
  }

  // Verify server membership for the voice channel
  const sbServerId = getChannelServerId(channelId);
  if (sbServerId && !isServerMember(user.userId, sbServerId)) {
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

function handleWatchStart(user: JwtPayload, videoUrl?: string) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) {
    sendTo(user.userId, {
      type: 'error',
      message: 'Must be in a voice channel or call to start Watch Party',
    });
    return;
  }

  const serverId = getChannelServerId(channelId);
  if (!hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !isAppEnabled('watch-party', serverId ?? undefined)) {
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

  const serverId = getChannelServerId(channelId);
  if (!hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !isAppEnabled('watch-party', serverId ?? undefined)) {
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

function handleWatchJoin(user: JwtPayload) {
  const channelId = userVoiceChannels.get(user.userId);
  if (!channelId) return;

  const serverId = getChannelServerId(channelId);
  if (!hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !isAppEnabled('watch-party', serverId ?? undefined)) {
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

function handleWatchTransferHost(user: JwtPayload, targetUserId: string) {
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

  const targetRow = db.prepare('SELECT username FROM users WHERE id = ?').get(targetUserId) as
    | { username: string }
    | undefined;
  if (!targetRow) return;

  session.hostUserId = targetUserId;
  session.hostUsername = targetRow.username;

  broadcastSessionUpdated(channelId);
}

function broadcastViewers(channelId: string) {
  const session = watchSessions.get(channelId);
  if (!session) return;

  const viewers = getViewerDetails(session.viewers);

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

function getHostUsername(hostUserId: string): string {
  const row = db.prepare('SELECT username FROM users WHERE id = ?').get(hostUserId) as
    | { username: string }
    | undefined;
  return row?.username ?? 'Unknown';
}

function getViewerDetails(
  viewers: Set<string>,
): { userId: string; username: string; display_name?: string; avatar_url?: string | null }[] {
  return Array.from(viewers)
    .map((userId) => {
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
      const row = db
        .prepare('SELECT id, username, display_name, avatar_url FROM users WHERE id = ?')
        .get(userId) as any;
      return row
        ? {
            userId: row.id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
          }
        : null;
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);
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

function handleEffectSend(user: JwtPayload, channelId: string, effect: string) {
  const serverId = getChannelServerId(channelId);
  if (!hasPermission(user.userId, 'use_apps', serverId ?? undefined) || !isAppEnabled('effects', serverId ?? undefined)) {
    sendTo(user.userId, { type: 'error', message: 'Effects are not available' });
    return;
  }

  if (!VALID_EFFECTS.includes(effect)) {
    sendTo(user.userId, { type: 'error', message: 'Invalid effect' });
    return;
  }

  // Verify server membership
  const effectServerId = getChannelServerId(channelId);
  if (effectServerId && !isServerMember(user.userId, effectServerId)) {
    sendTo(user.userId, { type: 'error', message: 'You are not a member of this server' });
    return;
  }

  if (!hasChannelPermission(user.userId, channelId, 'view_channel')) {
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

  broadcastToChannel(channelId, {
    type: 'effect:play',
    channelId,
    effect,
    userId: user.userId,
    username: user.username,
  });
}

function handleMessagePin(user: JwtPayload, messageId: string) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
  if (!msg) return;

  if (!hasChannelPermission(user.userId, msg.channel_id, 'pin_messages')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to pin messages' });
    return;
  }

  db.prepare('UPDATE messages SET pinned = 1, pinned_by = ? WHERE id = ?').run(
    user.userId,
    messageId,
  );

  broadcastToChannel(msg.channel_id, {
    type: 'message:pinned',
    messageId,
    channelId: msg.channel_id,
    pinnedBy: user.userId,
  });
}

function handleMessageUnpin(user: JwtPayload, messageId: string) {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as any;
  if (!msg) return;

  if (!hasChannelPermission(user.userId, msg.channel_id, 'pin_messages')) {
    sendTo(user.userId, { type: 'error', message: 'You do not have permission to unpin messages' });
    return;
  }

  db.prepare('UPDATE messages SET pinned = 0, pinned_by = NULL WHERE id = ?').run(messageId);

  broadcastToChannel(msg.channel_id, {
    type: 'message:unpinned',
    messageId,
    channelId: msg.channel_id,
  });
}

function handleDmOpen(user: JwtPayload, targetUserId: string) {
  if (!targetUserId || targetUserId === user.userId) {
    sendTo(user.userId, { type: 'error', message: 'Invalid DM target' });
    return;
  }

  const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
  if (!targetUser) {
    sendTo(user.userId, { type: 'error', message: 'User not found' });
    return;
  }

  // New-user cooldown: block DM creation for accounts < 1 hour old
  const cooldown = checkNewUserCooldown(user.userId);
  if (cooldown.restricted) {
    sendTo(user.userId, {
      type: 'error',
      message: `New accounts cannot send direct messages yet. Try again in ${cooldown.minutesRemaining} minute(s).`,
    });
    return;
  }

  try {
    const channelId = ensureDmChannel(user.userId, targetUserId);
    notifyDmCreated(user.userId, channelId);
  } catch (err) {
    console.error('Failed to open DM:', err);
    sendTo(user.userId, { type: 'error', message: 'Failed to open DM' });
  }
}

// ===== Call Handlers =====

function handleCallInitiate(user: JwtPayload, targetUserId: string, video = false) {
  // New-user cooldown: block calls for accounts < 1 hour old
  const cooldown = checkNewUserCooldown(user.userId);
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
  const callerRow = db
    .prepare('SELECT display_name, username, avatar_url FROM users WHERE id = ?')
    .get(user.userId) as
    | { display_name: string; username: string; avatar_url: string | null }
    | undefined;

  const timeout = setTimeout(() => {
    const call = activeCalls.get(callId);
    if (call && call.status === 'ringing') {
      activeCalls.delete(callId);
      sendTo(call.callerId, { type: 'call:ended', callId, reason: 'timeout' });
      sendTo(call.recipientId, { type: 'call:ended', callId, reason: 'timeout' });
      insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'missed');
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

function handleCallReject(user: JwtPayload, callId: string) {
  const call = activeCalls.get(callId);
  if (!call || call.recipientId !== user.userId) return;

  clearTimeout(call.timeout);
  activeCalls.delete(callId);
  sendTo(call.callerId, { type: 'call:ended', callId, reason: 'rejected' });
  insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'rejected');
}

function handleCallEnd(user: JwtPayload, callId: string) {
  const call = activeCalls.get(callId);
  if (!call) return;
  if (call.callerId !== user.userId && call.recipientId !== user.userId) return;

  clearTimeout(call.timeout);
  activeCalls.delete(callId);
  const otherUserId = call.callerId === user.userId ? call.recipientId : call.callerId;
  sendTo(otherUserId, { type: 'call:ended', callId, reason: 'ended' });

  if (call.status === 'active' && call.startedAt) {
    const duration = Math.round((Date.now() - call.startedAt) / 1000);
    insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'completed', duration);
  } else {
    insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'missed');
  }
}

function cleanupCallsForUser(userId: string) {
  for (const [callId, call] of activeCalls) {
    if (call.callerId === userId || call.recipientId === userId) {
      clearTimeout(call.timeout);
      activeCalls.delete(callId);
      const otherUserId = call.callerId === userId ? call.recipientId : call.callerId;
      sendTo(otherUserId, { type: 'call:ended', callId, reason: 'ended' });

      if (call.status === 'active' && call.startedAt) {
        const duration = Math.round((Date.now() - call.startedAt) / 1000);
        insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'completed', duration);
      } else {
        insertCallMessage(call.callerId, call.recipientId, call.video ? 'video' : 'voice', 'missed');
      }
    }
  }
}

export function handleDisconnect(user: JwtPayload) {
  clearAfkTimer(user.userId);

  // Clean up active calls
  cleanupCallsForUser(user.userId);

  // Clean up typing state and broadcast stop for each channel they were typing in
  for (const [channelId, users] of typingUsers) {
    if (users.has(user.userId)) {
      users.delete(user.userId);
      broadcastToChannel(
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
  leaveVoiceChannel(user.userId);
}

function handlePollVote(user: JwtPayload, pollId: string, optionIds: string[]) {
  const poll = db.prepare('SELECT server_id, is_active, allow_multiple, ends_at FROM polls WHERE id = ?').get(pollId) as any;
  if (!poll || !poll.is_active) return;

  // On-the-fly expiry check
  if (poll.ends_at && new Date(poll.ends_at) <= new Date()) {
    db.prepare('UPDATE polls SET is_active = 0 WHERE id = ?').run(pollId);
    return;
  }

  if (!isServerMember(user.userId, poll.server_id)) return;

  db.transaction(() => {
    // Clear existing votes for this user in this poll
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(pollId, user.userId);

    const insertVote = db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES (?, ?, ?)');
    
    if (poll.allow_multiple) {
      for (const oid of optionIds) {
        insertVote.run(pollId, user.userId, oid);
      }
    } else if (optionIds.length > 0) {
      insertVote.run(pollId, user.userId, optionIds[0]);
    }
  })();

  // Get updated stats
  const options = db.prepare(`
    SELECT o.id, 
           (SELECT COUNT(*) FROM poll_votes WHERE option_id = o.id) as vote_count
    FROM poll_options o
    WHERE o.poll_id = ?
  `).all(pollId) as any[];

  const totalVotes = db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM poll_votes WHERE poll_id = ?').get(pollId).c;

  // Broadcast update
  const memberIds = getServerMemberUserIds(poll.server_id);
  sendToMany(memberIds, {
    type: 'poll:updated',
    serverId: poll.server_id,
    pollId,
    options: options.map(o => ({ id: o.id, vote_count: o.vote_count })),
    totalVotes
  } as any);
}

function getServerMemberUserIds(serverId: string): string[] {
  return (db.prepare('SELECT user_id FROM server_members WHERE server_id = ?').all(serverId) as { user_id: string }[])
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
