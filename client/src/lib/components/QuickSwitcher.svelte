<script lang="ts">
  import { channels, dmChannels, activeChannelId } from '$lib/stores/channels';
  import { isDmView } from '$lib/stores/servers';
  import type { Channel } from '@voip-server/shared';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const filtered = $derived.by(() => {
    const q = query.toLowerCase().trim();
    const all: Channel[] = [...$channels, ...$dmChannels];
    if (!q) return all.slice(0, 8);
    return all.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 10);
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      select(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      onclose();
    }
  }

  function select(channel: Channel) {
    activeChannelId.set(channel.id);
    if (channel.type === 'dm') {
      isDmView.set(true);
    } else {
      isDmView.set(false);
    }
    onclose();
  }

  // Reset selection when query changes
  $effect(() => {
    query;
    selectedIndex = 0;
  });

  // Auto-focus input
  $effect(() => {
    inputEl?.focus();
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="qs-overlay" onclick={onclose} onkeydown={handleKeydown} role="dialog" aria-modal="true" aria-label="Quick Switcher">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="qs-modal" onclick={(e) => e.stopPropagation()}>
    <div class="qs-input-wrap">
      <Icon name="search" size={20} class="qs-search-icon" />
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder="Where would you like to go?"
        class="qs-input"
        onkeydown={handleKeydown}
      />
    </div>
    
    <div class="qs-results scrollable">
      {#if filtered.length > 0}
        <div class="qs-section-title">
          {query.trim() ? 'Search Results' : 'Recent Channels'}
        </div>
        {#each filtered as ch, i (ch.id)}
          <button 
            class="qs-result" 
            class:selected={i === selectedIndex} 
            onclick={() => select(ch)}
            onmouseenter={() => selectedIndex = i}
          >
            <div class="qs-icon-box">
              {#if ch.type === 'dm'}
                <Icon name="users" size={16} />
              {:else if ch.type === 'voice'}
                <Icon name="volume" size={16} />
              {:else}
                <Icon name="hash" size={16} />
              {/if}
            </div>
            <span class="qs-name">{ch.name}</span>
            {#if ch.type === 'dm'}
              <span class="qs-badge">DM</span>
            {/if}
            <div class="qs-enter-icon">
              <Icon name="arrow-right" size={14} />
            </div>
          </button>
        {/each}
      {:else}
        <div class="qs-empty">
          <Icon name="search" size={32} class="empty-icon" />
          <p>No channels found for "<strong>{query}</strong>"</p>
        </div>
      {/if}
    </div>

    <div class="qs-footer">
      <div class="qs-hints">
        <div class="qs-hint"><kbd>↑</kbd><kbd>↓</kbd> <span>to navigate</span></div>
        <div class="qs-hint"><kbd>↵</kbd> <span>to select</span></div>
        <div class="qs-hint"><kbd>esc</kbd> <span>to dismiss</span></div>
      </div>
    </div>
  </div>
</div>

<style>
  .qs-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
    z-index: 2000;
    animation: fadeIn 0.2s var(--ease-out);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .qs-modal {
    background: rgba(20, 20, 35, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    width: 90%;
    max-width: 560px;
    box-shadow: 
      0 30px 60px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    overflow: hidden;
    animation: qsIn 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes qsIn {
    from { opacity: 0; transform: translateY(-20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .qs-input-wrap {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px 24px;
    background: rgba(0, 0, 0, 0.2);
    border-bottom: 1px solid var(--border);
  }

  .qs-search-icon {
    color: var(--text-dim);
  }

  .qs-input {
    flex: 1;
    background: transparent;
    border: none;
    color: white;
    font-size: 1.25rem;
    font-weight: 500;
    outline: none;
  }

  .qs-input::placeholder {
    color: var(--text-dim);
    opacity: 0.5;
  }

  .qs-results {
    max-height: 420px;
    overflow-y: auto;
    padding: 12px;
  }

  .scrollable {
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .qs-section-title {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    padding: 8px 12px;
    margin-bottom: 4px;
  }

  .qs-result {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    transition: all 0.1s var(--ease-out);
    position: relative;
  }

  .qs-result:hover,
  .qs-result.selected {
    background: var(--bg-hover);
    color: white;
    transform: translateX(4px);
  }

  .qs-result.selected::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 8px;
    bottom: 8px;
    width: 4px;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
  }

  .qs-icon-box {
    width: 32px;
    height: 32px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    transition: all 0.1s;
  }

  .qs-result:hover .qs-icon-box,
  .qs-result.selected .qs-icon-box {
    background: var(--accent);
    color: white;
  }

  .qs-name {
    flex: 1;
    font-size: 1rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qs-badge {
    font-size: 0.65rem;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--bg-mid);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .qs-enter-icon {
    opacity: 0;
    color: var(--text-dim);
    transition: opacity 0.1s;
  }

  .qs-result.selected .qs-enter-icon {
    opacity: 1;
  }

  .qs-empty {
    padding: 60px 24px;
    text-align: center;
    color: var(--text-dim);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .empty-icon {
    opacity: 0.2;
  }

  .qs-footer {
    padding: 12px 24px;
    background: rgba(0, 0, 0, 0.1);
    border-top: 1px solid var(--border);
  }

  .qs-hints {
    display: flex;
    gap: 20px;
    justify-content: center;
  }

  .qs-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  kbd {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-family: inherit;
    font-size: 0.7rem;
    font-weight: 700;
    min-width: 20px;
    text-align: center;
  }
</style>
