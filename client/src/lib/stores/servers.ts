import { writable, derived, get } from 'svelte/store';
import { api } from '$lib/api';
import type { Server } from '@voip-server/shared';

export const servers = writable<Server[]>([]);
export const serverNotificationLevels = writable<Map<string, string>>(new Map());
export const activeServerId = writable<string | null>(null);
export const activeServer = derived([servers, activeServerId], ([$servers, $id]) =>
  $servers.find(s => s.id === $id) ?? null
);
export const isDmView = writable(true);

export async function loadServers(): Promise<Server[]> {
  const list = await api.get<Server[]>('/api/servers');
  servers.set(list);

  const levels = new Map<string, string>();
  for (const s of list) {
    levels.set(s.id, (s as any).notification_level || 'default');
  }
  serverNotificationLevels.set(levels);

  return list;
}

export async function createServer(name: string, iconFileId?: string): Promise<Server> {
  const body: any = { name };
  if (iconFileId) body.icon_file_id = iconFileId;
  const server = await api.post<Server>('/api/servers', body);
  servers.update(list => [...list, server]);
  return server;
}

export async function joinServer(inviteCode: string): Promise<Server> {
  const server = await api.post<Server>('/api/servers/join', { invite_code: inviteCode });
  servers.update(list => {
    // Avoid duplicates if already in list
    if (list.some(s => s.id === server.id)) return list;
    return [...list, server];
  });
  return server;
}

export async function leaveServer(serverId: string): Promise<void> {
  await api.post(`/api/servers/${serverId}/leave`, {});
  servers.update(list => list.filter(s => s.id !== serverId));
}

export async function updateServer(serverId: string, data: { name?: string; icon_file_id?: string }): Promise<void> {
  await api.patch(`/api/servers/${serverId}`, data);
  servers.update(list => list.map(s => s.id === serverId ? { ...s, ...data } : s));
}

export async function deleteServer(serverId: string): Promise<void> {
  await api.delete(`/api/servers/${serverId}`);
  servers.update(list => list.filter(s => s.id !== serverId));
}

export async function switchServer(serverId: string) {
  activeServerId.set(serverId);
  isDmView.set(false);
  localStorage.setItem('lastServerId', serverId);
}

// Helper to get the active server ID synchronously for API calls
export function getActiveServerId(): string {
  return get(activeServerId)!;
}

export async function setServerNotificationLevel(serverId: string, level: string) {
  await api.patch(`/api/servers/${serverId}/members/me/notifications`, { notification_level: level });
  serverNotificationLevels.update(map => {
    const m = new Map(map);
    m.set(serverId, level);
    return m;
  });
}

export async function updateServerMember(serverId: string, data: { nickname?: string | null; avatar_url?: string | null }): Promise<void> {
  await api.patch(`/api/servers/${serverId}/members/me`, data);
}

export async function setServerSuppressEveryone(serverId: string, suppress: boolean) {
  await api.patch(`/api/servers/${serverId}/members/me/notifications`, { suppress_everyone: suppress });
}

export async function setServerMuted(serverId: string, muted_until: string | null) {
  await api.patch(`/api/servers/${serverId}/members/me/notifications`, { muted_until });
}
