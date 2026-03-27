<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { onlineList, onlineUsers } from '$lib/stores/presence';
  import { currentUser } from '$lib/stores/auth';
  import { allUsers as usersStore, fetchUsers } from '$lib/stores/users';
  import { openOrCreateDm, activeChannel } from '$lib/stores/channels';
  import { roles } from '$lib/stores/permissions';
  import { toast } from '$lib/stores/toast';
  import UserProfileCard from './UserProfileCard.svelte';
  import Avatar from './Avatar.svelte';

  import type { UserInfo } from '$lib/stores/users';
  import { nameStyle } from '$lib/nameColor';

  let userMap = $derived(new SvelteMap($usersStore.map((u) => [u.id, u])));

  let adminRoleIds = $derived(
    new SvelteSet($roles.filter((r) => r.permissions.administrator).map((r) => r.id)),
  );

  // Build a map of roleId -> position for sorting
  let rolePositionMap = $derived(new SvelteMap($roles.map((r) => [r.id, r.position])));

  let roleMap = $derived(new SvelteMap($roles.map((r) => [r.id, r])));

  let visibleUserIds = $derived.by(() => {
    const ch = $activeChannel;
    if (!ch) return null;
    if (ch.accessible_user_ids && ch.accessible_user_ids.length > 0) {
      return new SvelteSet(ch.accessible_user_ids);
    }
    if (!ch.restricted) return null;
    const allowed = new SvelteSet<string>();
    if (ch.allowed_user_ids) for (const id of ch.allowed_user_ids) allowed.add(id);
    const allowedRoles = new SvelteSet(ch.allowed_role_ids ?? []);
    for (const id of adminRoleIds) allowedRoles.add(id);
    for (const u of $usersStore) {
      const uRoleIds = u.role_ids ?? (u.role_id ? [u.role_id] : []);
      if (uRoleIds.some((rid) => allowedRoles.has(rid))) allowed.add(u.id);
    }
    return allowed;
  });

  let filteredOnlineList = $derived(
    (visibleUserIds === null
      ? $onlineList
      : $onlineList.filter((u) => visibleUserIds!.has(u.userId))
    ).filter((u) => userMap.has(u.userId)),
  );

  let offlineUsers = $derived(
    $usersStore.filter(
      (u) =>
        !$onlineUsers.has(u.id) &&
        u.is_bot !== 1 &&
        (visibleUserIds === null || visibleUserIds.has(u.id)),
    ),
  );

  // Get the top role id for a user (lowest position = highest authority)
  function getHighestRoleId(userData: UserInfo | undefined): string | null {
    if (!userData) return null;
    const rIds = userData.role_ids ?? (userData.role_id ? [userData.role_id] : []);
    if (rIds.length === 0) return null;
    let best: string | null = null;
    let bestPos = Infinity;
    for (const rid of rIds) {
      const pos = rolePositionMap.get(rid) ?? Infinity;
      if (pos < bestPos) {
        bestPos = pos;
        best = rid;
      }
    }
    return best;
  }

  // Separate bots from regular online users
  let onlineBots = $derived(filteredOnlineList.filter((u) => userMap.get(u.userId)?.is_bot === 1));

  let onlineHumans = $derived(
    filteredOnlineList.filter((u) => userMap.get(u.userId)?.is_bot !== 1),
  );

  // Group online users by their highest role, sorted by role position (highest first)
  let onlineRoleGroups = $derived.by(() => {
    const groups = new SvelteMap<
      string,
      {
        role: { id: string; name: string; color: string; position: number };
        users: typeof onlineHumans;
      }
    >();

    for (const user of onlineHumans) {
      const userData = userMap.get(user.userId);
      const roleId = getHighestRoleId(userData);
      const role = roleId ? roleMap.get(roleId) : null;
      const key = role?.id ?? '__default__';

      if (!groups.has(key)) {
        groups.set(key, {
          role: role
            ? { id: role.id, name: role.name, color: role.color, position: role.position }
            : { id: '__default__', name: 'Online', color: '', position: -1 },
          users: [],
        });
      }
      groups.get(key)!.users.push(user);
    }

    // Sort groups by role position ascending (highest authority first)
    return [...groups.values()].sort((a, b) => a.role.position - b.role.position);
  });

  // Profile card state
  let selectedUser = $state<UserInfo | null>(null);
  let anchorEl = $state<HTMLElement | null>(null);

  function handleUserClick(user: UserInfo, event: MouseEvent) {
    selectedUser = user;
    anchorEl = event.currentTarget as HTMLElement;
  }

  async function handleDmClick(e: MouseEvent, userId: string) {
    e.stopPropagation();
    try {
      await openOrCreateDm(userId);
    } catch (err: any) {
      toast.error('Failed to open DM: ' + err.message);
    }
  }

  onMount(() => {
    fetchUsers();
  });
</script>

