<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  let servers = $derived(data.servers);
  let apiUrl = $derived(data.apiUrl);
  let actionLoading = $state('');

  function resolveIcon(path: string | null | undefined): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${apiUrl}${path}`;
  }

  function formatDate(iso: string) {
    return new Date(iso + 'Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function confirmDelete(serverName: string): boolean {
    return window.confirm(`Delete server "${serverName}"? This cannot be undone.`);
  }
</script>

<h3 class="content-title">Servers</h3>

<div class="admin-list">
  {#each servers as server (server.id)}
    <div class="list-item">
      <div class="item-avatar">
        {#if server.icon_url}
          <img src={resolveIcon(server.icon_url)} alt="" />
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
      <form
        method="POST"
        action="?/delete"
        use:enhance={({ cancel }) => {
          if (!confirmDelete(server.name)) {
            cancel();
            return;
          }
          actionLoading = server.id;
          return async ({ update }) => {
            await update();
            await invalidateAll();
            actionLoading = '';
          };
        }}
      >
        <input type="hidden" name="serverId" value={server.id} />
        <button
          type="submit"
          class="circle-btn danger"
          title="Delete server"
          disabled={actionLoading === server.id}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </form>
    </div>
  {:else}
    <div class="status-box"><p>No servers found.</p></div>
  {/each}
</div>

<style>
  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }

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

  .circle-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  form {
    display: contents;
  }
</style>
