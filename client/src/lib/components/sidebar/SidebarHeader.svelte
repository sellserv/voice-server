<script lang="ts">
  import { serverSettings } from '$lib/stores/serverSettings';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { resolveAsset } from '$lib/stores/server';
  import Icon from '../Icon.svelte';

  let {
    oncreate,
    oncreategroup,
    onserversettings,
    oninvite,
  }: {
    oncreate: () => void;
    oncreategroup: () => void;
    onserversettings: () => void;
    oninvite: () => void;
  } = $props();

  const canManageChannels = hasPermissionStore('manage_channels');
  const canManageGroups = hasPermissionStore('manage_channel_groups');
  const canInvite = hasPermissionStore('create_invites');
  const isAdmin = hasPermissionStore('administrator');

  let showPlusMenu = $state(false);
</script>

<div class="sidebar-header">
  <div class="server-identity">
    <h2 class="logo">{$serverSettings.name}</h2>
  </div>
  <div class="header-actions">
    {#if $canInvite}
      <button
        class="icon-btn"
        title="Invite People"
        aria-label="Invite People"
        onclick={() => oninvite()}
      >
        <Icon name="plus" size={20} strokeWidth={2.5} />
      </button>
    {/if}
    {#if $canManageChannels}
      <div class="plus-menu-container">
        <button
          class="icon-btn"
          title="Create"
          aria-label="Create"
          onclick={() => (showPlusMenu = !showPlusMenu)}
        >
          <Icon name="grid" size={20} strokeWidth={2.5} />
        </button>
        {#if showPlusMenu}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="plus-menu-backdrop" onclick={() => (showPlusMenu = false)}></div>
          <div class="plus-menu">
            <button
              class="plus-menu-item"
              onclick={() => {
                oncreate();
                showPlusMenu = false;
              }}
            >
              <Icon name="hash" size={16} strokeWidth={2.5} />
              <span>Create Channel</span>
            </button>
            {#if $canManageGroups}
              <button
                class="plus-menu-item"
                onclick={() => {
                  oncreategroup();
                  showPlusMenu = false;
                }}
              >
                <Icon name="users" size={16} strokeWidth={2.5} />
                <span>Create Group</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
    {#if $isAdmin}
      <button
        class="icon-btn"
        title="Server Settings"
        aria-label="Server Settings"
        onclick={() => onserversettings()}
      >
        <Icon name="settings" size={20} strokeWidth={2.5} />
      </button>
    {/if}
  </div>
</div>

<style>
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(0, 0, 0, 0.1);
  }

  .server-identity {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .header-actions {
    display: flex;
    gap: 6px;
  }

  .logo {
    font-size: 1.15rem;
    font-weight: 800;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.02em;
  }

  .icon-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-icon);
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-elastic);
    border: 1px solid var(--glass-border);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    transform: scale(1.05);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .plus-menu-container {
    position: relative;
  }

  .plus-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .plus-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-sm);
    padding: 6px;
    z-index: 100;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    min-width: 180px;
    animation: menuIn 0.2s var(--ease-out);
  }

  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .plus-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    color: var(--text-muted);
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 700;
    text-align: left;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .plus-menu-item:hover {
    background: var(--accent);
    color: white;
    padding-left: 16px;
  }
</style>
