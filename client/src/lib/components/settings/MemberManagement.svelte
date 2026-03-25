<script lang="ts">
  import { api } from '$lib/api';
  import { roles } from '$lib/stores/permissions';
  import { currentUser } from '$lib/stores/auth';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { confirm } from '$lib/stores/toast';
  import { allUsers as usersStore, fetchUsers, type UserInfo } from '$lib/stores/users';
  import { get } from 'svelte/store';
  import { resolveAsset } from '$lib/stores/server';
  import { nameStyle } from '$lib/nameColor';
  import { getActiveServerId } from '$lib/stores/servers';
  import { toast } from '$lib/stores/toast';
  import Icon from '../Icon.svelte';

  let members = $state<UserInfo[]>([]);
  let loadingMembers = $state(false);
  let search = $state('');
  let expandedId = $state<string | null>(null);
  let activeTab = $state<'members' | 'pending'>('members');

  // Pending invites state
  let pendingInvites = $state<any[]>([]);
  let loadingInvites = $state(false);

  // Invite user state
  let inviteSearch = $state('');
  let inviteResults = $state<{ id: string; username: string; display_name: string; avatar_url: string | null }[]>([]);
  let inviteSearching = $state(false);
  let inviteSending = $state<string | null>(null);
  let inviteTimeout: ReturnType<typeof setTimeout> | null = null;

  const canManageRoles = hasPermissionStore('manage_roles');
  const canKick = hasPermissionStore('kick_members');
  const canBan = hasPermissionStore('ban_members');
  const canInvite = hasPermissionStore('create_invites');
  const canManageInviteCodes = hasPermissionStore('manage_invite_codes');

  async function loadPendingInvites() {
    if (!$canManageInviteCodes) return;
    loadingInvites = true;
    try {
      const serverId = getActiveServerId();
      pendingInvites = await api.get(`/api/servers/${serverId}/pending-invitations`);
    } catch (e) {
      console.error('Failed to load pending invites:', e);
    } finally {
      loadingInvites = false;
    }
  }

  function searchInviteUsers(query: string) {
    inviteSearch = query;
    if (inviteTimeout) clearTimeout(inviteTimeout);
    if (!query.trim()) {
      inviteResults = [];
      return;
    }
    inviteTimeout = setTimeout(async () => {
      inviteSearching = true;
      try {
        const serverId = getActiveServerId();
        inviteResults = await api.get(`/api/servers/${serverId}/invitable-users?q=${encodeURIComponent(query)}`);
      } catch {
        inviteResults = [];
      } finally {
        inviteSearching = false;
      }
    }, 300);
  }

  async function sendInvite(userId: string) {
    inviteSending = userId;
    try {
      const serverId = getActiveServerId();
      await api.post(`/api/servers/${serverId}/invitations`, { userId });
      toast.success('Invitation sent');
      inviteResults = inviteResults.filter((u) => u.id !== userId);
      // Refresh pending list if we are on that tab
      if (activeTab === 'pending') loadPendingInvites();
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invite');
    } finally {
      inviteSending = null;
    }
  }

  async function cancelInvite(inviteId: string) {
    if (!(await confirm('Cancel this invitation?', { title: 'Cancel Invitation', confirmLabel: 'Cancel Invite', dangerAction: true }))) return;
    try {
      const serverId = getActiveServerId();
      await api.post(`/api/servers/${serverId}/invitations/${inviteId}/cancel`);
      pendingInvites = pendingInvites.filter(i => i.id !== inviteId);
      toast.success('Invitation cancelled');
    } catch (e: any) {
      toast.error(e.message || 'Failed to cancel invitation');
    }
  }

  let filteredMembers = $derived(
    search.trim()
      ? members.filter(
          (m) =>
            (m.display_name || '').toLowerCase().includes(search.toLowerCase()) ||
            m.username.toLowerCase().includes(search.toLowerCase()),
        )
      : members,
  );

  $effect(() => {
    loadingMembers = true;
    fetchUsers()
      .then(() => {
        members = [...get(usersStore)];
      })
      .finally(() => {
        loadingMembers = false;
      });
  });

  $effect(() => {
    if (activeTab === 'pending') {
      loadPendingInvites();
    }
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  async function toggleUserRole(userId: string, roleId: string) {
    const member = members.find((m) => m.id === userId);
    if (!member) return;
    const currentRoleIds = member.role_ids ?? (member.role_id ? [member.role_id] : []);
    let newRoleIds: string[];
    if (currentRoleIds.includes(roleId)) {
      if (currentRoleIds.length <= 1) return;
      newRoleIds = currentRoleIds.filter((id) => id !== roleId);
    } else {
      newRoleIds = [...currentRoleIds, roleId];
    }
    const serverId = getActiveServerId();
    await api.put(`/api/servers/${serverId}/users/${userId}/roles`, { role_ids: newRoleIds });
    const roleRecords = $roles.filter((r) => newRoleIds.includes(r.id));
    const displayRole = roleRecords.sort((a, b) => a.position - b.position)[0];
    members = members.map((m) => {
      if (m.id === userId) {
        return {
          ...m,
          role_ids: newRoleIds,
          role_names: roleRecords.map((r) => r.name),
          role_colors: roleRecords.map((r) => r.color),
          role_id: displayRole?.id ?? m.role_id,
          role_name: displayRole?.name ?? m.role_name,
          role_color: displayRole?.color ?? m.role_color,
        };
      }
      return m;
    });
  }

  async function setMainRole(userId: string, roleId: string) {
    const member = members.find((m) => m.id === userId);
    if (!member) return;
    const serverId = getActiveServerId();
    await api.put(`/api/servers/${serverId}/users/${userId}/roles`, {
      role_ids: member.role_ids ?? [member.role_id],
      main_role_id: roleId,
    });
    const role = $roles.find((r) => r.id === roleId);
    if (role) {
      members = members.map((m) => {
        if (m.id === userId) {
          return { ...m, role_id: roleId, role_name: role.name, role_color: role.color };
        }
        return m;
      });
    }
  }

  async function kickUser(userId: string) {
    const member = members.find((m) => m.id === userId);
    if (member?.is_bot) { toast.error('Bots cannot be kicked. Disable them in Bot Settings.'); return; }
    if (!(await confirm('Kick this member? They can rejoin with an invite.', { title: 'Kick Member', confirmLabel: 'Kick', dangerAction: true }))) return;
    try {
      const serverId = getActiveServerId();
      await api.post(`/api/servers/${serverId}/admin/kick/${userId}`, {});
      members = members.filter((m) => m.id !== userId);
      toast.success('Member kicked');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function banUser(userId: string) {
    const member = members.find((m) => m.id === userId);
    if (member?.is_bot) { toast.error('Bots cannot be banned. Disable them in Bot Settings.'); return; }
    if (!(await confirm('Ban this member? They will not be able to rejoin.', { title: 'Ban Member', confirmLabel: 'Ban', dangerAction: true }))) return;
    try {
      const serverId = getActiveServerId();
      await api.post(`/api/servers/${serverId}/admin/ban/${userId}`, {});
      members = members.map((m) => (m.id === userId ? { ...m, banned: true } : m));
      toast.success('Member banned');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function unbanUser(userId: string) {
    try {
      const serverId = getActiveServerId();
      await api.post(`/api/servers/${serverId}/admin/unban/${userId}`);
      members = members.map((m) => (m.id === userId ? { ...m, banned: false } : m));
      toast.success('Member unbanned');
    } catch (e: any) {
      toast.error(e.message);
    }
  }
</script>

<div class="members-container">
  {#if $canInvite}
    <div class="invite-card">
      <div class="card-header">
        <Icon name="plus" size={18} />
        <span>Invite your friends</span>
      </div>
      <div class="invite-input-wrap">
        <input
          type="text"
          class="fancy-input"
          placeholder="Search by username..."
          value={inviteSearch}
          oninput={(e) => searchInviteUsers(e.currentTarget.value)}
        />
        <Icon name="search" size={18} class="search-icon-dim" />
      </div>
      
      {#if inviteResults.length > 0}
        <div class="invite-results scrollable">
          {#each inviteResults as user (user.id)}
            <div class="invite-item">
              <div class="item-avatar small">
                {#if user.avatar_url}
                  <img src={resolveAsset(user.avatar_url)} alt="" />
                {:else}
                  <span>{(user.display_name || user.username).charAt(0).toUpperCase()}</span>
                {/if}
              </div>
              <div class="item-names">
                <span class="item-display">{user.display_name || user.username}</span>
                <span class="item-user">@{user.username}</span>
              </div>
              <button
                class="btn-success-small"
                onclick={() => sendInvite(user.id)}
                disabled={inviteSending === user.id}
              >
                {inviteSending === user.id ? 'Sending...' : 'Invite'}
              </button>
            </div>
          {/each}
        </div>
      {:else if inviteSearch.trim() && !inviteSearching}
        <p class="empty-hint">No users found.</p>
      {/if}
    </div>
  {/if}

  <div class="member-list-header">
    <div class="header-tabs">
      <button class="tab-btn" class:active={activeTab === 'members'} onclick={() => activeTab = 'members'}>
        Members
      </button>
      {#if $canManageInviteCodes}
        <button class="tab-btn" class:active={activeTab === 'pending'} onclick={() => activeTab = 'pending'}>
          Pending Invites
          {#if pendingInvites.length > 0}
            <span class="tab-count">{pendingInvites.length}</span>
          {/if}
        </button>
      {/if}
    </div>
    <div class="search-bar-wrap">
      <Icon name="search" size={18} class="search-icon" />
      <input 
        type="text" 
        class="search-input" 
        placeholder={activeTab === 'members' ? 'Search members...' : 'Search invites...'} 
        bind:value={search} 
      />
    </div>
    <span class="count-pill">
      {activeTab === 'members' ? `${filteredMembers.length} Members` : `${pendingInvites.length} Pending`}
    </span>
  </div>

  {#if activeTab === 'members'}
    {#if loadingMembers}
      <div class="loading-box">
        <div class="spinner"></div>
        <p>Fetching server members...</p>
      </div>
    {:else}
      <div class="members-list">
        {#each filteredMembers as member (member.id)}
          {@const isExpanded = expandedId === member.id}
          {@const memberRoleIds = member.role_ids ?? (member.role_id ? [member.role_id] : [])}
          
          <div class="member-card" class:expanded={isExpanded}>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="member-header" onclick={() => toggleExpand(member.id)}>
              <div class="member-avatar">
                {#if member.avatar_url}
                  <img src={resolveAsset(member.avatar_url)} alt="" />
                {:else}
                  <span>{(member.display_name || member.username).charAt(0).toUpperCase()}</span>
                {/if}
              </div>
              <div class="member-info">
                <span class="member-name" style={nameStyle(member.name_color, member.role_color)}>
                  {member.display_name || member.username}
                </span>
                <span class="member-handle">@{member.username}</span>
              </div>
              <div class="member-badges">
                {#each member.role_names ?? [member.role_name] as rName, i}
                  <span class="role-badge" style:--r-color={(member.role_colors ?? [member.role_color])[i] || '#99aab5'}>
                    {rName}
                  </span>
                {/each}
                {#if member.banned}
                  <span class="banned-badge">BANNED</span>
                {/if}
              </div>
              <Icon name="chevron-down" size={16} class="expand-icon {isExpanded ? 'rotated' : ''}" />
            </div>

            {#if isExpanded}
              <div class="member-details">
                {#if $canManageRoles}
                  <div class="detail-section">
                    <h5 class="detail-title">Manage Roles</h5>
                    <div class="role-chips">
                      {#each $roles as role (role.id)}
                        {@const isAssigned = memberRoleIds.includes(role.id)}
                        {@const isLastRole = isAssigned && memberRoleIds.length <= 1}
                        <button 
                          class="role-chip" 
                          class:active={isAssigned}
                          style:--role-color={role.color}
                          disabled={isLastRole}
                          onclick={() => toggleUserRole(member.id, role.id)}
                        >
                          <span class="dot" style:background={role.color}></span>
                          {role.name}
                          {#if isAssigned}<Icon name="x" size={12} class="chip-x" />{/if}
                        </button>
                      {/each}
                    </div>
                  </div>

                  {#if memberRoleIds.length > 1}
                    <div class="detail-section">
                      <h5 class="detail-title">Display Role</h5>
                      <div class="custom-select-wrap">
                        <select 
                          class="fancy-select"
                          value={member.role_id}
                          onchange={(e) => setMainRole(member.id, e.currentTarget.value)}
                        >
                          {#each memberRoleIds as rid}
                            {@const r = $roles.find(role => role.id === rid)}
                            {#if r}<option value={r.id}>{r.name}</option>{/if}
                          {/each}
                        </select>
                        <Icon name="chevron-down" size={14} class="select-arrow" />
                      </div>
                    </div>
                  {/if}
                {/if}

                {#if ($canKick || $canBan) && member.id !== $currentUser?.id}
                  <div class="detail-section moderation-actions">
                    <h5 class="detail-title">Moderation</h5>
                    <div class="action-buttons">
                      {#if member.banned}
                        {#if $canBan}
                          <button class="btn-subtle" onclick={() => unbanUser(member.id)}>
                            <Icon name="shield-check" size={16} />
                            <span>Unban from Server</span>
                          </button>
                        {/if}
                      {:else}
                        {#if $canKick}
                          <button class="btn-warning-outline" onclick={() => kickUser(member.id)}>
                            <Icon name="arrow-right" size={16} />
                            <span>Kick</span>
                          </button>
                        {/if}
                        {#if $canBan}
                          <button class="btn-danger-outline" onclick={() => banUser(member.id)}>
                            <Icon name="x" size={16} />
                            <span>Ban</span>
                          </button>
                        {/if}
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty-state">
            <Icon name="users" size={48} class="empty-icon" />
            <p>{search ? 'No members match your search' : 'No members found'}</p>
          </div>
        {/each}
      </div>
    {/if}
  {:else if activeTab === 'pending'}
    {#if loadingInvites}
      <div class="loading-box">
        <div class="spinner"></div>
        <p>Fetching pending invitations...</p>
      </div>
    {:else}
      <div class="members-list">
        {#each pendingInvites as invite (invite.id)}
          <div class="member-card">
            <div class="member-header no-cursor">
              <div class="member-avatar">
                {#if invite.invitee_avatar_url}
                  <img src={resolveAsset(invite.invitee_avatar_url)} alt="" />
                {:else}
                  <span>{invite.invitee_name.charAt(0).toUpperCase()}</span>
                {/if}
              </div>
              <div class="member-info">
                <span class="member-name">{invite.invitee_name}</span>
                <span class="member-handle">Invited by {invite.inviter_name}</span>
              </div>
              <div class="action-buttons force-show">
                <button class="btn-danger-outline" onclick={() => cancelInvite(invite.id)}>
                  <Icon name="x" size={16} />
                  <span>Cancel Invite</span>
                </button>
              </div>
            </div>
          </div>
        {:else}
          <div class="empty-state">
            <Icon name="plus" size={48} class="empty-icon" />
            <p>No pending invitations</p>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .members-container {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .scrollable {
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* Invite Card */
  .invite-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    color: white;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }

  .invite-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .fancy-input {
    width: 100%;
    padding: 12px 40px 12px 16px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: white;
    font-size: 0.95rem;
    outline: none;
    transition: all 0.2s;
  }

  .fancy-input:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

  .search-icon-dim {
    position: absolute;
    right: 14px;
    color: var(--text-dim);
    pointer-events: none;
  }

  .invite-results {
    max-height: 240px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 4px;
  }

  .invite-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
    transition: background 0.1s;
  }

  .invite-item:hover { background: var(--bg-hover); }

  .item-avatar.small {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--bg-mid); overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 0.8rem; flex-shrink: 0;
  }
  .item-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .item-names { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .item-display { font-weight: 600; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-user { font-size: 0.75rem; color: var(--text-dim); }

  /* Member List */
  .member-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
  }

  .header-tabs {
    display: flex;
    gap: 8px;
  }

  .tab-btn {
    padding: 8px 16px;
    background: transparent;
    color: var(--text-dim);
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab-btn:hover { background: rgba(255, 255, 255, 0.05); color: white; }
  .tab-btn.active { background: var(--bg-mid); color: white; box-shadow: inset 0 0 0 1px var(--border); }

  .tab-count {
    background: var(--accent);
    color: white;
    font-size: 0.7rem;
    padding: 1px 6px;
    border-radius: 10px;
    line-height: 1;
  }

  .search-bar-wrap {
    flex: 1;
    max-width: 300px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--bg-darkest);
    padding: 0 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .search-input {
    flex: 1;
    padding: 10px 0;
    background: transparent;
    border: none;
    color: white;
    font-size: 0.9rem;
    outline: none;
  }

  .search-icon { color: var(--text-dim); }

  .count-pill {
    padding: 4px 12px;
    background: var(--bg-darker);
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .members-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
  }

  .member-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    transition: all 0.2s var(--ease-out);
  }

  .member-card.expanded { border-color: var(--accent); background: var(--bg-mid); }

  .member-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .member-header.no-cursor { cursor: default; }

  .member-header:hover:not(.no-cursor) { background: var(--bg-hover); }

  .member-avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--bg-mid); overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; flex-shrink: 0;
  }
  .member-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .member-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .member-name { font-weight: 700; font-size: 1rem; color: white; }
  .member-handle { font-size: 0.8rem; color: var(--text-dim); }

  .member-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 12px; }
  
  .role-badge {
    font-size: 0.65rem;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--r-color) 15%, transparent);
    color: var(--r-color);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .banned-badge {
    background: var(--danger);
    color: white;
    font-size: 0.65rem;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .expand-icon { color: var(--text-dim); transition: transform 0.2s; }
  .expand-icon.rotated { transform: rotate(180deg); color: var(--accent); }

  /* Expanded Details */
  .member-details {
    padding: 20px;
    background: rgba(0, 0, 0, 0.15);
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .detail-section { display: flex; flex-direction: column; gap: 12px; }
  .detail-title {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.08em;
  }

  .role-chips { display: flex; flex-wrap: wrap; gap: 8px; }

  .role-chip {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 14px; background: var(--bg-darkest);
    border: 1px solid var(--border); border-radius: 20px;
    font-size: 0.85rem; font-weight: 600; color: var(--text-muted);
    cursor: pointer; transition: all 0.15s;
  }

  .role-chip:hover { border-color: var(--role-color); color: white; }
  .role-chip.active {
    background: color-mix(in srgb, var(--role-color) 20%, transparent);
    border-color: var(--role-color);
    color: white;
  }

  .role-chip .dot { width: 10px; height: 10px; border-radius: 50%; }
  .chip-x { color: var(--text-dim); }

  .custom-select-wrap { position: relative; width: 240px; }
  .fancy-select {
    width: 100%; padding: 10px 16px;
    background: var(--bg-darkest); border: 1px solid var(--border);
    border-radius: 6px; color: white; font-weight: 600;
    appearance: none; cursor: pointer; outline: none;
  }
  .select-arrow { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-dim); }

  .action-buttons { display: flex; gap: 12px; opacity: 0; transition: opacity 0.2s; }
  .member-card:hover .action-buttons, .action-buttons.force-show { opacity: 1; }

  /* Misc */
  .loading-box { padding: 60px; text-align: center; color: var(--text-dim); }
  .spinner {
    width: 32px; height: 32px; border: 3px solid var(--bg-light);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 0 auto 16px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .btn-success-small {
    padding: 6px 16px; background: var(--accent-success); color: white;
    border-radius: 4px; font-weight: 700; font-size: 0.8rem; border: none; cursor: pointer;
  }

  .btn-warning-outline {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 16px; background: transparent; border: 1px solid #f59e0b;
    color: #f59e0b; border-radius: 4px; font-weight: 600; font-size: 0.85rem; cursor: pointer;
    transition: all 0.1s;
  }
  .btn-warning-outline:hover { background: #f59e0b; color: white; }

  .btn-danger-outline {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 16px; background: transparent; border: 1px solid var(--danger);
    color: var(--danger); border-radius: 4px; font-weight: 600; font-size: 0.85rem; cursor: pointer;
    transition: all 0.1s;
  }
  .btn-danger-outline:hover { background: var(--danger); color: white; }

  .btn-subtle {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 16px; background: var(--bg-mid); color: white;
    border-radius: 4px; font-weight: 600; font-size: 0.85rem; border: none; cursor: pointer;
  }

  .empty-state { padding: 60px; text-align: center; color: var(--text-dim); }
  .empty-icon { opacity: 0.2; margin-bottom: 12px; }
  .empty-hint { text-align: center; color: var(--text-dim); font-size: 0.85rem; padding: 20px; }
</style>
