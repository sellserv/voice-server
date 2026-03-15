import { writable } from 'svelte/store';

// Local webcam preview stream
export const localVideoStream = writable<MediaStream | null>(null);

// Remote video streams keyed by userId
export const remoteVideos = writable<Map<string, MediaStream>>(new Map());

export function setRemoteVideo(userId: string, stream: MediaStream) {
  remoteVideos.update((m) => {
    m.set(userId, stream);
    return new Map(m);
  });
}

export function removeRemoteVideo(userId: string) {
  remoteVideos.update((m) => {
    m.delete(userId);
    return new Map(m);
  });
}

export function clearAllVideo() {
  localVideoStream.set(null);
  remoteVideos.set(new Map());
}
