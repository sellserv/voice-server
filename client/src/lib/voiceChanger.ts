// Voice Changer — client-side audio processing engine
// Applies real-time effects to microphone audio using Web Audio API

export type VoicePresetId = 'deep' | 'chipmunk' | 'robot' | 'echo' | 'radio' | 'whisper' | 'chorus';

export interface VoicePreset {
  id: VoicePresetId;
  name: string;
  description: string;
  icon: string; // SVG path content
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'deep',
    name: 'Deep',
    description: 'Lower pitched voice',
    icon: 'M12 3v18M8 8l4-5 4 5M6 14h12',
  },
  {
    id: 'chipmunk',
    name: 'Chipmunk',
    description: 'Higher pitched voice',
    icon: 'M12 21V3M8 16l4 5 4-5M6 10h12',
  },
  {
    id: 'robot',
    name: 'Robot',
    description: 'Metallic robotic voice',
    icon: 'M12 2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3V4a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M10 16h4',
  },
  {
    id: 'echo',
    name: 'Echo',
    description: 'Reverberant cave effect',
    icon: 'M2 12s3-7 10-7 10 7 10 7M2 12s3 7 10 7 10-7 10-7',
  },
  {
    id: 'radio',
    name: 'Radio',
    description: 'AM radio broadcast',
    icon: 'M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M19.07 19.07l-2.83-2.83M22 12h-4M19.07 4.93l-2.83 2.83',
  },
  {
    id: 'whisper',
    name: 'Whisper',
    description: 'Soft breathy voice',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    id: 'chorus',
    name: 'Chorus',
    description: 'Thick doubled voice',
    icon: 'M17 20h5v-2a3 3 0 0 0-5.356-1.857M9 20H4v-2a3 3 0 0 1 5.356-1.857M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  },
];

// Module-level state
let vcSource: MediaStreamAudioSourceNode | null = null;
let vcDest: MediaStreamAudioDestinationNode | null = null;
let vcNodes: AudioNode[] = []; // intermediate nodes to disconnect on cleanup
let vcOscillators: OscillatorNode[] = [];
let vcBufferSources: AudioBufferSourceNode[] = [];
let pitchWorkletLoaded = false;
let currentIntensityUpdaters: ((intensity: number) => void)[] = [];

// Pitch shifter worklet — proper overlap-add with 4 grains (75% overlap)
// Four Hann windows at 75% overlap sum to 1.5, preserving volume and smoothing pitch.
const PITCH_SHIFTER_CODE = `
class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.grainSize = 1024; // smaller grain for less latency and better transients
    this.numGrains = 4;
    this.hopSize = this.grainSize / this.numGrains;

    // Circular input buffer
    this.bufSize = this.grainSize * 4;
    this.inputBuf = new Float32Array(this.bufSize);
    this.writePos = 0;

    // Hann window
    this.window = new Float32Array(this.grainSize);
    for (let i = 0; i < this.grainSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.grainSize));
    }

    // Each grain: phase (position within grain) and origin (start in buffer)
    this.grainPhase = new Float32Array(this.numGrains);
    this.grainOrigin = new Float32Array(this.numGrains);

    for (let g = 0; g < this.numGrains; g++) {
      this.grainPhase[g] = g * this.hopSize;
      this.grainOrigin[g] = 0;
    }
  }

  static get parameterDescriptors() {
    return [{ name: 'pitchFactor', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0, automationRate: 'k-rate' }];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const pitch = parameters.pitchFactor[0];
    const bs = this.bufSize;
    const gs = this.grainSize;
    const ng = this.numGrains;
    const win = this.window;
    const buf = this.inputBuf;

    // Write input to circular buffer
    for (let i = 0; i < input.length; i++) {
      buf[this.writePos] = input[i];
      this.writePos = (this.writePos + 1) % bs;
    }

    // Generate output — sum overlapping windowed grains
    for (let i = 0; i < output.length; i++) {
      let sample = 0;

      for (let g = 0; g < ng; g++) {
        const phase = this.grainPhase[g];

        // Read from input buffer at pitched rate
        const readPos = this.grainOrigin[g] + phase * pitch;
        const readIdx = ((Math.floor(readPos) % bs) + bs) % bs;
        const nextIdx = (readIdx + 1) % bs;
        const frac = readPos - Math.floor(readPos);

        // Linear interpolation + Hann window
        const raw = buf[readIdx] * (1 - frac) + buf[nextIdx] * frac;
        sample += raw * win[Math.floor(phase)];

        // Advance grain phase
        this.grainPhase[g]++;

        // Reset grain when complete — start from recent input
        if (this.grainPhase[g] >= gs) {
          this.grainPhase[g] = 0;
          this.grainOrigin[g] = ((this.writePos - gs) % bs + bs) % bs;
        }
      }

      // For 4 grains with Hann window, the sum is 1.5
      output[i] = sample / 1.5;
    }

    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifterProcessor);
`;

