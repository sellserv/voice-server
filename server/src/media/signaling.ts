import type { JwtPayload } from '../auth/jwt.js';
import type { ClientEvent } from '@voip-server/shared';
import { broadcastToChannel, sendTo, getDisplayName, getAvatarUrl } from '../ws/index.js';
import { hasChannelPermission } from '../auth/permissions.js';
import { VoiceRoom } from './room.js';
import { isAfkChannel } from './afkManager.js';
import { userVoiceChannels, cleanupSoundboardForUser } from '../ws/handlers.js';

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

export function leaveVoiceChannel(userId: string) {
  const channelId = userVoiceChannels.get(userId);
  if (!channelId) return;

  // Stop any active soundboard playbacks before removing from channel
  cleanupSoundboardForUser(userId);

  const room = rooms.get(channelId);
  if (room) {
    room.removePeer(userId);

    // Get username from peer list before removal or use a fallback
    broadcastToChannel(channelId, { type: 'voice:left', channelId, userId, username: '' });

    if (room.isEmpty()) {
      room.close();
      rooms.delete(channelId);
    }
  }

  userVoiceChannels.delete(userId);
}

export function getAllRoomMembers(): Record<
  string,
  {
    userId: string;
    username: string;
    display_name?: string;
    avatar_url?: string | null;
    muted: boolean;
    deafened: boolean;
  }[]
> {
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
  for (const [channelId, room] of rooms) {
    const peers = room.getPeerList();
    if (peers.length > 0) {
      result[channelId] = peers.map((p) => ({
        userId: p.userId,
        username: p.username,
        display_name: p.display_name,
        avatar_url: getAvatarUrl(p.userId),
        muted: p.muted,
        deafened: p.deafened,
      }));
    }
  }
  return result;
}

export function getPeersInChannel(channelId: string): string[] {
  const room = rooms.get(channelId);
  if (!room) return [];
  return Array.from(room.peers.keys());
}

/** Called when the mediasoup worker dies — evict all peers and destroy all rooms */
export function clearAllRooms() {
  for (const [channelId, room] of rooms) {
    for (const userId of room.peers.keys()) {
      userVoiceChannels.delete(userId);
      broadcastToChannel(channelId, { type: 'voice:left', channelId, userId, username: '' });
    }
    room.close();
  }
  rooms.clear();
}

export async function handleVoiceEvent(user: JwtPayload, event: ClientEvent) {
  try {
    switch (event.type) {
      case 'voice:join': {
        // Leave current room if in one
        leaveVoiceChannel(user.userId);

        const room = await getOrCreateRoom(event.channelId);
        const peer = room.addPeer(user.userId, user.username, getDisplayName(user.userId));
        userVoiceChannels.set(user.userId, event.channelId);

        const avatarUrl = getAvatarUrl(user.userId);
        broadcastToChannel(event.channelId, {
          type: 'voice:joined',
          channelId: event.channelId,
          userId: user.userId,
          username: user.username,
          display_name: getDisplayName(user.userId),
          avatar_url: avatarUrl,
          muted: peer.muted,
          deafened: peer.deafened,
        });

        const peersWithAvatar = room.getPeerList().map((p) => ({
          ...p,
          avatar_url: getAvatarUrl(p.userId),
        }));
        sendTo(user.userId, {
          type: 'voice:peers',
          channelId: event.channelId,
          peers: peersWithAvatar,
        });

        // Force mute in AFK channel
        if (isAfkChannel(event.channelId)) {
          const afkPeer = room.peers.get(user.userId);
          if (afkPeer) afkPeer.muted = true;
          broadcastToChannel(event.channelId, {
            type: 'voice:muteUpdate',
            channelId: event.channelId,
            userId: user.userId,
            muted: true,
          });
        }
        break;
      }

      case 'voice:leave': {
        const channelId = userVoiceChannels.get(user.userId);
        if (channelId) {
          leaveVoiceChannel(user.userId);
          broadcastToChannel(channelId, {
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
          if (!event.muted && isAfkChannel(channelId)) {
            broadcastToChannel(channelId, {
              type: 'voice:muteUpdate',
              channelId,
              userId: user.userId,
              muted: true,
            });
            break;
          }
          const room = rooms.get(channelId);
          const peer = room?.peers.get(user.userId);
          if (peer) peer.muted = event.muted;
          broadcastToChannel(channelId, {
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
          const room = rooms.get(channelId);
          const peer = room?.peers.get(user.userId);
          if (peer) peer.deafened = event.deafened;
          broadcastToChannel(channelId, {
            type: 'voice:deafenUpdate',
            channelId,
            userId: user.userId,
            deafened: event.deafened,
          });
        }
        break;
      }

      case 'rtc:getRouterCapabilities': {
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
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId)!;
        await room.connectTransport(user.userId, event.transportId, event.dtlsParameters as any);
        sendTo(user.userId, { type: 'rtc:transportConnected' });
        break;
      }

      case 'rtc:produce': {
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId)!;
        const kind = event.kind || 'audio';
        // Enforce speak permission for audio production (skip for calls)
        if (
          kind === 'audio' &&
          !channelId.startsWith('call:') &&
          !hasChannelPermission(user.userId, channelId, 'speak')
        ) {
          sendTo(user.userId, { type: 'error', message: 'You do not have permission to speak' });
          return;
        }
        // Enforce screen share permission for video production
        if (
          kind === 'video' &&
          !channelId.startsWith('call:') &&
          !hasChannelPermission(user.userId, channelId, 'share_screen')
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
        if (kind === 'audio' && isAfkChannel(channelId)) {
          const afkRoom = rooms.get(channelId);
          const afkPeer = afkRoom?.peers.get(user.userId);
          if (afkPeer?.producer) {
            await afkPeer.producer.pause();
          }
        }

        if (kind === 'video') {
          // Screen share started — notify UI and trigger consumption
          broadcastToChannel(channelId, {
            type: 'screen:started',
            userId: user.userId,
            username: user.username,
            producerId,
          });
          broadcastToChannel(
            channelId,
            { type: 'rtc:newProducer', producerId, userId: user.userId, username: user.username },
            user.userId,
          );
        } else {
          // Notify other peers about the new audio producer
          broadcastToChannel(
            channelId,
            { type: 'rtc:newProducer', producerId, userId: user.userId, username: user.username },
            user.userId,
          );
        }
        break;
      }

      case 'screen:stop': {
        const channelId = userVoiceChannels.get(user.userId);
        if (!channelId) return;
        const room = rooms.get(channelId);
        if (room) {
          room.closeVideoProducer(user.userId);
        }
        broadcastToChannel(channelId, { type: 'screen:stopped', userId: user.userId });
        break;
      }

      case 'rtc:consume': {
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
