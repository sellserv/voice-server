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

  // Pub/Sub — Phase 2 (for now, always use memory)
  const { MemoryPubSubAdapter } = await import('./pubsub/memory.js');
  const pubsub = new MemoryPubSubAdapter();

  // State — Phase 2 (for now, always use memory)
  const { MemoryStateAdapter } = await import('./state/memory.js');
  const state = new MemoryStateAdapter();

  // Voice — Phase 3 (for now, always use mediasoup stub)
  const { MediasoupAdapter } = await import('./voice/mediasoup.js');
  const voice = new MediasoupAdapter();

  // Storage — Phase 4 (for now, always use local)
  const { LocalAdapter } = await import('./storage/local.js');
  const storage = new LocalAdapter(config.uploadDir);

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
