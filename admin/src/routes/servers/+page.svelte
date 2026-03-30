<script lang="ts">
  import { api } from '$lib/api';

  const API_URL = import.meta.env.VITE_API_URL || '';

  let servers: any[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let actionLoading = $state('');

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
      servers = await api.get<any[]>('/api/admin/servers');
    } catch (e: any) {
      error = e.message || 'Failed to load servers';
    } finally {
      loading = false;
    }
  }

  async function handleDeleteServer(serverId: string, serverName: string) {
    if (!window.confirm(`Delete server "${serverName}"? This cannot be undone.`)) return;
    actionLoading = serverId;
    error = '';
    try {
      await api.delete(`/api/admin/servers/${serverId}`);
      servers = servers.filter(s => s.id !== serverId);
    } catch (e: any) {
      error = e?.message || 'Failed to delete server';
    } finally {
      actionLoading = '';
    }
  }

  $effect(() => {
    loadData();
  });
</script>

<h1 class="page-title">Servers</h1>

{#if loading}
  <div class="status-box">
    <p>Loading servers...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
    <button class="retry-btn" onclick={loadData}>Retry</button>
  </div>
{:else}
  <div class="admin-list">
    {#each servers as server (server.id)}
      <div class="list-item">
        <div class="item-avatar">
          {#if server.icon_url}
            <img src={avatarSrc(server.icon_url)} alt="" />
          {:else}
            <span class="avatar-initial">{server.name.charAt(0).toUpperCase()}</span>
          {/if}
        </div>
        <div class="item-info">
          <span class="item-name">{server.name}</span>
          <span class="item-sub">Owner: {server.owner_username || 'Unknown'} &middot; {server.channel_count} channels</span>
        </div>
        <div class="item-meta">
          <span class="meta-main">{server.member_count} members</span>
          <span class="meta-sub">{formatDate(server.created_at)}</span>
        </div>
        <button
          class="delete-btn"
          title="Delete server"
          disabled={actionLoading === server.id}
          onclick={() => handleDeleteServer(server.id, server.name)}
        >
          &#10005;
        </button>
      </div>
    {/each}
    {#if servers.length === 0}
      <div class="status-box"><p>No servers found.</p></div>
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
    transition: background 0.1s;
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

  .delete-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-dim);
    font-size: 0.85rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .delete-btn:hover {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  .delete-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
