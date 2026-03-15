import { writable, derived } from 'svelte/store';
import { api } from '$lib/api';
import { currentUser } from './auth';
import type {
  RoleRecord,
  RolePermissions,
  ChannelPermissionOverride,
  GroupPermissionOverride,
  ChannelOverridablePermission,
} from '@voip-server/shared';
import { channels, channelGroups } from './channels';
import { getActiveServerId, activeServer } from './servers';
import { allUsers } from './users';

export const roles = writable<RoleRecord[]>([]);

export async function loadRoles() {
  const serverId = getActiveServerId();
  if (!serverId) return;
  try {
    const list = await api.get<RoleRecord[]>(`/api/servers/${serverId}/roles`);
    roles.set(list);
  } catch {
    // Ignore
  }
}

export const currentUserPermissions = derived([currentUser, roles, allUsers], ([$currentUser, $roles, $allUsers]) => {
  if (!$currentUser) return null;
  // Prefer server-scoped role_ids from allUsers (fetched per-server) over
  // the global currentUser.role_ids (which may be stale from /api/auth/me)
  const serverMe = $allUsers.find((u) => u.id === $currentUser.id);
  const userRoleIds = serverMe?.role_ids
    ?? $currentUser.role_ids
    ?? ($currentUser.role_id ? [$currentUser.role_id] : []);
  const userRoles = $roles.filter((r) => userRoleIds.includes(r.id));
  if (userRoles.length === 0) return null;
  // OR-merge permissions across all roles
  const merged = { ...userRoles[0].permissions };
  for (let i = 1; i < userRoles.length; i++) {
    const perms = userRoles[i].permissions;
    for (const key of Object.keys(merged) as (keyof RolePermissions)[]) {
      if (perms[key] === true) {
        (merged as any)[key] = true;
      }
    }
  }
  return merged;
});

export function hasPermissionStore(perm: keyof RolePermissions) {
  return derived([currentUserPermissions, currentUser, activeServer], ([$perms, $user, $server]) => {
    // Server owner always has all permissions
    if ($user && $server?.owner_id === $user.id) return true;
    if (!$perms) return false;
    if ($perms.administrator) return true;
    return !!$perms[perm];
  });
}

// ─── Channel Permission Overrides ───

export const channelOverrides = writable<ChannelPermissionOverride[]>([]);

export async function loadChannelOverrides() {
  const serverId = getActiveServerId();
  if (!serverId) return;
  try {
    const overrides = await api.get<ChannelPermissionOverride[]>(`/api/servers/${serverId}/channel-overrides`);
    channelOverrides.set(overrides);
  } catch {
    // Ignore
  }
}

// ─── Group Permission Overrides ───

export const groupOverrides = writable<GroupPermissionOverride[]>([]);

export async function loadGroupOverrides() {
  const serverId = getActiveServerId();
  if (!serverId) return;
  try {
    const overrides = await api.get<GroupPermissionOverride[]>(`/api/servers/${serverId}/group-overrides`);
    groupOverrides.set(overrides);
  } catch {
    // Ignore
  }
}

export function hasChannelPermissionStore(channelId: string, perm: ChannelOverridablePermission) {
  return derived(
    [
      currentUserPermissions,
      currentUser,
      channelOverrides,
      groupOverrides,
      channels,
      channelGroups,
      allUsers,
      activeServer,
    ],
    ([$perms, $user, $overrides, $groupOverrides, $channels, $channelGroups, $allUsers, $server]) => {
      if (!$user) return false;
      if ($user && $server?.owner_id === $user.id) return true;
      if (!$perms) return false;
      if ($perms.administrator) return true;

      let value: boolean = !!($perms[perm] ?? true);
      const serverMe = $allUsers.find((u) => u.id === $user.id);
      const userRoleIds = serverMe?.role_ids ?? $user.role_ids ?? ($user.role_id ? [$user.role_id] : []);

      // Apply channel role overrides — "allow wins" across all user roles
      const roleOverrides = $overrides.filter(
        (o) =>
          o.channel_id === channelId &&
          o.target_type === 'role' &&
          userRoleIds.includes(o.target_id),
      );
      if (roleOverrides.length > 0) {
        let hasExplicit = false;
        let anyAllow = false;
        for (const override of roleOverrides) {
          if (override[perm] !== null && override[perm] !== undefined) {
            hasExplicit = true;
            if (override[perm]) anyAllow = true;
          }
        }
        if (hasExplicit) value = anyAllow;
      }

      // Apply channel user override
      const userOverride = $overrides.find(
        (o) => o.channel_id === channelId && o.target_type === 'user' && o.target_id === $user.id,
      );
      if (userOverride && userOverride[perm] !== null && userOverride[perm] !== undefined) {
        value = !!userOverride[perm];
      }

      // Apply group overrides (highest priority) — only if permissions_enabled
      const channel = $channels.find((c) => c.id === channelId);
      if (channel?.group_id) {
        const group = $channelGroups.find((g) => g.id === channel.group_id);
        if (group?.permissions_enabled) {
          // Group role overrides — "allow wins" across all user roles
          const groupRoleOverrides = $groupOverrides.filter(
            (o) =>
              o.group_id === channel.group_id &&
              o.target_type === 'role' &&
              userRoleIds.includes(o.target_id),
          );
          if (groupRoleOverrides.length > 0) {
            let hasExplicit = false;
            let anyAllow = false;
            for (const override of groupRoleOverrides) {
              if (override[perm] !== null && override[perm] !== undefined) {
                hasExplicit = true;
                if (override[perm]) anyAllow = true;
              }
            }
            if (hasExplicit) value = anyAllow;
          }

          // Group user override (highest priority of all)
          const groupUserOverride = $groupOverrides.find(
            (o) =>
              o.group_id === channel.group_id &&
              o.target_type === 'user' &&
              o.target_id === $user.id,
          );
          if (
            groupUserOverride &&
            groupUserOverride[perm] !== null &&
            groupUserOverride[perm] !== undefined
          ) {
            value = !!groupUserOverride[perm];
          }
        }
      }

      return value;
    },
  );
}
