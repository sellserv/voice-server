import db from '../db/connection.js';
import type { RolePermissions, ChannelOverridablePermission } from '@voip-server/shared';

const DEFAULT_PERMISSIONS: RolePermissions = {
  manage_channels: false,
  manage_roles: false,
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
};

const CHANNEL_OVERRIDABLE: ChannelOverridablePermission[] = [
  'view_channel',
  'send_messages',
  'upload_files',
  'add_reactions',
  'use_custom_emoji',
  'manage_messages',
  'pin_messages',
  'connect_voice',
  'speak',
  'share_screen',
];

export function getUserRoleIds(userId: string, serverId?: string): string[] {
  if (serverId) {
    const rows = db
      .prepare(
        `SELECT ur.role_id FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND r.server_id = ?`,
      )
      .all(userId, serverId) as { role_id: string }[];
    return rows.map((r) => r.role_id);
  }
  const rows = db.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(userId) as {
    role_id: string;
  }[];
  if (rows.length > 0) return rows.map((r) => r.role_id);
  // Fallback: use single role_id from users table (for users not yet in user_roles)
  const user = db.prepare('SELECT role_id FROM users WHERE id = ?').get(userId) as
    | { role_id: string | null }
    | undefined;
  return user?.role_id ? [user.role_id] : [];
}

export function getUserPermissions(userId: string, serverId?: string): RolePermissions {
  if (serverId) {
    // Server-scoped: only consider roles belonging to this server
    const rows = db
      .prepare(
        `SELECT r.permissions FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND r.server_id = ?`,
      )
      .all(userId, serverId) as { permissions: string }[];

    const merged = { ...DEFAULT_PERMISSIONS };
    for (const row of rows) {
      try {
        const perms = JSON.parse(row.permissions);
        for (const key of Object.keys(merged) as (keyof RolePermissions)[]) {
          if (perms[key] === true) {
            (merged as any)[key] = true;
          }
        }
      } catch {}
    }
    return merged;
  }

  // Legacy: OR-merge permissions across all assigned roles
  const rows = db
    .prepare(
      `
    SELECT r.permissions FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ?
  `,
    )
    .all(userId) as { permissions: string }[];

  if (rows.length === 0) {
    // Fallback: try single role_id on users table
    const row = db
      .prepare(
        `
      SELECT r.permissions FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
    `,
      )
      .get(userId) as { permissions: string } | undefined;

    if (!row) return { ...DEFAULT_PERMISSIONS };
    try {
      return { ...DEFAULT_PERMISSIONS, ...JSON.parse(row.permissions) };
    } catch {
      return { ...DEFAULT_PERMISSIONS };
    }
  }

  const merged = { ...DEFAULT_PERMISSIONS };
  for (const row of rows) {
    try {
      const perms = JSON.parse(row.permissions);
      for (const key of Object.keys(merged) as (keyof RolePermissions)[]) {
        if (perms[key] === true) {
          (merged as any)[key] = true;
        }
      }
    } catch {}
  }
  return merged;
}

export function hasPermission(userId: string, perm: keyof RolePermissions, serverId?: string): boolean {
  // Server owner always has all permissions
  if (serverId) {
    const server = db.prepare('SELECT owner_id FROM servers WHERE id = ?').get(serverId) as { owner_id: string } | undefined;
    if (server?.owner_id === userId) return true;
  }
  const perms = getUserPermissions(userId, serverId);
  if (perms.administrator) return true;
  return !!perms[perm];
}

/**
 * Get resolved permissions for a user in a specific channel,
 * applying role and user overrides on top of base role permissions.
 */
