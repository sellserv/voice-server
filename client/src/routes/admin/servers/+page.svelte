<script lang="ts">
  import { api } from '$lib/api';
  import { resolveAsset } from '$lib/stores/server';
  import Icon from '$lib/components/Icon.svelte';

  let servers: any[] = $state([]);
  let stats: any = $state(null);
  let loading = $state(true);
  let error = $state('');

  // Action states
  let actionLoading = $state('');

  async function loadData() {
    loading = true;
    error = '';
    try {
      const [s, st] = await Promise.all([
        api.get<any[]>('/api/admin/servers'),
        api.get<any>('/api/admin/stats'),
      ]);
      servers = s;
      stats = st;
    } catch (e: any) {
      error = e.message || 'Failed to load data';
    } finally {
      loading = false;
    }
  }

  async function handleDeleteServer(serverId: string, serverName: string) {
    if (!confirm(`Delete server "${serverName}"? This cannot be undone.`)) return;
    actionLoading = serverId;
    error = '';
    try {
      await api.delete(`/api/admin/servers/${serverId}`);
      servers = servers.filter(s => s.id !== serverId);
      stats = await api.get<any>('/api/admin/stats');
    } catch (e: any) {
      error = e?.message || 'Failed to delete server';
    } finally {
      actionLoading = '';
    }
  }

  function formatDate(iso: string) {
    return new Date(iso + 'Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  $effect(() => {
    loadData();
  });
</script>

<h3 class="content-title">Servers</h3>

{#if loading}
  <div class="status-box">
    <div class="spinner"></div>
    <p>Loading servers...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
  </div>
{:else}
  <div class="admin-list">
    {#each servers as server (server.id)}
      <div class="list-item">
        <div class="item-avatar">
          {#if server.icon_url}
            <img src={resolveAsset(server.icon_url)} alt="" />
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
          class="circle-btn danger"
          title="Delete server"
          disabled={actionLoading === server.id}
          onclick={() => handleDeleteServer(server.id, server.name)}
        >
          <Icon name="x" size={16} />
        </button>
      </div>
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

  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }
  .spinner {
    width: 32px; height: 32px; border: 3px solid var(--bg-light);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

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
  }

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

  .circle-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .circle-btn:hover {
    background: var(--bg-light);
    color: var(--text);
  }

  .circle-btn.danger:hover {
    background: var(--danger);
    color: white;
  }
</style>
