<script lang="ts">
  import { toasts, removeToast, confirmDialog, type ConfirmState } from '$lib/stores/toast';

  function handleConfirm(state: ConfirmState, confirmed: boolean) {
    state.resolve(confirmed);
    $confirmDialog = null;
  }
</script>

{#if $toasts.length > 0}
  <div class="toast-container" aria-live="polite">
    {#each $toasts as t (t.id)}
      <div class="toast toast-{t.type}" role="alert">
        <span class="toast-message">{t.message}</span>
        <button class="toast-close" onclick={() => removeToast(t.id)}>&times;</button>
        {#if t.duration > 0}
          <div class="toast-progress" style="animation-duration: {t.duration}ms"></div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if $confirmDialog}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="confirm-overlay"
    onclick={() => handleConfirm($confirmDialog!, false)}
    onkeydown={(e) => e.key === 'Escape' && handleConfirm($confirmDialog!, false)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="confirm-modal" onclick={(e) => e.stopPropagation()}>
      {#if $confirmDialog.title}
        <h3 class="confirm-title">{$confirmDialog.title}</h3>
      {/if}
      <p class="confirm-message">{$confirmDialog.message}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" onclick={() => handleConfirm($confirmDialog!, false)}
          >Cancel</button
        >
        <button
          class="confirm-btn"
          class:danger={$confirmDialog.dangerAction}
          onclick={() => handleConfirm($confirmDialog!, true)}
        >
          {$confirmDialog.confirmLabel || 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    left: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    max-width: 400px;
    margin-left: auto;
  }

  .toast {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    animation: toastIn 200ms var(--ease-out);
    font-size: 0.9rem;
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateX(40px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .toast-info {
    background: var(--glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border-bright);
    color: var(--text);
  }

  .toast-success {
    background: var(--glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border-bright);
    border-left: 3px solid var(--success);
    color: var(--success);
  }

  .toast-error {
    background: var(--glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border-bright);
    border-left: 3px solid var(--danger);
    color: var(--danger);
  }

  .toast-warning {
    background: var(--glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border-bright);
    border-left: 3px solid var(--warning);
    color: var(--warning);
  }

  .toast-message {
    flex: 1;
  }

  .toast-close {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-dim);
    border-radius: 4px;
    font-size: 1.1rem;
    flex-shrink: 0;
  }

  .toast-close:hover {
    color: var(--text);
  }

  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: currentColor;
    opacity: 0.3;
    transform-origin: left;
    animation: progressShrink linear forwards;
  }

  @keyframes progressShrink {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }

  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: overlayIn 150ms var(--ease-out);
  }

  @keyframes overlayIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .confirm-modal {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-lg);
    padding: 24px;
    width: 100%;
    max-width: 380px;
    box-shadow: var(--glass-shadow), var(--glass-glow);
    animation: modalIn 150ms var(--ease-out);
  }

  @keyframes modalIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .confirm-title {
    font-size: 1.1rem;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .confirm-message {
    font-size: 0.9rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin-bottom: 20px;
  }

  .confirm-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .confirm-cancel {
    padding: 8px 16px;
    background: var(--bg-light);
    color: var(--text-muted);
    border-radius: var(--radius);
    transition: all 150ms var(--ease-out);
  }

  .confirm-cancel:hover {
    background: var(--bg-hover);
  }

  .confirm-btn {
    padding: 8px 20px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    border-radius: var(--radius);
    box-shadow: 0 0 16px var(--accent-glow);
    transition: all 150ms var(--ease-out);
  }

  .confirm-btn:hover {
    background: var(--accent-hover);
    box-shadow: 0 0 24px var(--accent-glow);
  }

  .confirm-btn.danger {
    background: var(--danger);
  }

  .confirm-btn.danger:hover {
    background: var(--danger-hover);
  }
</style>
