// Voice backend facade — dynamically loads mediasoup or livekit based on server config.
// Call initVoice() once at app startup before using any voice functions.

let backend: typeof import('./mediasoup.js') | typeof import('./livekit.js') | null = null;

export async function initVoice(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.voiceType === 'livekit') {
      backend = await import('./livekit.js');
    } else {
      backend = await import('./mediasoup.js');
    }
  } catch {
    backend = await import('./mediasoup.js');
  }
}

export function joinVoice(channelId: string) {
  return backend!.joinVoice(channelId);
}

export function leaveVoice() {
  backend?.leaveVoice();
}

export function toggleMute(): boolean {
  return backend?.toggleMute() ?? false;
}

export function toggleDeafen(): boolean {
  return backend?.toggleDeafen() ?? false;
}

export function isMuted(): boolean {
  return backend?.isMuted() ?? false;
}

export function startScreenShare() {
  return backend!.startScreenShare();
}

export function stopScreenShare() {
  backend?.stopScreenShare();
}

export function startVideo() {
  return backend!.startVideo();
}

export function stopVideo() {
  backend?.stopVideo();
}

export function setUserAudioVolume(userId: string, volume: number, muted: boolean) {
  backend?.setUserAudioVolume(userId, volume, muted);
}

export async function applyVoiceChanger() {
  await backend?.applyVoiceChanger();
}

export async function applyNoiseSuppression(enabled: boolean) {
  await backend?.applyNoiseSuppression(enabled);
}

export function setupRtcListener() {
  backend?.setupRtcListener();
}

export function setVideoProducerOwner(producerId: string, userId: string) {
  backend?.setVideoProducerOwner(producerId, userId);
}
