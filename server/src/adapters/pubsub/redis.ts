import Redis from 'ioredis';
import type { PubSubAdapter } from '../types.js';

export class RedisPubSubAdapter implements PubSubAdapter {
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, Set<(message: string) => void>>();

  constructor(url: string) {
    this.pub = new Redis(url);
    this.sub = new Redis(url);

    this.sub.on('message', (channel: string, message: string) => {
      const channelHandlers = this.handlers.get(channel);
      if (channelHandlers) {
        for (const handler of channelHandlers) {
          handler(message);
        }
      }
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.pub.publish(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.sub.subscribe(channel);
    }
    this.handlers.get(channel)!.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);
    await this.sub.unsubscribe(channel);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    await this.sub.quit();
    await this.pub.quit();
  }
}
