import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestDb, getTestRawDb } from '../test-helpers.js';

describe('Database Schema', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  it('should have the users table', () => {
    const raw = getTestRawDb();
    const table = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    expect(table).toBeDefined();
    // @ts-ignore
    expect(table.name).toBe('users');
  });

  it('should have the auth_sessions table', () => {
    const raw = getTestRawDb();
    const table = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get();
    expect(table).toBeDefined();
    // @ts-ignore
    expect(table.name).toBe('auth_sessions');
  });
});
