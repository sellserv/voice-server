<script lang="ts">
  import { api } from '$lib/api';
  import { getActiveServerId } from '$lib/stores/servers';
  import { showPollsPanel } from '$lib/stores/media';
  import { channels, activeChannelId } from '$lib/stores/channels';
  import { toast } from '$lib/stores/toast';
  import Icon from './Icon.svelte';

  // Create form state
  let question = $state('');
  let options = $state(['', '']);
  let allowMultiple = $state(false);
  let selectedChannelId = $state<string | null>(null);
  let creating = $state(false);

  const serverId = getActiveServerId();
  const textChannels = $derived($channels.filter(c => c.type === 'text'));

  // Auto-select active channel, fall back to first text channel
  $effect(() => {
    if (!selectedChannelId) {
      const active = $activeChannelId;
      const isText = textChannels.find(c => c.id === active);
      selectedChannelId = isText ? active : (textChannels[0]?.id ?? null);
    }
  });

  function addOption() {
    if (options.length < 10) options.push('');
  }

  function removeOption(idx: number) {
    if (options.length > 2) options.splice(idx, 1);
  }

  async function handleCreate() {
    if (!question.trim() || options.filter(o => o.trim()).length < 2 || !selectedChannelId) return;
    creating = true;
    try {
      await api.post(`/api/servers/${serverId}/polls`, {
        question: question.trim(),
        options: options.filter(o => o.trim()),
        allow_multiple: allowMultiple,
        channel_id: selectedChannelId
      });
      
      // Reset form
      question = '';
      options = ['', ''];
      allowMultiple = false;
      
      toast.success('Poll posted to chat!');
      $showPollsPanel = false; // Close panel after posting
    } catch (err: any) {
      toast.error('Failed to create poll: ' + err.message);
    } finally {
      creating = false;
    }
  }
</script>

<div class="poll-panel">
  <div class="panel-header">
    <div class="header-left">
      <Icon name="bar-chart" size={20} />
      <span class="header-title">Create Poll</span>
    </div>
    <div class="header-actions">
      <button class="icon-btn" onclick={() => $showPollsPanel = false}>
        <Icon name="chevron-down" size={18} />
      </button>
    </div>
  </div>

  <div class="panel-content scrollable">
    <div class="create-poll-form animate-in">
      <div class="form-group">
        <label for="poll-q">Question</label>
        <input
          id="poll-q"
          type="text"
          class="text-input"
          placeholder="What's on your mind?"
          bind:value={question}
          autofocus
        />
      </div>

      <div class="form-group">
        <label>Options</label>
        <div class="options-list">
          {#each options as opt, i}
            <div class="option-row">
              <input
                type="text"
                class="text-input"
                placeholder="Option {i + 1}"
                bind:value={options[i]}
              />
              {#if options.length > 2}
                <button class="remove-opt" onclick={() => removeOption(i)}>
                  <Icon name="trash" size={14} />
                </button>
              {/if}
            </div>
          {/each}
        </div>
        {#if options.length < 10}
          <button class="btn-add-opt" onclick={addOption}>
            <Icon name="plus" size={14} />
            <span>Add Option</span>
          </button>
        {/if}
      </div>

      <div class="form-group">
        <label for="poll-channel">Post to Channel</label>
        <select id="poll-channel" bind:value={selectedChannelId} class="select-input">
          {#each textChannels as ch}
            <option value={ch.id}>#{ch.name}</option>
          {/each}
        </select>
      </div>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={allowMultiple} />
        <span>Allow multiple answers</span>
      </label>

      <div class="expiry-note">
        <Icon name="info" size={14} />
        <span>Polls automatically expire after 24 hours.</span>
      </div>

      <button 
        class="btn-submit" 
        onclick={handleCreate} 
        disabled={creating || !question.trim() || options.filter(o => o.trim()).length < 2 || !selectedChannelId}
      >
        {creating ? 'Posting...' : 'Post Poll to Chat'}
      </button>
    </div>
  </div>
</div>

<style>
  .poll-panel {
    display: flex;
    flex-direction: column;
    height: 500px;
    max-height: 80vh;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--accent);
  }

  .header-title {
    font-weight: 800;
    font-size: 1.1rem;
    color: white;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    background: rgba(255, 255, 255, 0.05);
    border: none;
    border-radius: 8px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .create-poll-form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-group label {
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .text-input {
    padding: 12px 16px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: white;
    font-size: 0.95rem;
    outline: none;
    transition: all 0.2s;
  }

  .text-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .select-input {
    padding: 10px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: white;
    font-size: 0.9rem;
    outline: none;
  }
  
  .select-input:focus {
    border-color: var(--accent);
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option-row {
    display: flex;
    gap: 8px;
  }

  .remove-opt {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0 8px;
  }

  .remove-opt:hover { color: var(--danger); }

  .btn-add-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 4px;
  }

  .btn-add-opt:hover { border-color: var(--accent); color: var(--accent); }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .expiry-note {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    background: rgba(59, 130, 246, 0.05);
    border: 1px solid rgba(59, 130, 246, 0.1);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 0.8rem;
    font-weight: 500;
  }

  .btn-submit {
    padding: 12px;
    background: var(--accent);
    color: white;
    font-weight: 700;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 8px;
  }

  .btn-submit:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: var(--shadow-glow);
  }

  .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

  .animate-in {
    animation: fadeIn 0.3s var(--ease-out);
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
