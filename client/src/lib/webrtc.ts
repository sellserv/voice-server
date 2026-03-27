import { Device, type types } from 'mediasoup-client';
type Transport = types.Transport;
type Producer = types.Producer;
type Consumer = types.Consumer;
type DtlsParameters = types.DtlsParameters;
type MediaKind = types.MediaKind;
type RtpParameters = types.RtpParameters;
import { sendWs, onWsEvent } from './ws';
import type { ServerEvent } from '@voip-server/shared';
import { selectedInputDeviceId, selectedOutputDeviceId, pingMs, inVoiceChannel } from './stores/media';
import {
  voiceMode,
  vadSensitivity,
  pttKey,
  noiseSuppression,
  voiceChangerEnabled,
  voiceChangerPreset,
  voiceChangerIntensity,
  getUserVolume,
} from './stores/settings';
import { createVoiceChangerTrack, destroyVoiceChanger, type VoicePresetId } from './voiceChanger';
import { playPttOn, playPttOff } from './sounds';
import { isScreenSharing, setScreenShareStream } from './stores/screenShare';
import { localVideoStream, setRemoteVideo, clearAllVideo } from './stores/video';
import { get } from 'svelte/store';
import { channels } from './stores/channels.js';
import { startBackgroundAudio, stopBackgroundAudio } from './capacitor.js';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let device: Device | null = null;
let sendTransport: Transport | null = null;
let recvTransport: Transport | null = null;
let producer: Producer | null = null;
let screenProducer: Producer | null = null;
let screenStream: MediaStream | null = null;
let videoProducer: Producer | null = null;
let videoStream: MediaStream | null = null;
const consumers = new Map<string, Consumer>();
const pendingProducerIds: string[] = [];
let consumeQueue: Promise<void> = Promise.resolve();
let localStream: MediaStream | null = null;
let deafened = false;
let manuallyMuted = false;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// Audio playback — use Audio elements for Chrome/Edge/Safari, AudioContext for Firefox
const isFirefox = typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox');
const audioElements = new Map<string, HTMLAudioElement>();
let audioContext: AudioContext | null = null;
const audioGainNodes = new Map<string, GainNode>();
const audioSourceNodes = new Map<string, MediaStreamAudioSourceNode>();
let selectedOutputDevice: string | null = null;

// userId <-> consumerId mapping for per-user volume control
const producerToUserId = new Map<string, string>();
const consumerToUserId = new Map<string, string>();

// RNNoise state
let rnnoiseNode: RnnoiseWorkletNode | null = null;
let rnnoiseSource: MediaStreamAudioSourceNode | null = null;
let rnnoiseDest: MediaStreamAudioDestinationNode | null = null;

// VAD gate — GainNode at end of audio chain to suppress audio without breaking RNNoise
let vadGateNode: GainNode | null = null;
let vadGateSource: MediaStreamAudioSourceNode | null = null;
let vadGateDest: MediaStreamAudioDestinationNode | null = null;

// PTT state
let pttKeyDown = false;
let currentPttKey = get(pttKey);
let unsubPttKey: (() => void) | null = null;
let cleanupGlobalPttDown: (() => void) | null = null;
let cleanupGlobalPttUp: (() => void) | null = null;

// VAD state
let vadAnalyser: AnalyserNode | null = null;
let vadSource: MediaStreamAudioSourceNode | null = null;
let vadInterval: ReturnType<typeof setInterval> | null = null;
let vadSpeaking = false;
let vadHoldTimer: ReturnType<typeof setTimeout> | null = null;
let currentVadSensitivity = get(vadSensitivity);
let unsubVadSensitivity: (() => void) | null = null;

// Voice mode state
let unsubVoiceMode: (() => void) | null = null;

function handlePttKeyDown(e: KeyboardEvent) {
  if (e.code === currentPttKey && !pttKeyDown) {
    pttKeyDown = true;
    if (!manuallyMuted) {
      openVadGate();
      playPttOn();
    }
  }
}

function handlePttKeyUp(e: KeyboardEvent) {
  if (e.code === currentPttKey && pttKeyDown) {
    pttKeyDown = false;
    closeVadGate();
    playPttOff();
  }
}