export function getChannelPermissions(userId: string, channelId: string): RolePermissions {
  const channelRow = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as
    | { server_id: string | null }
    | undefined;
  const serverId = channelRow?.server_id ?? undefined;
  const base = getUserPermissions(userId, serverId);
  if (base.administrator) return base;

  const resolved = { ...base };

  // Get all user role_ids (scoped to server)
  const roleIds = getUserRoleIds(userId, serverId);

  // Apply role overrides — "allow wins": if ANY role override grants, it's granted
  if (roleIds.length > 0) {
    const placeholders = roleIds.map(() => '?').join(',');
    const roleOverrides = db
      .prepare(
        `SELECT * FROM channel_permission_overrides WHERE channel_id = ? AND target_type = 'role' AND target_id IN (${placeholders})`,
      )
      .all(channelId, ...roleIds) as Record<string, unknown>[];

    for (const perm of CHANNEL_OVERRIDABLE) {
      let hasExplicit = false;
      let anyAllow = false;
      for (const override of roleOverrides) {
        const val = override[perm];
        if (val !== null && val !== undefined) {
          hasExplicit = true;
          if (val) anyAllow = true;
        }
      }
      if (hasExplicit) {
        (resolved as any)[perm] = anyAllow;
      }
    }
  }

  // Apply user override (higher priority than role override)
  const userOverride = db
    .prepare(
      'SELECT * FROM channel_permission_overrides WHERE channel_id = ? AND target_type = ? AND target_id = ?',
    )
    .get(channelId, 'user', userId) as Record<string, unknown> | undefined;

  if (userOverride) {
    for (const perm of CHANNEL_OVERRIDABLE) {
      const val = userOverride[perm];
      if (val !== null && val !== undefined) {
        (resolved as any)[perm] = !!val;
      }
    }
  }

  // Apply group overrides (highest priority — override channel-level overrides)
  // Only if the group has permissions_enabled = 1
  const channel = db.prepare('SELECT group_id FROM channels WHERE id = ?').get(channelId) as
    | { group_id: string | null }
    | undefined;
  if (channel?.group_id) {
    const groupRow = db
      .prepare('SELECT permissions_enabled FROM channel_groups WHERE id = ?')
      .get(channel.group_id) as { permissions_enabled: number } | undefined;
    if (groupRow?.permissions_enabled) {
      // Group role overrides — "allow wins" across all user roles
      if (roleIds.length > 0) {
        const placeholders = roleIds.map(() => '?').join(',');
        const groupRoleOverrides = db
          .prepare(
            `SELECT * FROM group_permission_overrides WHERE group_id = ? AND target_type = 'role' AND target_id IN (${placeholders})`,
          )
          .all(channel.group_id, ...roleIds) as Record<string, unknown>[];

        for (const perm of CHANNEL_OVERRIDABLE) {
          let hasExplicit = false;
          let anyAllow = false;
          for (const override of groupRoleOverrides) {
            const val = override[perm];
            if (val !== null && val !== undefined) {
              hasExplicit = true;
              if (val) anyAllow = true;
            }
          }
          if (hasExplicit) {
            (resolved as any)[perm] = anyAllow;
          }
        }
      }

      // Group user override (highest priority of all)
      const groupUserOverride = db
        .prepare(
          'SELECT * FROM group_permission_overrides WHERE group_id = ? AND target_type = ? AND target_id = ?',
        )
        .get(channel.group_id, 'user', userId) as Record<string, unknown> | undefined;

      if (groupUserOverride) {
        for (const perm of CHANNEL_OVERRIDABLE) {
          const val = groupUserOverride[perm];
          if (val !== null && val !== undefined) {
            (resolved as any)[perm] = !!val;
          }
        }
      }
    }
  }

  return resolved;
}

/**
 * Check if a user has a specific permission in a channel context.
 * For channel-overridable permissions, applies override resolution.
 * For server-only permissions, uses base role permissions.
 */
export function hasChannelPermission(
  userId: string,
  channelId: string,
  perm: keyof RolePermissions,
): boolean {
  const channel = db.prepare('SELECT server_id FROM channels WHERE id = ?').get(channelId) as
    | { server_id: string | null }
    | undefined;
  const serverId = channel?.server_id ?? undefined;
  const basePerms = getUserPermissions(userId, serverId);
  if (basePerms.administrator) return true;

  if (!CHANNEL_OVERRIDABLE.includes(perm as ChannelOverridablePermission)) {
    return !!basePerms[perm];
  }

  const resolved = getChannelPermissions(userId, channelId);
  return !!resolved[perm];
}

export function hasChannelAccess(userId: string, channelId: string): boolean {
  const channel = db.prepare('SELECT id, type FROM channels WHERE id = ?').get(channelId) as
    | { id: string; type: string }
    | undefined;
  if (!channel) return false;
  if (channel.type === 'dm') return true;

  return hasChannelPermission(userId, channelId, 'view_channel');
}

