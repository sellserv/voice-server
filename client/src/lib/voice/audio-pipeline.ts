import {
  voiceMode,
  vadSensitivity,
  pttKey,
  noiseSuppression,
  voiceChangerEnabled,
  voiceChangerPreset,
  voiceChangerIntensity,
} from '../stores/settings';
import { selectedInputDeviceId } from '../stores/media';
import { createVoiceChangerTrack, destroyVoiceChanger, type VoicePresetId } from '../voiceChanger';
import { playPttOn, playPttOff } from '../sounds';
import { get } from 'svelte/store';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let onTrackReady: ((track: MediaStreamTrack) => void) | null = null;
let audioContext: AudioContext | null = null;
let localStream: MediaStream | null = null;

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

// Mute state
let manuallyMuted = false;

// ---------------------------------------------------------------------------
// Gate control
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PTT handlers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// VAD logic
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Voice mode management
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RNNoise helpers
// ---------------------------------------------------------------------------

let rnnoiseModuleLoaded = false;

async function createRnnoiseTrack(rawTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
  if (!audioContext) throw new Error('No AudioContext');

  const wasmBinary = await loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath });
  if (!rnnoiseModuleLoaded) {
    await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
    rnnoiseModuleLoaded = true;
  }

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

// ---------------------------------------------------------------------------
// VAD gate helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal: build audio chain
// ---------------------------------------------------------------------------

async function buildChain(): Promise<MediaStreamTrack> {
  if (!localStream || !audioContext) throw new Error('No localStream or AudioContext');
  const rawTrack = localStream.getAudioTracks()[0];
  if (!rawTrack) throw new Error('No audio track in localStream');

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

  // Gate at end of chain — VAD/PTT control this to suppress audio
  // without breaking the RNNoise pipeline upstream
  track = createVadGate(track);

  return track;
}

function restoreGateState(): void {
  if (!vadGateNode) return;
  const mode = get(voiceMode);
  if (manuallyMuted || (mode === 'ptt' && !pttKeyDown)) {
    vadGateNode.gain.value = 0;
  } else if (mode === 'vad' && !vadSpeaking) {
    vadGateNode.gain.value = 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initAudioPipeline(
  callback: (track: MediaStreamTrack) => void,
): Promise<{ audioContext: AudioContext; localStream: MediaStream; initialTrack: MediaStreamTrack }> {
  // Store callback for subsequent rebuilds — NOT called on first init
  onTrackReady = callback;

  // Create AudioContext at 48kHz to match Opus codec and avoid resampling artifacts
  audioContext = new AudioContext({ sampleRate: 48000 });
  // Resume AudioContext immediately (some webviews start in suspended state)
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {});
  }

  // Firefox/WebKitGTK aggressively suspends AudioContext — auto-resume on state change
  audioContext.onstatechange = () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
  };

  // Get mic access with high-quality audio constraints
  // Always disable browser noiseSuppression — we use RNNoise instead
  const inputDeviceId = get(selectedInputDeviceId);
  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: !get(noiseSuppression), // Use browser suppression as fallback when RNNoise is off
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
    ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
  };
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false,
  });

  // Build audio chain: raw mic → [voice changer] → [noise suppression] → VAD gate → output
  const initialTrack = await buildChain();

  // Set up voice mode (VAD or PTT)
  setupVoiceMode();

  return { audioContext, localStream, initialTrack };
}

export async function rebuildAudioChain(): Promise<void> {
  if (!localStream || !audioContext) return;

  destroyVoiceChanger();
  destroyRnnoise();
  destroyVadGate();

  let track: MediaStreamTrack;
  try {
    track = await buildChain();
  } catch (e) {
    console.error('Audio chain rebuild failed, falling back to raw track:', e);
    // Fall back to raw mic with just a VAD gate so audio still works
    const rawTrack = localStream.getAudioTracks()[0];
    if (!rawTrack) return;
    track = createVadGate(rawTrack);
  }

  // Restore gate state based on current mode
  restoreGateState();

  // Notify the caller (mediasoup/livekit) about the new track
  onTrackReady?.(track);
}

export function destroyAudioPipeline(): void {
  destroyVoiceChanger();
  destroyRnnoise();
  destroyVadGate();
  cleanupVoiceMode();

  audioContext?.close();
  audioContext = null;
  rnnoiseModuleLoaded = false;

  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;

  onTrackReady = null;
}

export function setManuallyMuted(muted: boolean): void {
  manuallyMuted = muted;

  if (muted) {
    closeVadGate();
  } else {
    // Unmuting: if PTT, stay gated until key is pressed
    if (get(voiceMode) === 'ptt') {
      closeVadGate();
    }
    // VAD will open gate when speech is detected
  }
}

export function isManuallyMuted(): boolean {
  return manuallyMuted;
}

export async function applyNoiseSuppression(_enabled: boolean): Promise<void> {
  await rebuildAudioChain();
}

export async function applyVoiceChanger(): Promise<void> {
  await rebuildAudioChain();
}

export function getAudioContext(): AudioContext | null {
  return audioContext;
}