function handlePttMouseDown(e: MouseEvent) {
  if (currentPttKey === `Mouse${e.button}` && !pttKeyDown) {
    e.preventDefault();
    pttKeyDown = true;
    if (!manuallyMuted) {
      openVadGate();
      playPttOn();
    }
  }
}

function handlePttMouseUp(e: MouseEvent) {
  if (currentPttKey === `Mouse${e.button}` && pttKeyDown) {
    e.preventDefault();
    pttKeyDown = false;
    closeVadGate();
    playPttOff();
  }
}

function handlePttContextMenu(e: MouseEvent) {
  if (currentPttKey === 'Mouse2') {
    e.preventDefault();
  }
}

// Gate control — uses a GainNode at the end of the audio chain so the
// RNNoise pipeline keeps running while audio output is suppressed.
function openVadGate() {
  if (vadGateNode && audioContext) {
    vadGateNode.gain.setTargetAtTime(1, audioContext.currentTime, 0.015);
  }
}

function closeVadGate() {
  if (vadGateNode && audioContext) {
    vadGateNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.015);
  }
}

function handleGlobalPttDown() {
  if (!pttKeyDown) {
    pttKeyDown = true;
    if (!manuallyMuted) {
      openVadGate();
      playPttOn();
    }
  }
}

function handleGlobalPttUp() {
  if (pttKeyDown) {
    pttKeyDown = false;
    closeVadGate();
    playPttOff();
  }
}

function activatePtt() {
  cleanupPtt();

  // Start muted — gate opens on key/button press
  closeVadGate();

  const api = (window as any).electronAPI;
  if (api?.configurePtt) {
    // Desktop: use OS-level global hooks (works even when app is unfocused)
    api.configurePtt(currentPttKey);
    cleanupGlobalPttDown = api.onPttDown(handleGlobalPttDown);
    cleanupGlobalPttUp = api.onPttUp(handleGlobalPttUp);
  } else {
    // Web: use DOM events (only works when window is focused)
    window.addEventListener('keydown', handlePttKeyDown);
    window.addEventListener('keyup', handlePttKeyUp);
    window.addEventListener('mousedown', handlePttMouseDown);
    window.addEventListener('mouseup', handlePttMouseUp);
    window.addEventListener('contextmenu', handlePttContextMenu);
  }
}

function cleanupPtt() {
  window.removeEventListener('keydown', handlePttKeyDown);
  window.removeEventListener('keyup', handlePttKeyUp);
  window.removeEventListener('mousedown', handlePttMouseDown);
  window.removeEventListener('mouseup', handlePttMouseUp);
  window.removeEventListener('contextmenu', handlePttContextMenu);
  cleanupGlobalPttDown?.();
  cleanupGlobalPttUp?.();
  cleanupGlobalPttDown = null;
  cleanupGlobalPttUp = null;
  const api = (window as any).electronAPI;
  if (api?.configurePtt) api.configurePtt(null);
  pttKeyDown = false;
}

function activateVad() {
  if (!localStream || !audioContext) return;

  // Start with gate closed — will open when speech detected
  closeVadGate();

  // Create analyser from the raw local mic stream (before RNNoise)
  vadAnalyser = audioContext.createAnalyser();
  vadAnalyser.fftSize = 512;
  vadSource = audioContext.createMediaStreamSource(localStream);
  vadSource.connect(vadAnalyser);

  const dataArray = new Float32Array(vadAnalyser.fftSize);

  // Smoothed RMS to prevent single-frame noise from triggering/closing the gate
  let smoothedDb = -100;
  const SMOOTHING = 0.3; // 0 = no smoothing, 1 = fully smoothed (higher = more stable)

  vadInterval = setInterval(() => {
    if (!vadAnalyser || manuallyMuted) return;

    vadAnalyser.getFloatTimeDomainData(dataArray);

    // Calculate RMS energy in dBFS
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const dbFS = rms > 0 ? 20 * Math.log10(rms) : -100;

    // Smooth the dB value to avoid jitter
    smoothedDb = SMOOTHING * smoothedDb + (1 - SMOOTHING) * dbFS;

    // Map sensitivity (0-100) to threshold: 0 = -70dB (very sensitive), 100 = -20dB (least sensitive)
    const threshold = -70 + (currentVadSensitivity / 100) * 50;

    if (smoothedDb >= threshold) {
      if (vadHoldTimer) {
        clearTimeout(vadHoldTimer);
        vadHoldTimer = null;
      }
      if (!vadSpeaking) {
        vadSpeaking = true;
        openVadGate();
      }
    } else if (vadSpeaking && !vadHoldTimer) {
      // 400ms hold time prevents end-of-word clipping
      vadHoldTimer = setTimeout(() => {
        vadHoldTimer = null;
        vadSpeaking = false;
        closeVadGate();
      }, 400);
    }
  }, 20);
}

