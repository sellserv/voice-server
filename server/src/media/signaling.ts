import { randomBytes } from 'crypto';
import type { JwtPayload } from '../auth/jwt.js';
import type { ClientEvent } from '@voip-server/shared';
import { broadcastToChannel, sendTo, getDisplayName, getAvatarUrl } from '../ws/index.js';
import { hasChannelPermission } from '../auth/permissions.js';
import { VoiceRoom } from './room.js';
import { isAfkChannel } from './afkManager.js';
import { userVoiceChannels, cleanupSoundboardForUser } from '../ws/handlers.js';
import { config } from '../config.js';
import { getAdapters } from '../adapters/index.js';

// --- Mediasoup peer tracking ---
const rooms = new Map<string, VoiceRoom>();

async function getOrCreateRoom(channelId: string): Promise<VoiceRoom> {
  let room = rooms.get(channelId);
  if (!room) {
    room = new VoiceRoom(channelId);
    await room.init();
    room.setSpeakingCallback((userId, speaking) => {
      broadcastToChannel(channelId, { type: 'voice:speaking', userId, speaking });
    });
    rooms.set(channelId, room);
  }
  return room;
}

// --- LiveKit peer tracking ---
type LiveKitPeer = {
  userId: string;
  username: string;
  display_name?: string;
  muted: boolean;
  deafened: boolean;
};
const livekitPeers = new Map<string, Map<string, LiveKitPeer>>();
const livekitE2eeKeys = new Map<string, string>();

function getLivekitRoom(channelId: string): Map<string, LiveKitPeer> {
  let channel = livekitPeers.get(channelId);
  if (!channel) {
    channel = new Map();
    livekitPeers.set(channelId, channel);
  }
  return channel;
}

// ---

export function leaveVoiceChannel(userId: string) {
  const channelId = userVoiceChannels.get(userId);
  if (!channelId) return;

  // Stop any active soundboard playbacks before removing from channel
  cleanupSoundboardForUser(userId);

  if (config.voiceType === 'livekit') {
    const channel = livekitPeers.get(channelId);
    if (channel) {
      channel.delete(userId);
      broadcastToChannel(channelId, { type: 'voice:left', channelId, userId, username: '' });
      if (channel.size === 0) {
        livekitPeers.delete(channelId);
        livekitE2eeKeys.delete(channelId);
        // Best-effort room cleanup; ignore errors if room is already gone
        getAdapters().voice.deleteRoom(channelId).catch(() => {});
      }
    }
  } else {
    const room = rooms.get(channelId);
    if (room) {
      room.removePeer(userId);
      broadcastToChannel(channelId, { type: 'voice:left', channelId, userId, username: '' });
      if (room.isEmpty()) {
        room.close();
        rooms.delete(channelId);
      }
    }
  }

  userVoiceChannels.delete(userId);
}

export async function getAllRoomMembers(): Promise<Record<
  string,
  {
    userId: string;
    username: string;
    display_name?: string;
    avatar_url?: string | null;
    muted: boolean;
    deafened: boolean;
  }[]
>> {
  const result: Record<
    string,
    {
      userId: string;
      username: string;
      display_name?: string;
      avatar_url?: string | null;
      muted: boolean;
      deafened: boolean;
    }[]
  > = {};

  if (config.voiceType === 'livekit') {
    for (const [channelId, channel] of livekitPeers) {
      const peers = Array.from(channel.values());
      if (peers.length > 0) {
        result[channelId] = await Promise.all(peers.map(async (p) => ({
          userId: p.userId,
          username: p.username,
          display_name: p.display_name,
          avatar_url: await getAvatarUrl(p.userId),
          muted: p.muted,
          deafened: p.deafened,
        })));
      }
    }
  } else {
    for (const [channelId, room] of rooms) {
      const peers = room.getPeerList();
      if (peers.length > 0) {
        result[channelId] = await Promise.all(peers.map(async (p) => ({
          userId: p.userId,
          username: p.username,
          display_name: p.display_name,
          avatar_url: await getAvatarUrl(p.userId),
          muted: p.muted,
          deafened: p.deafened,
        })));
      }
    }
  }

  return result;
}

export function getPeersInChannel(channelId: string): string[] {
  if (config.voiceType === 'livekit') {
    const channel = livekitPeers.get(channelId);
    if (!channel) return [];
    return Array.from(channel.keys());
  }
  const room = rooms.get(channelId);
  if (!room) return [];
  return Array.from(room.peers.keys());
}

/** Called when the mediasoup worker dies — evict all peers and destroy all rooms */
export async function clearAllRooms() {
  if (config.voiceType === 'livekit') {
    for (const [channelId, channel] of livekitPeers) {
      for (const userId of channel.keys()) {
        userVoiceChannels.delete(userId);
        await broadcastToChannel(channelId, { type: 'voice:left', channelId, userId, username: '' });
      }
    }
    livekitPeers.clear();
    livekitE2eeKeys.clear();
  } else {
    for (const [channelId, room] of rooms) {
      for (const userId of room.peers.keys()) {
        userVoiceChannels.delete(userId);
        await broadcastToChannel(channelId, { type: 'voice:left', channelId, userId, username: '' });
      }
      room.close();
    }
    rooms.clear();
  }
}