<aside class="user-list">
  {#each onlineRoleGroups as group (group.role.id)}
    <h3 class="title" style:color={group.role.color || undefined}>
      {group.role.name} — {group.users.length}
    </h3>
    <div class="users">
      {#each group.users as user (user.userId)}
        {@const userData = userMap.get(user.userId)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="user" onclick={(e) => userData && handleUserClick(userData, e)}>
          <Avatar
            src={userData?.avatar_url}
            alt={userData?.display_name || userData?.username || user.display_name || user.username}
            size={32}
            userId={user.userId}
            showStatus={true}
          />
          <div class="user-info">
            <div class="username-row">
              <span
                class="username"
                style={nameStyle(userData?.name_color, userData?.role_color, userData?.name_font)}
                >{userData?.server_nickname || user.display_name || user.username}</span
              >{#if userData?.is_bot === 1}<span class="bot-tag" title="Bot"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v1a2 2 0 0 1 0 4H3a2 2 0 0 1 0-4v-1a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 12 2zM9 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg></span>{:else if userData?.premium_tier === 'pro'}<span class="pro-tag" title="Pro"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>{/if}
            </div>
            {#if user.activity}
              <span class="user-activity">Playing {user.activity}</span>
            {/if}
          </div>
          <div class="user-actions-right">
            {#if user.userId !== $currentUser?.id && userData?.is_bot !== 1}
              <button class="dm-icon-btn" title="Message" onclick={(e) => handleDmClick(e, user.userId)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/each}

  {#if onlineBots.length > 0}
    <h3 class="title">Bots — {onlineBots.length}</h3>
    <div class="users">
      {#each onlineBots as user (user.userId)}
        {@const userData = userMap.get(user.userId)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="user" onclick={(e) => userData && handleUserClick(userData, e)}>
          <Avatar
            src={userData?.avatar_url}
            alt={userData?.display_name || userData?.username || user.display_name || user.username}
            size={32}
            userId={user.userId}
            showStatus={true}
          />
          <div class="user-info">
            <div class="username-row">
              <span
                class="username"
                style={nameStyle(userData?.name_color, userData?.role_color, userData?.name_font)}
                >{userData?.server_nickname || user.display_name || user.username}</span
              ><span class="bot-tag" title="Bot"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v1a2 2 0 0 1 0 4H3a2 2 0 0 1 0-4v-1a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 12 2zM9 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg></span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if offlineUsers.length > 0}
    <h3 class="title offline-title">Offline — {offlineUsers.length}</h3>
    <div class="users">
      {#each offlineUsers as user (user.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="user offline" onclick={(e) => handleUserClick(user, e)}>
          <Avatar
            src={user.avatar_url}
            alt={user.display_name || user.username}
            size={32}
            userId={user.id}
            showStatus={true}
          />
          <div class="user-info">
            <div class="username-row">
              <span
                class="username"
                style={nameStyle(user.name_color, user.role_color, user.name_font)}
                >{user.server_nickname || user.display_name || user.username}</span
              >{#if user.is_bot === 1}<span class="bot-tag" title="Bot"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7v1a2 2 0 0 1 0 4H3a2 2 0 0 1 0-4v-1a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 12 2zM9 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg></span>{:else if user.premium_tier === 'pro'}<span class="pro-tag" title="Pro"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>{/if}
            </div>
          </div>
          <div class="user-actions-right">
            {#if user.id !== $currentUser?.id && user.is_bot !== 1}
              <button class="dm-icon-btn" title="Message" onclick={(e) => handleDmClick(e, user.id)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</aside>

{#if selectedUser && anchorEl}
  <UserProfileCard
    user={selectedUser}
    {anchorEl}
    onclose={() => {
      selectedUser = null;
      anchorEl = null;
    }}
  />
{/if}

<style>
  .user-list {
    width: var(--userlist-width);
    height: 100%;
    background: rgba(8, 8, 15, 0.4);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-left: 1px solid var(--glass-border);
    padding: 16px 10px;
    flex-shrink: 0;
    overflow-y: auto;
    z-index: 10;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.05) transparent;
  }

  .title {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    margin-bottom: 6px;
    margin-top: 24px;
    padding: 0 10px;
    opacity: 0.8;
  }

  .title:first-child {
    margin-top: 4px;
  }

  .users {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .user {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-out);
    cursor: pointer;
    position: relative;
    min-width: 0;
  }

  .user:hover {
    background: rgba(255, 255, 255, 0.03);
    padding-left: 14px;
  }

  .user:active {
    transform: scale(0.98);
  }

  .offline-title {
    margin-top: 32px;
  }

  .user.offline {
    opacity: 0.4;
    filter: grayscale(0.4);
  }

  .user.offline:hover {
    opacity: 0.8;
    filter: grayscale(0);
  }

  .user-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .user-activity {
    font-size: 0.7rem;
    color: var(--text-dim);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .username {
    font-size: 0.95rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-muted);
    transition: all 0.2s;
  }

  .user:hover .username {
    color: white;
  }

  .username-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .user-actions-right {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .dm-icon-btn {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    border-radius: 4px;
    opacity: 0;
    transition: all 0.15s var(--ease-out);
    flex-shrink: 0;
    border: none;
    cursor: pointer;
    background: none;
    padding: 0;
  }

  .dm-icon-btn svg {
    width: 14px;
    height: 14px;
  }

  .user:hover .dm-icon-btn {
    opacity: 0.6;
  }

  .dm-icon-btn:hover {
    opacity: 1 !important;
    color: var(--text);
  }

  .bot-tag, .pro-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .bot-tag {
    color: var(--accent);
    opacity: 0.6;
  }

  .pro-tag {
    color: #f59e0b;
    opacity: 0.7;
  }
</style>
