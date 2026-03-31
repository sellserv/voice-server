import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from './sqlite.js';

let adapter: SqliteAdapter;

beforeEach(() => {
  adapter = new SqliteAdapter(':memory:');
  adapter.execSync(`
    CREATE TABLE test_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE
    )
  `);
});

afterEach(async () => {
  await adapter.close();
});

describe('SqliteAdapter', () => {
  it('inserts and queries rows', async () => {
    await adapter.run('INSERT INTO test_users (name, email) VALUES (?, ?)', ['Alice', 'alice@test.com']);
    const rows = await adapter.query<{ id: number; name: string; email: string }>(
      'SELECT * FROM test_users WHERE name = ?',
      ['Alice'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice');
    expect(rows[0].email).toBe('alice@test.com');
  });

  it('queryOne returns single row', async () => {
    await adapter.run('INSERT INTO test_users (name, email) VALUES (?, ?)', ['Bob', 'bob@test.com']);
    const row = await adapter.queryOne<{ name: string }>('SELECT * FROM test_users WHERE name = ?', ['Bob']);
    expect(row).toBeDefined();
    expect(row!.name).toBe('Bob');
  });

  it('queryOne returns undefined for no match', async () => {
    const row = await adapter.queryOne('SELECT * FROM test_users WHERE name = ?', ['Nobody']);
    expect(row).toBeUndefined();
  });

  it('run returns changes and lastInsertRowid', async () => {
    const result = await adapter.run('INSERT INTO test_users (name, email) VALUES (?, ?)', ['Carol', 'carol@test.com']);
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBeGreaterThan(0);
  });

  it('transaction commits on success', async () => {
    await adapter.transaction(async (tx) => {
      await tx.run('INSERT INTO test_users (name, email) VALUES (?, ?)', ['Dan', 'dan@test.com']);
      await tx.run('INSERT INTO test_users (name, email) VALUES (?, ?)', ['Eve', 'eve@test.com']);
    });
    const rows = await adapter.query('SELECT * FROM test_users');
    expect(rows).toHaveLength(2);
  });

  it('transaction rolls back on error', async () => {
    await expect(
      adapter.transaction(async (tx) => {
        await tx.run('INSERT INTO test_users (name, email) VALUES (?, ?)', ['Frank', 'frank@test.com']);
        throw new Error('rollback test');
      }),
    ).rejects.toThrow('rollback test');
    const rows = await adapter.query('SELECT * FROM test_users');
    expect(rows).toHaveLength(0);
  });
});
