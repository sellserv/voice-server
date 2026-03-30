<script lang="ts">
  import { api } from '$lib/api';

  const API_URL = import.meta.env.VITE_API_URL || '';

  let users: any[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let userSearch = $state('');

  // User detail
  let selectedUser: any = $state(null);
  let userDetailLoading = $state(false);

  // Global roles
  let globalRoles: any[] = $state([]);
  let selectedUserGlobalRoles: string[] = $state([]);

  // Action states
  let actionLoading = $state('');

  let filteredUsers = $derived(
    userSearch.trim()
      ? users.filter((u: any) => {
          const q = userSearch.trim().toLowerCase();
          return u.username.toLowerCase().includes(q) ||
            (u.display_name || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q);
        })
      : users,
  );

  function avatarSrc(url: string) {
    if (url.startsWith('/')) return `${API_URL}${url}`;
    return url;
  }

  function formatDate(iso: string) {
    return new Date(iso + 'Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const [u, gr] = await Promise.all([
        api.get<any[]>('/api/admin/users'),
        api.get<any[]>('/api/admin/global-roles'),
      ]);
      users = u;
      globalRoles = gr;
    } catch (e: any) {
      error = e.message || 'Failed to load users';
    } finally {
      loading = false;
    }
  }

  async function loadUserDetail(userId: string) {
    userDetailLoading = true;
    error = '';
    try {
      const [user, roles] = await Promise.all([
        api.get<any>(`/api/admin/users/${userId}`),
        api.get<any[]>(`/api/admin/users/${userId}/global-roles`),
      ]);
      selectedUser = user;
      selectedUserGlobalRoles = roles.map((r: any) => r.id);
    } catch (e: any) {
      error = e?.message || 'Failed to load user details';
    } finally {
      userDetailLoading = false;
    }
  }

  async function toggleGlobalRole(roleId: string) {
    if (!selectedUser) return;
    const hasRole = selectedUserGlobalRoles.includes(roleId);
    const action = hasRole ? 'remove' : 'add';
    actionLoading = roleId;
    try {
      const result = await api.patch<any>(`/api/admin/users/${selectedUser.id}/global-roles`, { roleId, action });
      selectedUserGlobalRoles = result.globalRoles.map((r: any) => r.id);
    } catch (e: any) {
      error = e?.message || 'Failed to update role';
    } finally {
      actionLoading = '';
    }
  }

  async function toggleBan(user: any) {
    const msg = user.banned
      ? `Unban user "${user.username}"?`
      : `Ban user "${user.username}" from the platform?`;
    if (!window.confirm(msg)) return;
    actionLoading = user.id;
    error = '';
    try {
      if (user.banned) {
        await api.post(`/api/admin/users/${user.id}/unban`);
      } else {
        await api.post(`/api/admin/users/${user.id}/ban`, { reason: 'Banned by instance admin' });
      }
      users = await api.get<any[]>('/api/admin/users');
      if (selectedUser?.id === user.id) {
        selectedUser = await api.get<any>(`/api/admin/users/${user.id}`);
      }
    } catch (e: any) {
      error = e?.message || 'Failed to update ban status';
    } finally {
      actionLoading = '';
    }
  }

  $effect(() => {
    loadData();
  });
</script>

<h1 class="page-title">Users</h1>

