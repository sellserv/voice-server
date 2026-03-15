import { writable, derived, get } from 'svelte/store';
import { sendWs } from '$lib/ws';
import { currentUser } from '$lib/stores/auth';
import { pingMs } from '$lib/stores/media';

export interface WatchSession {
  channelId: string;
  hostUserId: string;
  hostUsername: string;
  videoId: string | null;
}

export interface QueueItem {
  videoId: string;
  title?: string;
  addedBy: string;
  addedByUsername: string;
}

export interface WatchViewer {
  userId: string;
  username: string;
  display_name?: string;
  avatar_url?: string | null;
}

export const watchSession = writable<WatchSession | null>(null);
export const watchQueue = writable<QueueItem[]>([]);
export const watchViewers = writable<WatchViewer[]>([]);

export const isWatchHost = derived([watchSession], ([$watchSession]) => {
  const user = get(currentUser);
  return !!$watchSession && !!user && $watchSession.hostUserId === user.id;
});

// Sync state forwarded from WS events for viewers
export const watchSyncEvent = writable<{ state: 'playing' | 'paused'; time: number } | null>(null);

export function startWatch(videoUrl?: string) {
  sendWs({ type: 'watch:start', videoUrl });
}

export function syncWatch(state: 'playing' | 'paused', time: number) {
  sendWs({ type: 'watch:sync', state, time, pingMs: get(pingMs) ?? 0 });
}

export function stopWatch() {
  sendWs({ type: 'watch:stop' });
}

export function queueVideo(videoUrl: string) {
  sendWs({ type: 'watch:queue', videoUrl });
}

export function skipVideo() {
  sendWs({ type: 'watch:skip' });
}

export function nextVideo() {
  sendWs({ type: 'watch:next' });
}

export function joinWatch() {
  sendWs({ type: 'watch:join' });
}

export function leaveWatch() {
  sendWs({ type: 'watch:leave' });
}

export function transferHost(targetUserId: string) {
  sendWs({ type: 'watch:transferHost', targetUserId });
}
