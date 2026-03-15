import { writable, derived, get } from 'svelte/store';
import { api } from '../api';
import type { Channel, ChannelGroup } from '@voip-server/shared';
import { getActiveServerId, isDmView } from './servers';
import { pendingInvitations } from './invitations';

export const channels = writable<Channel[]>([]);
export const dmChannels = writable<Channel[]>([]);
export const activeChannelId = writable<string | null>(null);
export const channelGroups = writable<ChannelGroup[]>([]);

export const textChannels = derived(channels, ($ch) => $ch.filter((c) => c.type === 'text'));
export const voiceChannels = derived(channels, ($ch) => $ch.filter((c) => c.type === 'voice'));

export const activeChannel = derived(
  [channels, dmChannels, activeChannelId],
  ([$channels, $dmChannels, $id]) =>
    $channels.find((c) => c.id === $id) ?? $dmChannels.find((c) => c.id === $id) ?? null,
);

export interface GroupedChannels {
  group: ChannelGroup | null;
  channels: Channel[];
}

export const groupedChannels = derived([channels, channelGroups], ([$channels, $channelGroups]) => {
  const nonDm = $channels.filter((c) => c.type !== 'dm');
  const result: GroupedChannels[] = [];

  // Ungrouped channels first (group_id is null/undefined)
  const ungrouped = nonDm.filter((c) => !c.group_id);
  if (ungrouped.length > 0) {
    result.push({ group: null, channels: ungrouped.sort((a, b) => a.sort_order - b.sort_order) });
  }

  // Then each group sorted by sort_order
  const sortedGroups = [...$channelGroups].sort((a, b) => a.sort_order - b.sort_order);
  for (const group of sortedGroups) {
    const groupChannels = nonDm.filter((c) => c.group_id === group.id);
    result.push({ group, channels: groupChannels.sort((a, b) => a.sort_order - b.sort_order) });
  }

  return result;
});

export async function loadChannels() {
  const serverId = getActiveServerId();
  if (!serverId) return [];
  try {
    const list = await api.get<Channel[]>(`/api/servers/${serverId}/channels`);
    channels.set(list);
    for (const ch of list) registerChannelServer(ch.id, serverId);
    return list;
  } catch {
    return [];
  }
}

export async function loadChannelGroups() {
  const serverId = getActiveServerId();
  if (!serverId) return [];
  try {
    const list = await api.get<ChannelGroup[]>(`/api/servers/${serverId}/channel-groups`);
    channelGroups.set(list);
    return list;
  } catch {
    return [];
  }
}

export async function loadDmChannels() {
  try {
    const list = await api.get<Channel[]>('/api/dm');
    dmChannels.set(list);
    return list;
  } catch {
    return [];
  }
}

export async function openOrCreateDm(targetUserId: string) {
  const channel = await api.post<Channel>('/api/dm', { targetUserId });
  dmChannels.update((list) => (list.some((c) => c.id === channel.id) ? list : [channel, ...list]));
  activeChannelId.set(channel.id);
  isDmView.set(true);
  return channel;
}

export async function closeDm(channelId: string) {
  await api.delete(`/api/dm/${channelId}`);
  dmChannels.update((list) => list.filter((c) => c.id !== channelId));
  // If this was the active channel, switch to first text channel
  if (get(activeChannelId) === channelId) {
    const firstText = get(textChannels)[0];
    activeChannelId.set(firstText?.id ?? null);
  }
}

export async function createChannel(
  name: string,
  type: 'text' | 'voice',
  group_id?: string | null,
) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  const channel = await api.post<Channel>(`/api/servers/${serverId}/channels`, {
    name,
    type,
    group_id: group_id || undefined,
  });
  // The WS broadcast (channel:created) already adds it to the store,
  // so only add if it wasn't already inserted.
  channels.update((list) => (list.some((c) => c.id === channel.id) ? list : [...list, channel]));
  return channel;
}

export async function createChannelGroup(name: string) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  const group = await api.post<ChannelGroup>(`/api/servers/${serverId}/channel-groups`, { name });
  channelGroups.update((list) => (list.some((g) => g.id === group.id) ? list : [...list, group]));
  return group;
}

export async function renameChannelGroup(id: string, name: string) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  const group = await api.patch<ChannelGroup>(`/api/servers/${serverId}/channel-groups/${id}`, { name });
  channelGroups.update((list) => list.map((g) => (g.id === id ? group : g)));
  return group;
}

export async function deleteChannelGroup(id: string) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  await api.delete(`/api/servers/${serverId}/channel-groups/${id}`);
  channelGroups.update((list) => list.filter((g) => g.id !== id));
  // Channels become ungrouped — reload to get updated group_id
  await loadChannels();
}

