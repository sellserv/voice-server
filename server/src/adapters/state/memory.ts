import type { StateAdapter } from '../types.js';

export class MemoryStateAdapter implements StateAdapter {
  private presence = new Map<string, { data: Record<string, any>; expiresAt: number }>();
  private typing = new Map<string, Map<string, number>>();
  private sessions = new Map<string, { data: Record<string, any>; expiresAt: number }>();

  async setPresence(userId: string, state: Record<string, any>, ttlMs: number): Promise<void> {
    this.presence.set(userId, { data: state, expiresAt: Date.now() + ttlMs });
  }

  async getPresence(userId: string): Promise<Record<string, any> | null> {
    const entry = this.presence.get(userId);
    if (!entry || entry.expiresAt < Date.now()) { this.presence.delete(userId); return null; }
    return entry.data;
  }

  async removePresence(userId: string): Promise<void> { this.presence.delete(userId); }

  async getAllPresence(): Promise<Map<string, Record<string, any>>> {
    const result = new Map<string, Record<string, any>>();
    const now = Date.now();
    for (const [k, v] of this.presence) {
      if (v.expiresAt >= now) result.set(k, v.data);
      else this.presence.delete(k);
    }
    return result;
  }

  async setTyping(channelId: string, userId: string, ttlMs: number): Promise<void> {
    if (!this.typing.has(channelId)) this.typing.set(channelId, new Map());
    this.typing.get(channelId)!.set(userId, Date.now() + ttlMs);
  }

  async getTyping(channelId: string): Promise<string[]> {
    const map = this.typing.get(channelId);
    if (!map) return [];
    const now = Date.now();
    const active: string[] = [];
    for (const [uid, exp] of map) {
      if (exp >= now) active.push(uid);
      else map.delete(uid);
    }
    return active;
  }

  async removeTyping(channelId: string, userId: string): Promise<void> {
    this.typing.get(channelId)?.delete(userId);
  }

  async cacheSession(token: string, session: Record<string, any>, ttlMs: number): Promise<void> {
    this.sessions.set(token, { data: session, expiresAt: Date.now() + ttlMs });
  }

  async getCachedSession(token: string): Promise<Record<string, any> | null> {
    const entry = this.sessions.get(token);
    if (!entry || entry.expiresAt < Date.now()) { this.sessions.delete(token); return null; }
    return entry.data;
  }

  async removeCachedSession(token: string): Promise<void> { this.sessions.delete(token); }

  async close(): Promise<void> {
    this.presence.clear();
    this.typing.clear();
    this.sessions.clear();
  }
}
