import { writable, derived } from 'svelte/store';
import type { UserStatus } from '@voip-server/shared';

interface OnlineUser {
  userId: string;
  username: string;
  display_name?: string;
  status: UserStatus;
  activity?: string;
}

export const onlineUsers = writable<Map<string, OnlineUser>>(new Map());
export const myStatus = writable<UserStatus>('online');
export const isAutoIdled = writable<boolean>(false);
export const isDnd = derived(myStatus, ($s) => $s === 'dnd');

export const onlineList = derived(onlineUsers, ($map) => Array.from($map.values()));
export const onlineCount = derived(onlineUsers, ($map) => $map.size);

export function setOnlineUsers(users: OnlineUser[]) {
  onlineUsers.set(new Map(users.map((u) => [u.userId, u])));
}

export function setUserOnline(
  userId: string,
  username: string,
  display_name?: string,
  status: UserStatus = 'online',
  activity?: string,
) {
  onlineUsers.update((map) => {
    map.set(userId, { userId, username, display_name, status, activity });
    return new Map(map);
  });
}

export function updateUserActivity(userId: string, activity: string | null) {
  onlineUsers.update((map) => {
    const user = map.get(userId);
    if (user) {
      map.set(userId, { ...user, activity: activity || undefined });
    }
    return new Map(map);
  });
}

export function updateUserStatus(userId: string, status: UserStatus) {
  onlineUsers.update((map) => {
    const user = map.get(userId);
    if (user) {
      map.set(userId, { ...user, status });
    }
    return new Map(map);
  });
}

export function setUserOffline(userId: string) {
  onlineUsers.update((map) => {
    map.delete(userId);
    return new Map(map);
  });
}
