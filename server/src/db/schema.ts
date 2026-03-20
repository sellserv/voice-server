import db from './connection.js';
import { randomUUID } from 'crypto';

const ALL_PERMISSIONS = JSON.stringify({
  manage_channels: true,
  manage_roles: true,
  kick_members: true,
  ban_members: true,
  manage_messages: true,
  manage_invite_codes: true,
  create_invites: true,
  manage_soundboard: true,
  manage_emojis: true,
  administrator: true,
  send_messages: true,
  upload_files: true,
  add_reactions: true,
  connect_voice: true,
  speak: true,
  share_screen: true,
  use_custom_emoji: true,
  change_nickname: true,
  pin_messages: true,
  manage_channel_groups: true,
  view_channel: true,
  use_apps: true,
  view_audit_log: true,
  manage_bots: true,
  manage_server: true,
});

const MEMBER_PERMISSIONS = JSON.stringify({
  manage_channels: false,
  manage_roles: false,
  kick_members: false,
  ban_members: false,
  manage_messages: false,
  manage_invite_codes: false,
  create_invites: true,
  manage_soundboard: false,
  manage_emojis: false,
  administrator: false,
  send_messages: true,
  upload_files: true,
  add_reactions: true,
  connect_voice: true,
  speak: true,
  share_screen: true,
  use_custom_emoji: true,
  change_nickname: true,
  pin_messages: false,
  manage_channel_groups: false,
  view_channel: true,
  use_apps: true,
  view_audit_log: false,
  manage_bots: false,
  manage_server: false,
});