function cleanupVad() {
  if (vadInterval) {
    clearInterval(vadInterval);
    vadInterval = null;
  }
  if (vadHoldTimer) {
    clearTimeout(vadHoldTimer);
    vadHoldTimer = null;
  }
  vadSource?.disconnect();
  vadSource = null;
  vadAnalyser = null;
  vadSpeaking = false;
}

function activateVoiceMode(mode: 'vad' | 'ptt') {
  cleanupPtt();
  cleanupVad();

  if (mode === 'ptt') {
    activatePtt();
  } else {
    activateVad();
  }
}

function setupVoiceMode() {
  activateVoiceMode(get(voiceMode));

  unsubVoiceMode = voiceMode.subscribe((mode) => {
    activateVoiceMode(mode);
  });

  unsubPttKey = pttKey.subscribe((key) => {
    currentPttKey = key;
    // Re-activate PTT if currently in PTT mode to pick up new key
    if (get(voiceMode) === 'ptt') {
      cleanupPtt();
      activatePtt();
    }
  });

  unsubVadSensitivity = vadSensitivity.subscribe((val) => {
    currentVadSensitivity = val;
  });
}

function cleanupVoiceMode() {
  cleanupPtt();
  cleanupVad();
  manuallyMuted = false;

  unsubVoiceMode?.();
  unsubVoiceMode = null;
  unsubPttKey?.();
  unsubPttKey = null;
  unsubVadSensitivity?.();
  unsubVadSensitivity = null;
}

// Promise resolvers for request-response patterns over WS
type Resolver = { resolve: (v: any) => void; reject: (e: any) => void };
const pendingRequests = new Map<string, Resolver>();

function waitForEvent<T extends ServerEvent['type']>(
  type: T,
  timeout = 10000,
): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(type);
      reject(new Error(`Timeout waiting for ${type}`));
    }, timeout);

    pendingRequests.set(type, {
      resolve: (v: any) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e: any) => {
        clearTimeout(timer);
        reject(e);
      },
    });
  });
}

// Store the voice:peers data so we can consume existing producers after setup
let pendingPeers: {
  userId: string;
  username: string;
  muted: boolean;
  producerId?: string;
  screenShareProducerId?: string;
}[] = [];

// Call this once to wire up the WS listener for RTC responses
let listenerSetup = false;
export function setupRtcListener() {
  if (listenerSetup) return;
  listenerSetup = true;

  onWsEvent((event) => {
    const resolver = pendingRequests.get(event.type);
    if (resolver) {
      pendingRequests.delete(event.type);
      resolver.resolve(event);
    }

    // Handle ping response
    if (event.type === 'ws:pong') {
      pingMs.set(Date.now() - event.timestamp);
    }

    // Handle new producers from other peers
    if (event.type === 'rtc:newProducer') {
      producerToUserId.set(event.producerId, event.userId);
      if (!recvTransport || !device) {
        // Transport not ready yet — queue for later
        pendingProducerIds.push(event.producerId);
      } else {
        // Serialize consume calls to avoid waitForEvent collisions
        consumeQueue = consumeQueue
          .then(() => consumeProducer(event.producerId))
          .catch(console.error);
      }
    }

    // Capture voice:peers so we can consume existing producers after setup
    if (event.type === 'voice:peers') {
      pendingPeers = event.peers;
      for (const peer of event.peers) {
        if (peer.producerId) {
          producerToUserId.set(peer.producerId, peer.userId);
        }
        if (peer.screenShareProducerId) {
          producerToUserId.set(peer.screenShareProducerId, peer.userId);
          videoProducerOwners.set(peer.screenShareProducerId, peer.userId);
        }
      }
    }
  });
}

