import { writable, get } from 'svelte/store';
import { api } from '../api';
import type { Message, PaginatedMessages } from '@voip-server/shared';

// Map<channelId, Message[]>
export const messagesByChannel = writable<Map<string, Message[]>>(new Map());
export const hasMoreByChannel = writable<Map<string, boolean>>(new Map());
export const loadingMessages = writable(false);

const MAX_CACHED_CHANNELS = 20;
const channelAccessOrder: string[] = [];

function touchChannel(channelId: string) {
  const idx = channelAccessOrder.indexOf(channelId);
  if (idx !== -1) channelAccessOrder.splice(idx, 1);
  channelAccessOrder.push(channelId);
}

function evictOldChannels() {
  if (channelAccessOrder.length <= MAX_CACHED_CHANNELS) return;
  messagesByChannel.update((map) => {
    while (channelAccessOrder.length > MAX_CACHED_CHANNELS) {
      const oldest = channelAccessOrder.shift()!;
      map.delete(oldest);
    }
    return new Map(map);
  });
  // Also clean up hasMoreByChannel
  hasMoreByChannel.update((map) => {
    const validChannels = new Set(channelAccessOrder);
    for (const key of map.keys()) {
      if (!validChannels.has(key)) map.delete(key);
    }
    return new Map(map);
  });
}

export async function loadMessages(channelId: string, before?: string) {
  loadingMessages.set(true);
  try {
    const query = before ? `?before=${encodeURIComponent(before)}&limit=50` : '?limit=50';
    const data = await api.get<PaginatedMessages>(`/api/channels/${channelId}/messages${query}`);

    messagesByChannel.update((map) => {
      const existing = before ? map.get(channelId) || [] : [];
      map.set(channelId, [...data.messages, ...existing]);
      return new Map(map);
    });

    hasMoreByChannel.update((map) => {
      map.set(channelId, data.hasMore);
      return new Map(map);
    });

    touchChannel(channelId);
    evictOldChannels();
  } catch (e) {
    console.error('[Messages] Failed to load messages:', e);
  } finally {
    loadingMessages.set(false);
  }
}

export function addMessage(message: Message) {
  messagesByChannel.update((map) => {
    const existing = map.get(message.channel_id) || [];
    if (existing.some((m) => m.id === message.id)) return map;
    map.set(message.channel_id, [...existing, message]);
    return new Map(map);
  });
  touchChannel(message.channel_id);
}

export function editMessage(message: Message) {
  messagesByChannel.update((map) => {
    const existing = map.get(message.channel_id) || [];
    map.set(
      message.channel_id,
      existing.map((m) => (m.id === message.id ? message : m)),
    );
    return new Map(map);
  });
}

export function pinMessage(messageId: string, channelId: string, pinnedBy: string) {
  messagesByChannel.update((map) => {
    const existing = map.get(channelId);
    if (!existing) return map;
    map.set(
      channelId,
      existing.map((m) => (m.id === messageId ? { ...m, pinned: true, pinned_by: pinnedBy } : m)),
    );
    return new Map(map);
  });
}

export function unpinMessage(messageId: string, channelId: string) {
  messagesByChannel.update((map) => {
    const existing = map.get(channelId);
    if (!existing) return map;
    map.set(
      channelId,
      existing.map((m) => (m.id === messageId ? { ...m, pinned: false, pinned_by: null } : m)),
    );
    return new Map(map);
  });
}

export function removeMessage(messageId: string, channelId: string) {
  messagesByChannel.update((map) => {
    const existing = map.get(channelId) || [];
    map.set(
      channelId,
      existing.filter((m) => m.id !== messageId),
    );
    return new Map(map);
  });
}

export function addReaction(messageId: string, channelId: string, emoji: string, userId: string) {
  messagesByChannel.update((map) => {
    const msgs = map.get(channelId);
    if (!msgs) return map;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) return map;

    const msg = msgs[idx];
    const reactions = msg.reactions ? [...msg.reactions] : [];
    const existingIdx = reactions.findIndex((r) => r.emoji === emoji);
    if (existingIdx !== -1) {
      const r = reactions[existingIdx];
      if (!r.userIds.includes(userId)) {
        reactions[existingIdx] = { ...r, count: r.count + 1, userIds: [...r.userIds, userId] };
      }
    } else {
      reactions.push({ emoji, count: 1, userIds: [userId] });
    }

    const newMsgs = [...msgs];
    newMsgs[idx] = { ...msg, reactions };
    map.set(channelId, newMsgs);
    return new Map(map);
  });
}

export function removeReaction(
  messageId: string,
  channelId: string,
  emoji: string,
  userId: string,
) {
  messagesByChannel.update((map) => {
    const msgs = map.get(channelId);
    if (!msgs) return map;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) return map;

    const msg = msgs[idx];
    if (!msg.reactions) return map;

    const existingIdx = msg.reactions.findIndex((r) => r.emoji === emoji);
    if (existingIdx === -1) return map;

    const r = msg.reactions[existingIdx];
    const newUserIds = r.userIds.filter((id) => id !== userId);
    let reactions: typeof msg.reactions;
    if (newUserIds.length <= 0) {
      reactions = msg.reactions.filter((_, i) => i !== existingIdx);
    } else {
      reactions = [...msg.reactions];
      reactions[existingIdx] = { ...r, count: newUserIds.length, userIds: newUserIds };
    }

    const newMsgs = [...msgs];
    newMsgs[idx] = { ...msg, reactions };
    map.set(channelId, newMsgs);
    return new Map(map);
  });
}