const BOT_PERMISSIONS = JSON.stringify({
  manage_channels: false,
  manage_roles: false,
  kick_members: false,
  ban_members: false,
  manage_messages: false,
  manage_invite_codes: false,
  create_invites: false,
  manage_soundboard: false,
  manage_emojis: false,
  administrator: false,
  send_messages: true,
  upload_files: true,
  add_reactions: true,
  connect_voice: false,
  speak: false,
  share_screen: false,
  use_custom_emoji: true,
  change_nickname: false,
  pin_messages: false,
  manage_channel_groups: false,
  view_channel: true,
  use_apps: true,
  view_audit_log: false,
  manage_bots: false,
  manage_server: false,
});

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
      avatar_url TEXT,
      banned INTEGER NOT NULL DEFAULT 0,
      ban_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text', 'voice')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL DEFAULT '',
      file_id TEXT REFERENCES files(id),
      reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      invite_id TEXT REFERENCES server_invitations(id) ON DELETE SET NULL,
      poll_id TEXT REFERENCES polls(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      edited_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel_time
      ON messages(channel_id, created_at);

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id, emoji)
    );

    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

    CREATE TABLE IF NOT EXISTS invite_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      mfa_verified INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);
  `);

  // Migrate: add TOTP columns to users table
  try {
    db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0');
  } catch {}

  // Migrate: add password_changed_at column
  try {
    db.exec('ALTER TABLE users ADD COLUMN password_changed_at TEXT');
  } catch {}

  // Migrate: add account lockout columns
  try {
    db.exec('ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE users ADD COLUMN locked_at TEXT');
  } catch {}

  // Migrate: add email columns
  try {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN mfa_method TEXT NOT NULL DEFAULT 'email'");
  } catch {}

  // Create email_codes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('verification', 'mfa', 'password_reset')),
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_codes_user_type ON email_codes(user_id, type, used);
  `);

  // Unique index on email (partial — only non-null)
  try {
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL',
    );
  } catch {}

  // ─── New tables: server_settings, roles, soundboard_sounds, custom_emojis ───

  db.exec(`
    CREATE TABLE IF NOT EXISTS server_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      name TEXT NOT NULL DEFAULT 'SellServ Voice',
      icon_file_id TEXT
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT NOT NULL DEFAULT '#99aab5',
      position INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS soundboard_sounds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_id TEXT NOT NULL REFERENCES files(id),
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add welcome_channel_id to server_settings
  try {
    db.exec('ALTER TABLE server_settings ADD COLUMN welcome_channel_id TEXT');
  } catch {}

  // Migrate: add enabled_apps column to server_settings (JSON array of enabled app ids)
  try {
    db.exec("ALTER TABLE server_settings ADD COLUMN enabled_apps TEXT NOT NULL DEFAULT '[]'");
  } catch {}

  // Migrate: add bio and banner_url columns
  try {
    db.exec("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''");
  } catch {}
  try {
    db.exec('ALTER TABLE users ADD COLUMN banner_url TEXT');
  } catch {}

  // Migrate: add role_id column to users
  try {
    db.exec('ALTER TABLE users ADD COLUMN role_id TEXT');
  } catch {}

  // Migrate: add status_preference column to users
  try {
    db.exec("ALTER TABLE users ADD COLUMN status_preference TEXT NOT NULL DEFAULT 'online'");
  } catch {}

  // Migrate: add topic column to channels
  try {
    db.exec('ALTER TABLE channels ADD COLUMN topic TEXT');
  } catch {}

  // Migrate: update channels CHECK constraint to allow 'dm' type
  // SQLite can't ALTER CHECK constraints, so we recreate the table
  {
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='channels'")
      .get() as { sql: string } | undefined;
    if (tableInfo && !tableInfo.sql.includes("'dm'")) {
      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`CREATE TABLE channels_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('text', 'voice', 'dm')),
          sort_order INTEGER NOT NULL DEFAULT 0,
          topic TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec(
          `INSERT INTO channels_new SELECT id, name, type, sort_order, topic, created_at FROM channels`,
        );
        db.exec(`DROP TABLE channels`);
        db.exec(`ALTER TABLE channels_new RENAME TO channels`);
        db.exec(
          `CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at)`,
        );
      } catch (err) {
        console.error('Failed to migrate channels table for DM support:', err);
        // Clean up partial migration
        try {
          db.exec('DROP TABLE IF EXISTS channels_new');
        } catch {}
      }
      db.pragma('foreign_keys = ON');
    }
  }

  // Create dm_participants table for DM channels
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_participants (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (channel_id, user_id)
    );
  `);

  // Create FTS5 virtual table for message search
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, content=messages, content_rowid=rowid
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
    // Populate FTS index from existing messages
    const ftsCount = db.prepare('SELECT COUNT(*) as c FROM messages_fts').get() as { c: number };
    if (ftsCount.c === 0) {
      db.exec('INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages');
    }
  } catch {}

  // Migrate: add reply_to_id column to messages
  try {
    db.exec(
      'ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL',
    );
  } catch {}

  // Migrate: add pinned and pinned_by columns to messages
  try {
    db.exec('ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE messages ADD COLUMN pinned_by TEXT');
  } catch {}

  // Migrate: add source column to files
  try {
    db.exec("ALTER TABLE files ADD COLUMN source TEXT NOT NULL DEFAULT 'upload'");
  } catch {}

  // Migrate: add restricted column to channels + access control junction tables
  try {
    db.exec('ALTER TABLE channels ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0');
  } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_access_roles (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (channel_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS channel_access_users (
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (channel_id, user_id)
    );
  `);

  // Migrate: add channel_groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add permissions_enabled column to channel_groups
  try {
    db.exec('ALTER TABLE channel_groups ADD COLUMN permissions_enabled INTEGER NOT NULL DEFAULT 0');
  } catch {}

  // Migrate: add group_id column to channels
  try {
    db.exec(
      'ALTER TABLE channels ADD COLUMN group_id TEXT REFERENCES channel_groups(id) ON DELETE SET NULL',
    );
  } catch {}

  // Migrate: add channel_permission_overrides table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_permission_overrides (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('role', 'user')),
      target_id TEXT NOT NULL,
      view_channel INTEGER,
      send_messages INTEGER,
      upload_files INTEGER,
      add_reactions INTEGER,
      use_custom_emoji INTEGER,
      manage_messages INTEGER,
      pin_messages INTEGER,
      connect_voice INTEGER,
      speak INTEGER,
      share_screen INTEGER,
      UNIQUE(channel_id, target_type, target_id)
    );
  `);

  // Migrate: convert existing restricted channels to permission overrides
  {
    const restrictedChannels = db.prepare('SELECT id FROM channels WHERE restricted = 1').all() as {
      id: string;
    }[];
    if (restrictedChannels.length > 0) {
      // Check if we've already migrated (any overrides exist for these channels)
      const firstChannelOverrides = db
        .prepare('SELECT 1 FROM channel_permission_overrides WHERE channel_id = ?')
        .get(restrictedChannels[0].id);
      if (!firstChannelOverrides) {
        const defRole = db.prepare('SELECT id FROM roles WHERE is_default = 1').get() as
          | { id: string }
          | undefined;
        for (const ch of restrictedChannels) {
          // Deny view_channel for default role
          if (defRole) {
            db.prepare(
              'INSERT OR IGNORE INTO channel_permission_overrides (id, channel_id, target_type, target_id, view_channel) VALUES (?, ?, ?, ?, ?)',
            ).run(randomUUID(), ch.id, 'role', defRole.id, 0);
          }
          // Allow view_channel for each allowed role
          const allowedRoles = db
            .prepare('SELECT role_id FROM channel_access_roles WHERE channel_id = ?')
            .all(ch.id) as { role_id: string }[];
          for (const r of allowedRoles) {
            db.prepare(
              'INSERT OR IGNORE INTO channel_permission_overrides (id, channel_id, target_type, target_id, view_channel) VALUES (?, ?, ?, ?, ?)',
            ).run(randomUUID(), ch.id, 'role', r.role_id, 1);
          }
          // Allow view_channel for each allowed user
          const allowedUsers = db
            .prepare('SELECT user_id FROM channel_access_users WHERE channel_id = ?')
            .all(ch.id) as { user_id: string }[];
          for (const u of allowedUsers) {
            db.prepare(
              'INSERT OR IGNORE INTO channel_permission_overrides (id, channel_id, target_type, target_id, view_channel) VALUES (?, ?, ?, ?, ?)',
            ).run(randomUUID(), ch.id, 'user', u.user_id, 1);
          }
        }
        console.log(
          `Migrated ${restrictedChannels.length} restricted channel(s) to permission overrides`,
        );
      }
    }
  }

  // Migrate: add group_permission_overrides table
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_permission_overrides (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES channel_groups(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('role', 'user')),
      target_id TEXT NOT NULL,
      view_channel INTEGER,
      send_messages INTEGER,
      upload_files INTEGER,
      add_reactions INTEGER,
      use_custom_emoji INTEGER,
      manage_messages INTEGER,
      pin_messages INTEGER,
      connect_voice INTEGER,
      speak INTEGER,
      share_screen INTEGER,
      UNIQUE(group_id, target_type, target_id)
    );
  `);

  // Backfill view_channel into existing role permission blobs
  {
    const allRoles = db.prepare('SELECT id, permissions FROM roles').all() as {
      id: string;
      permissions: string;
    }[];
    for (const role of allRoles) {
      try {
        const perms = JSON.parse(role.permissions);
        if (perms.view_channel === undefined) {
          perms.view_channel = true;
          db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
            JSON.stringify(perms),
            role.id,
          );
        }
      } catch {}
    }
  }

  // Backfill use_apps into existing role permission blobs
  {
    const allRoles = db.prepare('SELECT id, permissions FROM roles').all() as {
      id: string;
      permissions: string;
    }[];
    for (const role of allRoles) {
      try {
        const perms = JSON.parse(role.permissions);
        if (perms.use_apps === undefined) {
          perms.use_apps = true;
          db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
            JSON.stringify(perms),
            role.id,
          );
        }
      } catch {}
    }
  }

  // Backfill view_audit_log into existing role permission blobs
  {
    const allRoles = db.prepare('SELECT id, permissions FROM roles').all() as {
      id: string;
      permissions: string;
    }[];
    for (const role of allRoles) {
      try {
        const perms = JSON.parse(role.permissions);
        if (perms.view_audit_log === undefined) {
          perms.view_audit_log = false;
          db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
            JSON.stringify(perms),
            role.id,
          );
        }
      } catch {}
    }
  }

  // Backfill manage_bots into existing role permission blobs
  {
    const allRoles = db.prepare('SELECT id, permissions FROM roles').all() as {
      id: string;
      permissions: string;
    }[];
    for (const role of allRoles) {
      try {
        const perms = JSON.parse(role.permissions);
        if (perms.manage_bots === undefined) {
          perms.manage_bots = false;
          db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
            JSON.stringify(perms),
            role.id,
          );
        }
      } catch {}
    }
  }

  // Backfill manage_server into existing role permission blobs
  {
    const allRoles = db.prepare('SELECT id, permissions FROM roles').all() as {
      id: string;
      permissions: string;
    }[];
    for (const role of allRoles) {
      try {
        const perms = JSON.parse(role.permissions);
        if (perms.manage_server === undefined) {
          perms.manage_server = false;
          db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
            JSON.stringify(perms),
            role.id,
          );
        }
      } catch {}
    }
  }

  // Backfill kick_members into existing role permission blobs
  {
    const allRoles = db.prepare('SELECT id, permissions FROM roles').all() as {
      id: string;
      permissions: string;
    }[];
    for (const role of allRoles) {
      try {
        const perms = JSON.parse(role.permissions);
        if (perms.kick_members === undefined) {
          perms.kick_members = !!perms.ban_members;
          db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(
            JSON.stringify(perms),
            role.id,
          );
        }
      } catch {}
    }
  }

  // Seed server_settings singleton
  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM server_settings').get() as {
    c: number;
  };
  if (settingsCount.c === 0) {
    db.prepare("INSERT INTO server_settings (id, name) VALUES (1, 'SellServ Voice')").run();
  }

  // Seed default roles if none exist
  const roleCount = db.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number };
  if (roleCount.c === 0) {
    const adminRoleId = randomUUID();
    const memberRoleId = randomUUID();
    const botRoleId = randomUUID();
    db.prepare(
      'INSERT INTO roles (id, name, color, position, permissions, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(adminRoleId, 'Admin', '#e74c3c', 0, ALL_PERMISSIONS, 0);
    db.prepare(
      'INSERT INTO roles (id, name, color, position, permissions, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(memberRoleId, 'Member', '#99aab5', 1, MEMBER_PERMISSIONS, 1);
    db.prepare(
      'INSERT INTO roles (id, name, color, position, permissions, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(botRoleId, 'Bot', '#7289da', 2, BOT_PERMISSIONS, 0);

    // Backfill existing users: admins get Admin role, members get Member role
    db.prepare("UPDATE users SET role_id = ? WHERE role = 'admin'").run(adminRoleId);
    db.prepare("UPDATE users SET role_id = ? WHERE role = 'member'").run(memberRoleId);
  }

  // Migrate: add is_bot column to users (must happen before Bot role migration)
  try {
    db.exec('ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0');
  } catch {}

  // Migrate: create Bot role if it doesn't exist and assign bot users to it
  {
    const botRole = db.prepare("SELECT id FROM roles WHERE name = 'Bot'").get() as
      | { id: string }
      | undefined;
    if (!botRole) {
      const botRoleId = randomUUID();
      // Insert at position 2 (after Admin=0, Member=1)
      db.prepare(
        'INSERT INTO roles (id, name, color, position, permissions, is_default) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(botRoleId, 'Bot', '#7289da', 2, BOT_PERMISSIONS, 0);
      // Reassign all bot users to the new Bot role
      db.prepare('UPDATE users SET role_id = ? WHERE is_bot = 1').run(botRoleId);
      console.log('Created Bot role and assigned bot users to it');
    } else {
      // Ensure all bot users are on the Bot role
      db.prepare('UPDATE users SET role_id = ? WHERE is_bot = 1 AND role_id != ?').run(
        botRole.id,
        botRole.id,
      );
    }
  }

  // Migrate: fix broken avatar_url / banner_url values ('/uploads/undefined')
  {
    const broken = db
      .prepare(
        "SELECT id FROM users WHERE avatar_url = '/uploads/undefined' OR banner_url = '/uploads/undefined'",
      )
      .all() as { id: string }[];
    if (broken.length > 0) {
      const findLatestImage = db.prepare(
        "SELECT stored_name FROM files WHERE user_id = ? AND mime_type LIKE 'image/%' ORDER BY created_at DESC LIMIT 1",
      );
      const updateAvatar = db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?');
      const updateBanner = db.prepare('UPDATE users SET banner_url = ? WHERE id = ?');
      const getUser = db.prepare('SELECT avatar_url, banner_url FROM users WHERE id = ?');

      for (const { id } of broken) {
        const user = getUser.get(id) as { avatar_url: string | null; banner_url: string | null };
        const img = findLatestImage.get(id) as { stored_name: string } | undefined;
        const fixedUrl = img ? `/uploads/${img.stored_name}` : null;

        if (user.avatar_url === '/uploads/undefined') {
          updateAvatar.run(fixedUrl, id);
        }
        if (user.banner_url === '/uploads/undefined') {
          updateBanner.run(null, id); // banners are harder to guess; clear instead
        }
      }
      console.log(`Fixed ${broken.length} user(s) with broken avatar/banner URLs`);
    }
  }

  // Migrate: add name_font and name_color columns to users
  try {
    db.exec('ALTER TABLE users ADD COLUMN name_font TEXT DEFAULT NULL');
  } catch {}
  try {
    db.exec('ALTER TABLE users ADD COLUMN name_color TEXT DEFAULT NULL');
  } catch {}

  // Create bots table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      channel_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      greeting TEXT NOT NULL DEFAULT 'Welcome to the server, {user}!',
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add dm_enabled and dm_greeting columns to bots
  try {
    db.exec('ALTER TABLE bots ADD COLUMN dm_enabled INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec(
      "ALTER TABLE bots ADD COLUMN dm_greeting TEXT NOT NULL DEFAULT 'Welcome to the server! A moderator will need to assign you a role for more access.'",
    );
  } catch {}
  try {
    db.exec('ALTER TABLE bots ADD COLUMN config TEXT');
  } catch {}

  // Ensure any user without a role_id gets the default role
  const defaultRole = db.prepare('SELECT id FROM roles WHERE is_default = 1').get() as
    | { id: string }
    | undefined;
  if (defaultRole) {
    db.prepare('UPDATE users SET role_id = ? WHERE role_id IS NULL').run(defaultRole.id);
  }

  // Seed default channels if none exist
  const count = db.prepare('SELECT COUNT(*) as c FROM channels').get() as { c: number };
  if (count.c === 0) {
    const insert = db.prepare(
      'INSERT INTO channels (id, name, type, sort_order) VALUES (?, ?, ?, ?)',
    );
    insert.run(randomUUID(), 'general', 'text', 0);
    insert.run(randomUUID(), 'voice', 'voice', 1);
  }

  // Link preview cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_previews (
      url TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      image TEXT,
      site_name TEXT,
      favicon TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed welcome bot user + config
  {
    const botUser = db.prepare("SELECT id FROM users WHERE id = 'bot-welcome'").get();
    if (!botUser) {
      const botRole = db.prepare("SELECT id FROM roles WHERE name = 'Bot'").get() as
        | { id: string }
        | undefined;
      const fallbackRole = db.prepare('SELECT id FROM roles WHERE is_default = 1').get() as
        | { id: string }
        | undefined;
      db.prepare(
        "INSERT INTO users (id, username, display_name, password_hash, role, role_id, is_bot, avatar_url, created_at) VALUES ('bot-welcome', 'welcome-bot', 'Welcome Bot', '', 'member', ?, 1, '/bot-avatar.svg', datetime('now'))",
      ).run(botRole?.id ?? fallbackRole?.id ?? null);
    }
    const botRow = db.prepare("SELECT id FROM bots WHERE type = 'welcome'").get();
    if (!botRow) {
      db.prepare(
        "INSERT INTO bots (id, user_id, type, name, enabled, greeting, created_at) VALUES ('bot-welcome', 'bot-welcome', 'welcome', 'Welcome Bot', 0, 'Welcome to the server, {user}! 👋', datetime('now'))",
      ).run();
    }
  }

  // Migrate: set default bot avatar for existing bots without one
  db.prepare(
    "UPDATE users SET avatar_url = '/bot-avatar.svg' WHERE is_bot = 1 AND avatar_url IS NULL",
  ).run();

  // Migrate: add emoji_id and emoji columns to soundboard_sounds
  try {
    db.exec('ALTER TABLE soundboard_sounds ADD COLUMN emoji_id TEXT REFERENCES custom_emojis(id)');
  } catch {}
  try {
    db.exec('ALTER TABLE soundboard_sounds ADD COLUMN emoji TEXT');
  } catch {}

  // Migrate: rename 'watch-together' app to 'watch-party' in server_settings
  {
    const row = db.prepare('SELECT enabled_apps FROM server_settings WHERE id = 1').get() as
      | { enabled_apps: string }
      | undefined;
    if (row) {
      const apps: string[] = JSON.parse(row.enabled_apps);
      if (apps.includes('watch-together')) {
        const updated = apps.map((a) => (a === 'watch-together' ? 'watch-party' : a));
        db.prepare('UPDATE server_settings SET enabled_apps = ? WHERE id = 1').run(
          JSON.stringify(updated),
        );
      }
    }
  }

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id TEXT,
      target_id TEXT,
      ip TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
  `);

  // Performance indexes for frequently queried foreign keys
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
    CREATE INDEX IF NOT EXISTS idx_dm_participants_user_id ON dm_participants(user_id);
    CREATE INDEX IF NOT EXISTS idx_channels_group_id ON channels(group_id);
    CREATE INDEX IF NOT EXISTS idx_channel_perm_overrides_channel ON channel_permission_overrides(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_access_roles_channel ON channel_access_roles(channel_id);
    CREATE INDEX IF NOT EXISTS idx_channel_access_users_channel ON channel_access_users(channel_id);
    CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);
    CREATE INDEX IF NOT EXISTS idx_channel_perm_overrides_target ON channel_permission_overrides(target_id);
    CREATE INDEX IF NOT EXISTS idx_group_perm_overrides_target ON group_permission_overrides(target_id);
  `);

  // Migrate: create user_roles junction table for multi-role support
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
  `);

  // Backfill user_roles from existing users.role_id (fills in any users missing from junction table)
  // Only backfill role_ids that still exist in the roles table (servers/roles may have been deleted)
  db.exec(
    'INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT u.id, u.role_id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.role_id IS NOT NULL',
  );

  // ─── Multi-server (guilds) support ───

  // Create servers, server_members, instance_settings tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon_file_id TEXT REFERENCES files(id),
      owner_id TEXT NOT NULL REFERENCES users(id),
      afk_channel_id TEXT,
      afk_timeout INTEGER NOT NULL DEFAULT 300,
      enabled_apps TEXT NOT NULL DEFAULT '["soundboard", "watch-party", "voice-changer", "effects", "polls"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS server_members (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT,
      avatar_url TEXT,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (server_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS server_bans (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT,
      banned_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (server_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_server_bans_user ON server_bans(user_id);

    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      allow_multiple INTEGER NOT NULL DEFAULT 0,
      ends_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_polls_server ON polls(server_id);

    CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);

    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id TEXT NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (poll_id, user_id, option_id)
    );

    CREATE TABLE IF NOT EXISTS instance_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      allow_server_creation INTEGER NOT NULL DEFAULT 1
    );
    INSERT OR IGNORE INTO instance_settings (id) VALUES (1);
  `);

  // Migrate: add server_id column to tables
  try { db.exec('ALTER TABLE channels ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE channel_groups ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE roles ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE channel_permission_overrides ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE group_permission_overrides ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE custom_emojis ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE soundboard_sounds ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE invite_codes ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE bots ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}
  try { db.exec('ALTER TABLE audit_log ADD COLUMN server_id TEXT REFERENCES servers(id)'); } catch {}

  // Create default server from existing data if servers table is empty
  {
    const serverCount = (db.prepare('SELECT COUNT(*) as c FROM servers').get() as any).c;
    if (serverCount === 0) {
      const firstAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as any;
      const anyUser = db.prepare('SELECT id FROM users LIMIT 1').get() as any;
      const ownerId = firstAdmin?.id || anyUser?.id;
      if (!ownerId) return; // no users exist, nothing to migrate

      const settings = db.prepare('SELECT name, icon_file_id FROM server_settings WHERE id = 1').get() as any;
      const defaultServerId = randomUUID();

      const migrate = db.transaction(() => {
        db.prepare('INSERT INTO servers (id, name, icon_file_id, owner_id) VALUES (?, ?, ?, ?)').run(
          defaultServerId,
          settings?.name || 'My Server',
          settings?.icon_file_id || null,
          ownerId
        );

        // Add all existing users as members
        const users = db.prepare('SELECT id FROM users').all() as any[];
        const insertMember = db.prepare('INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)');
        for (const u of users) insertMember.run(defaultServerId, u.id);

        // Backfill server_id on all existing data (try-catch for fresh installs where tables may not exist yet)
        try { db.prepare('UPDATE channels SET server_id = ? WHERE server_id IS NULL AND type != \'dm\'').run(defaultServerId); } catch {}
        for (const table of ['channel_groups', 'roles', 'custom_emojis', 'soundboard_sounds', 'invite_codes', 'bots', 'audit_log', 'server_bans', 'polls']) {
          try { db.prepare(`UPDATE ${table} SET server_id = ? WHERE server_id IS NULL`).run(defaultServerId); } catch {}
        }
        try { db.prepare('UPDATE channel_permission_overrides SET server_id = ? WHERE server_id IS NULL').run(defaultServerId); } catch {}
        try { db.prepare('UPDATE group_permission_overrides SET server_id = ? WHERE server_id IS NULL').run(defaultServerId); } catch {}
      });
      migrate();
    }
  }

  // Multi-server indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
    CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id);
    CREATE INDEX IF NOT EXISTS idx_channel_groups_server ON channel_groups(server_id);
    CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_user ON poll_votes(poll_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(channel_id, pinned) WHERE pinned = 1;
    CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);
  `);

  // Ensure every server has a welcome bot
  {
    const serversWithoutBot = db.prepare(
      `SELECT s.id FROM servers s
       WHERE NOT EXISTS (SELECT 1 FROM bots b WHERE b.server_id = s.id AND b.type = 'welcome')`
    ).all() as { id: string }[];
    const botUserExists = db.prepare("SELECT id FROM users WHERE id = 'bot-welcome'").get();
    if (botUserExists && serversWithoutBot.length > 0) {
      const insertBot = db.prepare(
        "INSERT INTO bots (id, user_id, type, name, enabled, greeting, server_id, created_at) VALUES (?, 'bot-welcome', 'welcome', 'Welcome Bot', 0, 'Welcome to the server, {user}! 👋', ?, datetime('now'))"
      );
      for (const server of serversWithoutBot) {
        insertBot.run(randomUUID(), server.id);
      }
    }
  }

  // Seed automod bot user + ensure every server has one
  {
    const automodUser = db.prepare("SELECT id FROM users WHERE id = 'bot-automod'").get();
    if (!automodUser) {
      const botRole = db.prepare("SELECT id FROM roles WHERE name = 'Bot'").get() as
        | { id: string }
        | undefined;
      const fallbackRole = db.prepare('SELECT id FROM roles WHERE is_default = 1').get() as
        | { id: string }
        | undefined;
      db.prepare(
        "INSERT INTO users (id, username, display_name, password_hash, role, role_id, is_bot, avatar_url, created_at) VALUES ('bot-automod', 'automod-bot', 'Automod', '', 'member', ?, 1, '/bot-avatar.svg', datetime('now'))",
      ).run(botRole?.id ?? fallbackRole?.id ?? null);
    }
    const serversWithoutAutomod = db.prepare(
      `SELECT s.id FROM servers s
       WHERE NOT EXISTS (SELECT 1 FROM bots b WHERE b.server_id = s.id AND b.type = 'automod')`
    ).all() as { id: string }[];
    if (serversWithoutAutomod.length > 0) {
      const defaultConfig = JSON.stringify({ blockedWords: [], action: 'delete', warnMessage: 'Your message was removed for containing a blocked word.' });
      const insertBot = db.prepare(
        "INSERT INTO bots (id, user_id, type, name, enabled, config, server_id, created_at) VALUES (?, 'bot-automod', 'automod', 'Automod', 0, ?, ?, datetime('now'))"
      );
      for (const server of serversWithoutAutomod) {
        insertBot.run(randomUUID(), defaultConfig, server.id);
      }
    }
    // Ensure automod bot user is a member of every server that has an automod bot
    const serversWithAutomod = db.prepare(
      `SELECT DISTINCT server_id FROM bots WHERE type = 'automod'`
    ).all() as { server_id: string }[];
    for (const { server_id } of serversWithAutomod) {
      db.prepare("INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, 'bot-automod')").run(server_id);
    }
  }

  // Server invitations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_invitations (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_server_invitations_invitee ON server_invitations(invitee_id, status);
  `);

  // Migrate: add AFK channel settings to servers
  try { db.exec('ALTER TABLE servers ADD COLUMN afk_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL'); } catch {}
  try { db.exec('ALTER TABLE servers ADD COLUMN afk_timeout INTEGER NOT NULL DEFAULT 300'); } catch {}

  // Friendships table (friends, pending requests, blocks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_friendships_target ON friendships(target_id, status);
  `);

  // Migration: add notification_level to server_members
  try {
    db.exec(`ALTER TABLE server_members ADD COLUMN notification_level TEXT NOT NULL DEFAULT 'default'`);
  } catch {}

  // Migration: remove UNIQUE constraint on roles.name (must be unique per server, not globally)
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='roles'").get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql.includes('UNIQUE')) {
      db.pragma('foreign_keys = OFF');
      try {
        db.exec(`
          CREATE TABLE roles_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#99aab5',
            position INTEGER NOT NULL DEFAULT 0,
            permissions TEXT NOT NULL DEFAULT '{}',
            is_default INTEGER NOT NULL DEFAULT 0,
            server_id TEXT REFERENCES servers(id)
          );
          INSERT INTO roles_new SELECT id, name, color, position, permissions, is_default, server_id FROM roles;
          DROP TABLE roles;
          ALTER TABLE roles_new RENAME TO roles;
        `);
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
  } catch (err) {
    console.error('Failed to migrate roles table:', err);
  }

  // Migration: ensure custom_emojis has created_at column and per-server UNIQUE(name, server_id)
  try {
    const emojiTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='custom_emojis'").get() as { sql: string } | undefined;
    if (emojiTable) {
      const cols = db.pragma('table_info(custom_emojis)') as { name: string }[];
      const colNames = new Set(cols.map(c => c.name));
      const hasCreatedAt = colNames.has('created_at');
      // Need to fix if: missing created_at OR has wrong UNIQUE constraint (anything other than UNIQUE(name, server_id))
      const needsTableRecreate = !hasCreatedAt || !emojiTable.sql.includes('UNIQUE(name, server_id)');

      if (needsTableRecreate) {
        console.log('[Migration] Rebuilding custom_emojis table (created_at:', hasCreatedAt, ', sql:', emojiTable.sql.substring(0, 100), ')');
        db.pragma('foreign_keys = OFF');
        try {
          db.exec('DROP TABLE IF EXISTS custom_emojis_new');
          db.exec(`
            CREATE TABLE custom_emojis_new (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              file_id TEXT NOT NULL REFERENCES files(id),
              uploaded_by TEXT NOT NULL REFERENCES users(id),
              server_id TEXT REFERENCES servers(id),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(name, server_id)
            );
          `);
          // Build INSERT from only columns that exist in the old table
          const sharedCols = ['id', 'name', 'file_id', 'uploaded_by'];
          if (colNames.has('server_id')) sharedCols.push('server_id');
          const insertCols = [...sharedCols, 'created_at'];
          const selectExprs = [...sharedCols, hasCreatedAt ? "COALESCE(created_at, datetime('now'))" : "datetime('now')"];
          db.exec(`
            INSERT OR IGNORE INTO custom_emojis_new (${insertCols.join(', ')})
            SELECT ${selectExprs.join(', ')} FROM custom_emojis;
          `);
          db.exec('DROP TABLE custom_emojis');
          db.exec('ALTER TABLE custom_emojis_new RENAME TO custom_emojis');
          db.exec('CREATE INDEX IF NOT EXISTS idx_custom_emojis_server ON custom_emojis(server_id)');
          console.log('[Migration] custom_emojis table rebuilt successfully');
        } finally {
          db.pragma('foreign_keys = ON');
        }
      }
    }
  } catch (err) {
    console.error('Failed to migrate custom_emojis table:', err);
  }

  // ─── Data repair: ensure server owners have admin roles ───
  // If user_roles entries were lost (e.g. from unscoped DELETE bug), restore them
  {
    const servers = db.prepare('SELECT id, owner_id FROM servers').all() as { id: string; owner_id: string }[];
    for (const server of servers) {
      // Find the Admin role for this server (position 0 = highest)
      const adminRole = db.prepare(
        "SELECT id FROM roles WHERE server_id = ? AND name = 'Admin' ORDER BY position ASC LIMIT 1",
      ).get(server.id) as { id: string } | undefined;
      if (adminRole) {
        db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(
          server.owner_id, adminRole.id,
        );
      }
    }
  }

  // Ensure instance admins (users.role = 'admin') have a global Admin role in user_roles
  {
    const globalAdminRole = db.prepare(
      "SELECT id FROM roles WHERE server_id IS NULL AND name = 'Admin' LIMIT 1",
    ).get() as { id: string } | undefined;
    if (globalAdminRole) {
      db.prepare(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id)
         SELECT id, ? FROM users WHERE role = 'admin'`,
      ).run(globalAdminRole.id);
    }
  }

  // Used reset tokens table (prevents token replay after server restart)
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_reset_tokens (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Cleanup expired reset tokens
  db.prepare("DELETE FROM used_reset_tokens WHERE expires_at < datetime('now')").run();

  // Reports table (message reports from users)
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id),
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      reported_user_id TEXT NOT NULL REFERENCES users(id),
      channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
      server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      message_content TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
      resolved_by TEXT REFERENCES users(id),
      resolution_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports(reported_user_id);
  `);

  // Clean up orphaned users.role_id references
  db.exec(
    'UPDATE users SET role_id = NULL WHERE role_id IS NOT NULL AND role_id NOT IN (SELECT id FROM roles)',
  );

  // Migration: add enabled_apps to servers table
  try {
    db.exec('ALTER TABLE servers ADD COLUMN enabled_apps TEXT NOT NULL DEFAULT \'["soundboard", "watch-party", "voice-changer", "effects", "polls"]\'');
    // Backfill from global settings if available
    const globalSettings = db.prepare('SELECT enabled_apps FROM server_settings WHERE id = 1').get() as { enabled_apps: string } | undefined;
    if (globalSettings?.enabled_apps) {
      db.prepare('UPDATE servers SET enabled_apps = ?').run(globalSettings.enabled_apps);
    }
  } catch {}

  // Migration: add poll_id to messages table
  try {
    db.exec('ALTER TABLE messages ADD COLUMN poll_id TEXT REFERENCES polls(id) ON DELETE SET NULL');
  } catch {}

  // Migration: add reply_to_id to messages table
  try {
    db.exec('ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
  } catch {}

  // Migration: add invite_id to messages table
  try {
    db.exec('ALTER TABLE messages ADD COLUMN invite_id TEXT REFERENCES server_invitations(id) ON DELETE SET NULL');
  } catch {}

  // Migration: add banner_url to server_members
  try {
    db.exec('ALTER TABLE server_members ADD COLUMN banner_url TEXT');
  } catch {}

  // Migration: add allow_registration to instance_settings
  try {
    db.exec('ALTER TABLE instance_settings ADD COLUMN allow_registration INTEGER NOT NULL DEFAULT 1');
  } catch {}
}
