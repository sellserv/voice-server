import { describe, it, expect, afterAll } from 'vitest';
import { RedisPubSubAdapter } from './redis.js';

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)('RedisPubSubAdapter', () => {
  let adapter: RedisPubSubAdapter;

  afterAll(async () => {
    if (adapter) await adapter.close();
  });

  it('publishes and receives messages', async () => {
    adapter = new RedisPubSubAdapter(REDIS_URL!);
    const received: string[] = [];

    await adapter.subscribe('test-channel', (msg) => received.push(msg));
    // Small delay for Redis subscription to activate
    await new Promise(r => setTimeout(r, 100));
    await adapter.publish('test-channel', 'hello');
    await new Promise(r => setTimeout(r, 100));

    expect(received).toContain('hello');
  });

  it('unsubscribe stops receiving', async () => {
    const received: string[] = [];
    await adapter.subscribe('unsub-test', (msg) => received.push(msg));
    await new Promise(r => setTimeout(r, 100));
    await adapter.unsubscribe('unsub-test');
    await adapter.publish('unsub-test', 'should-not-receive');
    await new Promise(r => setTimeout(r, 100));

    expect(received).not.toContain('should-not-receive');
  });
});