export async function joinVoice(channelId: string): Promise<MediaStream> {
  setupRtcListener();
  pendingPeers = [];

  // Create AudioContext at 48kHz to match Opus codec and avoid resampling artifacts
  audioContext = new AudioContext({ sampleRate: 48000 });
  // Resume AudioContext immediately (some webviews start in suspended state)
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {});
  }
  selectedOutputDevice = get(selectedOutputDeviceId);
  if (selectedOutputDevice && 'setSinkId' in audioContext) {
    (audioContext as any).setSinkId(selectedOutputDevice).catch(() => {});
  }

  // Firefox/WebKitGTK aggressively suspends AudioContext — auto-resume on state change
  audioContext.onstatechange = () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  };

  // Get mic access with Discord-quality audio constraints
  // Always disable browser noiseSuppression — we use RNNoise instead
  const inputDeviceId = get(selectedInputDeviceId);
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: !get(noiseSuppression),  // Use browser suppression as fallback when RNNoise is off
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
    ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
  };
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  });

  // Join the voice channel first (server will send voice:peers back)
  sendWs({ type: 'voice:join', channelId });

  // Get router capabilities (must be after voice:join so server knows we're in the channel)
  sendWs({ type: 'rtc:getRouterCapabilities', channelId });
  const capEvent = await waitForEvent('rtc:routerCapabilities');

  // Create device
  device = new Device();
  await device.load({ routerRtpCapabilities: capEvent.codecs as any });

  // Create send transport
  sendWs({ type: 'rtc:createTransport', direction: 'send' });
  const sendInfo = await waitForEvent('rtc:transportCreated');

  sendTransport = device.createSendTransport({
    id: sendInfo.id,
    iceParameters: sendInfo.iceParameters as any,
    iceCandidates: sendInfo.iceCandidates as any,
    dtlsParameters: sendInfo.dtlsParameters as any,
  });

  sendTransport.on(
    'connect',
    async (
      { dtlsParameters }: { dtlsParameters: DtlsParameters },
      callback: () => void,
      errback: (e: Error) => void,
    ) => {
      try {
        sendWs({ type: 'rtc:connectTransport', transportId: sendTransport!.id, dtlsParameters });
        await waitForEvent('rtc:transportConnected');
        callback();
      } catch (e: any) {
        errback(e);
      }
    },
  );

  sendTransport.on('connectionstatechange', (_state: string) => {});

  sendTransport.on(
    'produce',
    async (
      { kind, rtpParameters }: { kind: MediaKind; rtpParameters: RtpParameters },
      callback: (arg: { id: string }) => void,
      errback: (e: Error) => void,
    ) => {
      sendWs({
        type: 'rtc:produce',
        transportId: sendTransport!.id,
        kind: kind as 'audio' | 'video',
        rtpParameters,
      });
      try {
        const event = await waitForEvent('rtc:produced');
        callback({ id: event.producerId });
      } catch (e: any) {
        errback(e);
      }
    },
  );

  // Create recv transport
  sendWs({ type: 'rtc:createTransport', direction: 'recv' });
  const recvInfo = await waitForEvent('rtc:transportCreated');

  recvTransport = device.createRecvTransport({
    id: recvInfo.id,
    iceParameters: recvInfo.iceParameters as any,
    iceCandidates: recvInfo.iceCandidates as any,
    dtlsParameters: recvInfo.dtlsParameters as any,
  });

  recvTransport.on(
    'connect',
    async (
      { dtlsParameters }: { dtlsParameters: DtlsParameters },
      callback: () => void,
      errback: (e: Error) => void,
    ) => {
      try {
        sendWs({ type: 'rtc:connectTransport', transportId: recvTransport!.id, dtlsParameters });
        await waitForEvent('rtc:transportConnected');
        callback();
      } catch (e: any) {
        errback(e);
      }
    },
  );

  recvTransport.on('connectionstatechange', (_state: string) => {});

  // Produce our audio with high bitrate (Discord uses 64-128kbps)
  // Build audio chain: raw mic → [voice changer] → [noise suppression] → producer
  let audioTrack = localStream.getAudioTracks()[0];

  if (get(voiceChangerEnabled)) {
    try {
      audioTrack = await createVoiceChangerTrack(
        audioContext!,
        audioTrack,
        get(voiceChangerPreset) as VoicePresetId,
        get(voiceChangerIntensity),
      );
    } catch (e) {
      console.error('Voice changer failed, using raw track:', e);
      audioTrack = localStream.getAudioTracks()[0];
    }
  }

  if (get(noiseSuppression)) {
    audioTrack = await createRnnoiseTrack(audioTrack);
  }

  // Gate at end of chain — VAD/PTT control this to suppress audio
  // without breaking the RNNoise pipeline upstream
  audioTrack = createVadGate(audioTrack);

  producer = await sendTransport.produce({
    track: audioTrack,
    codecOptions: {
      opusStereo: false,
      opusDtx: true,
      opusFec: true,
      opusMaxPlaybackRate: 48000,
      opusPtime: 20,
    },
    encodings: [{ maxBitrate: 128000 }],
  });

  // Set up voice mode (VAD or PTT)
  setupVoiceMode();

  // Start ping interval
  sendWs({ type: 'ws:ping', timestamp: Date.now() });
  pingInterval = setInterval(() => {
    sendWs({ type: 'ws:ping', timestamp: Date.now() });
  }, 5000);

  // Collect all producer IDs to consume, deduplicating between peer list and queued events
  const producerIdsToConsume = new Set<string>();
  for (const peer of pendingPeers) {
    if (peer.producerId) {
      producerIdsToConsume.add(peer.producerId);
    }
    if (peer.screenShareProducerId) {
      producerIdsToConsume.add(peer.screenShareProducerId);
    }
  }
  pendingPeers = [];

  for (const producerId of pendingProducerIds) {
    producerIdsToConsume.add(producerId);
  }
  pendingProducerIds.length = 0;

  // Consume sequentially to avoid waitForEvent collisions
  for (const producerId of producerIdsToConsume) {
    await consumeProducer(producerId).catch(console.error);
  }

  // Start background audio service (fire-and-forget for Android foreground service)
  const channel = get(channels).find(c => c.id === channelId);
  void startBackgroundAudio(channel?.name || 'voice');

  return localStream;
}

