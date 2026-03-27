/**
 * Seed a demo server with fake users and conversations on staging.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts
 *
 * Cleanup:
 *   npx tsx scripts/seed-demo.ts --cleanup
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Load .env if present
try {
  const envFile = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const DB_PATH = process.env.DB_PATH || resolve(__dirname, '../data/voip-server.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DEMO_PREFIX = 'demo_';
const SERVER_NAME = 'Hangout';
const PASSWORD = 'DemoPass123!';

// ── Fake users ──
const USERS = [
  { username: 'jake', display_name: 'Jake', color: '#23a559', premium: true },
  { username: 'mia', display_name: 'Mia', color: '#e78284', premium: false },
  { username: 'alex', display_name: 'Alex', color: '#7eb8f0', premium: false },
  { username: 'sam', display_name: 'Sam', color: '#e0a45e', premium: false },
  { username: 'luna', display_name: 'Luna', color: '#c4a7e7', premium: true },
  { username: 'jordan', display_name: 'Jordan', color: '#99aab5', premium: false },
];

// ── Conversations ──
const MESSAGES: { user: string; content: string; reactions?: { emoji: string; users: string[] }[] }[] = [
  { user: 'jake', content: 'hey everyone, glad we finally made this server' },
  { user: 'mia', content: 'right?? so much better than group chats' },
  { user: 'alex', content: 'the voice quality is actually really good, was not expecting that' },
  { user: 'sam', content: 'yeah the spatial audio stuff is cool. who wants to hop in a call later?' },
  { user: 'luna', content: 'I\'m down! maybe around 8?', reactions: [{ emoji: '👍', users: ['jake', 'sam', 'alex'] }] },
  { user: 'jake', content: 'works for me. also check out the soundboard lol', reactions: [{ emoji: '😂', users: ['mia', 'luna'] }] },
  { user: 'mia', content: 'the custom emojis are a nice touch too' },
  { user: 'alex', content: 'anyone tried the screen sharing yet? wanted to show some clips' },
  { user: 'jordan', content: 'just joined, what did I miss?' },
  { user: 'sam', content: 'not much, just planning a call for tonight' },
  { user: 'jordan', content: 'oh sick, count me in' },
  { user: 'luna', content: 'this is way nicer than I thought it would be. love the dark theme', reactions: [{ emoji: '💯', users: ['jake', 'mia', 'alex', 'sam'] }] },
  { user: 'jake', content: 'the roles and permissions system is pretty solid too' },
  { user: 'mia', content: 'yeah I set up a few channels already, check out #music and #clips' },
  { user: 'alex', content: 'nice! ok see everyone at 8 🎮', reactions: [{ emoji: '🎮', users: ['jake', 'luna', 'jordan'] }] },
];

const CLIPS_MESSAGES: { user: string; content: string; reactions?: { emoji: string; users: string[] }[] }[] = [
  { user: 'alex', content: 'check this insane play I hit yesterday' },
  { user: 'jake', content: 'no way dude that was clean', reactions: [{ emoji: '🔥', users: ['mia', 'sam'] }] },
  { user: 'mia', content: 'I have one too but it\'s embarrassing lol' },
  { user: 'luna', content: 'post it anyway we won\'t judge 😄' },
  { user: 'sam', content: 'we definitely will judge' },
  { user: 'mia', content: 'ok fine here it is... I fell off the map 💀', reactions: [{ emoji: '💀', users: ['jake', 'alex', 'sam', 'luna', 'jordan'] }] },
];

async function seed() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const userIds: Record<string, string> = {};
  const now = new Date();

  console.log('Creating demo users...');
  for (const u of USERS) {
    const id = DEMO_PREFIX + randomUUID();
    userIds[u.username] = id;

    db.prepare(
      `INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, premium_tier, created_at)
       VALUES (?, ?, ?, ?, 'member', ?, ?)`,
    ).run(id, DEMO_PREFIX + u.username, u.display_name, passwordHash, u.premium ? 'pro' : 'free', now.toISOString());
  }

  // Pick first user as server owner
  const ownerId = userIds['jake'];

  console.log('Creating demo server...');
  const serverId = DEMO_PREFIX + randomUUID();
  db.prepare(
    'INSERT INTO servers (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)',
  ).run(serverId, SERVER_NAME, ownerId, now.toISOString());

  // Add all users as members
  for (const [, userId] of Object.entries(userIds)) {
    db.prepare(
      'INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)',
    ).run(serverId, userId, now.toISOString());
  }

  // Add the real admin account so they can see the demo server
  const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('staging_admin') as { id: string } | undefined;
  if (adminUser) {
    db.prepare(
      'INSERT OR IGNORE INTO server_members (server_id, user_id, joined_at) VALUES (?, ?, ?)',
    ).run(serverId, adminUser.id, now.toISOString());
    console.log('Added staging_admin to demo server.');
  } else {
    console.log('Warning: staging_admin user not found, skipping.');
  }

  // Create roles
  console.log('Creating roles...');
  const roles: Record<string, string> = {};
  for (const u of USERS) {
    const roleId = DEMO_PREFIX + randomUUID();
    roles[u.username] = roleId;
    db.prepare(
      'INSERT INTO roles (id, name, color, position, permissions, is_default, server_id) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).run(roleId, u.display_name, u.color, USERS.indexOf(u), '{}', serverId);

    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userIds[u.username], roleId);
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(roleId, userIds[u.username]);
  }

  // Create channel groups
  console.log('Creating channels...');
  const textGroupId = DEMO_PREFIX + randomUUID();
  db.prepare(
    'INSERT INTO channel_groups (id, name, sort_order, server_id) VALUES (?, ?, ?, ?)',
  ).run(textGroupId, 'Text Channels', 0, serverId);

  const voiceGroupId = DEMO_PREFIX + randomUUID();
  db.prepare(
    'INSERT INTO channel_groups (id, name, sort_order, server_id) VALUES (?, ?, ?, ?)',
  ).run(voiceGroupId, 'Voice Channels', 1, serverId);

  // Text channels
  const channels: Record<string, string> = {};
  const textChannels = ['general', 'clips', 'music', 'memes'];
  for (let i = 0; i < textChannels.length; i++) {
    const chId = DEMO_PREFIX + randomUUID();
    channels[textChannels[i]] = chId;
    db.prepare(
      'INSERT INTO channels (id, name, type, sort_order, server_id, group_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(chId, textChannels[i], 'text', i, serverId, textGroupId);
  }

  // Voice channels
  const voiceChannels = ['Hangout', 'Gaming', 'Music'];
  for (let i = 0; i < voiceChannels.length; i++) {
    const chId = DEMO_PREFIX + randomUUID();
    channels[voiceChannels[i]] = chId;
    db.prepare(
      'INSERT INTO channels (id, name, type, sort_order, server_id, group_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(chId, voiceChannels[i], 'voice', i, serverId, voiceGroupId);
  }

  // Seed messages in #general
  console.log('Seeding messages in #general...');
  const baseTime = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago
  for (let i = 0; i < MESSAGES.length; i++) {
    const msg = MESSAGES[i];
    const msgId = DEMO_PREFIX + randomUUID();
    const msgTime = new Date(baseTime.getTime() + i * 90 * 1000); // 90s apart

    db.prepare(
      'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(msgId, channels['general'], userIds[msg.user], msg.content, msgTime.toISOString());

    if (msg.reactions) {
      for (const r of msg.reactions) {
        for (const username of r.users) {
          db.prepare(
            'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
          ).run(msgId, userIds[username], r.emoji, msgTime.toISOString());
        }
      }
    }
  }

  // Seed messages in #clips
  console.log('Seeding messages in #clips...');
  const clipsBaseTime = new Date(now.getTime() - 15 * 60 * 1000);
  for (let i = 0; i < CLIPS_MESSAGES.length; i++) {
    const msg = CLIPS_MESSAGES[i];
    const msgId = DEMO_PREFIX + randomUUID();
    const msgTime = new Date(clipsBaseTime.getTime() + i * 60 * 1000);

    db.prepare(
      'INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(msgId, channels['clips'], userIds[msg.user], msg.content, msgTime.toISOString());

    if (msg.reactions) {
      for (const r of msg.reactions) {
        for (const username of r.users) {
          db.prepare(
            'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
          ).run(msgId, userIds[username], r.emoji, msgTime.toISOString());
        }
      }
    }
  }

  console.log('\nDemo seeded successfully!');
  console.log(`  Server: ${SERVER_NAME} (${serverId})`);
  console.log(`  Users: ${USERS.map((u) => u.display_name).join(', ')}`);
  console.log(`  Channels: ${[...textChannels, ...voiceChannels].join(', ')}`);
  console.log(`  Messages: ${MESSAGES.length + CLIPS_MESSAGES.length}`);

  // Build presence payload for the API
  const presenceUsers = [
    { userId: userIds['jake'], activity: 'Overwatch', status: 'online' },
    { userId: userIds['mia'], status: 'online' },
    { userId: userIds['alex'], activity: 'Minecraft', status: 'online' },
    { userId: userIds['sam'], status: 'idle' },
    { userId: userIds['luna'], activity: 'Spotify', status: 'online' },
  ];

  console.log('\nTo make demo users appear online, call this from the server:');
  console.log(`  curl -X POST http://localhost:3001/api/admin/demo-presence \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -H "Cookie: <your-auth-cookie>" \\`);
  console.log(`    -d '${JSON.stringify({ users: presenceUsers })}'`);
  console.log(`\nTo remove fake presence: curl -X DELETE http://localhost:3001/api/admin/demo-presence -H "Cookie: <your-auth-cookie>"`);
  console.log(`\nTo clean up all demo data: npm run seed:demo:cleanup`);
}

function cleanup() {
  console.log('Cleaning up demo data...');

  const count = (table: string) => {
    const row = db.prepare(`SELECT COUNT(*) as n FROM ${table} WHERE id LIKE '${DEMO_PREFIX}%'`).get() as { n: number };
    return row.n;
  };

  // Disable FK checks so ALTER TABLE FKs without CASCADE don't block us
  db.pragma('foreign_keys = OFF');

  db.prepare(`DELETE FROM reactions WHERE message_id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM messages WHERE id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM user_roles WHERE user_id LIKE '${DEMO_PREFIX}%' OR role_id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM server_members WHERE server_id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM invite_codes WHERE server_id IN (SELECT id FROM servers WHERE id LIKE '${DEMO_PREFIX}%')`).run();
  db.prepare(`DELETE FROM bots WHERE server_id IN (SELECT id FROM servers WHERE id LIKE '${DEMO_PREFIX}%')`).run();
  db.prepare(`DELETE FROM channels WHERE id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM channel_groups WHERE id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM roles WHERE id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM servers WHERE id LIKE '${DEMO_PREFIX}%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE '${DEMO_PREFIX}%'`).run();

  db.pragma('foreign_keys = ON');
  console.log('Demo data removed.');
}

if (process.argv.includes('--cleanup')) {
  cleanup();
  db.close();
} else {
  seed().then(() => db.close()).catch((e) => { console.error(e); db.close(); });
}
