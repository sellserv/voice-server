import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';
import { getActiveServerId } from './servers';

export interface UserInfo {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio?: string | null;
  banner_url?: string | null;
  role_id: string;
  role_name: string;
  role_color: string;
  role_ids?: string[];
  role_names?: string[];
  role_colors?: string[];
  server_nickname?: string | null;
  member_avatar_url?: string | null;
  member_banner_url?: string | null;
  name_font?: string | null;
  name_color?: string | null;
  is_bot: number;
  created_at: string;
  banned?: boolean;
}

export const allUsers = writable<UserInfo[]>([]);
export const usersMap = derived(allUsers, ($users) => {
  const map = new Map<string, UserInfo>();
  for (const u of $users) map.set(u.id, u);
  return map;
});

let fetchPromise: Promise<void> | null = null;
let loaded = false;

export async function fetchUsers() {
  if (loaded) return;
  if (fetchPromise) return fetchPromise;
  const serverId = getActiveServerId();
  if (!serverId) return;
  fetchPromise = (async () => {
    try {
      const users = await api.get<UserInfo[]>(`/api/servers/${serverId}/users`);
      allUsers.set(users);
      loaded = true;
    } catch {
      // silently fail, will retry next time
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

export function refreshUsers() {
  loaded = false;
  return fetchUsers();
}

export function resetUsersStore() {
  loaded = false;
  fetchPromise = null;
  allUsers.set([]);
}