{#if loading}
  <div class="status-box">
    <p>Loading users...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
    <button class="retry-btn" onclick={loadData}>Retry</button>
  </div>
{:else if selectedUser}
  <button class="back-btn" onclick={() => selectedUser = null}>
    &larr; Back to users
  </button>
  {#if userDetailLoading}
    <div class="status-box"><p>Loading user details...</p></div>
  {:else}
    <div class="user-detail-card">
      <div class="detail-header">
        <div class="detail-avatar">
          {#if selectedUser.avatar_url}
            <img src={avatarSrc(selectedUser.avatar_url)} alt="" />
          {:else}
            <span class="avatar-initial">{selectedUser.username.charAt(0).toUpperCase()}</span>
          {/if}
        </div>
        <div class="detail-names">
          <span class="detail-display">{selectedUser.display_name || selectedUser.username}</span>
          <span class="detail-username">@{selectedUser.username}</span>
          {#if selectedUser.banned}
            <span class="badge-banned">BANNED</span>
          {/if}
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-field">
          <span class="field-label">Email</span>
          <span class="field-value">{selectedUser.email || 'None'}</span>
        </div>
        <div class="detail-field">
          <span class="field-label">Last IP</span>
          <span class="field-value mono">{selectedUser.last_ip || 'Unknown'}</span>
        </div>
        <div class="detail-field">
          <span class="field-label">Messages</span>
          <span class="field-value">{selectedUser.message_count?.toLocaleString()}</span>
        </div>
        <div class="detail-field">
          <span class="field-label">Joined</span>
          <span class="field-value">{formatDate(selectedUser.created_at)}</span>
        </div>
      </div>

      {#if selectedUser.servers?.length}
        <div class="detail-section">
          <span class="section-title">Servers — {selectedUser.servers.length}</span>
          <div class="server-tags">
            {#each selectedUser.servers as s}
              <span class="server-tag">{s.name}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if globalRoles.length > 0}
        <div class="detail-section">
          <span class="section-title">Global Roles</span>
          <div class="role-toggles">
            {#each globalRoles as role (role.id)}
              <button
                class="role-toggle"
                class:active={selectedUserGlobalRoles.includes(role.id)}
                disabled={actionLoading === role.id}
                onclick={() => toggleGlobalRole(role.id)}
              >
                <span class="role-dot" style:background={role.color}></span>
                <span class="role-name">{role.name}</span>
                {#if role.pro}
                  <span class="pro-badge" title="Pro">&#9889;</span>
                {/if}
                <span class="role-status">
                  {selectedUserGlobalRoles.includes(role.id) ? 'Assigned' : 'Not assigned'}
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="detail-footer">
        <button
          class="btn-danger"
          disabled={actionLoading === selectedUser.id}
          onclick={() => toggleBan(selectedUser)}
        >
          {selectedUser.banned ? 'Unban User' : 'Ban from Platform'}
        </button>
      </div>
    </div>
  {/if}
{:else}
  <input
    type="text"
    class="search-input"
    placeholder="Search users by name, username, or email..."
    bind:value={userSearch}
  />
  <div class="admin-list">
    {#each filteredUsers as user (user.id)}
      <button class="list-item clickable" onclick={() => loadUserDetail(user.id)}>
        <div class="item-avatar">
          {#if user.avatar_url}
            <img src={avatarSrc(user.avatar_url)} alt="" />
          {:else}
            <span class="avatar-initial">{user.username.charAt(0).toUpperCase()}</span>
          {/if}
        </div>
        <div class="item-info">
          <span class="item-name">
            {user.display_name || user.username}
            {#if user.banned}<span class="badge-banned sm">BANNED</span>{/if}
          </span>
          <span class="item-sub">@{user.username} &middot; {user.email || 'No email'} &middot; {user.message_count} messages</span>
        </div>
        <div class="item-meta">
          <span class="meta-main">{user.server_count} servers</span>
          <span class="meta-sub">{formatDate(user.created_at)}</span>
        </div>
      </button>
    {/each}
    {#if filteredUsers.length === 0}
      <div class="status-box"><p>No users found.</p></div>
    {/if}
  </div>
{/if}

<style>
  .page-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .status-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .status-box.error {
    color: var(--danger);
  }

  .retry-btn {
    padding: 8px 16px;
    background: var(--bg-light);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--bg-mid);
  }

  /* Search */
  .search-input {
    width: 100%;
    padding: 10px 14px;
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    margin-bottom: 16px;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-dim);
  }

  /* Admin List */
  .admin-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px;
    background: transparent;
    border-radius: 8px;
    border: none;
    width: 100%;
    text-align: left;
    transition: background 0.1s;
    font-family: inherit;
  }

  .list-item.clickable {
    cursor: pointer;
  }

  .list-item:hover {
    background: var(--bg-light);
  }

  .item-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-mid);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .item-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-initial {
    font-weight: 700;
    color: var(--text-dim);
  }

  .item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .item-name {
    font-size: 1rem;
    font-weight: 600;
    color: white;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .item-sub {
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .item-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .meta-main {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .meta-sub {
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .badge-banned {
    background: var(--danger);
    color: white;
    font-size: 0.6rem;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .badge-banned.sm {
    padding: 1px 4px;
    font-size: 0.55rem;
  }

  /* Back button */
  .back-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    margin-bottom: 20px;
    padding: 0;
  }

  .back-btn:hover {
    text-decoration: underline;
  }

  /* User Detail */
  .user-detail-card {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .detail-header {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .detail-avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--bg-mid);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .detail-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .detail-names {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .detail-display {
    font-size: 1.25rem;
    font-weight: 700;
    color: white;
  }

  .detail-username {
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .detail-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
  }

  .field-value {
    color: white;
    font-weight: 500;
  }

  .field-value.mono {
    font-family: monospace;
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .server-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }

  .server-tag {
    background: var(--bg-mid);
    border: 1px solid var(--border);
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  /* Role toggles */
  .role-toggles {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }

  .role-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-mid);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--text-muted);
    font-family: inherit;
  }

  .role-toggle:hover {
    background: var(--bg-light);
    border-color: var(--text-dim);
  }

  .role-toggle.active {
    border-color: var(--accent);
    background: rgba(124, 92, 252, 0.08);
  }

  .role-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .role-name {
    font-weight: 600;
    color: var(--text);
    font-size: 0.9rem;
  }

  .pro-badge {
    display: inline-flex;
    align-items: center;
    color: #f59e0b;
    margin-left: 4px;
    font-size: 0.85rem;
  }

  .role-status {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .role-toggle.active .role-status {
    color: var(--accent);
  }

  .detail-footer {
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }

  .btn-danger {
    background: var(--danger);
    color: white;
    padding: 10px 24px;
    border-radius: 4px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .btn-danger:hover {
    filter: brightness(1.1);
  }

  .btn-danger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