export async function handleVoiceEvent(user: JwtPayload, event: ClientEvent) {
  try {
    switch (event.type) {
      case 'voice:join': {
        // Leave current room if in one
        leaveVoiceChannel(user.userId);

        if (config.voiceType === 'livekit') {
          const voiceAdapter = getAdapters().voice;
          await voiceAdapter.createRoom(event.channelId);

          if (!livekitE2eeKeys.has(event.channelId)) {
            livekitE2eeKeys.set(event.channelId, randomBytes(32).toString('base64'));
          }
          const e2eeKey = livekitE2eeKeys.get(event.channelId)!;

          const displayName = await getDisplayName(user.userId);
          const token = await voiceAdapter.generateJoinToken(
            event.channelId,
            user.userId,
            displayName || user.username,
          );
          const url = (voiceAdapter as any).getServerUrl() as string;

          // Send LiveKit credentials to the joining client
          sendTo(user.userId, { type: 'voice:token', token, url, channelId: event.channelId, e2eeKey });

          // Track peer locally
          const channel = getLivekitRoom(event.channelId);
          channel.set(user.userId, {
            userId: user.userId,
            username: user.username,
            display_name: displayName,
            muted: false,
            deafened: false,
          });
          userVoiceChannels.set(user.userId, event.channelId);

          const avatarUrl = await getAvatarUrl(user.userId);
          await broadcastToChannel(event.channelId, {
            type: 'voice:joined',
            channelId: event.channelId,
            userId: user.userId,
            username: user.username,
            display_name: displayName,
            avatar_url: avatarUrl,
            muted: false,
            deafened: false,
          });

          const peersWithAvatar = await Promise.all(
            Array.from(channel.values()).map(async (p) => ({
              ...p,
              avatar_url: await getAvatarUrl(p.userId),
            })),
          );
          sendTo(user.userId, {
            type: 'voice:peers',
            channelId: event.channelId,
            peers: peersWithAvatar,
          });

          // Force mute in AFK channel
          if (await isAfkChannel(event.channelId)) {
            const peer = channel.get(user.userId);
            if (peer) peer.muted = true;
            await broadcastToChannel(event.channelId, {
              type: 'voice:muteUpdate',
              channelId: event.channelId,
              userId: user.userId,
              muted: true,
            });
          }
        } else {
          const room = await getOrCreateRoom(event.channelId);
          const peer = room.addPeer(user.userId, user.username, await getDisplayName(user.userId));
          userVoiceChannels.set(user.userId, event.channelId);

          const avatarUrl = await getAvatarUrl(user.userId);
          await broadcastToChannel(event.channelId, {
            type: 'voice:joined',
            channelId: event.channelId,
            userId: user.userId,
            username: user.username,
            display_name: await getDisplayName(user.userId),
            avatar_url: avatarUrl,
            muted: peer.muted,
            deafened: peer.deafened,
          });

          const peersWithAvatar = await Promise.all(room.getPeerList().map(async (p) => ({
            ...p,
            avatar_url: await getAvatarUrl(p.userId),
          })));
          sendTo(user.userId, {
            type: 'voice:peers',
            channelId: event.channelId,
            peers: peersWithAvatar,
          });

          // Force mute in AFK channel
          if (await isAfkChannel(event.channelId)) {
            const afkPeer = room.peers.get(user.userId);
            if (afkPeer) afkPeer.muted = true;
            await broadcastToChannel(event.channelId, {
              type: 'voice:muteUpdate',
              channelId: event.channelId,
              userId: user.userId,
              muted: true,
            });
          }
        }
        break;
      }

      case 'voice:leave': {
        const channelId = userVoiceChannels.get(user.userId);
        if (channelId) {
          leaveVoiceChannel(user.userId);
          await broadcastToChannel(channelId, {
            type: 'voice:left',
            channelId,
            userId: user.userId,
            username: user.username,
          });
        }
        break;
      }

      case 'voice:mute': {
        const channelId = userVoiceChannels.get(user.userId);
        if (channelId) {
          // Prevent unmuting in AFK channel
          if (!event.muted && await isAfkChannel(channelId)) {
            await broadcastToChannel(channelId, {
              type: 'voice:muteUpdate',
              channelId,
              userId: user.userId,
              muted: true,
            });
            break;
          }
          if (config.voiceType === 'livekit') {
            const peer = livekitPeers.get(channelId)?.get(user.userId);
            if (peer) peer.muted = event.muted;
          } else {
            const room = rooms.get(channelId);
            const peer = room?.peers.get(user.userId);
            if (peer) peer.muted = event.muted;
          }
          await broadcastToChannel(channelId, {
            type: 'voice:muteUpdate',
            channelId,
            userId: user.userId,
            muted: event.muted,
          });
        }
        break;
      }

      case 'voice:deafen': {
        const channelId = userVoiceChannels.get(user.userId);
        if (channelId) {
          if (config.voiceType === 'livekit') {
            const peer = livekitPeers.get(channelId)?.get(user.userId);
            if (peer) peer.deafened = event.deafened;
          } else {
            const room = rooms.get(channelId);
            const peer = room?.peers.get(user.userId);
            if (peer) peer.deafened = event.deafened;
          }
          await broadcastToChannel(channelId, {
            type: 'voice:deafenUpdate',
            channelId,
            userId: user.userId,
            deafened: event.deafened,
          });
        }
        break;
      }

      case 'rtc:getRouterCapabilities': {
        if (config.voiceType === 'livekit') return;
        // Verify the user is actually in this voice channel
        const currentChannel = userVoiceChannels.get(user.userId);
        if (currentChannel !== event.channelId) {
          sendTo(user.userId, { type: 'error', message: 'Not in this voice channel' });
          return;
        }
        const room = await getOrCreateRoom(event.channelId);
        sendTo(user.userId, {
          type: 'rtc:routerCapabilities',
          codecs: room.router!.rtpCapabilities,
        });
        break;
      }

      case 'rtc:createTransport': {
        if (config.voiceType === 'livekit') return;
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) {
          sendTo(user.userId, { type: 'error', message: 'Not in a voice channel' });
          return;
        }
        const room = rooms.get(channelId)!;
        const transport = await room.createWebRtcTransport(user.userId, event.direction);
        sendTo(user.userId, { type: 'rtc:transportCreated', ...transport });
        break;
      }

      case 'rtc:connectTransport': {
        if (config.voiceType === 'livekit') return;
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId)!;
        await room.connectTransport(user.userId, event.transportId, event.dtlsParameters as any);
        sendTo(user.userId, { type: 'rtc:transportConnected' });
        break;
      }

      case 'rtc:produce': {
        if (config.voiceType === 'livekit') return;
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId)!;
        const kind = event.kind || 'audio';
        // Enforce speak permission for audio production (skip for calls)
        if (
          kind === 'audio' &&
          !channelId.startsWith('call:') &&
          !await hasChannelPermission(user.userId, channelId, 'speak')
        ) {
          sendTo(user.userId, { type: 'error', message: 'You do not have permission to speak' });
          return;
        }
        // Enforce screen share permission for video production
        if (
          kind === 'video' &&
          !channelId.startsWith('call:') &&
          !await hasChannelPermission(user.userId, channelId, 'share_screen')
        ) {
          sendTo(user.userId, {
            type: 'error',
            message: 'You do not have permission to share your screen',
          });
          return;
        }
        const producerId = await room.produce(
          user.userId,
          event.transportId,
          event.rtpParameters as any,
          kind,
        );
        sendTo(user.userId, { type: 'rtc:produced', producerId });

        // Pause audio in AFK channel
        if (kind === 'audio' && await isAfkChannel(channelId)) {
          const afkRoom = rooms.get(channelId);
          const afkPeer = afkRoom?.peers.get(user.userId);
          if (afkPeer?.producer) {
            await afkPeer.producer.pause();
          }
        }

        if (kind === 'video') {
          // Screen share started — notify UI and trigger consumption
          await broadcastToChannel(channelId, {
            type: 'screen:started',
            userId: user.userId,
            username: user.username,
            producerId,
          });
          await broadcastToChannel(
            channelId,
            { type: 'rtc:newProducer', producerId, userId: user.userId, username: user.username },
            user.userId,
          );
        } else {
          // Notify other peers about the new audio producer
          await broadcastToChannel(
            channelId,
            { type: 'rtc:newProducer', producerId, userId: user.userId, username: user.username },
            user.userId,
          );
        }
        break;
      }

      case 'screen:stop': {
        if (config.voiceType === 'livekit') return;
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId);
        if (room) {
          room.closeVideoProducer(user.userId);
        }
        await broadcastToChannel(channelId, { type: 'screen:stopped', userId: user.userId });
        break;
      }

      case 'rtc:consume': {
        if (config.voiceType === 'livekit') return;
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId)!;
        const result = await room.consume(
          user.userId,
          event.producerId,
          event.rtpCapabilities as any,
        );
        sendTo(user.userId, { type: 'rtc:consumed', ...result });
        break;
      }

      case 'rtc:resumeConsumer': {
        if (config.voiceType === 'livekit') return;
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId)!;
        await room.resumeConsumer(user.userId, event.consumerId);
        break;
      }
    }
  } catch (err: any) {
    console.error('Voice error for user', user.userId, err);
    sendTo(user.userId, { type: 'error', message: 'Voice error' });
  }
}
