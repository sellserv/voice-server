<script lang="ts">
  import { createChannel, channelGroups } from '$lib/stores/channels';

  let { onclose }: { onclose: () => void } = $props();

  let name = $state('');
  let type = $state<'text' | 'voice'>('text');
  let groupId = $state('');
  let error = $state('');
  let loading = $state(false);

  async function handleSubmit() {
    error = '';
    loading = true;
    try {
      await createChannel(name, type, groupId || null);
      onclose();
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <h3>Create Channel</h3>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <label class="field">
        <span>Channel Name</span>
        <input type="text" bind:value={name} placeholder="channel-name" required maxlength="32" />
      </label>

      <div class="type-picker">
        <label class:selected={type === 'text'}>
          <input type="radio" bind:group={type} value="text" />
          <span class="type-icon"
            ><svg
              class="svg-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line
                x1="10"
                y1="3"
                x2="8"
                y2="21"
              /><line x1="16" y1="3" x2="14" y2="21" /></svg
            ></span
          > Text
        </label>
        <label class:selected={type === 'voice'}>
          <input type="radio" bind:group={type} value="voice" />
          <span class="type-icon"
            ><svg
              class="svg-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path
                d="M19.07 4.93a10 10 0 0 1 0 14.14"
              /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></svg
            ></span
          > Voice
        </label>
      </div>

      {#if $channelGroups.length > 0}
        <label class="field">
          <span>Group</span>
          <select class="group-select" bind:value={groupId}>
            <option value="">No Group</option>
            {#each $channelGroups as group (group.id)}
              <option value={group.id}>{group.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <button type="button" class="cancel-btn" onclick={onclose}>Cancel</button>
        <button type="submit" class="create-btn" disabled={loading}>
          {loading ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
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
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
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

  h3 {
    font-size: 1.2rem;
    margin-bottom: 20px;
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

  .type-picker {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .type-picker label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px;
    background: var(--bg-mid);
    border-radius: var(--radius);
    cursor: pointer;
    border: 1px solid var(--border);
    transition: all 150ms var(--ease-out);
  }

  .type-picker label.selected {
    border-color: var(--accent);
    background: var(--accent-subtle);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .type-picker input[type='radio'] {
    display: none;
  }

  .type-icon {
    display: inline-flex;
    align-items: center;
  }

  .svg-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .group-select {
    padding: 10px 14px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    font-family: var(--font);
    font-size: 14px;
    cursor: pointer;
    transition: all 150ms var(--ease-out);
  }

  .group-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
    outline: none;
  }

  .error {
    color: var(--danger);
    font-size: 0.85rem;
    margin-bottom: 12px;
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
</style>
