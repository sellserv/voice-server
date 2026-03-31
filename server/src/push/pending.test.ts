import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestDb, getTestRawDb } from '../test-helpers.js';
import {
  createPendingNotification,
  fetchAndDeletePending,
  cleanExpiredNotifications,
  shouldNotifyUser,
} from './pending.js';
import { randomUUID } from 'crypto';

function createTestUser(id?: string): string {
  const raw = getTestRawDb();
  const userId = id || randomUUID();
  const username = `user-${userId.slice(0, 8)}`;
  raw.prepare(
    "INSERT OR IGNORE INTO users (id, username, display_name, password_hash, email) VALUES (?, ?, ?, 'hash', ?)",
  ).run(userId, username, username, `${userId}@test.com`);
  return userId;
}

function createTestServer(ownerId: string): string {
  const raw = getTestRawDb();
  const serverId = randomUUID();
  raw.prepare('INSERT INTO servers (id, name, owner_id) VALUES (?, ?, ?)').run(serverId, 'Test Server', ownerId);
  raw.prepare('INSERT INTO server_members (server_id, user_id) VALUES (?, ?)').run(serverId, ownerId);
  return serverId;
}

function createTestChannel(serverId: string | null, type = 'text'): string {
  const raw = getTestRawDb();
  const channelId = randomUUID();
  raw.prepare('INSERT INTO channels (id, name, type, server_id) VALUES (?, ?, ?, ?)').run(channelId, 'test-channel', type, serverId);
  return channelId;
}

function addMember(serverId: string, userId: string, level = 'mentions') {
  const raw = getTestRawDb();
  raw.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id, notification_level) VALUES (?, ?, ?)').run(serverId, userId, level);
}

describe('Pending Notifications', () => {
  beforeAll(async () => { await setupTestDb(); });
  beforeEach(() => { getTestRawDb().exec('DELETE FROM pending_notifications'); });

  it('creates and fetches a pending notification', async () => {
    const userId = createTestUser();
    const id = await createPendingNotification(userId, 'dm', { channelId: 'ch1', senderId: 'u2' });
    expect(id).toBeTruthy();
    const result = await fetchAndDeletePending(id, userId);
    expect(result).toBeTruthy();
    expect(result!.type).toBe('dm');
    expect(result!.data.channelId).toBe('ch1');
  });

  it('returns null for wrong user', async () => {
    const userId = createTestUser();
    const otherId = createTestUser();
    const id = await createPendingNotification(userId, 'dm', { channelId: 'ch1' });
    const result = await fetchAndDeletePending(id, otherId);
    expect(result).toBeNull();
  });

  it('returns null for already-fetched notification', async () => {
    const userId = createTestUser();
    const id = await createPendingNotification(userId, 'dm', { channelId: 'ch1' });
    await fetchAndDeletePending(id, userId);
    const second = await fetchAndDeletePending(id, userId);
    expect(second).toBeNull();
  });

  it('cleans expired notifications', async () => {
    const raw = getTestRawDb();
    const userId = createTestUser();
    raw.prepare("INSERT INTO pending_notifications (id, user_id, type, data, created_at) VALUES (?, ?, 'dm', '{}', datetime('now', '-6 minutes'))").run('old-id', userId);
    await createPendingNotification(userId, 'dm', {});
    await cleanExpiredNotifications();
    const remaining = raw.prepare('SELECT COUNT(*) as count FROM pending_notifications').get() as { count: number };
    expect(remaining.count).toBe(1);
  });
});

describe('shouldNotifyUser', () => {
  beforeAll(async () => { await setupTestDb(); });

  it('returns true for DM when not muted', async () => {
    const userId = createTestUser();
    const channelId = createTestChannel(null, 'dm');
    expect(await shouldNotifyUser(userId, channelId, null, 'dm')).toBe(true);
  });

  it('returns false for muted DM', async () => {
    const raw = getTestRawDb();
    const userId = createTestUser();
    const channelId = createTestChannel(null, 'dm');
    raw.prepare("INSERT INTO dm_notification_overrides (user_id, channel_id, muted_until) VALUES (?, ?, '9999-12-31T23:59:59Z')").run(userId, channelId);
    expect(await shouldNotifyUser(userId, channelId, null, 'dm')).toBe(false);
  });

  it('returns true for mention with default server settings', async () => {
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'mentions');
    expect(await shouldNotifyUser(userId, channelId, serverId, 'mention')).toBe(true);
  });

  it('returns false for channel_message with mentions-only server setting', async () => {
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'mentions');
    expect(await shouldNotifyUser(userId, channelId, serverId, 'channel_message')).toBe(false);
  });

  it('returns true for channel_message with all server setting', async () => {
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'all');
    expect(await shouldNotifyUser(userId, channelId, serverId, 'channel_message')).toBe(true);
  });

  it('returns false for nothing server setting', async () => {
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'nothing');
    expect(await shouldNotifyUser(userId, channelId, serverId, 'mention')).toBe(false);
  });

  it('channel override takes precedence over server setting', async () => {
    const raw = getTestRawDb();
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'nothing');
    raw.prepare("INSERT INTO channel_notification_overrides (user_id, channel_id, level) VALUES (?, ?, 'all')").run(userId, channelId);
    expect(await shouldNotifyUser(userId, channelId, serverId, 'channel_message')).toBe(true);
  });

  it('muted server blocks notifications', async () => {
    const raw = getTestRawDb();
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'all');
    raw.prepare("UPDATE server_members SET muted_until = '9999-12-31T23:59:59Z' WHERE server_id = ? AND user_id = ?").run(serverId, userId);
    expect(await shouldNotifyUser(userId, channelId, serverId, 'channel_message')).toBe(false);
  });

  it('muted server still allows direct mentions', async () => {
    const raw = getTestRawDb();
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'mentions');
    raw.prepare("UPDATE server_members SET muted_until = '9999-12-31T23:59:59Z' WHERE server_id = ? AND user_id = ?").run(serverId, userId);
    expect(await shouldNotifyUser(userId, channelId, serverId, 'mention')).toBe(true);
  });

  it('suppress_everyone blocks @everyone pushes', async () => {
    const raw = getTestRawDb();
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'mentions');
    raw.prepare('UPDATE server_members SET suppress_everyone = 1 WHERE server_id = ? AND user_id = ?').run(serverId, userId);
    expect(await shouldNotifyUser(userId, channelId, serverId, 'everyone')).toBe(false);
  });

  it('muted channel blocks notifications', async () => {
    const raw = getTestRawDb();
    const ownerId = createTestUser();
    const userId = createTestUser();
    const serverId = createTestServer(ownerId);
    const channelId = createTestChannel(serverId);
    addMember(serverId, userId, 'all');
    raw.prepare("INSERT INTO channel_notification_overrides (user_id, channel_id, level, muted_until) VALUES (?, ?, 'default', '9999-12-31T23:59:59Z')").run(userId, channelId);
    expect(await shouldNotifyUser(userId, channelId, serverId, 'channel_message')).toBe(false);
  });

  it('incoming_call always returns true', async () => {
    const userId = createTestUser();
    expect(await shouldNotifyUser(userId, null, null, 'incoming_call')).toBe(true);
  });
});
