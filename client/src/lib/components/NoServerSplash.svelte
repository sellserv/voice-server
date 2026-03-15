<script lang="ts">
  import { servers, loadServers, isDmView } from '$lib/stores/servers';
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
  <div class="splash-inner">
    <h1 class="splash-heading">Get Started</h1>

    <div class="action-cards">
      <button class="action-card" onclick={() => (showCreateModal = true)}>
        <div class="card-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
        <span class="card-label">Create a Server</span>
      </button>

      <div class="action-card join-card">
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
          <button type="submit" class="inline-btn" disabled={joiningServer || !inviteCode.trim()}>
            {joiningServer ? 'Joining...' : 'Join'}
          </button>
        </form>
      </div>
    </div>

    <div class="friend-section">
      <h2 class="section-heading">Add some friends</h2>
      <form class="inline-form" onsubmit={(e) => { e.preventDefault(); handleAddFriend(); }}>
        <input
          type="text"
          bind:value={friendUsername}
          placeholder="Enter a username"
          class="inline-input"
        />
        <button type="submit" class="inline-btn" disabled={!friendUsername.trim()}>
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
    padding: 40px;
    background: var(--bg-dark);
  }

  .splash-inner {
    max-width: 540px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .splash-heading {
    margin: 0;
    font-size: 2rem;
    font-weight: 800;
    color: white;
    text-align: center;
    letter-spacing: -0.02em;
  }

  .action-cards {
    display: flex;
    gap: 20px;
  }

  .action-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 32px 20px;
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
    text-align: center;
    border: none;
  }

  button.action-card {
    background: var(--bg-darker);
    color: inherit;
  }

  button.action-card:hover {
    background: var(--bg-hover);
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
  }

  .join-card {
    cursor: default;
    background: var(--bg-darker);
  }

  .card-icon {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    transition: all 0.2s;
  }

  .action-card:hover .card-icon {
    background: var(--accent);
    color: white;
    transform: scale(1.1) rotate(5deg);
  }

  .card-label {
    font-size: 1.1rem;
    font-weight: 700;
    color: white;
  }

  .section-heading {
    margin: 0 0 16px;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-align: center;
  }

  .inline-form {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  .inline-input {
    flex: 1;
    padding: 12px 16px;
    background: var(--bg-darkest);
    color: white;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: var(--font-md);
    outline: none;
    transition: all 0.2s;
  }

  .inline-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .inline-btn {
    padding: 12px 24px;
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: var(--font-md);
    border-radius: 4px;
    white-space: nowrap;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .inline-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--shadow-glow);
  }

  .inline-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .friend-section {
    background: var(--bg-darker);
    padding: 24px;
    border-radius: 12px;
    border: 1px solid var(--border);
  }
</style>
