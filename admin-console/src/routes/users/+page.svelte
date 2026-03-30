<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';

  let { data } = $props();

  let users = $derived(data.users);
  let roles = $derived(data.roles);
  let selectedUser = $derived(data.selectedUser);
  let selectedUserGlobalRoles = $derived(data.selectedUserGlobalRoles);
  let apiUrl = $derived(data.apiUrl);

  let userSearch = $state('');
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

  function resolveAvatar(path: string | null | undefined): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${apiUrl}${path}`;
  }

  function formatDate(iso: string) {
    return new Date(iso + 'Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function selectUser(userId: string) {
    goto(`/users?userId=${userId}`);
  }

  function deselectUser() {
    goto('/users');
  }
</script>

<h3 class="content-title">Users</h3>

{#if selectedUser}
  <button class="back-btn" onclick={deselectUser}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(90deg)"><polyline points="6 9 12 15 18 9"></polyline></svg>
    Back to users
  </button>

  <div class="user-detail-card">
    <div class="detail-header">
      <div class="detail-avatar">
        {#if selectedUser.avatar_url}
          <img src={resolveAvatar(selectedUser.avatar_url)} alt="" />
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
        <span class="section-title">Servers &mdash; {selectedUser.servers.length}</span>
        <div class="server-tags">
          {#each selectedUser.servers as s}
            <span class="server-tag">{s.name}</span>
          {/each}
        </div>
      </div>
    {/if}

    {#if roles.length > 0}
      <div class="detail-section">
        <span class="section-title">Global Roles</span>
        <div class="role-toggles">
          {#each roles as role (role.id)}
            {@const hasRole = selectedUserGlobalRoles.includes(role.id)}
            <form
              method="POST"
              action="?/toggleRole"
              use:enhance={() => {
                actionLoading = role.id;
                return async ({ update }) => {
                  await update();
                  await invalidateAll();
                  actionLoading = '';
                };
              }}
            >
              <input type="hidden" name="userId" value={selectedUser.id} />
              <input type="hidden" name="roleId" value={role.id} />
              <input type="hidden" name="action" value={hasRole ? 'remove' : 'add'} />
              <button
                type="submit"
                class="role-toggle"
                class:active={hasRole}
                disabled={actionLoading === role.id}
              >
                <span class="role-dot" style:background={role.color}></span>
                <span class="role-name">{role.name}</span>
                {#if role.pro}
                  <span class="pro-badge" title="Pro"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>
                {/if}
                <span class="role-status">
                  {hasRole ? 'Assigned' : 'Not assigned'}
                </span>
              </button>
            </form>
          {/each}
        </div>
      </div>
    {/if}

    <div class="detail-footer">
      <form
        method="POST"
        action={selectedUser.banned ? '?/unban' : '?/ban'}
        use:enhance={() => {
          actionLoading = selectedUser.id;
          return async ({ update }) => {
            await update();
            await invalidateAll();
            actionLoading = '';
          };
        }}
      >
        <input type="hidden" name="userId" value={selectedUser.id} />
        <button
          type="submit"
          class="btn-danger"
          disabled={actionLoading === selectedUser.id}
        >
          {selectedUser.banned ? 'Unban User' : 'Ban from Platform'}
        </button>
      </form>
    </div>
  </div>
{:else}
  <input
    type="text"
    class="search-input"
    placeholder="Search users by name, username, or email..."
    bind:value={userSearch}
  />
  <div class="admin-list">
    {#each filteredUsers as user (user.id)}
      <button class="list-item clickable" onclick={() => selectUser(user.id)}>
        <div class="item-avatar">
          {#if user.avatar_url}
            <img src={resolveAvatar(user.avatar_url)} alt="" />
          {:else}
            <span class="avatar-initial">{user.username.charAt(0).toUpperCase()}</span>
          {/if}
        </div>
        <div class="item-info">
          <span class="item-name">
            {user.display_name || user.username}
            {#if user.banned}<span class="badge-banned sm">BANNED</span>{/if}
          </span>
          <span class="item-sub">@{user.username} &middot; {user.message_count} messages</span>
        </div>
        <div class="item-meta">
          <span class="meta-main">{user.server_count} servers</span>
          <span class="meta-sub">{formatDate(user.created_at)}</span>
        </div>
      </button>
    {/each}
  </div>
{/if}

<style>
  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  /* Search */
  .search-input {
    width: 100%;
    padding: 10px 14px;
    background: var(--bg-darker);
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
    color: inherit;
    font-family: inherit;
  }

  .list-item.clickable { cursor: pointer; }
  .list-item:hover { background: var(--bg-hover); }

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

  .item-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .avatar-initial { font-weight: 700; color: var(--text-dim); }

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

  .item-sub { font-size: 0.8rem; color: var(--text-dim); }

  .item-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .meta-main { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
  .meta-sub { font-size: 0.75rem; color: var(--text-dim); }

  .badge-banned {
    background: var(--danger);
    color: white;
    font-size: 0.6rem;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .badge-banned.sm { padding: 1px 4px; font-size: 0.55rem; }

  /* User Detail */
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
    font-family: inherit;
  }

  .back-btn:hover { text-decoration: underline; }

  .user-detail-card {
    background: var(--bg-darker);
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

  .detail-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .detail-names {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .detail-display {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
  }

  .detail-username {
    font-size: 0.9rem;
    color: var(--text-dim);
  }

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .detail-field { display: flex; flex-direction: column; gap: 4px; }

  .field-label { font-size: 0.7rem; font-weight: 800; color: var(--text-dim); text-transform: uppercase; }
  .field-value { color: white; font-weight: 500; }
  .field-value.mono { font-family: monospace; }

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
    margin-bottom: 12px;
  }

  .server-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .server-tag {
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .detail-footer { padding-top: 20px; border-top: 1px solid var(--border); }

  .btn-danger {
    background: var(--danger); color: white; padding: 10px 24px;
    border-radius: 4px; font-weight: 600; border: none; cursor: pointer;
    font-family: inherit;
    font-size: 0.9rem;
  }

  .btn-danger:hover { filter: brightness(1.1); }
  .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

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
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    color: var(--text-muted);
    width: 100%;
    font-family: inherit;
    font-size: inherit;
  }

  .role-toggle:hover {
    background: var(--bg-hover);
    border-color: var(--text-dim);
  }

  .role-toggle.active {
    border-color: var(--accent);
    background: rgba(88, 101, 242, 0.08);
  }

  .role-toggle:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
  }

  .role-status {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .role-toggle.active .role-status {
    color: var(--accent);
  }

  form {
    display: contents;
  }
</style>
