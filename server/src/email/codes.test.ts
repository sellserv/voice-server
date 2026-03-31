import { describe, it, expect, beforeAll } from 'vitest';
import { createEmailCode, validateEmailCode } from './codes.js';
import { setupTestDb, getTestRawDb } from '../test-helpers.js';

describe('Email Codes', () => {
  beforeAll(async () => {
    await setupTestDb();
    const raw = getTestRawDb();
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare('DELETE FROM users').run();
    raw.prepare('DELETE FROM auth_sessions').run();
    raw.prepare('DELETE FROM email_codes').run();
    raw.exec('PRAGMA foreign_keys = ON');
    raw.prepare('INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)').run(
      'user1', 'testuser', 'Test User', 'hash'
    );
  });

  it('should create and validate an MFA code', async () => {
    const code = await createEmailCode('user1', 'mfa');
    expect(code).toHaveLength(6);
    expect(/^[0-9]+$/.test(code)).toBe(true);

    const isValid = await validateEmailCode('user1', code, 'mfa');
    expect(isValid).toBe(true);
  });

  it('should not validate an incorrect code', async () => {
    await createEmailCode('user1', 'mfa');
    const isValid = await validateEmailCode('user1', '000000', 'mfa');
    expect(isValid).toBe(false);
  });

  it('should not validate a used code', async () => {
    const code = await createEmailCode('user1', 'mfa');
    await validateEmailCode('user1', code, 'mfa');
    const isValidAgain = await validateEmailCode('user1', code, 'mfa');
    expect(isValidAgain).toBe(false);
  });

  it('should invalidate old codes when a new one is created', async () => {
    const firstCode = await createEmailCode('user1', 'mfa');
    await createEmailCode('user1', 'mfa'); // New code

    const isFirstValid = await validateEmailCode('user1', firstCode, 'mfa');
    expect(isFirstValid).toBe(false);
  });
});
