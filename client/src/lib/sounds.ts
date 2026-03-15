import { get } from 'svelte/store';
import { isDnd } from './stores/presence';
import { notifySound, notifyMessageSound, notifyJoinLeaveSound } from './stores/settings';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(freq1: number, freq2: number) {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;

  // First tone
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.frequency.value = freq1;
  osc1.type = 'sine';
  gain1.gain.setValueAtTime(0.15, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.08);

  // Second tone
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.frequency.value = freq2;
  osc2.type = 'sine';
  gain2.gain.setValueAtTime(0.15, now + 0.08);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.08);
  osc2.stop(now + 0.16);
}

export function playJoinSound() {
  if (get(isDnd)) return;
  if (!get(notifySound) || !get(notifyJoinLeaveSound)) return;
  playTone(400, 600);
}

export function playLeaveSound() {
  if (get(isDnd)) return;
  if (!get(notifySound) || !get(notifyJoinLeaveSound)) return;
  playTone(600, 400);
}

export function playRingSound(): () => void {
  if (get(isDnd)) return () => {};
  if (!get(notifySound)) return () => {};
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  let stopped = false;

  function ringBurst() {
    if (stopped) return;
    const now = ctx.currentTime;
    // Two-tone chord: 440Hz + 520Hz for 0.8s
    for (const freq of [440, 520]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.setValueAtTime(0.12, now + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.8);
    }
  }

  ringBurst();
  const interval = setInterval(ringBurst, 2500);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

export function playCallAcceptSound() {
  if (get(isDnd)) return;
  playTone(500, 700);
}

export function playPttOn() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 480;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}

export function playPttOff() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 360;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}

export function playMessageSound() {
  if (get(isDnd)) return;
  if (!get(notifySound) || !get(notifyMessageSound)) return;
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 800;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}
