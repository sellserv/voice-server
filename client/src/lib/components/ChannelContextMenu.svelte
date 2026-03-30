<script lang="ts">
  import { deleteChannel } from '$lib/stores/channels';
  import { confirm, toast } from '$lib/stores/toast';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { activeServerId } from '$lib/stores/servers';
  import { channelNotificationOverrides } from '$lib/stores/channelNotifications';
  import Icon from './Icon.svelte';
  import NotificationSettingsMenu from './NotificationSettingsMenu.svelte';

  let {
    channelId,
    channelName,
    anchorX,
    anchorY,
    onclose,
    onrename,
    onpermissions,
  }: {
    channelId: string;
    channelName: string;
    anchorX: number;
    anchorY: number;
    onclose: () => void;
    onrename: (channelId: string) => void;
    onpermissions: (channelId: string) => void;
  } = $props();

  const canManageChannels = hasPermissionStore('manage_channels');

  let showNotificationSubmenu = $state(false);

  const channelOverride = $derived($channelNotificationOverrides.get(channelId));
  const channelLevel = $derived(channelOverride?.level || 'default');
  const channelMutedUntil = $derived(channelOverride?.muted_until || null);

  async function handleDelete() {
    const name = channelName;
    const id = channelId;
    onclose();
    if (
      !(await confirm(`Delete channel "${name}"? This cannot be undone.`, {
        title: 'Delete Channel',
        confirmLabel: 'Delete',
        dangerAction: true,
      }))
    )
      return;
    try {
      await deleteChannel(id);
    } catch (err: any) {
      toast.error('Failed to delete channel: ' + err.message);
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
    <Icon name="hash" size={14} class="header-icon" />
    <span class="header-text">{channelName}</span>
  </div>

  {#if $canManageChannels}
    <div class="menu-group">
      <button
        class="menu-item"
        onclick={() => {
          onrename(channelId);
          onclose();
        }}
      >
        <Icon name="edit" size={16} class="menu-icon" />
        <span>Rename Channel</span>
      </button>

      <button
        class="menu-item"
        onclick={() => {
          onpermissions(channelId);
          onclose();
        }}
      >
        <Icon name="shield-check" size={16} class="menu-icon" />
        <span>Edit Permissions</span>
      </button>
    </div>

    <div class="menu-separator"></div>
  {/if}

  <div class="menu-group">
    <button
      class="menu-item"
      onclick={() => showNotificationSubmenu = !showNotificationSubmenu}
    >
      <Icon name="bell" size={16} class="menu-icon" />
      <span>Notification Settings</span>
      <Icon name="chevron-right" size={14} class="chevron-icon" />
    </button>
  </div>

  {#if showNotificationSubmenu}
    <div class="menu-separator"></div>
    <NotificationSettingsMenu
      type="channel"
      serverId={$activeServerId || ''}
      channelId={channelId}
      currentLevel={channelLevel}
      currentMutedUntil={channelMutedUntil}
      onClose={onclose}
    />
  {/if}

  {#if $canManageChannels}
    <div class="menu-separator"></div>

    <div class="menu-group">
      <button class="menu-item danger" onclick={handleDelete}>
        <Icon name="trash" size={16} class="menu-icon" />
        <span>Delete Channel</span>
      </button>
    </div>
  {/if}
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

  :global(.chevron-icon) {
    margin-left: auto;
    opacity: 0.5;
  }
</style>
