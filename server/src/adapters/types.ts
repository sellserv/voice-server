export interface DatabaseAdapter {
  /** Execute a query that returns multiple rows */
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;

  /** Execute a query that returns a single row or undefined */
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | undefined>;

  /** Execute a statement that modifies data (INSERT/UPDATE/DELETE) */
  run(sql: string, params?: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;

  /** Execute raw SQL (DDL, multi-statement). No params, no return. */
  exec(sql: string): Promise<void>;

  /** Run multiple operations in a transaction */
  transaction<T>(fn: (db: DatabaseAdapter) => Promise<T>): Promise<T>;

  /** Close the connection/pool */
  close(): Promise<void>;
}

export interface PubSubAdapter {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  close(): Promise<void>;
}

export interface StateAdapter {
  setPresence(userId: string, state: Record<string, any>, ttlMs: number): Promise<void>;
  getPresence(userId: string): Promise<Record<string, any> | null>;
  removePresence(userId: string): Promise<void>;
  getAllPresence(): Promise<Map<string, Record<string, any>>>;

  setTyping(channelId: string, userId: string, ttlMs: number): Promise<void>;
  getTyping(channelId: string): Promise<string[]>;
  removeTyping(channelId: string, userId: string): Promise<void>;

  cacheSession(token: string, session: Record<string, any>, ttlMs: number): Promise<void>;
  getCachedSession(token: string): Promise<Record<string, any> | null>;
  removeCachedSession(token: string): Promise<void>;

  close(): Promise<void>;
}

export interface VoiceAdapter {
  createRoom(channelId: string): Promise<{ roomName: string }>;
  deleteRoom(channelId: string): Promise<void>;
  generateJoinToken(channelId: string, userId: string, displayName: string): Promise<string>;
  getRoomParticipants(channelId: string): Promise<{ userId: string; displayName: string }[]>;
  close(): Promise<void>;
}

export interface StorageAdapter {
  /** Upload a file. Returns the public URL. */
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  /** Delete a file by key */
  delete(key: string): Promise<void>;
  /** Get the public URL for a key */
  getUrl(key: string): string;
  /** Check if a file exists */
  exists(key: string): Promise<boolean>;
  /** Generate a presigned upload URL (S3 only, local returns null) */
  getPresignedUploadUrl?(key: string, contentType: string, expiresIn?: number): Promise<string>;
  close(): Promise<void>;
}

export interface Adapters {
  db: DatabaseAdapter;
  pubsub: PubSubAdapter;
  state: StateAdapter;
  voice: VoiceAdapter;
  storage: StorageAdapter;
}
