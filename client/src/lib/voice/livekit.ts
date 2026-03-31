import { Room, RoomEvent, Track, type RemoteAudioTrack } from 'livekit-client';
import { sendWs, onWsEvent } from '../ws';
import { pingMs, inVoiceChannel } from '../stores/media';
import { getUserVolume } from '../stores/settings';
import { isScreenSharing } from '../stores/screenShare';
import { localVideoStream } from '../stores/video';
import { startBackgroundAudio, stopBackgroundAudio } from '../capacitor.js';
import { get } from 'svelte/store';
import { channels } from '../stores/channels.js';

let room: Room | null = null;
let deafened = false;
let manuallyMuted = false;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// Map of participantIdentity -> attached audio element, for volume control
const participantAudioTracks = new Map<string, RemoteAudioTrack>();

// Unsubscribe function for the voice:token WS listener
let unsubTokenListener: (() => void) | null = null;

// Wait for a voice:token event from the server
function waitForToken(timeout = 10000): Promise<{ url: string; token: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubTokenListener?.();
      unsubTokenListener = null;
      reject(new Error('Timeout waiting for voice:token'));
    }, timeout);

    unsubTokenListener = onWsEvent((event: any) => {
      if (event.type === 'voice:token') {
        clearTimeout(timer);
        unsubTokenListener?.();
        unsubTokenListener = null;
        resolve({ url: event.url, token: event.token });
      }
    });
  });
}

export async function joinVoice(channelId: string): Promise<MediaStream> {
  // Request a LiveKit token from the server
  sendWs({ type: 'voice:join', channelId });

  const { url, token } = await waitForToken();

  // TODO: E2EE support — livekit-client supports E2EE via KeyProvider/E2EEManager,
  // but setup requires a shared key or key exchange mechanism. Add in a follow-up.

  room = new Room();

  // Handle remote audio tracks as they are subscribed
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track as RemoteAudioTrack;
      participantAudioTracks.set(participant.identity, audioTrack);

      const audioEl = audioTrack.attach();
      document.body.appendChild(audioEl);

      // Apply saved per-user volume
      const userVol = getUserVolume(participant.identity);
      const effectiveVolume = deafened || userVol.muted ? 0 : userVol.volume / 100;
      audioTrack.setVolume(effectiveVolume);
    }
  });

  // Detach audio when a track is unsubscribed
  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      const audioTrack = track as RemoteAudioTrack;
      audioTrack.detach().forEach((el: HTMLMediaElement) => el.remove());
      participantAudioTracks.delete(participant.identity);
    }
  });

  // Speaking detection via LiveKit's built-in VAD
  room.on(RoomEvent.ActiveSpeakersChanged, (_speakers) => {
    // Speakers list is managed by the server — no local action needed here.
    // Components can subscribe to this event via the room instance if needed.
  });

  await room.connect(url, token);

  // Enable microphone — LiveKit handles the getUserMedia call internally
  await room.localParticipant.setMicrophoneEnabled(true);

  // Start ping interval
  sendWs({ type: 'ws:ping', timestamp: Date.now() });
  pingInterval = setInterval(() => {
    sendWs({ type: 'ws:ping', timestamp: Date.now() });
  }, 5000);

  // Start background audio service (fire-and-forget for Android foreground service)
  const channel = get(channels).find(c => c.id === channelId);
  void startBackgroundAudio(channel?.name || 'voice');

  // Return a dummy MediaStream — LiveKit manages tracks internally.
  // Callers that store the returned stream only use it to check truthiness.
  return new MediaStream();
}

export function leaveVoice() {
  void stopBackgroundAudio();
  sendWs({ type: 'voice:leave' });

  inVoiceChannel.set(null);

  // Detach all remote audio tracks
  for (const audioTrack of participantAudioTracks.values()) {
    audioTrack.detach().forEach((el: HTMLMediaElement) => el.remove());
  }
  participantAudioTracks.clear();

  // Clear ping interval
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  pingMs.set(null);

  isScreenSharing.set(false);
  localVideoStream.set(null);
  deafened = false;
  manuallyMuted = false;

  room?.disconnect();
  room = null;
}

export function toggleMute(): boolean {
  if (!room) return false;

  manuallyMuted = !manuallyMuted;
  room.localParticipant.setMicrophoneEnabled(!manuallyMuted).catch(console.error);
  sendWs({ type: 'voice:mute', muted: manuallyMuted });
  return manuallyMuted;
}

export function toggleDeafen(): boolean {
  deafened = !deafened;

  for (const [identity, audioTrack] of participantAudioTracks.entries()) {
    if (deafened) {
      audioTrack.setVolume(0);
    } else {
      const userVol = getUserVolume(identity);
      audioTrack.setVolume(userVol.muted ? 0 : userVol.volume / 100);
    }
  }

  sendWs({ type: 'voice:deafen', deafened });
  return deafened;
}

export function isMuted(): boolean {
  return manuallyMuted;
}

export async function startScreenShare() {
  if (!room) throw new Error('Not in a voice channel');
  await room.localParticipant.setScreenShareEnabled(true);
  isScreenSharing.set(true);
}

export function stopScreenShare() {
  if (!room) return;
  room.localParticipant.setScreenShareEnabled(false).catch(console.error);
  isScreenSharing.set(false);
}

export async function startVideo() {
  if (!room) throw new Error('Not in a voice channel');
  const pub = await room.localParticipant.setCameraEnabled(true);
  if (pub?.track) {
    const stream = new MediaStream([pub.track.mediaStreamTrack]);
    localVideoStream.set(stream);
  }
}

export function stopVideo() {
  if (!room) return;
  room.localParticipant.setCameraEnabled(false).catch(console.error);
  localVideoStream.set(null);
}

export function setUserAudioVolume(userId: string, volume: number, muted: boolean) {
  const audioTrack = participantAudioTracks.get(userId);
  if (!audioTrack) return;
  const vol = muted ? 0 : volume / 100;
  audioTrack.setVolume(deafened ? 0 : vol);
}

// No-op stubs — LiveKit handles audio processing differently
export async function applyVoiceChanger() {
  // Not supported in LiveKit backend — voice changer is mediasoup-only
}

export async function applyNoiseSuppression(_enabled: boolean) {
  // Not supported in LiveKit backend — use LiveKit's built-in noise cancellation
}

export function setupRtcListener() {
  // No-op — LiveKit manages its own signaling internally
}

export function setVideoProducerOwner(_producerId: string, _userId: string) {
  // No-op — not applicable to LiveKit backend
}
