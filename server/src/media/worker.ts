import * as mediasoup from 'mediasoup';
import * as os from 'os';
import { config } from '../config.js';

const workers: mediasoup.types.Worker[] = [];
let nextWorkerIdx = 0;
let onWorkerDied: (() => void) | null = null;

export function setWorkerDiedCallback(cb: () => void) {
  onWorkerDied = cb;
}

async function spawnWorker(): Promise<mediasoup.types.Worker> {
  const worker = await mediasoup.createWorker({
    rtcMinPort: config.mediasoup.minPort,
    rtcMaxPort: config.mediasoup.maxPort,
    logLevel: 'warn',
  });

  worker.on('died', () => {
    console.error(`mediasoup worker ${worker.pid} died, restarting in 2s...`);
    const idx = workers.indexOf(worker);
    if (idx !== -1) workers.splice(idx, 1);
    onWorkerDied?.();
    setTimeout(async () => {
      try {
        const replacement = await spawnWorker();
        workers.push(replacement);
        console.log(`mediasoup replacement worker started [pid:${replacement.pid}]`);
      } catch (err) {
        console.error('Failed to restart mediasoup worker:', err);
      }
    }, 2000);
  });

  return worker;
}

export async function createWorkers(): Promise<void> {
  const maxWorkers = parseInt(process.env.MEDIASOUP_WORKERS || '0') || os.cpus().length;
  const numWorkers = Math.max(1, Math.min(maxWorkers, os.cpus().length));

  for (let i = 0; i < numWorkers; i++) {
    const worker = await spawnWorker();
    workers.push(worker);
    console.log(`mediasoup worker ${i + 1}/${numWorkers} started [pid:${worker.pid}]`);
  }
}

/** @deprecated Use createWorkers() instead */
export async function createWorker(): Promise<mediasoup.types.Worker> {
  await createWorkers();
  return workers[0];
}

export function getNextWorker(): mediasoup.types.Worker {
  if (workers.length === 0) throw new Error('No mediasoup workers available');
  const worker = workers[nextWorkerIdx % workers.length];
  nextWorkerIdx = (nextWorkerIdx + 1) % workers.length;
  return worker;
}

/** @deprecated Use getNextWorker() instead */
export function getWorker(): mediasoup.types.Worker {
  return getNextWorker();
}

export const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
      usedtx: 0,
      stereo: 0,
      'sprop-stereo': 0,
      minptime: 10,
    },
  } as unknown as mediasoup.types.RtpCodecCapability,
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
  } as mediasoup.types.RtpCodecCapability,
  {
    kind: 'video',
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: {
      'profile-id': 2,
    },
  } as unknown as mediasoup.types.RtpCodecCapability,
];
