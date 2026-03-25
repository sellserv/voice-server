<script lang="ts">
  import { loadServers } from '$lib/stores/servers';
  import { sendFriendRequest, loadPendingRequests } from '$lib/stores/friends';

  import { currentUser } from '$lib/stores/auth';
  import { api } from '$lib/api';
  import { toast } from '$lib/stores/toast';
  import CreateServerModal from '$lib/components/CreateServerModal.svelte';

  let showCreateModal = $state(false);
  let inviteCode = $state('');
  let joiningServer = $state(false);
  let friendUsername = $state('');

  async function handleJoinServer() {
    if (!inviteCode.trim()) return;
    joiningServer = true;
    try {
      await api.post('/api/servers/join', { invite_code: inviteCode.trim() });
      await loadServers();
      inviteCode = '';
      toast.success('Joined server!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to join');
    } finally {
      joiningServer = false;
    }
  }

  async function handleAddFriend() {
    if (!friendUsername.trim()) return;
    try {
      const user = await api.get<{ id: string; username: string; display_name: string }>(`/api/users/lookup?username=${encodeURIComponent(friendUsername.trim())}`);
      if (user.id === $currentUser?.id) {
        toast.error("Can't add yourself");
        return;
      }
      await sendFriendRequest(user.id);
      await loadPendingRequests();
      friendUsername = '';
      toast.success('Friend request sent!');
    } catch (err: any) {
      toast.error(err.message || 'User not found');
    }
  }
</script>

<div class="splash-container">
  <div class="splash-inner glass-panel" style="padding: 60px; background: rgba(255, 255, 255, 0.015);">
    <h1 class="splash-heading">Get Started</h1>

    <div class="action-cards">
      <button class="action-card glass-panel" onclick={() => (showCreateModal = true)}>
        <div class="card-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <span class="card-label">Create a Server</span>
      </button>

      <div class="action-card join-card glass-panel">
        <div class="card-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </div>
        <span class="card-label">Join a Server</span>
        <form class="inline-form" onsubmit={(e) => { e.preventDefault(); handleJoinServer(); }}>
          <input
            type="text"
            bind:value={inviteCode}
            placeholder="Invite code"
            class="inline-input"
          />
          <button type="submit" class="inline-btn btn-accent" disabled={joiningServer || !inviteCode.trim()}>
            {joiningServer ? 'Joining...' : 'Join'}
          </button>
        </form>
      </div>
    </div>

    <div class="friend-section glass-panel" style="background: rgba(0,0,0,0.2);">
      <h2 class="section-heading">Add some friends</h2>
      <form class="inline-form" onsubmit={(e) => { e.preventDefault(); handleAddFriend(); }}>
        <input
          type="text"
          bind:value={friendUsername}
          placeholder="Enter a username"
          class="inline-input"
        />
        <button type="submit" class="inline-btn btn-accent" disabled={!friendUsername.trim()}>
          Send Request
        </button>
      </form>
    </div>
  </div>
</div>

{#if showCreateModal}
  <CreateServerModal onclose={() => (showCreateModal = false)} />
{/if}

<style>
  .splash-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--space-8);
    background: var(--bg-darkest);
  }

  .splash-inner {
    max-width: 680px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    border-radius: var(--radius-lg);
    animation: splashIn 0.5s var(--ease-out);
  }

  @keyframes splashIn {
    from { opacity: 0; transform: scale(0.98) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .splash-heading {
    margin: 0;
    font-size: 2.2rem;
    font-weight: 800;
    color: white;
    text-align: center;
    letter-spacing: -0.03em;
  }

  .action-cards {
    display: flex;
    gap: var(--space-5);
  }

  .action-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
    padding: var(--space-8) var(--space-5);
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.3s var(--ease-out);
    text-align: center;
  }

  button.action-card {
    color: inherit;
  }

  button.action-card:hover {
    background: var(--bg-hover);
    transform: translateY(-6px);
    border-color: var(--accent-subtle);
    box-shadow: var(--shadow-lg);
  }

  .join-card {
    cursor: default;
    background: rgba(255, 255, 255, 0.03);
  }

  .card-icon {
    width: 64px; height: 64px;
    border-radius: 18px;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    transition: all 0.4s var(--ease-elastic);
  }

  .action-card:hover .card-icon {
    background: var(--accent);
    color: white;
    transform: scale(1.1) rotate(5deg);
    box-shadow: 0 4px 15px var(--accent-glow);
  }

  .card-label {
    font-size: 1.15rem;
    font-weight: 800;
    color: white;
    letter-spacing: -0.01em;
  }

  .section-heading {
    margin: 0 0 var(--space-4);
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-dim);
    text-align: center;
  }

  .inline-form {
    display: flex;
    gap: var(--space-3);
    width: 100%;
  }

  .inline-input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
  }

  .inline-btn {
    padding: 12px 24px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 800;
  }

  .friend-section {
    padding: var(--space-7);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
  }

  @media (max-width: 640px) {
    .action-cards {
      flex-direction: column;
    }
  }
</style>