let pitchWorkletUrl: string | null = null;

function getPitchWorkletUrl(): string {
  if (!pitchWorkletUrl) {
    const blob = new Blob([PITCH_SHIFTER_CODE], { type: 'application/javascript' });
    pitchWorkletUrl = URL.createObjectURL(blob);
  }
  return pitchWorkletUrl;
}

// Distortion curve generators
function makeHardClipCurve(samples = 256): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.max(-0.8, Math.min(0.8, x * 1.5));
  }
  return curve as Float32Array<ArrayBuffer>;
}

function makeSigmoidCurve(amount: number, samples = 256): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const k = amount;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  return curve as Float32Array<ArrayBuffer>;
}

function makeSoftClipCurve(samples = 256): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * 2) * 0.8;
  }
  return curve as Float32Array<ArrayBuffer>;
}

function createWhiteNoiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const bufferSize = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// Preset builders — each returns [connected nodes, intensity updater]
type PresetBuilder = (
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
) => Promise<[(AudioNode | OscillatorNode | AudioBufferSourceNode)[], (intensity: number) => void]>;

async function buildDeep(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  if (!pitchWorkletLoaded) {
    await ctx.audioWorklet.addModule(getPitchWorkletUrl());
    pitchWorkletLoaded = true;
  }
  const shifter = new AudioWorkletNode(ctx, 'pitch-shifter');
  const pitchParam = shifter.parameters.get('pitchFactor')!;
  // intensity 0 = no shift (1.0), intensity 100 = one octave down (0.5)
  pitchParam.value = 1.0 - (intensity / 100) * 0.5;

  // Low-pitched audio needs a gain boost to sound equally loud (perceptual)
  const gain = ctx.createGain();
  gain.gain.value = 1.4;

  source.connect(shifter);
  shifter.connect(gain);
  gain.connect(dest);

  return [
    [shifter, gain],
    (i: number) => {
      pitchParam.value = 1.0 - (i / 100) * 0.5;
    },
  ];
}

async function buildChipmunk(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  if (!pitchWorkletLoaded) {
    await ctx.audioWorklet.addModule(getPitchWorkletUrl());
    pitchWorkletLoaded = true;
  }
  const shifter = new AudioWorkletNode(ctx, 'pitch-shifter');
  const pitchParam = shifter.parameters.get('pitchFactor')!;
  // intensity 0 = no shift (1.0), intensity 100 = high pitch (1.8)
  pitchParam.value = 1.0 + (intensity / 100) * 0.8;

  const gain = ctx.createGain();
  gain.gain.value = 1.2;

  source.connect(shifter);
  shifter.connect(gain);
  gain.connect(dest);

  return [
    [shifter, gain],
    (i: number) => {
      pitchParam.value = 1.0 + (i / 100) * 0.8;
    },
  ];
}

async function buildRobot(
  _ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  const ctx = _ctx;
  // Bandpass → hard clip → tremolo modulated gain → lowpass → output
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 1200;
  bandpass.Q.value = 2 + (intensity / 100) * 5;

  const waveshaper = ctx.createWaveShaper();
  waveshaper.curve = makeHardClipCurve();
  waveshaper.oversample = '2x';

  const tremoloGain = ctx.createGain();
  tremoloGain.gain.value = 1.0;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 40 + (intensity / 100) * 60;

  const oscGain = ctx.createGain();
  oscGain.gain.value = 0.5 + (intensity / 100) * 0.5;

  osc.connect(oscGain);
  oscGain.connect(tremoloGain.gain);
  osc.start();

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4000;

  const output = ctx.createGain();
  output.gain.value = 1.8;

  source.connect(bandpass);
  bandpass.connect(waveshaper);
  waveshaper.connect(tremoloGain);
  tremoloGain.connect(lowpass);
  lowpass.connect(output);
  output.connect(dest);

  return [
    [bandpass, waveshaper, tremoloGain, osc, oscGain, lowpass, output],
    (i: number) => {
      bandpass.Q.value = 2 + (i / 100) * 5;
      osc.frequency.value = 30 + (i / 100) * 50;
      oscGain.gain.value = 0.3 + (i / 100) * 0.4;
    },
  ];
}

