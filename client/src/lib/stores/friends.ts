import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';
import type { FriendInfo, FriendRequest } from '@voip-server/shared';

export const friends = writable<FriendInfo[]>([]);
export const pendingRequests = writable<FriendRequest[]>([]);
export const blockedUsers = writable<FriendInfo[]>([]);

export const onlineFriends = derived(friends, ($f) =>
  $f.filter((f) => f.online)
);

export async function loadFriends() {
  const list = await api.get<FriendInfo[]>('/api/friends');
  friends.set(list);
}

export async function loadPendingRequests() {
  const list = await api.get<FriendRequest[]>('/api/friends/pending');
  pendingRequests.set(list);
}

export async function loadBlockedUsers() {
  const list = await api.get<FriendInfo[]>('/api/friends/blocked');
  blockedUsers.set(list);
}

export async function sendFriendRequest(targetId: string) {
  await api.post('/api/friends/request', { target_id: targetId });
}

export async function acceptFriendRequest(friendshipId: string) {
  await api.post(`/api/friends/accept/${friendshipId}`, {});
  await Promise.all([loadFriends(), loadPendingRequests()]);
}

export async function declineFriendRequest(friendshipId: string) {
  await api.post(`/api/friends/decline/${friendshipId}`, {});
  await loadPendingRequests();
}

export async function removeFriend(friendshipId: string) {
  await api.post(`/api/friends/remove/${friendshipId}`, {});
  await loadFriends();
}

export async function blockUser(userId: string) {
  await api.post(`/api/friends/block/${userId}`, {});
  await Promise.all([loadFriends(), loadBlockedUsers()]);
}

export async function unblockUser(userId: string) {
  await api.post(`/api/friends/unblock/${userId}`, {});
  await loadBlockedUsers();
}

export function addFriendFromWs(friend: FriendInfo) {
  friends.update((list) => {
    if (list.some((f) => f.id === friend.id)) return list;
    return [...list, friend];
  });
}

export function removeFriendFromWs(userId: string) {
  friends.update((list) => list.filter((f) => f.id !== userId));
}

export function addPendingFromWs(request: FriendRequest) {
  pendingRequests.update((list) => {
    if (list.some((r) => r.id === request.id)) return list;
    return [...list, request];
  });
}

export function removePendingByUser(userId: string) {
  pendingRequests.update((list) => list.filter((r) => r.user.id !== userId));
}
