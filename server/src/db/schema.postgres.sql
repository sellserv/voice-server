-- PostgreSQL schema for SellServ Voice
-- Mirrors the SQLite schema in schema.ts with PostgreSQL-compatible syntax.
-- This file is executed once on first run; migrations are handled separately.

-- ─── Core tables ───

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
  avatar_url TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  password_changed_at TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  mfa_method TEXT NOT NULL DEFAULT 'email',
  bio TEXT DEFAULT '',
  banner_url TEXT,
  role_id TEXT,
  status_preference TEXT NOT NULL DEFAULT 'online',
  is_bot INTEGER NOT NULL DEFAULT 0,
  name_font TEXT DEFAULT NULL,
  name_color TEXT DEFAULT NULL,
  premium_tier TEXT NOT NULL DEFAULT 'free'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon_file_id TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id),
  afk_channel_id TEXT,
  afk_timeout INTEGER NOT NULL DEFAULT 300,
  enabled_apps TEXT NOT NULL DEFAULT '["soundboard", "watch-party", "voice-changer", "effects", "polls"]',
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text', 'voice', 'dm')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  topic TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  restricted INTEGER NOT NULL DEFAULT 0,
  group_id TEXT,
  server_id TEXT REFERENCES servers(id)
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  source TEXT NOT NULL DEFAULT 'upload'
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#99aab5',
  position INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  server_id TEXT REFERENCES servers(id),
  pro INTEGER NOT NULL DEFAULT 0
);

-- Deferred foreign keys (cross-table references)
DO $$ BEGIN
  ALTER TABLE servers ADD CONSTRAINT servers_icon_file_id_fkey
    FOREIGN KEY (icon_file_id) REFERENCES files(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE servers ADD CONSTRAINT servers_afk_channel_id_fkey
    FOREIGN KEY (afk_channel_id) REFERENCES channels(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES roles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS server_invitations (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_server_invitations_invitee ON server_invitations(invitee_id, status);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  allow_multiple INTEGER NOT NULL DEFAULT 0,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
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
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  PRIMARY KEY (poll_id, user_id, option_id)
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
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  edited_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  pinned_by TEXT,
  type TEXT NOT NULL DEFAULT 'user',
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
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
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  server_id TEXT REFERENCES servers(id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  mfa_verified INTEGER NOT NULL DEFAULT 0,
  ip_address TEXT,
  user_agent TEXT,
  last_active_at TEXT NOT NULL DEFAULT (NOW()::text),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);

CREATE TABLE IF NOT EXISTS email_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('verification', 'mfa', 'password_reset')),
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_email_codes_user_type ON email_codes(user_id, type, used);

CREATE TABLE IF NOT EXISTS server_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  name TEXT NOT NULL DEFAULT 'SellServ Voice',
  icon_file_id TEXT,
  welcome_channel_id TEXT,
  enabled_apps TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS soundboard_sounds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES files(id),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  emoji_id TEXT,
  emoji TEXT,
  server_id TEXT REFERENCES servers(id)
);

CREATE TABLE IF NOT EXISTS dm_participants (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);

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

CREATE TABLE IF NOT EXISTS channel_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  permissions_enabled INTEGER NOT NULL DEFAULT 0,
  server_id TEXT REFERENCES servers(id)
);

-- Deferred FK: channels.group_id -> channel_groups.id
DO $$ BEGIN
  ALTER TABLE channels ADD CONSTRAINT channels_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
  server_id TEXT REFERENCES servers(id),
  UNIQUE(channel_id, target_type, target_id)
);

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
  server_id TEXT REFERENCES servers(id),
  UNIQUE(group_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  joined_at TEXT NOT NULL DEFAULT (NOW()::text),
  notification_level TEXT NOT NULL DEFAULT 'mentions',
  suppress_everyone INTEGER NOT NULL DEFAULT 0,
  muted_until TEXT,
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS server_bans (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  banned_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  PRIMARY KEY (server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_bans_user ON server_bans(user_id);

CREATE TABLE IF NOT EXISTS instance_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  allow_server_creation INTEGER NOT NULL DEFAULT 1,
  allow_registration INTEGER NOT NULL DEFAULT 1,
  instance_name TEXT NOT NULL DEFAULT 'SellServ Voice',
  alpha_billing INTEGER NOT NULL DEFAULT 0,
  terms_url TEXT NOT NULL DEFAULT '',
  privacy_url TEXT NOT NULL DEFAULT ''
);

INSERT INTO instance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS custom_emojis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_id TEXT NOT NULL REFERENCES files(id),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  server_id TEXT REFERENCES servers(id),
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  UNIQUE(name, server_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_emojis_server ON custom_emojis(server_id);

-- Deferred FK: soundboard_sounds.emoji_id -> custom_emojis.id
DO $$ BEGIN
  ALTER TABLE soundboard_sounds ADD CONSTRAINT soundboard_sounds_emoji_id_fkey
    FOREIGN KEY (emoji_id) REFERENCES custom_emojis(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  greeting TEXT NOT NULL DEFAULT 'Welcome to the server, {user}!',
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  dm_enabled INTEGER NOT NULL DEFAULT 0,
  dm_greeting TEXT NOT NULL DEFAULT 'Welcome to the server! A moderator will need to assign you a role for more access.',
  server_id TEXT REFERENCES servers(id)
);

CREATE TABLE IF NOT EXISTS link_previews (
  url TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  image TEXT,
  site_name TEXT,
  favicon TEXT,
  fetched_at TEXT NOT NULL DEFAULT (NOW()::text),
  author TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  target_id TEXT,
  ip TEXT,
  details TEXT,
  created_at TEXT DEFAULT (NOW()::text),
  server_id TEXT REFERENCES servers(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  UNIQUE(user_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_target ON friendships(target_id, status);

CREATE TABLE IF NOT EXISTS used_reset_tokens (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

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
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports(reported_user_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'past_due', 'canceled')),
  tier TEXT NOT NULL DEFAULT 'pro',
  current_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

CREATE TABLE IF NOT EXISTS channel_notification_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'default',
  muted_until TEXT,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS dm_notification_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  muted_until TEXT,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS pending_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text),
  fetched INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pending_notifications_user ON pending_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_notifications_created ON pending_notifications(created_at);

CREATE TABLE IF NOT EXISTS oauth2_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'admin',
  state TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE TABLE IF NOT EXISTS oauth2_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  access_token TEXT UNIQUE NOT NULL,
  scope TEXT NOT NULL DEFAULT 'admin',
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_access_token ON oauth2_tokens(access_token);
CREATE INDEX IF NOT EXISTS idx_oauth2_codes_expires ON oauth2_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth2_tokens_expires ON oauth2_tokens(expires_at);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  created_at TEXT NOT NULL DEFAULT (NOW()::text)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- ─── Performance indexes ───

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
CREATE INDEX IF NOT EXISTS idx_channels_server ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_roles_server ON roles(server_id);
CREATE INDEX IF NOT EXISTS idx_channel_groups_server ON channel_groups(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll_user ON poll_votes(poll_id, user_id);
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(channel_id, pinned) WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at);

-- ─── Full-text search (replaces SQLite FTS5) ───

ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN(search_vector);

CREATE OR REPLACE FUNCTION messages_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER messages_search_trigger
    BEFORE INSERT OR UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION messages_search_update();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