async function consumeProducer(producerId: string) {
  if (!recvTransport || !device) return;

  sendWs({ type: 'rtc:consume', producerId, rtpCapabilities: device!.rtpCapabilities });
  const event = await waitForEvent('rtc:consumed');

  const consumer = await recvTransport.consume({
    id: event.consumerId,
    producerId: event.producerId,
    kind: event.kind as any,
    rtpParameters: event.rtpParameters as any,
  });

  consumers.set(consumer.id, consumer);

  // Track which user owns this consumer
  const userId = producerToUserId.get(producerId);
  if (userId) {
    consumerToUserId.set(consumer.id, userId);
  }

  const stream = new MediaStream([consumer.track]);

  if (event.kind === 'video') {
    // Video consumer — route to screen share store and video store
    const userId = videoProducerOwners.get(producerId);
    if (userId) {
      setScreenShareStream(userId, stream);
      setRemoteVideo(userId, stream);
    }
    // Resume the consumer on the server
    sendWs({ type: 'rtc:resumeConsumer', consumerId: consumer.id });
    return;
  }

  // Audio consumer — apply saved per-user volume
  const userVol = userId ? getUserVolume(userId) : { volume: 100, muted: false };
  const effectiveVolume = deafened || userVol.muted ? 0 : userVol.volume / 100;

  if (isFirefox) {
    // Firefox: <audio> elements with WebRTC srcObject are unreliable — use AudioContext only
    if (audioContext) {
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      let source = audioContext.createMediaStreamSource(stream);
      const gain = audioContext.createGain();
      gain.gain.value = effectiveVolume;
      source.connect(gain);
      gain.connect(audioContext.destination);
      audioGainNodes.set(consumer.id, gain);
      audioSourceNodes.set(consumer.id, source);

      // Firefox: when the track unmutes (server resumes consumer), reconnect
      // the source node — Firefox won't output audio from a source created
      // while the track was still muted
      consumer.track.addEventListener('unmute', () => {
        if (!audioContext) return;
        if (audioContext.state === 'suspended') {
          audioContext.resume().catch(() => {});
        }
        try {
          source.disconnect();
          source = audioContext.createMediaStreamSource(stream);
          source.connect(gain);
          audioSourceNodes.set(consumer.id, source);
        } catch {}
      });
    }
  } else {
    // Chrome/Edge/Safari: <audio> element with setSinkId support
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.volume = effectiveVolume;
    if (selectedOutputDevice && 'setSinkId' in audio) {
      (audio as any).setSinkId(selectedOutputDevice).catch(() => {});
    }
    document.body.appendChild(audio);
    audio.play().catch(() => {});
    audioElements.set(consumer.id, audio);

    // Re-trigger playback when track starts receiving data
    consumer.track.addEventListener('unmute', () => {
      audio.play().catch(() => {});
    });
  }

  // Resume the consumer on the server
  sendWs({ type: 'rtc:resumeConsumer', consumerId: consumer.id });
}

