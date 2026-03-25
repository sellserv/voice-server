<script lang="ts">
  import { 
    groupedChannels, 
    channelGroups, 
    reorderChannels, 
    moveChannelToGroup, 
    reorderChannelGroups,
    deleteChannel,
    deleteChannelGroup,
    createChannel,
    createChannelGroup
  } from '$lib/stores/channels';
  import { toast } from '$lib/stores/toast';
  import Icon from '../Icon.svelte';
  import { slide } from 'svelte/transition';

  let { serverId: _serverId }: { serverId: string } = $props();

  let showCreateChannel = $state(false);
  let newChannelName = $state('');
  let newChannelType = $state<'text' | 'voice'>('text');
  let newChannelGroupId = $state<string | null>(null);

  let showCreateGroup = $state(false);
  let newGroupName = $state('');

  async function moveGroup(groupId: string, direction: 'up' | 'bottom') {
    const currentGroups = [...$channelGroups].sort((a, b) => a.sort_order - b.sort_order);
    const idx = currentGroups.findIndex(g => g.id === groupId);
    if (idx === -1) return;

    if (direction === 'up' && idx > 0) {
      [currentGroups[idx], currentGroups[idx - 1]] = [currentGroups[idx - 1], currentGroups[idx]];
    } else if (direction === 'bottom' && idx < currentGroups.length - 1) {
      [currentGroups[idx], currentGroups[idx + 1]] = [currentGroups[idx + 1], currentGroups[idx]];
    } else {
      return;
    }

    try {
      await reorderChannelGroups(currentGroups.map(g => g.id));
    } catch (err: any) {
      toast.error('Failed to move group: ' + err.message);
    }
  }

  async function moveChannel(channelId: string, direction: 'up' | 'bottom', groupId: string | null) {
    const group = $groupedChannels.find(g => (g.group?.id ?? null) === groupId);
    if (!group) return;

    const currentChannels = [...group.channels];
    const idx = currentChannels.findIndex(c => c.id === channelId);
    if (idx === -1) return;

    if (direction === 'up' && idx > 0) {
      [currentChannels[idx], currentChannels[idx - 1]] = [currentChannels[idx - 1], currentChannels[idx]];
    } else if (direction === 'bottom' && idx < currentChannels.length - 1) {
      [currentChannels[idx], currentChannels[idx + 1]] = [currentChannels[idx + 1], currentChannels[idx]];
    } else {
      return;
    }

    try {
      await reorderChannels(currentChannels.map(c => c.id));
    } catch (err: any) {
      toast.error('Failed to move channel: ' + err.message);
    }
  }

  async function changeGroup(channelId: string, newGroupId: string | null) {
    try {
      await moveChannelToGroup(channelId, newGroupId);
      toast.success('Channel group updated');
    } catch (err: any) {
      toast.error('Failed to change group: ' + err.message);
    }
  }

  async function handleCreateChannel() {
    if (!newChannelName.trim()) return;
    try {
      await createChannel(newChannelName.trim(), newChannelType, newChannelGroupId);
      newChannelName = '';
      showCreateChannel = false;
      toast.success('Channel created');
    } catch (err: any) {
      toast.error('Failed to create channel: ' + err.message);
    }
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    try {
      await createChannelGroup(newGroupName.trim());
      newGroupName = '';
      showCreateGroup = false;
      toast.success('Group created');
    } catch (err: any) {
      toast.error('Failed to create group: ' + err.message);
    }
  }

  async function handleDeleteChannel(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete #${name}?`)) return;
    try {
      await deleteChannel(id);
      toast.success('Channel deleted');
    } catch (err: any) {
      toast.error('Failed to delete channel: ' + err.message);
    }
  }

  async function handleDeleteGroup(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete the group "${name}"? Channels inside will become ungrouped.`)) return;
    try {
      await deleteChannelGroup(id);
      toast.success('Group deleted');
    } catch (err: any) {
      toast.error('Failed to delete group: ' + err.message);
    }
  }
</script>

<div class="channel-management">
  <header class="mgmt-header">
    <div class="mgmt-title-row">
      <h2 class="mgmt-title">Channel Hierarchy</h2>
      <div class="header-actions">
        <button class="btn-action" onclick={() => showCreateChannel = true}>
          <Icon name="plus" size={16} />
          <span>New Channel</span>
        </button>
        <button class="btn-action" onclick={() => showCreateGroup = true}>
          <Icon name="plus" size={16} />
          <span>New Group</span>
        </button>
      </div>
    </div>
    <p class="mgmt-desc">Manage your server's structure by reordering channels and groups or moving them between categories.</p>
  </header>

  {#if showCreateChannel}
    <div class="creator-card glass-panel-heavy" in:slide>
      <div class="creator-header">
        <Icon name="plus" size={18} />
        <h3>Create New Channel</h3>
      </div>
      <div class="creator-form">
        <div class="form-group">
          <label for="ch-name">Channel Name</label>
          <input id="ch-name" type="text" class="text-input" placeholder="e.g. general" bind:value={newChannelName} />
        </div>
        <div class="form-group">
          <label for="ch-type">Type</label>
          <select id="ch-type" bind:value={newChannelType}>
            <option value="text">Text Channel</option>
            <option value="voice">Voice Channel</option>
          </select>
        </div>
        <div class="form-group">
          <label for="ch-group">Category</label>
          <select id="ch-group" bind:value={newChannelGroupId}>
            <option value={null}>No Category</option>
            {#each $channelGroups as g (g.id)}
              <option value={g.id}>{g.name}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="creator-footer">
        <button class="btn-ghost" onclick={() => showCreateChannel = false}>Cancel</button>
        <button class="btn-accent" onclick={handleCreateChannel} disabled={!newChannelName.trim()}>Create Channel</button>
      </div>
    </div>
  {/if}

  {#if showCreateGroup}
    <div class="creator-card glass-panel-heavy" in:slide>
      <div class="creator-header">
        <Icon name="plus" size={18} />
        <h3>Create New Category</h3>
      </div>
      <div class="creator-form">
        <div class="form-group">
          <label for="g-name">Category Name</label>
          <input id="g-name" type="text" class="text-input" placeholder="e.g. IMPORTANT" bind:value={newGroupName} />
        </div>
      </div>
      <div class="creator-footer">
        <button class="btn-ghost" onclick={() => showCreateGroup = false}>Cancel</button>
        <button class="btn-accent" onclick={handleCreateGroup} disabled={!newGroupName.trim()}>Create Category</button>
      </div>
    </div>
  {/if}

  <div class="board">
    {#each $groupedChannels as { group, channels: groupChannels } (group?.id ?? 'ungrouped')}
      <div class="board-column glass-panel" class:column-ungrouped={!group}>
        <div class="column-header">
          <div class="column-info">
            <Icon name={group ? "chevron-down" : "hash"} size={14} class="column-icon" />
            <span class="column-name">{group?.name ?? 'Ungrouped'}</span>
            <span class="count-badge">{groupChannels.length}</span>
          </div>
          {#if group}
            <div class="column-actions">
              <div class="order-btns">
                <button class="tool-btn" onclick={() => moveGroup(group.id, 'up')} title="Move Group Up">
                  <Icon name="arrow-up" size={14} />
                </button>
                <button class="tool-btn" onclick={() => moveGroup(group.id, 'bottom')} title="Move Group Down">
                  <Icon name="arrow-down" size={14} />
                </button>
              </div>
              <button class="tool-btn danger" onclick={() => handleDeleteGroup(group.id, group.name)} title="Delete Group">
                <Icon name="trash" size={14} />
              </button>
            </div>
          {/if}
        </div>

        <div class="column-body">
          {#each groupChannels as channel (channel.id)}
            <div class="item-row glass-panel">
              <div class="item-main">
                <Icon name={channel.type === 'text' ? 'hash' : 'volume'} size={16} class="item-icon" />
                <span class="item-name">{channel.name}</span>
              </div>
              
              <div class="item-controls">
                <select 
                  class="mini-select" 
                  value={channel.group_id} 
                  onchange={(e) => changeGroup(channel.id, (e.target as HTMLSelectElement).value || null)}
                  title="Move to category"
                >
                  <option value={null}>No Category</option>
                  {#each $channelGroups as g (g.id)}
                    <option value={g.id}>{g.name}</option>
                  {/each}
                </select>

                <div class="order-btns">
                  <button class="tool-btn" onclick={() => moveChannel(channel.id, 'up', group?.id ?? null)} title="Move Up">
                    <Icon name="arrow-up" size={14} />
                  </button>
                  <button class="tool-btn" onclick={() => moveChannel(channel.id, 'bottom', group?.id ?? null)} title="Move Down">
                    <Icon name="arrow-down" size={14} />
                  </button>
                </div>

                <button class="tool-btn danger" onclick={() => handleDeleteChannel(channel.id, channel.name)} title="Delete Channel">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          {/each}
          
          {#if groupChannels.length === 0}
            <div class="column-empty">
              <p>No channels here</p>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .channel-management {
    display: flex;
    flex-direction: column;
    gap: 32px;
    animation: fadeIn 0.3s var(--ease-out);
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .mgmt-header {
    border-bottom: 1px solid var(--glass-border);
    padding-bottom: 24px;
  }

  .mgmt-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .mgmt-title {
    font-size: 1.5rem;
    font-weight: 850;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .mgmt-desc {
    color: var(--text-muted);
    font-size: 0.95rem;
    max-width: 600px;
    margin: 0;
  }

  .header-actions {
    display: flex;
    gap: 12px;
  }

  .btn-action {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: white;
    font-weight: 700;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-action:hover {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 4px 15px var(--accent-glow);
    transform: translateY(-1px);
  }

  /* Creator Card */
  .creator-card {
    padding: 24px;
    border-radius: var(--radius);
    border: 1px solid var(--accent-subtle);
    background: linear-gradient(135deg, rgba(124, 92, 252, 0.05) 0%, transparent 100%);
  }

  .creator-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    color: var(--accent-hover);
  }

  .creator-header h3 {
    font-size: 1.1rem;
    font-weight: 800;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .creator-form {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-bottom: 24px;
  }

  .creator-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }

  /* Board Layout */
  .board {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .board-column {
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius);
    border: 1px solid var(--glass-border);
    transition: all 0.3s var(--ease-out);
  }

  .board-column:hover {
    border-color: rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.03);
  }

  .column-ungrouped {
    border-style: dashed;
    background: transparent;
  }

  .column-header {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(0, 0, 0, 0.2);
    border-bottom: 1px solid var(--glass-border);
  }

  .column-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .column-icon {
    color: var(--text-dim);
  }

  .column-name {
    font-size: 0.8rem;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: white;
  }

  .count-badge {
    font-size: 0.7rem;
    font-weight: 800;
    background: rgba(255, 255, 255, 0.05);
    padding: 2px 8px;
    border-radius: 10px;
    color: var(--text-dim);
  }

  .column-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .column-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Item Rows */
  .item-row {
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--radius-sm);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid transparent;
    transition: all 0.2s;
  }

  .item-row:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--glass-border);
    transform: translateX(4px);
  }

  .item-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .item-icon {
    color: var(--text-dim);
    opacity: 0.7;
  }

  .item-name {
    font-weight: 700;
    font-size: 1rem;
    color: var(--text);
  }

  .item-controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  /* Components */
  .mini-select {
    height: 32px;
    padding: 0 12px;
    font-size: 0.8rem;
    font-weight: 700;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    width: 140px;
  }

  .mini-select:focus {
    border-color: var(--accent);
    color: white;
  }

  .order-btns {
    display: flex;
    background: rgba(0, 0, 0, 0.2);
    padding: 2px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--glass-border);
  }

  .tool-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s;
  }

  .tool-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .tool-btn.danger:hover {
    background: var(--danger);
    color: white;
  }

  .column-empty {
    padding: 32px;
    text-align: center;
    color: var(--text-dim);
    font-style: italic;
    font-size: 0.9rem;
    border: 1px dashed var(--glass-border);
    border-radius: var(--radius-sm);
  }

  @media (max-width: 900px) {
    .creator-form { grid-template-columns: 1fr; }
    .item-controls { gap: 8px; }
    .mini-select { width: 110px; }
  }
</style>
