<script lang="ts">
  import { updateReady } from '$lib/updater';
  import { openStoreUpdate } from '$lib/updater';

  let dismissed = $state(false);

  let show = $derived($updateReady?.store && !dismissed);
</script>

{#if show}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onkeydown={(e) => e.key === 'Escape' && (dismissed = true)}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3 class="title">Update Available</h3>
      <p class="message">A new version of SellServ Voice (v{$updateReady?.version}) is available in the Microsoft Store.</p>
      <div class="actions">
        <button class="btn later" onclick={() => (dismissed = true)}>Later</button>
        <button class="btn update" onclick={openStoreUpdate}>Update</button>
      </div>
    </div>
  </div>
{/if}

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
    z-index: 10000;
    animation: fadeIn 150ms var(--ease-out);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 32px;
    max-width: 400px;
    width: 90%;
    text-align: center;
    animation: scaleIn 150ms var(--ease-out);
  }

  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }

  .title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 12px;
  }

  .message {
    font-size: 0.9rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 24px;
  }

  .actions {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .btn {
    padding: 10px 28px;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .btn:hover {
    filter: brightness(1.1);
  }

  .later {
    background: var(--bg-light);
    color: var(--text-muted);
  }

  .update {
    background: var(--accent);
    color: white;
  }
</style>
