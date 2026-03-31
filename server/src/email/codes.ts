import { randomUUID, randomInt, createHmac } from 'crypto';
import { getDb } from '../adapters/index.js';
import { config } from '../config.js';

type CodeType = 'verification' | 'mfa' | 'password_reset';

function hashCode(code: string): string {
  return createHmac('sha256', config.jwtSecret).update(code).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(100000, 999999));
}

export async function createEmailCode(userId: string, type: CodeType): Promise<string> {
  // Invalidate existing unused codes for this user/type
  await getDb().run('UPDATE email_codes SET used = 1 WHERE user_id = ? AND type = ? AND used = 0', [
    userId,
    type,
  ]);

  const code = generateCode();
  const id = randomUUID();
  const minutes = type === 'verification' ? 10 : 5;
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace('Z', '');

  // Store hashed code in DB; return plaintext for emailing
  await getDb().run(
    'INSERT INTO email_codes (id, user_id, code, type, expires_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, hashCode(code), type, expiresAt],
  );

  return code;
}

export async function validateEmailCode(userId: string, code: string, type: CodeType): Promise<boolean> {
  const row = await getDb().queryOne<{ id: string }>(
    "SELECT id FROM email_codes WHERE user_id = ? AND code = ? AND type = ? AND used = 0 AND expires_at > datetime('now')",
    [userId, hashCode(code), type],
  );

  if (!row) return false;

  await getDb().run('UPDATE email_codes SET used = 1 WHERE id = ?', [row.id]);
  return true;
}

export async function cleanupExpiredCodes(): Promise<void> {
  await getDb().run("DELETE FROM email_codes WHERE expires_at < datetime('now')");
}