async function buildEcho(
  _ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  const ctx = _ctx;
  const scale = 0.3 + (intensity / 100) * 0.7; // 0.3–1.0
  const feedbackAmount = 0.1 + (intensity / 100) * 0.5; // 0.1–0.6

  const dry = ctx.createGain();
  dry.gain.value = 0.85;

  const delay1 = ctx.createDelay(1.0);
  delay1.delayTime.value = 0.12 * scale;
  const gain1 = ctx.createGain();
  gain1.gain.value = 0.35;
  const fb1 = ctx.createGain();
  fb1.gain.value = feedbackAmount;

  const delay2 = ctx.createDelay(1.0);
  delay2.delayTime.value = 0.24 * scale;
  const gain2 = ctx.createGain();
  gain2.gain.value = 0.25;
  const fb2 = ctx.createGain();
  fb2.gain.value = feedbackAmount * 0.7;

  const delay3 = ctx.createDelay(1.0);
  delay3.delayTime.value = 0.37 * scale;
  const gain3 = ctx.createGain();
  gain3.gain.value = 0.15;

  const merger = ctx.createGain();
  merger.gain.value = 1.0;

  // Dry path
  source.connect(dry);
  dry.connect(merger);

  // Delay 1 with feedback
  source.connect(delay1);
  delay1.connect(gain1);
  gain1.connect(merger);
  gain1.connect(fb1);
  fb1.connect(delay1);

  // Delay 2 with feedback
  source.connect(delay2);
  delay2.connect(gain2);
  gain2.connect(merger);
  gain2.connect(fb2);
  fb2.connect(delay2);

  // Delay 3 (no feedback)
  source.connect(delay3);
  delay3.connect(gain3);
  gain3.connect(merger);

  merger.connect(dest);

  return [
    [dry, delay1, gain1, fb1, delay2, gain2, fb2, delay3, gain3, merger],
    (i: number) => {
      const s = 0.3 + (i / 100) * 0.7;
      const fb = 0.1 + (i / 100) * 0.5;
      delay1.delayTime.value = 0.12 * s;
      delay2.delayTime.value = 0.24 * s;
      delay3.delayTime.value = 0.37 * s;
      fb1.gain.value = fb;
      fb2.gain.value = fb * 0.7;
    },
  ];
}

async function buildRadio(
  _ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  const ctx = _ctx;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 400 + (intensity / 100) * 400; // 400→800
  highpass.Q.value = 1.5;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2500 - (intensity / 100) * 1000; // 2500→1500
  lowpass.Q.value = 1.5;

  const distortion = ctx.createWaveShaper();
  const distAmount = 5 + (intensity / 100) * 45;
  distortion.curve = makeSigmoidCurve(distAmount);
  distortion.oversample = '2x';

  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = 1000;
  peak.gain.value = 6;
  peak.Q.value = 2;

  const output = ctx.createGain();
  output.gain.value = 1.1;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(distortion);
  distortion.connect(peak);
  peak.connect(output);
  output.connect(dest);

  return [
    [highpass, lowpass, distortion, peak, output],
    (i: number) => {
      lowpass.frequency.value = 3000 - (i / 100) * 1500;
      distortion.curve = makeSigmoidCurve(5 + (i / 100) * 45);
    },
  ];
}

async function buildWhisper(
  _ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  const ctx = _ctx;

  // Voice path: highpass → soft clip → gain → merger
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 500 + (intensity / 100) * 1500; // 500→2000

  const clip = ctx.createWaveShaper();
  clip.curve = makeSoftClipCurve();
  clip.oversample = '2x';

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0.7;

  // Noise path: white noise → bandpass → gain → merger
  const noiseBuffer = createWhiteNoiseBuffer(ctx);
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  noiseSource.start();

  const noiseBandpass = ctx.createBiquadFilter();
  noiseBandpass.type = 'bandpass';
  noiseBandpass.frequency.value = 2000;
  noiseBandpass.Q.value = 0.5;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.05 + (intensity / 100) * 0.15; // 0.05→0.20

  const merger = ctx.createGain();
  merger.gain.value = 1.0;

  // Voice chain
  source.connect(highpass);
  highpass.connect(clip);
  clip.connect(voiceGain);
  voiceGain.connect(merger);

  // Noise chain
  noiseSource.connect(noiseBandpass);
  noiseBandpass.connect(noiseGain);
  noiseGain.connect(merger);

  merger.connect(dest);

  return [
    [highpass, clip, voiceGain, noiseSource, noiseBandpass, noiseGain, merger],
    (i: number) => {
      highpass.frequency.value = 500 + (i / 100) * 1500;
      noiseGain.gain.value = 0.05 + (i / 100) * 0.15;
    },
  ];
}

