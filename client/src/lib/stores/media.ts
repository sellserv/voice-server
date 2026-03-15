import { writable } from 'svelte/store';

interface VoicePeer {
  userId: string;
  username: string;
  display_name?: string;
  avatar_url?: string | null;
  muted: boolean;
  speaking: boolean;
  producerId?: string;
}

export interface VoiceChannelMember {
  userId: string;
  username: string;
  display_name?: string;
  avatar_url?: string | null;
  muted: boolean;
  deafened: boolean;
}

export const inVoiceChannel = writable<string | null>(null);
export const voicePeers = writable<Map<string, VoicePeer>>(new Map());
export const isMutedStore = writable(false);
export const isDeafenedStore = writable(false);
export const speakingUsers = writable<Set<string>>(new Set());
export const selectedInputDeviceId = writable<string>('');
export const selectedOutputDeviceId = writable<string>('');
export const pingMs = writable<number | null>(null);

// Sidebar app panels (triggered from AppsMenu)
export const showSoundboardPanel = writable(false);
export const showWatchUrlPanel = writable(false);
export const showVoiceChangerPanel = writable(false);
export const showPollsPanel = writable(false);
export const showPingGraph = writable(false);

// Global voice channel members — visible to all users
export const voiceChannelMembers = writable<Map<string, VoiceChannelMember[]>>(new Map());

export function setAllChannelMembers(channels: Record<string, VoiceChannelMember[]>) {
  voiceChannelMembers.set(new Map(Object.entries(channels)));
}

export function addChannelMember(channelId: string, member: VoiceChannelMember) {
  voiceChannelMembers.update((map) => {
    const members = map.get(channelId) || [];
    const filtered = members.filter((m) => m.userId !== member.userId);
    map.set(channelId, [...filtered, member]);
    return new Map(map);
  });
}

export function removeChannelMember(channelId: string, userId: string) {
  voiceChannelMembers.update((map) => {
    const members = map.get(channelId);
    if (members) {
      const filtered = members.filter((m) => m.userId !== userId);
      if (filtered.length === 0) {
        map.delete(channelId);
      } else {
        map.set(channelId, filtered);
      }
    }
    return new Map(map);
  });
}

export function updateChannelMemberMute(channelId: string, userId: string, muted: boolean) {
  voiceChannelMembers.update((map) => {
    const members = map.get(channelId);
    if (members) {
      map.set(
        channelId,
        members.map((m) => (m.userId === userId ? { ...m, muted } : m)),
      );
    }
    return new Map(map);
  });
}

export function updateChannelMemberDeafen(channelId: string, userId: string, deafened: boolean) {
  voiceChannelMembers.update((map) => {
    const members = map.get(channelId);
    if (members) {
      map.set(
        channelId,
        members.map((m) => (m.userId === userId ? { ...m, deafened } : m)),
      );
    }
    return new Map(map);
  });
}

export function updateChannelMemberProfile(
  userId: string,
  updates: { username?: string; display_name?: string; avatar_url?: string | null },
) {
  voiceChannelMembers.update((map) => {
    let changed = false;
    for (const [channelId, members] of map) {
      const idx = members.findIndex((m) => m.userId === userId);
      if (idx !== -1) {
        map.set(
          channelId,
          members.map((m) => (m.userId === userId ? { ...m, ...updates } : m)),
        );
        changed = true;
      }
    }
    return changed ? new Map(map) : map;
  });
}

export function setVoicePeers(channelId: string, peers: VoicePeer[]) {
  voicePeers.set(new Map(peers.map((p) => [p.userId, { ...p, speaking: false }])));
}

export function addVoicePeer(peer: VoicePeer) {
  voicePeers.update((map) => {
    map.set(peer.userId, { ...peer, speaking: false });
    return new Map(map);
  });
}

export function removeVoicePeer(userId: string) {
  voicePeers.update((map) => {
    map.delete(userId);
    return new Map(map);
  });
}

const voiceSpeakingUsers = new Set<string>();
const soundboardSpeakingCounts = new Map<string, number>();

export function setSpeaking(userId: string, speaking: boolean) {
  if (speaking) voiceSpeakingUsers.add(userId);
  else voiceSpeakingUsers.delete(userId);
  refreshSpeakingUsers(userId);
}

export function setSoundboardSpeaking(userId: string, delta: number) {
  const current = soundboardSpeakingCounts.get(userId) || 0;
  const next = current + delta;
  if (next > 0) {
    soundboardSpeakingCounts.set(userId, next);
  } else {
    soundboardSpeakingCounts.delete(userId);
  }
  refreshSpeakingUsers(userId);
}

function refreshSpeakingUsers(userId: string) {
  const isSpeaking = voiceSpeakingUsers.has(userId) || (soundboardSpeakingCounts.get(userId) || 0) > 0;
  speakingUsers.update((set) => {
    if (isSpeaking) {
      set.add(userId);
    } else {
      set.delete(userId);
    }
    return new Set(set);
  });
}
