import { SqliteAdapter } from './adapters/db/sqlite.js';
import { _setDbForTesting, getDb } from './adapters/index.js';
import { initSchema } from './db/schema.js';

/**
 * Initialize an in-memory SQLite adapter for testing.
 * Sets it as the active database adapter, then runs schema init.
 * Returns the adapter instance for direct access if needed.
 */
export async function setupTestDb(): Promise<SqliteAdapter> {
  const adapter = new SqliteAdapter(':memory:');
  _setDbForTesting(adapter);
  await initSchema();
  return adapter;
}

/**
 * Get the raw better-sqlite3 database instance for direct SQL in tests.
 * Useful for setup/teardown that doesn't go through the adapter async API.
 */
export function getTestRawDb(): import('better-sqlite3').Database {
  const db = getDb() as SqliteAdapter;
  return db.getRawDb();
}
