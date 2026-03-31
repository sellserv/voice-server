import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { RedisStateAdapter } from './redis.js';

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)('RedisStateAdapter', () => {
  let adapter: RedisStateAdapter;

  beforeEach(async () => {
    if (!adapter) adapter = new RedisStateAdapter(REDIS_URL!);
  });

  afterAll(async () => {
    if (adapter) await adapter.close();
  });

  it('sets and gets presence', async () => {
    await adapter.setPresence('user1', { status: 'online' }, 5000);
    const presence = await adapter.getPresence('user1');
    expect(presence).toEqual({ status: 'online' });
  });

  it('removes presence', async () => {
    await adapter.setPresence('user2', { status: 'online' }, 5000);
    await adapter.removePresence('user2');
    const presence = await adapter.getPresence('user2');
    expect(presence).toBeNull();
  });

  it('gets all presence', async () => {
    await adapter.setPresence('userA', { status: 'online' }, 5000);
    await adapter.setPresence('userB', { status: 'away' }, 5000);
    const all = await adapter.getAllPresence();
    expect(all.get('userA')).toEqual({ status: 'online' });
    expect(all.get('userB')).toEqual({ status: 'away' });
  });

  it('sets and gets typing', async () => {
    await adapter.setTyping('channel1', 'user1', 5000);
    const typing = await adapter.getTyping('channel1');
    expect(typing).toContain('user1');
  });

  it('removes typing', async () => {
    await adapter.setTyping('channel2', 'user1', 5000);
    await adapter.removeTyping('channel2', 'user1');
    const typing = await adapter.getTyping('channel2');
    expect(typing).not.toContain('user1');
  });

  it('caches and gets session', async () => {
    await adapter.cacheSession('token123', { userId: 'u1', role: 'member' }, 5000);
    const session = await adapter.getCachedSession('token123');
    expect(session).toEqual({ userId: 'u1', role: 'member' });
  });

  it('removes cached session', async () => {
    await adapter.cacheSession('token456', { userId: 'u2' }, 5000);
    await adapter.removeCachedSession('token456');
    const session = await adapter.getCachedSession('token456');
    expect(session).toBeNull();
  });
});
