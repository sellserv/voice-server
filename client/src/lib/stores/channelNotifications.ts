import { writable } from 'svelte/store';
import { api } from '$lib/api';

interface ChannelOverride {
  channel_id: string;
  level: string;
  muted_until: string | null;
}

export const channelNotificationOverrides = writable<Map<string, ChannelOverride>>(new Map());
export const dmMutes = writable<Map<string, string | null>>(new Map());

export async function loadChannelOverrides(serverId: string) {
  try {
    const overrides = await api.get(`/api/servers/${serverId}/notifications/channels`) as ChannelOverride[];
    const map = new Map<string, ChannelOverride>();
    for (const o of overrides) {
      map.set(o.channel_id, o);
    }
    channelNotificationOverrides.set(map);
  } catch (err) {
    console.error('Failed to load channel notification overrides:', err);
  }
}

export async function setChannelOverride(
  serverId: string,
  channelId: string,
  level?: string,
  muted_until?: string | null,
) {
  await api.put(`/api/servers/${serverId}/channels/${channelId}/notifications`, { level, muted_until });
  channelNotificationOverrides.update((map) => {
    const m = new Map(map);
    const existing = m.get(channelId);
    m.set(channelId, {
      channel_id: channelId,
      level: level ?? existing?.level ?? 'default',
      muted_until: muted_until !== undefined ? muted_until : existing?.muted_until ?? null,
    });
    return m;
  });
}

export async function resetChannelOverride(serverId: string, channelId: string) {
  await api.delete(`/api/servers/${serverId}/channels/${channelId}/notifications`);
  channelNotificationOverrides.update((map) => {
    const m = new Map(map);
    m.delete(channelId);
    return m;
  });
}

export async function muteDm(channelId: string, muted_until: string) {
  await api.put(`/api/channels/${channelId}/mute`, { muted_until });
  dmMutes.update((map) => {
    const m = new Map(map);
    m.set(channelId, muted_until);
    return m;
  });
}

export async function unmuteDm(channelId: string) {
  await api.delete(`/api/channels/${channelId}/mute`);
  dmMutes.update((map) => {
    const m = new Map(map);
    m.delete(channelId);
    return m;
  });
}
