<script lang="ts">
  import { sendWs } from '$lib/ws';

  let { channelId, onclose }: { channelId: string; onclose?: () => void } = $props();

  const effects = [
    { id: 'confetti', label: 'Confetti', icon: '🎊' },
    { id: 'fireworks', label: 'Fireworks', icon: '🎆' },
    { id: 'hearts', label: 'Hearts', icon: '❤️' },
    { id: 'snow', label: 'Snow', icon: '❄️' },
    { id: 'money', label: 'Money', icon: '💸' },
  ];

  function sendEffect(effectId: string) {
    sendWs({ type: 'effect:send', channelId, effect: effectId });
  }
</script>

<div class="effects-panel">
  <div class="effects-header">
    <span>Effects</span>
    <button class="close-btn" onclick={() => onclose?.()}>&times;</button>
  </div>
  <div class="effects-grid">
    {#each effects as effect (effect.id)}
      <button class="effect-btn" onclick={() => sendEffect(effect.id)}>
        <span class="effect-icon">{effect.icon}</span>
        <span class="effect-label">{effect.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .effects-panel {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 8px;
    z-index: 100;
    width: 280px;
    max-width: calc(100vw - 28px);
    background: var(--bg-dark);
    border: 1px solid var(--border-light);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--shadow);
    animation: slideUp 200ms var(--ease-out);
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .effects-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
  }

  .close-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    font-size: 16px;
    cursor: pointer;
  }

  .close-btn:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .effects-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 12px;
  }

  .effect-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 14px 8px;
    background: var(--bg-mid);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all 150ms var(--ease-out);
  }

  .effect-btn:hover {
    background: var(--bg-hover);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .effect-btn:active {
    transform: translateY(0);
  }

  .effect-icon {
    font-size: 1.6rem;
    line-height: 1;
  }

  .effect-label {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text);
  }
</style>
