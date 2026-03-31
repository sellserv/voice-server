import { randomUUID, randomBytes } from 'crypto';
import { getDb } from '../adapters/index.js';

export interface Session {
  id: string;
  user_id: string;
  token: string;
  mfa_verified: number;
  ip_address: string | null;
  user_agent: string | null;
  last_active_at: string;
  expires_at: string;
  created_at: string;
}

export async function createSession(userId: string, ip: string | null, ua: string | null): Promise<string> {
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  await getDb().run(`
    INSERT INTO auth_sessions (id, user_id, token, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [sessionId, userId, token, ip, ua, expiresAt]);

  return token;
}

export async function getSessionByToken(token: string): Promise<Session | undefined> {
  const session = await getDb().queryOne<Session>(`
    SELECT * FROM auth_sessions WHERE token = ? AND expires_at > datetime('now')
  `, [token]);

  if (session) {
    // Update last_active_at asynchronously (or just run it, it's fast)
    await getDb().run(`
      UPDATE auth_sessions SET last_active_at = datetime('now') WHERE id = ?
    `, [session.id]);
  }

  return session;
}

export async function revokeSession(token: string): Promise<void> {
  await getDb().run('DELETE FROM auth_sessions WHERE token = ?', [token]);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await getDb().run('DELETE FROM auth_sessions WHERE user_id = ?', [userId]);
}
