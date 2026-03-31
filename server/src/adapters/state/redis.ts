import Redis from 'ioredis';
import type { StateAdapter } from '../types.js';

export class RedisStateAdapter implements StateAdapter {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url);
  }

  // ── Presence ──

  async setPresence(userId: string, state: Record<string, any>, ttlMs: number): Promise<void> {
    await this.redis.set(`presence:${userId}`, JSON.stringify(state), 'PX', ttlMs);
  }

  async getPresence(userId: string): Promise<Record<string, any> | null> {
    const data = await this.redis.get(`presence:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  async removePresence(userId: string): Promise<void> {
    await this.redis.del(`presence:${userId}`);
  }

  async getAllPresence(): Promise<Map<string, Record<string, any>>> {
    const result = new Map<string, Record<string, any>>();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'presence:*', 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        const values = await this.redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          if (values[i]) {
            const userId = keys[i].replace('presence:', '');
            result.set(userId, JSON.parse(values[i]!));
          }
        }
      }
    } while (cursor !== '0');
    return result;
  }

  // ── Typing ──

  async setTyping(channelId: string, userId: string, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    await this.redis.zadd(`typing:${channelId}`, expiresAt, userId);
  }

  async getTyping(channelId: string): Promise<string[]> {
    const now = Date.now();
    // Remove expired entries
    await this.redis.zremrangebyscore(`typing:${channelId}`, '-inf', now);
    // Return active typers
    return this.redis.zrangebyscore(`typing:${channelId}`, now, '+inf');
  }

  async removeTyping(channelId: string, userId: string): Promise<void> {
    await this.redis.zrem(`typing:${channelId}`, userId);
  }

  // ── Session Cache ──

  async cacheSession(token: string, session: Record<string, any>, ttlMs: number): Promise<void> {
    await this.redis.set(`session:${token}`, JSON.stringify(session), 'PX', ttlMs);
  }

  async getCachedSession(token: string): Promise<Record<string, any> | null> {
    const data = await this.redis.get(`session:${token}`);
    return data ? JSON.parse(data) : null;
  }

  async removeCachedSession(token: string): Promise<void> {
    await this.redis.del(`session:${token}`);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