// Track which user owns which video producer (for screen share)
const videoProducerOwners = new Map<string, string>();

export function setVideoProducerOwner(producerId: string, userId: string) {
  videoProducerOwners.set(producerId, userId);
}

export async function startScreenShare() {
  if (!sendTransport || !device) throw new Error('Not in a voice channel');

  screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const videoTrack = screenStream.getVideoTracks()[0];

  // When user stops sharing via browser UI
  videoTrack.addEventListener('ended', () => {
    stopScreenShare();
  });

  screenProducer = await sendTransport.produce({ track: videoTrack });
  isScreenSharing.set(true);
}

export function stopScreenShare() {
  if (screenProducer) {
    screenProducer.close();
    screenProducer = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  isScreenSharing.set(false);
  sendWs({ type: 'screen:stop' });
}

export async function startVideo() {
  if (!sendTransport || !device) throw new Error('Not in a voice channel');

  videoStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  const videoTrack = videoStream.getVideoTracks()[0];

  videoTrack.addEventListener('ended', () => {
    stopVideo();
  });

  videoProducer = await sendTransport.produce({ track: videoTrack });
  localVideoStream.set(videoStream);
}

export function stopVideo() {
  if (videoProducer) {
    videoProducer.close();
    videoProducer = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
  localVideoStream.set(null);
  sendWs({ type: 'screen:stop' });
}

export function leaveVoice() {
  void stopBackgroundAudio();
  sendWs({ type: 'voice:leave' });

  inVoiceChannel.set(null);
  destroyVoiceChanger();
  destroyRnnoise();
  destroyVadGate();
  cleanupVoiceMode();

  // Clear ping interval
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  pingMs.set(null);

  // Clean up screen share
  if (screenProducer) {
    screenProducer.close();
    screenProducer = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  isScreenSharing.set(false);

  // Clean up webcam video
  if (videoProducer) {
    videoProducer.close();
    videoProducer = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
  clearAllVideo();

  videoProducerOwners.clear();
  producerToUserId.clear();
  consumerToUserId.clear();

  producer?.close();
  producer = null;

  for (const consumer of consumers.values()) {
    consumer.close();
  }
  consumers.clear();

  for (const audio of audioElements.values()) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  }
  audioElements.clear();
  for (const source of audioSourceNodes.values()) {
    source.disconnect();
  }
  audioSourceNodes.clear();
  for (const gain of audioGainNodes.values()) {
    gain.disconnect();
  }
  audioGainNodes.clear();
  audioContext?.close();
  audioContext = null;
  deafened = false;

  sendTransport?.close();
  sendTransport = null;
  recvTransport?.close();
  recvTransport = null;

  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;

  device = null;
  pendingProducerIds.length = 0;
  consumeQueue = Promise.resolve();
}

export function toggleMute(): boolean {
  if (!localStream) return false;

  manuallyMuted = !manuallyMuted;

  if (manuallyMuted) {
    closeVadGate();
    sendWs({ type: 'voice:mute', muted: true });
  } else {
    // Unmuting: if PTT, stay gated until key is pressed
    if (get(voiceMode) === 'ptt') {
      closeVadGate();
    } else {
      // VAD will open gate when speech is detected
    }
    sendWs({ type: 'voice:mute', muted: false });
  }

  return manuallyMuted;
}

export function setUserAudioVolume(userId: string, volume: number, muted: boolean) {
  const vol = muted ? 0 : volume / 100;
  for (const [consumerId, uid] of consumerToUserId.entries()) {
    if (uid !== userId) continue;
    const audio = audioElements.get(consumerId);
    if (audio) audio.volume = deafened ? 0 : vol;
    const gain = audioGainNodes.get(consumerId);
    if (gain) gain.gain.value = deafened ? 0 : vol;
  }
}

export function toggleDeafen(): boolean {
  deafened = !deafened;
  for (const [consumerId, audio] of audioElements.entries()) {
    if (deafened) {
      audio.volume = 0;
    } else {
      const uid = consumerToUserId.get(consumerId);
      const userVol = uid ? getUserVolume(uid) : { volume: 100, muted: false };
      audio.volume = userVol.muted ? 0 : userVol.volume / 100;
    }
  }
  for (const [consumerId, gain] of audioGainNodes.entries()) {
    if (deafened) {
      gain.gain.value = 0;
    } else {
      const uid = consumerToUserId.get(consumerId);
      const userVol = uid ? getUserVolume(uid) : { volume: 100, muted: false };
      gain.gain.value = userVol.muted ? 0 : userVol.volume / 100;
    }
  }
  sendWs({ type: 'voice:deafen', deafened });
  return deafened;
}

export function isMuted(): boolean {
  return manuallyMuted;
}

async function createRnnoiseTrack(rawTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
  if (!audioContext) throw new Error('No AudioContext');

  const wasmBinary = await loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath });
  await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);

  rnnoiseNode = new RnnoiseWorkletNode(audioContext, { maxChannels: 1, wasmBinary });
  rnnoiseSource = audioContext.createMediaStreamSource(new MediaStream([rawTrack]));
  rnnoiseDest = audioContext.createMediaStreamDestination();

  rnnoiseSource.connect(rnnoiseNode);
  rnnoiseNode.connect(rnnoiseDest);

  return rnnoiseDest.stream.getAudioTracks()[0];
}

