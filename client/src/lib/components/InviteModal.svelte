<script lang="ts">
  import { api } from '$lib/api';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId } from '$lib/stores/servers';
  import { toast } from '$lib/stores/toast';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let inviteSearch = $state('');
  let inviteResults = $state<{ id: string; username: string; display_name: string; avatar_url: string | null }[]>([]);
  let inviteSearching = $state(false);
  let inviteSending = $state<string | null>(null);
  let inviteTimeout: ReturnType<typeof setTimeout> | null = null;

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
    } catch (e: any) {
      toast.error(e.message || 'Failed to send invite');
    } finally {
      inviteSending = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={onclose}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <div class="header-title">
        <Icon name="check" size={20} />
        <h3>Invite Friends</h3>
      </div>
      <button class="close-btn" onclick={onclose} aria-label="Close">
        <Icon name="x" size={20} />
      </button>
    </div>

    <div class="modal-body">
      <p class="subtitle">Search for friends by username to invite them to this server.</p>
      
      <div class="search-input-wrap">
        <input
          type="text"
          class="fancy-input"
          placeholder="Enter a username..."
          value={inviteSearch}
          oninput={(e) => searchInviteUsers(e.currentTarget.value)}
          autofocus
        />
        <Icon name="search" size={20} class="search-icon" />
      </div>

      <div class="results-area">
        {#if inviteSearching}
          <div class="status-box">
            <div class="spinner"></div>
            <span>Searching...</span>
          </div>
        {:else if inviteResults.length > 0}
          <div class="invite-results scrollable">
            {#each inviteResults as user (user.id)}
              <div class="invite-item">
                <div class="user-avatar">
                  {#if user.avatar_url}
                    <img src={resolveAsset(user.avatar_url)} alt="" />
                  {:else}
                    <span>{(user.display_name || user.username).charAt(0).toUpperCase()}</span>
                  {/if}
                </div>
                <div class="user-names">
                  <span class="display-name">{user.display_name || user.username}</span>
                  <span class="username">@{user.username}</span>
                </div>
                <button
                  class="invite-btn"
                  onclick={() => sendInvite(user.id)}
                  disabled={inviteSending === user.id}
                >
                  {inviteSending === user.id ? 'Sending...' : 'Invite'}
                </button>
              </div>
            {/each}
          </div>
        {:else if inviteSearch.trim()}
          <div class="status-box">
            <p>No users found matching "{inviteSearch}"</p>
          </div>
        {:else}
          <div class="empty-placeholder">
            <Icon name="users" size={48} class="placeholder-icon" />
            <p>Find people to chat with!</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    padding: 20px;
  }

  .modal-content {
    background: var(--bg-darker);
    border: 1px solid var(--glass-border-bright);
    border-radius: 16px;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    animation: modalIn 0.3s var(--ease-out);
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.95) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .modal-header {
    padding: 24px;
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 12px;
    color: white;
  }

  .header-title h3 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px;
    border-radius: 50%;
    transition: all 0.2s;
  }

  .close-btn:hover { background: rgba(255, 255, 255, 0.05); color: white; }

  .modal-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .subtitle {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
  }

  .search-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .fancy-input {
    width: 100%;
    padding: 14px 48px 14px 16px;
    background: var(--bg-darkest);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    color: white;
    font-size: 1rem;
    outline: none;
    transition: all 0.2s;
  }

  .fancy-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  .search-icon {
    position: absolute;
    right: 16px;
    color: var(--text-dim);
    pointer-events: none;
  }

  .results-area {
    min-height: 200px;
    max-height: 320px;
    display: flex;
    flex-direction: column;
  }

  .scrollable {
    overflow-y: auto;
    scrollbar-width: thin;
    padding-right: 4px;
  }

  .invite-results {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .invite-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 10px;
    transition: background 0.2s;
  }

  .invite-item:hover { background: rgba(255, 255, 255, 0.06); }

  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    overflow: hidden;
    flex-shrink: 0;
  }

  .user-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .user-names { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .display-name { font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .username { font-size: 0.8rem; color: var(--text-dim); }

  .invite-btn {
    padding: 8px 16px;
    background: var(--success);
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 800;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .invite-btn:hover:not(:disabled) {
    background: var(--success-hover);
    transform: translateY(-1px);
  }

  .invite-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .status-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-dim);
    text-align: center;
  }

  .empty-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    opacity: 0.5;
    gap: 12px;
  }

  .placeholder-icon { opacity: 0.2; }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
