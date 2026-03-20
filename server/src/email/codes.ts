import { randomUUID, randomInt, createHmac } from 'crypto';
import db from '../db/connection.js';
import { config } from '../config.js';

type CodeType = 'verification' | 'mfa' | 'password_reset';

function hashCode(code: string): string {
  return createHmac('sha256', config.jwtSecret).update(code).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(100000, 999999));
}

export function createEmailCode(userId: string, type: CodeType): string {
  // Invalidate existing unused codes for this user/type
  db.prepare('UPDATE email_codes SET used = 1 WHERE user_id = ? AND type = ? AND used = 0').run(
    userId,
    type,
  );

  const code = generateCode();
  const id = randomUUID();
  const minutes = type === 'verification' ? 10 : 5;
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');

  // Store hashed code in DB; return plaintext for emailing
  db.prepare(
    'INSERT INTO email_codes (id, user_id, code, type, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, userId, hashCode(code), type, expiresAt);

  return code;
}

export function validateEmailCode(userId: string, code: string, type: CodeType): boolean {
  const row = db
    .prepare(
      "SELECT id FROM email_codes WHERE user_id = ? AND code = ? AND type = ? AND used = 0 AND expires_at > datetime('now')",
    )
    .get(userId, hashCode(code), type) as { id: string } | undefined;

  if (!row) return false;

  db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(row.id);
  return true;
}

export function cleanupExpiredCodes() {
  db.prepare("DELETE FROM email_codes WHERE expires_at < datetime('now')").run();
}