function destroyRnnoise() {
  rnnoiseNode?.destroy();
  rnnoiseNode = null;
  rnnoiseSource?.disconnect();
  rnnoiseSource = null;
  rnnoiseDest?.disconnect();
  rnnoiseDest = null;
}

function createVadGate(audioTrack: MediaStreamTrack): MediaStreamTrack {
  if (!audioContext) throw new Error('No AudioContext');
  vadGateSource = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
  vadGateNode = audioContext.createGain();
  vadGateNode.gain.value = 1; // Start open; VAD/PTT will close as needed
  vadGateDest = audioContext.createMediaStreamDestination();
  vadGateSource.connect(vadGateNode);
  vadGateNode.connect(vadGateDest);
  return vadGateDest.stream.getAudioTracks()[0];
}

function destroyVadGate() {
  vadGateSource?.disconnect();
  vadGateSource = null;
  vadGateNode?.disconnect();
  vadGateNode = null;
  vadGateDest = null;
}

// Unified audio chain rebuild: tears down everything and rebuilds from scratch
// Chain order: raw mic → [voice changer] → [noise suppression] → producer
async function rebuildAudioChain() {
  if (!localStream || !producer || !audioContext) return;
  const rawTrack = localStream.getAudioTracks()[0];
  if (!rawTrack) return;

  destroyVoiceChanger();
  destroyRnnoise();
  destroyVadGate();

  let track: MediaStreamTrack = rawTrack;

  if (get(voiceChangerEnabled)) {
    try {
      track = await createVoiceChangerTrack(
        audioContext,
        track,
        get(voiceChangerPreset) as VoicePresetId,
        get(voiceChangerIntensity),
      );
    } catch (e) {
      console.error('Voice changer failed, using raw track:', e);
      track = rawTrack;
    }
  }

  if (get(noiseSuppression)) {
    track = await createRnnoiseTrack(track);
  }

  // Re-create VAD gate at end of chain
  track = createVadGate(track);

  // Restore gate state based on current mode
  const mode = get(voiceMode);
  if (manuallyMuted || (mode === 'ptt' && !pttKeyDown)) {
    vadGateNode!.gain.value = 0;
  } else if (mode === 'vad' && !vadSpeaking) {
    vadGateNode!.gain.value = 0;
  }

  await producer.replaceTrack({ track });
}

export async function applyNoiseSuppression(_enabled: boolean) {
  await rebuildAudioChain();
}

export async function applyVoiceChanger() {
  await rebuildAudioChain();
}
