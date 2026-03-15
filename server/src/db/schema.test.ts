import { describe, it, expect, beforeAll } from 'vitest';
import db from './connection.js';
import { initSchema } from './schema.js';

describe('Database Schema', () => {
  beforeAll(() => {
    initSchema();
  });

  it('should have the users table', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    expect(table).toBeDefined();
    // @ts-ignore
    expect(table.name).toBe('users');
  });

  it('should have the auth_sessions table', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").get();
    expect(table).toBeDefined();
    // @ts-ignore
    expect(table.name).toBe('auth_sessions');
  });
});
