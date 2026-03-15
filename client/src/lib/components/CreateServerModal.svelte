<script lang="ts">
  import { createServer, joinServer, switchServer } from '$lib/stores/servers';
  import { toast } from '$lib/stores/toast';

  let { onclose }: { onclose: () => void } = $props();

  let mode = $state<'create' | 'join'>('create');
  let serverName = $state('');
  let inviteCode = $state('');
  let loading = $state(false);

  async function handleCreate() {
    if (!serverName.trim()) return;
    loading = true;
    try {
      const server = await createServer(serverName.trim());
      toast.success('Server created!');
      onclose();
      switchServer(server.id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      loading = false;
    }
  }

  async function handleJoin() {
    if (!inviteCode.trim()) return;
    loading = true;
    try {
      const server = await joinServer(inviteCode.trim());
      toast.success('Joined server!');
      onclose();
      switchServer(server.id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      loading = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <h3>{mode === 'create' ? 'Create a Server' : 'Join a Server'}</h3>

    <div class="tab-bar">
      <button
        class="tab"
        class:active={mode === 'create'}
        onclick={() => (mode = 'create')}
      >Create</button>
      <button
        class="tab"
        class:active={mode === 'join'}
        onclick={() => (mode = 'join')}
      >Join</button>
    </div>

    {#if mode === 'create'}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <label class="field">
          <span>Server Name</span>
          <input
            type="text"
            bind:value={serverName}
            placeholder="My Awesome Server"
            required
            maxlength="64"
            autofocus
          />
        </label>

        <div class="actions">
          <button type="button" class="cancel-btn" onclick={onclose}>Cancel</button>
          <button type="submit" class="create-btn" disabled={loading || !serverName.trim()}>
            {loading ? 'Creating...' : 'Create Server'}
          </button>
        </div>
      </form>
    {:else}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleJoin();
        }}
      >
        <label class="field">
          <span>Invite Code</span>
          <input
            type="text"
            bind:value={inviteCode}
            placeholder="Enter an invite code"
            required
            maxlength="64"
            autofocus
          />
        </label>

        <div class="actions">
          <button type="button" class="cancel-btn" onclick={onclose}>Cancel</button>
          <button type="submit" class="create-btn" disabled={loading || !inviteCode.trim()}>
            {loading ? 'Joining...' : 'Join Server'}
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
    animation: overlayIn 150ms var(--ease-out);
  }

  .modal {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-lg);
    padding: 28px;
    width: 100%;
    max-width: 380px;
    box-shadow: var(--glass-shadow), var(--glass-glow);
    animation: modalIn 150ms var(--ease-out);
  }

  @keyframes overlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.95) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  h3 {
    font-size: 1.2rem;
    margin-bottom: 16px;
  }

  .tab-bar {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
    background: var(--bg-mid);
    border-radius: var(--radius);
    padding: 3px;
  }

  .tab {
    flex: 1;
    padding: 8px 12px;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 600;
    transition: all 150ms var(--ease-out);
  }

  .tab.active {
    background: var(--accent);
    color: white;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .tab:not(.active):hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .field span {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .field input {
    padding: 10px 14px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    transition: all 150ms var(--ease-out);
  }

  .field input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
    outline: none;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .cancel-btn {
    padding: 8px 16px;
    background: var(--bg-light);
    color: var(--text-muted);
    border-radius: var(--radius);
    transition: all 150ms var(--ease-out);
  }

  .cancel-btn:hover {
    background: var(--bg-hover);
  }

  .create-btn {
    padding: 8px 20px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    border-radius: var(--radius);
    box-shadow: 0 0 16px var(--accent-glow);
    transition: all 150ms var(--ease-out);
  }

  .create-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 0 24px var(--accent-glow);
    transform: translateY(-1px);
  }

  .create-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