export async function reorderChannelGroups(orderedIds: string[]) {
  const serverId = getActiveServerId();
  if (!serverId) return;
  await api.put(`/api/servers/${serverId}/channel-groups/reorder`, { order: orderedIds });
  await loadChannelGroups();
}

export const unreadCounts = writable<Map<string, number>>(new Map());
export const unreadChannels = derived(unreadCounts, ($m) => new Set($m.keys()));

export const mentionCounts = writable<Map<string, number>>(new Map());

// Channel-to-server mapping for per-server unread badges
export const channelServerMap = new Map<string, string>();

export function registerChannelServer(channelId: string, serverId: string) {
  channelServerMap.set(channelId, serverId);
}

export const serverUnreadCounts = derived(
  [unreadCounts, mentionCounts],
  ([$unread, $mentions]) => {
    const result = new Map<string, { unread: boolean; mentions: number }>();
    const seen = new Set<string>();
    for (const [channelId] of $unread) {
      const serverId = channelServerMap.get(channelId);
      if (!serverId) continue;
      seen.add(channelId);
      const entry = result.get(serverId) || { unread: false, mentions: 0 };
      entry.unread = true;
      entry.mentions += $mentions.get(channelId) || 0;
      result.set(serverId, entry);
    }
    for (const [channelId, count] of $mentions) {
      if (seen.has(channelId) || count === 0) continue;
      const serverId = channelServerMap.get(channelId);
      if (!serverId) continue;
      const entry = result.get(serverId) || { unread: false, mentions: 0 };
      entry.mentions += count;
      result.set(serverId, entry);
    }
    return result;
  }
);

export const homeUnreadCounts = derived(
  [unreadCounts, mentionCounts, pendingInvitations],
  ([$unread, $mentions, $invites]) => {
    let unread = false;
    let mentions = $invites.length;

    for (const [channelId] of $unread) {
      if (!channelServerMap.has(channelId)) {
        unread = true;
      }
    }

    for (const [channelId, count] of $mentions) {
      if (!channelServerMap.has(channelId)) {
        mentions += count;
      }
    }

    return { unread, mentions };
  }
);

export function markChannelUnread(channelId: string) {
  unreadCounts.update((m) => {
    m.set(channelId, (m.get(channelId) || 0) + 1);
    return new Map(m);
  });
}

export function markChannelRead(channelId: string) {
  unreadCounts.update((m) => {
    m.delete(channelId);
    return new Map(m);
  });
}

export function incrementMention(channelId: string) {
  mentionCounts.update((m) => {
    m.set(channelId, (m.get(channelId) || 0) + 1);
    return new Map(m);
  });
}

export function clearMentions(channelId: string) {
  mentionCounts.update((m) => {
    m.delete(channelId);
    return new Map(m);
  });
}

export const missedCalls = writable<Map<string, { callerName: string; time: Date }>>(new Map());

export function addMissedCall(channelId: string, callerName: string) {
  missedCalls.update((m) => {
    m.set(channelId, { callerName, time: new Date() });
    return new Map(m);
  });
}

export function clearMissedCall(channelId: string) {
  missedCalls.update((m) => {
    m.delete(channelId);
    return new Map(m);
  });
}

export function updateChannel(channel: Channel) {
  channels.update((list) => list.map((c) => (c.id === channel.id ? channel : c)));
}

export async function renameChannel(id: string, name: string) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  const channel = await api.patch<Channel>(`/api/servers/${serverId}/channels/${id}`, { name });
  updateChannel(channel);
  return channel;
}

export async function reorderChannels(orderedIds: string[]) {
  const serverId = getActiveServerId();
  if (!serverId) return;
  await api.put(`/api/servers/${serverId}/channels/reorder`, { order: orderedIds });
  await loadChannels();
}

export async function moveChannelToGroup(channelId: string, groupId: string | null) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  const channel = await api.patch<Channel>(`/api/servers/${serverId}/channels/${channelId}`, { group_id: groupId });
  updateChannel(channel);
  return channel;
}

export async function deleteChannel(id: string) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  await api.delete(`/api/servers/${serverId}/channels/${id}`);
  channels.update((list) => list.filter((c) => c.id !== id));
}

export async function updateChannelAccess(
  channelId: string,
  restricted: boolean,
  allowed_role_ids: string[],
  allowed_user_ids: string[],
) {
  const serverId = getActiveServerId();
  if (!serverId) throw new Error('No active server');
  const channel = await api.patch<Channel>(`/api/servers/${serverId}/channels/${channelId}/access`, {
    restricted,
    allowed_role_ids,
    allowed_user_ids,
  });
  updateChannel(channel);
  return channel;
}