async function buildChorus(
  _ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  dest: MediaStreamAudioDestinationNode,
  intensity: number,
): Promise<[AudioNode[], (i: number) => void]> {
  const ctx = _ctx;
  const scale = intensity / 100;

  // Dry signal
  const dry = ctx.createGain();
  dry.gain.value = 0.7;

  // Three modulated delay lines at different rates/depths
  const voices: { delay: DelayNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode }[] = [];
  const baseDelays = [0.015, 0.025, 0.035];
  const lfoRates = [0.6, 0.8, 1.1];
  const lfoDepths = [0.003, 0.004, 0.005];

  const merger = ctx.createGain();
  merger.gain.value = 1.0;

  source.connect(dry);
  dry.connect(merger);

  for (let v = 0; v < 3; v++) {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = baseDelays[v];

    const gain = ctx.createGain();
    gain.gain.value = (0.2 + scale * 0.2);

    // LFO modulates delay time for pitch wobble
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRates[v] + scale * 0.5;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = lfoDepths[v] * (0.5 + scale);

    lfo.connect(lfoGain);
    lfoGain.connect(delay.delayTime);
    lfo.start();

    source.connect(delay);
    delay.connect(gain);
    gain.connect(merger);

    voices.push({ delay, gain, lfo, lfoGain });
  }

  merger.connect(dest);

  const allNodes: (AudioNode | OscillatorNode)[] = [dry, merger];
  for (const v of voices) {
    allNodes.push(v.delay, v.gain, v.lfo, v.lfoGain);
  }

  return [
    allNodes,
    (i: number) => {
      const s = i / 100;
      for (let v = 0; v < voices.length; v++) {
        voices[v].gain.gain.value = 0.2 + s * 0.2;
        voices[v].lfo.frequency.value = lfoRates[v] + s * 0.5;
        voices[v].lfoGain.gain.value = lfoDepths[v] * (0.5 + s);
      }
    },
  ];
}

const PRESET_BUILDERS: Record<VoicePresetId, PresetBuilder> = {
  deep: buildDeep,
  chipmunk: buildChipmunk,
  robot: buildRobot,
  echo: buildEcho,
  radio: buildRadio,
  whisper: buildWhisper,
  chorus: buildChorus,
};

export async function createVoiceChangerTrack(
  audioContext: AudioContext,
  rawTrack: MediaStreamTrack,
  presetId: VoicePresetId,
  intensity: number,
): Promise<MediaStreamTrack> {
  // Clean up any previous chain
  destroyVoiceChanger();

  vcSource = audioContext.createMediaStreamSource(new MediaStream([rawTrack]));
  vcDest = audioContext.createMediaStreamDestination();

  const builder = PRESET_BUILDERS[presetId];
  const [nodes, updater] = await builder(audioContext, vcSource, vcDest, intensity);

  vcNodes = nodes.filter(
    (n) => !(n instanceof OscillatorNode) && !(n instanceof AudioBufferSourceNode),
  );
  vcOscillators = nodes.filter((n) => n instanceof OscillatorNode) as OscillatorNode[];
  vcBufferSources = nodes.filter(
    (n) => n instanceof AudioBufferSourceNode,
  ) as AudioBufferSourceNode[];
  currentIntensityUpdaters = [updater];

  return vcDest.stream.getAudioTracks()[0];
}

export function destroyVoiceChanger(): void {
  for (const osc of vcOscillators) {
    try {
      osc.stop();
    } catch {}
    try {
      osc.disconnect();
    } catch {}
  }
  vcOscillators = [];

  for (const src of vcBufferSources) {
    try {
      src.stop();
    } catch {}
    try {
      src.disconnect();
    } catch {}
  }
  vcBufferSources = [];

  for (const node of vcNodes) {
    try {
      node.disconnect();
    } catch {}
  }
  vcNodes = [];

  if (vcSource) {
    try {
      vcSource.disconnect();
    } catch {}
    vcSource = null;
  }
  if (vcDest) {
    try {
      vcDest.disconnect();
    } catch {}
    vcDest = null;
  }

  currentIntensityUpdaters = [];
}

export function updateVoiceChangerIntensity(intensity: number): void {
  for (const updater of currentIntensityUpdaters) {
    updater(intensity);
  }
}
