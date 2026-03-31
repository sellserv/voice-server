import type { PubSubAdapter } from '../types.js';
import { EventEmitter } from 'events';

export class MemoryPubSubAdapter implements PubSubAdapter {
  private emitter = new EventEmitter();

  async publish(channel: string, message: string): Promise<void> {
    this.emitter.emit(channel, message);
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    this.emitter.on(channel, handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.emitter.removeAllListeners(channel);
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
  }
}
