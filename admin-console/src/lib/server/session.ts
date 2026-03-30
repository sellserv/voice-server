import { env } from '$env/dynamic/private';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

interface SessionData {
  userId: string;
  username: string;
  displayName: string;
  accessToken: string;
  createdAt: number;
}

function getSecret(): Buffer {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  return Buffer.from(secret.slice(0, 32), 'utf-8');
}

export function encryptSession(data: SessionData): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getSecret(), iv);
  const json = JSON.stringify(data);
  let encrypted = cipher.update(json, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSession(value: string): SessionData | null {
  try {
    const [ivHex, authTagHex, encrypted] = value.split(':');
    if (!ivHex || !authTagHex || !encrypted) return null;
    const decipher = createDecipheriv(ALGORITHM, getSecret(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    const data: SessionData = JSON.parse(decrypted);
    if (Date.now() - data.createdAt > SESSION_MAX_AGE) return null;
    return data;
  } catch {
    return null;
  }
}
