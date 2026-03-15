<script lang="ts">
  import { deleteChannelGroup } from '$lib/stores/channels';
  import { confirm, toast } from '$lib/stores/toast';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import Icon from './Icon.svelte';

  let {
    groupId,
    groupName,
    anchorX,
    anchorY,
    onclose,
    onrename,
    onpermissions,
  }: {
    groupId: string;
    groupName: string;
    anchorX: number;
    anchorY: number;
    onclose: () => void;
    onrename: (groupId: string) => void;
    onpermissions: (groupId: string) => void;
  } = $props();

  const canManageGroups = hasPermissionStore('manage_channel_groups');

  async function handleDelete() {
    const name = groupName;
    const id = groupId;
    onclose();
    if (
      !(await confirm(`Delete group "${name}"? Channels inside will become ungrouped.`, {
        title: 'Delete Group',
        confirmLabel: 'Delete',
        dangerAction: true,
      }))
    )
      return;
    try {
      await deleteChannelGroup(id);
    } catch (err: any) {
      toast.error('Failed to delete group: ' + err.message);
    }
  }

  let menuEl: HTMLDivElement | undefined = $state();

  let left = $derived.by(() => {
    const w = menuEl?.offsetWidth ?? 180;
    return Math.min(anchorX, window.innerWidth - w - 8);
  });
  let top = $derived.by(() => {
    const h = menuEl?.offsetHeight ?? 80;
    return Math.min(anchorY, window.innerHeight - h - 8);
  });

  function handleClickOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  $effect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="context-menu" bind:this={menuEl} style="left: {left}px; top: {top}px;">
  <div class="menu-header">
    <Icon name="grid" size={14} class="header-icon" />
    <span class="header-text">{groupName}</span>
  </div>
  
  <div class="menu-group">
    <button
      class="menu-item"
      onclick={() => {
        onrename(groupId);
        onclose();
      }}
    >
      <Icon name="edit" size={16} class="menu-icon" />
      <span>Rename Group</span>
    </button>

    {#if $canManageGroups}
      <button
        class="menu-item"
        onclick={() => {
          onpermissions(groupId);
          onclose();
        }}
      >
        <Icon name="shield-check" size={16} class="menu-icon" />
        <span>Edit Permissions</span>
      </button>
    {/if}
  </div>

  <div class="menu-separator"></div>

  <div class="menu-group">
    <button class="menu-item danger" onclick={handleDelete}>
      <Icon name="trash" size={16} class="menu-icon" />
      <span>Delete Group</span>
    </button>
  </div>
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--glass-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-md);
    padding: 6px;
    min-width: 190px;
    box-shadow: var(--glass-shadow), var(--glass-glow);
    animation: menuIn 150ms var(--ease-out);
  }

  @keyframes menuIn {
    from { opacity: 0; transform: scale(0.95) translateY(4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .menu-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .header-icon {
    color: var(--text-dim);
  }

  .header-text {
    font-weight: 700;
    font-size: 0.75rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 500;
    text-align: left;
    transition: all 150ms;
    cursor: pointer;
    border: none;
  }

  .menu-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .menu-item.danger {
    color: var(--danger);
  }

  .menu-item.danger:hover {
    background: rgba(248, 113, 113, 0.1);
    color: var(--danger);
    box-shadow: inset 0 0 0 1px var(--danger);
  }

  .menu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 6px;
    opacity: 0.5;
  }

  .menu-icon {
    opacity: 0.7;
  }

  .menu-item:hover .menu-icon {
    opacity: 1;
  }
</style>
