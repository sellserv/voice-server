import { config } from '../config.js';
import type { DatabaseAdapter, Adapters } from './types.js';
import { SqliteAdapter } from './db/sqlite.js';

let adapters: Adapters | null = null;
let dbAdapter: DatabaseAdapter | null = null;

/** Get the database adapter. Available after initAdapters(). */
export function getDb(): DatabaseAdapter {
  if (!dbAdapter) throw new Error('Database adapter not initialized. Call initAdapters() first.');
  return dbAdapter;
}

/** Get all adapters. Available after initAdapters(). */
export function getAdapters(): Adapters {
  if (!adapters) throw new Error('Adapters not initialized. Call initAdapters() first.');
  return adapters;
}

/**
 * Initialize all adapters based on config.
 * Called once at startup before routes are registered.
 */
export async function initAdapters(): Promise<Adapters> {
  // Database
  if (config.dbType === 'postgres') {
    const { PostgresAdapter } = await import('./db/postgres.js');
    dbAdapter = new PostgresAdapter(config.databaseUrl);
  } else {
    const sqliteAdapter = new SqliteAdapter(config.dbPath);
    dbAdapter = sqliteAdapter;
  }

  // Pub/Sub
  let pubsub;
  if (config.redisUrl) {
    const { RedisPubSubAdapter } = await import('./pubsub/redis.js');
    pubsub = new RedisPubSubAdapter(config.redisUrl);
  } else {
    const { MemoryPubSubAdapter } = await import('./pubsub/memory.js');
    pubsub = new MemoryPubSubAdapter();
  }

  // State
  let state;
  if (config.redisUrl) {
    const { RedisStateAdapter } = await import('./state/redis.js');
    state = new RedisStateAdapter(config.redisUrl);
  } else {
    const { MemoryStateAdapter } = await import('./state/memory.js');
    state = new MemoryStateAdapter();
  }

  // Voice
  let voice;
  if (config.voiceType === 'livekit') {
    const { LiveKitAdapter } = await import('./voice/livekit.js');
    voice = new LiveKitAdapter(config.livekit.url, config.livekit.publicUrl, config.livekit.apiKey, config.livekit.apiSecret);
  } else {
    const { MediasoupAdapter } = await import('./voice/mediasoup.js');
    voice = new MediasoupAdapter();
  }

  // Storage
  let storage;
  if (config.storageType === 's3') {
    const { S3Adapter } = await import('./storage/s3.js');
    storage = new S3Adapter(config.s3);
  } else {
    const { LocalAdapter } = await import('./storage/local.js');
    storage = new LocalAdapter(config.uploadDir);
  }

  adapters = { db: dbAdapter, pubsub, state, voice, storage };
  return adapters;
}

/**
 * Replace the database adapter. For testing only.
 * Allows tests to inject an in-memory SQLite adapter without calling initAdapters().
 */
export function _setDbForTesting(adapter: DatabaseAdapter): void {
  dbAdapter = adapter;
}

/** Shutdown all adapters (for graceful shutdown) */
export async function shutdownAdapters(): Promise<void> {
  if (adapters) {
    await adapters.db.close();
    await adapters.pubsub.close();
    await adapters.state.close();
    await adapters.voice.close();
    await adapters.storage.close();
    adapters = null;
    dbAdapter = null;
  }
}