// TTL cache for channel access results
const channelAccessCache = new Map<string, { users: string[]; expiresAt: number }>();
const CHANNEL_ACCESS_CACHE_TTL = 5000; // 5 seconds

export function getCachedChannelAccess(channelId: string): string[] {
  const cached = channelAccessCache.get(channelId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.users;
  }
  const users = getUsersWithChannelAccess(channelId);
  channelAccessCache.set(channelId, { users, expiresAt: Date.now() + CHANNEL_ACCESS_CACHE_TTL });
  return users;
}

export function invalidateChannelAccessCache(channelId?: string) {
  if (channelId) {
    channelAccessCache.delete(channelId);
  } else {
    channelAccessCache.clear();
  }
}

/**
 * Get all user IDs who can view a channel.
 * Returns empty array if channel has no view_channel overrides (meaning everyone can see it).
 */
export function getUsersWithChannelAccess(channelId: string): string[] {
  // Check if any overrides affect view_channel for this channel
  const hasViewOverrides = db
    .prepare(
      'SELECT 1 FROM channel_permission_overrides WHERE channel_id = ? AND view_channel IS NOT NULL',
    )
    .get(channelId);

  // Also check group-level view_channel overrides (only if group has permissions_enabled)
  const channel = db.prepare('SELECT group_id, server_id FROM channels WHERE id = ?').get(channelId) as
    | { group_id: string | null; server_id: string | null }
    | undefined;
  const serverId = channel?.server_id ?? undefined;
  let hasGroupViewOverrides: unknown = null;
  if (channel?.group_id) {
    const groupRow = db
      .prepare('SELECT permissions_enabled FROM channel_groups WHERE id = ?')
      .get(channel.group_id) as { permissions_enabled: number } | undefined;
    if (groupRow?.permissions_enabled) {
      hasGroupViewOverrides = db
        .prepare(
          'SELECT 1 FROM group_permission_overrides WHERE group_id = ? AND view_channel IS NOT NULL',
        )
        .get(channel.group_id);
    }
  }

  if (!hasViewOverrides && !hasGroupViewOverrides) return []; // No overrides = everyone has access

  // Batch: get all users with their role permissions in one query
  const allUsers = serverId
    ? (db
        .prepare(
          `SELECT u.id, GROUP_CONCAT(r.permissions, '|||') as all_perms
           FROM users u
           JOIN server_members sm ON sm.user_id = u.id AND sm.server_id = ?
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id AND r.server_id = ?
           GROUP BY u.id`,
        )
        .all(serverId, serverId) as { id: string; all_perms: string | null }[])
    : (db
        .prepare(
          `SELECT u.id, GROUP_CONCAT(r.permissions, '|||') as all_perms
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           GROUP BY u.id`,
        )
        .all() as { id: string; all_perms: string | null }[]);

  // Pre-fetch all channel overrides for this channel (2 queries total)
  const channelRoleOverrides = db
    .prepare(
      `SELECT * FROM channel_permission_overrides WHERE channel_id = ? AND target_type = 'role'`,
    )
    .all(channelId) as Record<string, unknown>[];
  const channelUserOverrides = db
    .prepare(
      `SELECT * FROM channel_permission_overrides WHERE channel_id = ? AND target_type = 'user'`,
    )
    .all(channelId) as Record<string, unknown>[];
  const userOverrideMap = new Map(
    channelUserOverrides.map((o) => [o.target_id as string, o]),
  );

  // Pre-fetch group overrides if applicable
  let groupRoleOverrides: Record<string, unknown>[] = [];
  let groupUserOverrideMap = new Map<string, Record<string, unknown>>();
  if (channel?.group_id) {
    const groupRow = db
      .prepare('SELECT permissions_enabled FROM channel_groups WHERE id = ?')
      .get(channel.group_id) as { permissions_enabled: number } | undefined;
    if (groupRow?.permissions_enabled) {
      groupRoleOverrides = db
        .prepare(
          `SELECT * FROM group_permission_overrides WHERE group_id = ? AND target_type = 'role'`,
        )
        .all(channel.group_id) as Record<string, unknown>[];
      const groupUserOverrides = db
        .prepare(
          `SELECT * FROM group_permission_overrides WHERE group_id = ? AND target_type = 'user'`,
        )
        .all(channel.group_id) as Record<string, unknown>[];
      groupUserOverrideMap = new Map(
        groupUserOverrides.map((o) => [o.target_id as string, o]),
      );
    }
  }

  // Pre-fetch all user role mappings (scoped to server when available)
  const allUserRoles = serverId
    ? (db
        .prepare(
          `SELECT user_id, role_id FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE r.server_id = ?`,
        )
        .all(serverId) as { user_id: string; role_id: string }[])
    : (db
        .prepare('SELECT user_id, role_id FROM user_roles')
        .all() as { user_id: string; role_id: string }[]);
  const userRolesMap = new Map<string, string[]>();
  for (const ur of allUserRoles) {
    const list = userRolesMap.get(ur.user_id) || [];
    list.push(ur.role_id);
    userRolesMap.set(ur.user_id, list);
  }

  const result: string[] = [];

  for (const user of allUsers) {
    // Parse base permissions (OR-merge across roles)
    const base = { ...DEFAULT_PERMISSIONS };
    if (user.all_perms) {
      for (const permJson of user.all_perms.split('|||')) {
        try {
          const perms = JSON.parse(permJson);
          for (const key of Object.keys(base) as (keyof RolePermissions)[]) {
            if (perms[key] === true) (base as any)[key] = true;
          }
        } catch {}
      }
    }

    // Admin can see everything
    if (base.administrator) {
      result.push(user.id);
      continue;
    }

    let viewChannel = base.view_channel;
    const roleIds = userRolesMap.get(user.id) || [];

    // Apply channel role overrides
    if (roleIds.length > 0) {
      const roleIdSet = new Set(roleIds);
      const matching = channelRoleOverrides.filter((o) => roleIdSet.has(o.target_id as string));
      let hasExplicit = false;
      let anyAllow = false;
      for (const override of matching) {
        const val = override.view_channel;
        if (val !== null && val !== undefined) {
          hasExplicit = true;
          if (val) anyAllow = true;
        }
      }
      if (hasExplicit) viewChannel = anyAllow;
    }

    // Apply channel user override
    const userOverride = userOverrideMap.get(user.id);
    if (userOverride?.view_channel !== null && userOverride?.view_channel !== undefined) {
      viewChannel = !!userOverride.view_channel;
    }

    // Apply group role overrides
    if (groupRoleOverrides.length > 0 && roleIds.length > 0) {
      const roleIdSet = new Set(roleIds);
      const matching = groupRoleOverrides.filter((o) => roleIdSet.has(o.target_id as string));
      let hasExplicit = false;
      let anyAllow = false;
      for (const override of matching) {
        const val = override.view_channel;
        if (val !== null && val !== undefined) {
          hasExplicit = true;
          if (val) anyAllow = true;
        }
      }
      if (hasExplicit) viewChannel = anyAllow;
    }

    // Apply group user override
    const groupUserOverride = groupUserOverrideMap.get(user.id);
    if (groupUserOverride?.view_channel !== null && groupUserOverride?.view_channel !== undefined) {
      viewChannel = !!groupUserOverride.view_channel;
    }

    if (viewChannel) result.push(user.id);
  }

  return result;
}

export function isAppEnabled(appId: string, serverId?: string): boolean {
  // 1. Check per-server settings if serverId provided
  if (serverId) {
    const row = db.prepare('SELECT enabled_apps FROM servers WHERE id = ?').get(serverId) as
      | { enabled_apps: string }
      | undefined;
    if (row) {
      try {
        const apps: string[] = JSON.parse(row.enabled_apps);
        return apps.includes(appId);
      } catch {
        // Fall through to instance check
      }
    }
  }

  // 2. Fallback to instance-wide settings
  const row = db.prepare('SELECT enabled_apps FROM server_settings WHERE id = 1').get() as
    | { enabled_apps: string }
    | undefined;
  if (!row) return false;
  try {
    const apps: string[] = JSON.parse(row.enabled_apps);
    return apps.includes(appId);
  } catch {
    return false;
  }
}
