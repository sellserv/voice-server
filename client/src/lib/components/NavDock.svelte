<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
  import { officialInstance } from '$lib/stores/features';
  import { resolveAsset } from '$lib/stores/server';
  import { servers, activeServerId, isDmView, switchServer, serverNotificationLevels, serverMutedUntil } from '$lib/stores/servers';
  import { serverUnreadCounts, homeUnreadCounts } from '$lib/stores/channels';
  import CreateServerModal from '$lib/components/CreateServerModal.svelte';

  import ServerContextMenu from './ServerContextMenu.svelte';
  import Icon from './Icon.svelte';

  // Server modal
  let showCreateServerModal = $state(false);


  let contextMenu: { serverId: string; serverName: string; ownerId?: string; x: number; y: number } | null = $state(null);

  function handleServerContext(e: MouseEvent, server: { id: string; name: string; owner_id?: string }) {
    e.preventDefault();
    contextMenu = { serverId: server.id, serverName: server.name, ownerId: (server as any).owner_id, x: e.clientX, y: e.clientY };
  }

  function closeMenu() {
    contextMenu = null;
  }

  function switchToServer(serverId: string) {
    switchServer(serverId);
  }
</script>

<nav class="nav-dock">
  <div class="nav-item home-nav" class:active={$isDmView}>
    <button
      class="home-btn"
      class:active={$isDmView}
      data-tooltip="Home"
      aria-label="Home"
      onclick={() => isDmView.set(true)}
    >
      <svg viewBox="0 0 24 24" class="home-icon-svg">
        <path d="M12 2.4L3.6 9.6V21.6h6v-6h4.8v6h6V9.6L12 2.4z" fill="currentColor" />
      </svg>
      {#if $homeUnreadCounts.mentions > 0}
        <span class="server-badge mention">{$homeUnreadCounts.mentions}</span>
      {:else if $homeUnreadCounts.unread}
        <span class="server-badge unread"></span>
      {/if}
    </button>
  </div>

  <div class="nav-separator"></div>

  <!-- Server list -->
  <div class="server-list">
    {#each $servers as server (server.id)}
      {@const badge = $serverUnreadCounts.get(server.id)}
      <div class="nav-item" class:active={$activeServerId === server.id && !$isDmView}>
        <button
          class="server-icon"
          class:active={$activeServerId === server.id && !$isDmView}
          data-tooltip={server.name}
          aria-label={server.name}
          onclick={() => switchToServer(server.id)}
          oncontextmenu={(e) => handleServerContext(e, server)}
        >
          {#if server.icon_url}
            <img src={resolveAsset(server.icon_url)} alt="" class="server-icon-img" />
          {:else}
            <span class="server-icon-initial">{server.name.charAt(0).toUpperCase()}</span>
          {/if}
          {#if badge?.mentions}
            <span class="server-badge mention">{badge.mentions}</span>
          {:else if badge?.unread}
            <span class="server-badge unread"></span>
          {/if}
          {#if $serverNotificationLevels.get(server.id) === 'nothing' || ($serverMutedUntil.get(server.id) && $serverMutedUntil.get(server.id) > new Date().toISOString())}
            <span class="muted-badge">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
                <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
                <path d="M18 8a6 6 0 0 0-9.33-5" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            </span>
          {/if}
        </button>
      </div>
    {/each}

    <!-- Add server button -->
    <div class="nav-item">
      <button
        class="server-icon add-server-btn"
        data-tooltip="Add a Server"
        aria-label="Add a Server"
        onclick={() => showCreateServerModal = true}
      >
        <Icon name="plus" size={24} strokeWidth={2.5} />
      </button>
    </div>
  </div>

  {#if $currentUser?.is_instance_admin && !$officialInstance}
    <div class="admin-spacer"></div>
    <div class="nav-item">
      <a
        href="/admin"
        class="server-icon admin-btn"
        data-tooltip="Admin Panel"
        aria-label="Admin Panel"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </a>
    </div>
  {/if}

</nav>

{#if contextMenu}
  <ServerContextMenu
    serverId={contextMenu.serverId}
    serverName={contextMenu.serverName}
    ownerId={contextMenu.ownerId}
    anchorX={contextMenu.x}
    anchorY={contextMenu.y}
    onclose={closeMenu}
  />
{/if}

{#if showCreateServerModal}
  <CreateServerModal onclose={() => showCreateServerModal = false} />
{/if}



<style>
  .nav-dock {
    width: var(--nav-dock-width);
    height: 100%;
    background: rgba(4, 4, 8, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-4) 0;
    flex-shrink: 0;
    z-index: 20;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.2);
  }

  .nav-separator {
    width: 32px;
    height: 2px;
    background: var(--glass-border);
    margin: var(--space-3) 0;
    flex-shrink: 0;
    border-radius: 2px;
    opacity: 0.5;
  }

  /* Server list */
  .server-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    overflow-y: auto;
    padding: var(--space-2) 0;
    flex: 0 1 auto;
    min-height: 0;
    scrollbar-width: none;
  }

  .server-list::-webkit-scrollbar {
    display: none;
  }

  .server-icon, .home-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      border-radius 0.3s var(--ease-elastic),
      background-color 0.2s var(--ease-out),
      transform 0.3s var(--ease-elastic),
      box-shadow 0.2s var(--ease-out);
    overflow: visible;
    border: none;
    padding: 0;
    color: var(--text-muted);
    outline: none !important;
    position: relative;
  }

  .server-icon:hover, .home-btn:hover {
    border-radius: 16px;
    background: var(--accent);
    color: white;
    transform: scale(1.05);
    box-shadow: 0 4px 15px var(--accent-glow);
  }

  .server-icon.active, .home-btn.active {
    border-radius: 16px;
    background: var(--accent);
    color: white;
    box-shadow: 0 4px 15px var(--accent-glow);
  }

  /* Indicator pill */
  .nav-item::before {
    content: '';
    position: absolute;
    left: -4px;
    top: 50%;
    transform: translateY(-50%) scaleY(0);
    width: 4px;
    height: 8px;
    background: white;
    border-radius: 0 4px 4px 0;
    transition: all 0.2s var(--ease-out);
    opacity: 0;
  }

  .nav-item:hover::before {
    transform: translateY(-50%) scaleY(2.5);
    opacity: 0.6;
  }

  .nav-item.active::before {
    transform: translateY(-50%) scaleY(4.5);
    opacity: 1;
    height: 8px;
  }

  .server-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.3s var(--ease-out);
    border-radius: inherit;
  }

  .server-icon:active .server-icon-img, .home-btn:active .home-icon-svg {
    transform: scale(0.85);
  }

  .server-icon-initial {
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .home-icon-svg {
    width: 26px;
    height: 26px;
    color: currentColor;
    transition: transform 0.3s var(--ease-out);
  }

  /* Add Server Button */
  .add-server-btn {
    background: rgba(34, 197, 94, 0.1);
    color: var(--success);
    border: 1px dashed rgba(34, 197, 94, 0.2);
  }

  .add-server-btn:hover {
    background: var(--success) !important;
    border-color: transparent !important;
    color: white !important;
    box-shadow: 0 4px 15px rgba(34, 197, 94, 0.3) !important;
  }

  /* Tooltips Overhaul */
  .server-icon[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    left: calc(100% + 18px);
    top: 50%;
    transform: translateY(-50%) translateX(-10px);
    background: rgba(8, 8, 15, 0.95);
    backdrop-filter: blur(8px);
    color: white;
    padding: 8px 14px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 800;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s var(--ease-elastic);
    z-index: 1000;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    border: 1px solid var(--glass-border-bright);
  }

  .server-icon[data-tooltip]:hover::after {
    opacity: 1;
    visibility: visible;
    transform: translateY(-50%) translateX(0);
    transition-delay: 0.05s;
  }

  /* Tooltip Arrow */
  .server-icon[data-tooltip]::before {
    content: '';
    position: absolute;
    left: calc(100% + 10px);
    top: 50%;
    transform: translateY(-50%) translateX(-5px);
    border: 5px solid transparent;
    border-right-color: rgba(8, 8, 15, 0.95);
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s var(--ease-elastic);
    pointer-events: none;
  }

  .server-icon[data-tooltip]:hover::before {
    opacity: 1;
    visibility: visible;
    transform: translateY(-50%) translateX(0);
    transition-delay: 0.05s;
  }

  /* Badges Overhaul */
  .server-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    border: 3px solid var(--bg-darkest);
    border-radius: 12px;
    z-index: 2;
  }

  .server-badge.unread {
    width: 14px;
    height: 14px;
    background: white;
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
  }

  .server-badge.mention {
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    background: var(--danger);
    color: white;
    font-size: 0.75rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    box-shadow: 0 4px 10px rgba(248, 113, 113, 0.3);
  }

  .muted-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 20px;
    height: 20px;
    background: rgba(8, 8, 15, 0.9);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    z-index: 2;
    border: 2px solid var(--bg-darkest);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .admin-btn {
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-dim);
    margin-top: var(--space-3);
    text-decoration: none;
  }

  .admin-btn:hover {
    color: white !important;
    background: var(--accent) !important;
  }
</style>