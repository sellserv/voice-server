<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
  import { serverNotificationLevels, serverSuppressEveryone, serverMutedUntil, leaveServer } from '$lib/stores/servers';
  import { toast, confirm } from '$lib/stores/toast';
  import Icon from './Icon.svelte';
  import NotificationSettingsMenu from './NotificationSettingsMenu.svelte';

  let {
    serverId,
    serverName,
    ownerId,
    anchorX,
    anchorY,
    onclose,
  }: {
    serverId: string;
    serverName: string;
    ownerId?: string;
    anchorX: number;
    anchorY: number;
    onclose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();

  let left = $derived.by(() => {
    const w = menuEl?.offsetWidth ?? 200;
    return Math.min(anchorX, window.innerWidth - w - 8);
  });
  let top = $derived.by(() => {
    const h = menuEl?.offsetHeight ?? 200;
    return Math.min(anchorY, window.innerHeight - h - 8);
  });

  let showNotificationSubmenu = $state(false);

  function getLevel(): string {
    return $serverNotificationLevels.get(serverId) || 'default';
  }

  function getSuppressEveryone(): boolean {
    return $serverSuppressEveryone.get(serverId) || false;
  }

  function getMutedUntil(): string | null {
    return $serverMutedUntil.get(serverId) || null;
  }

  async function handleLeave() {
    const sId = serverId;
    const sName = serverName;
    onclose();
    const confirmed = await confirm(`Are you sure you want to leave "${sName}"? You will need a new invite to rejoin.`, {
      title: 'Leave Server',
      confirmLabel: 'Leave Server',
      dangerAction: true,
    });
    if (!confirmed) return;
    try {
      await leaveServer(sId);
      toast.success(`Left ${sName}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to leave server');
    }
  }

  function copyId() {
    navigator.clipboard.writeText(serverId);
    toast.success('Server ID copied to clipboard');
    onclose();
  }

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
    <Icon name="shield-check" size={14} class="header-icon" />
    <span class="header-text">{serverName}</span>
  </div>

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
      type="server"
      serverId={serverId}
      currentLevel={getLevel()}
      currentMutedUntil={getMutedUntil()}
      currentSuppressEveryone={getSuppressEveryone()}
      onClose={onclose}
    />
  {/if}

  <div class="menu-separator"></div>

  <div class="menu-group">
    <button class="menu-item" onclick={copyId}>
      <Icon name="copy" size={16} class="menu-icon" />
      <span>Copy Server ID</span>
    </button>

    {#if ownerId !== $currentUser?.id}
      <button class="menu-item danger" onclick={handleLeave}>
        <Icon name="log-out" size={16} class="menu-icon" />
        <span>Leave Server</span>
      </button>
    {/if}
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
    min-width: 200px;
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

  .group-label {
    padding: 6px 12px 2px;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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

  .menu-item.selected {
    color: var(--accent);
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
    transition: opacity 150ms;
  }

  .menu-item:hover .menu-icon {
    opacity: 1;
  }

  :global(.check-icon) {
    margin-left: auto;
    opacity: 0.8;
  }

  :global(.chevron-icon) {
    margin-left: auto;
    opacity: 0.5;
  }
</style>
