import { writable } from 'svelte/store';
import { api } from '$lib/api';
import type { ServerSettings } from '@voip-server/shared';
import { getActiveServerId } from './servers';

export const serverSettings = writable<ServerSettings>({
  name: 'SellServ Voice',
  icon_url: null,
  enabled_apps: [],
  afk_channel_id: null,
  afk_timeout: 300,
});

export async function loadServerSettings() {
  const serverId = getActiveServerId();
  if (!serverId) return;
  try {
    const settings = await api.get<ServerSettings>(`/api/servers/${serverId}/settings`);
    serverSettings.set(settings);
    document.title = settings.name;
  } catch {
    // Ignore — use defaults
  }
}
