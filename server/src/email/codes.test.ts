import { describe, it, expect, beforeAll } from 'vitest';
import { createEmailCode, validateEmailCode } from './codes.js';
import { initSchema } from '../db/schema.js';
import db from '../db/connection.js';

describe('Email Codes', () => {
  beforeAll(() => {
    initSchema();
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM auth_sessions').run();
    db.prepare('DELETE FROM email_codes').run();
    db.exec('PRAGMA foreign_keys = ON');
    db.prepare('INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)').run(
      'user1', 'testuser', 'Test User', 'hash'
    );
  });

  it('should create and validate an MFA code', () => {
    const code = createEmailCode('user1', 'mfa');
    expect(code).toHaveLength(6);
    expect(/^[0-9]+$/.test(code)).toBe(true);

    const isValid = validateEmailCode('user1', code, 'mfa');
    expect(isValid).toBe(true);
  });

  it('should not validate an incorrect code', () => {
    createEmailCode('user1', 'mfa');
    const isValid = validateEmailCode('user1', '000000', 'mfa');
    expect(isValid).toBe(false);
  });

  it('should not validate a used code', () => {
    const code = createEmailCode('user1', 'mfa');
    validateEmailCode('user1', code, 'mfa');
    const isValidAgain = validateEmailCode('user1', code, 'mfa');
    expect(isValidAgain).toBe(false);
  });

  it('should invalidate old codes when a new one is created', () => {
    const firstCode = createEmailCode('user1', 'mfa');
    createEmailCode('user1', 'mfa'); // New code
    
    const isFirstValid = validateEmailCode('user1', firstCode, 'mfa');
    expect(isFirstValid).toBe(false);
  });
});
