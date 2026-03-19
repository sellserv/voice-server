import { randomUUID } from 'crypto';
import db from '../db/connection.js';

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

export function createSession(userId: string, ip: string | null, ua: string | null): string {
  const sessionId = randomUUID();
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, token, ip, ua, expiresAt);

  return token;
}

export function getSessionByToken(token: string): Session | undefined {
  const session = db.prepare(`
    SELECT * FROM auth_sessions WHERE token = ? AND expires_at > datetime('now')
  `).get(token) as Session | undefined;

  if (session) {
    // Update last_active_at asynchronously (or just run it, it's fast)
    db.prepare(`
      UPDATE auth_sessions SET last_active_at = datetime('now') WHERE id = ?
    `).run(session.id);
  }

  return session;
}

export function revokeSession(token: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

export function revokeAllUserSessions(userId: string): void {
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
}
