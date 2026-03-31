import type { StorageAdapter } from '../types.js';
import { writeFile, unlink, access } from 'fs/promises';
import { resolve } from 'path';

export class LocalAdapter implements StorageAdapter {
  constructor(private uploadDir: string) {}

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = resolve(this.uploadDir, key);
    await writeFile(filePath, data);
    return `/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await unlink(resolve(this.uploadDir, key)).catch(() => {});
  }

  getUrl(key: string): string {
    return `/uploads/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(resolve(this.uploadDir, key));
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {}
}
