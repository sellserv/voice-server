<script lang="ts">
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { currentUser } from '$lib/stores/auth';
  import { getActiveServerId, activeServer, deleteServer, leaveServer, isDmView } from '$lib/stores/servers';
  import { serverSettings } from '$lib/stores/serverSettings';
  import { confirm } from '$lib/stores/toast';
  import Icon from './Icon.svelte';
  import GeneralSettings from './settings/GeneralSettings.svelte';
  import RolesSettings from './settings/RolesSettings.svelte';
  import ChannelManagement from './settings/ChannelManagement.svelte';
  import MemberManagement from './settings/MemberManagement.svelte';
  import InvitesSettings from './settings/InvitesSettings.svelte';
  import SoundboardSettings from './settings/SoundboardSettings.svelte';
  import EmojiSettings from './settings/EmojiSettings.svelte';
  import AppsSettings from './settings/AppsSettings.svelte';
  import BotSettings from './settings/BotSettings.svelte';
  import AuditLogViewer from './settings/AuditLogViewer.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const isOwner = $derived($currentUser?.id === $activeServer?.owner_id);

  async function handleDeleteServer() {
    const serverId = getActiveServerId();
    const confirmed = await confirm(
      `Are you sure you want to permanently delete "${$serverSettings.name}"? This will delete all channels, messages, roles, and members. This action cannot be undone.`,
      { title: 'Delete Server', confirmLabel: 'Delete Server', dangerAction: true },
    );
    if (!confirmed) return;
    await deleteServer(serverId);
    isDmView.set(true);
    onclose();
  }

  async function handleLeaveServer() {
    const serverId = getActiveServerId();
    const confirmed = await confirm(
      `Are you sure you want to leave "${$serverSettings.name}"? You will need a new invite to rejoin.`,
      { title: 'Leave Server', confirmLabel: 'Leave Server', dangerAction: true },
    );
    if (!confirmed) return;
    await leaveServer(serverId);
    isDmView.set(true);
    onclose();
  }

  let activeSection = $state('general');

  const isAdmin = hasPermissionStore('administrator');
  const canManageChannelsGroups = hasPermissionStore('manage_channels_groups');
  const canManageBots = hasPermissionStore('manage_bots');
  const canViewAuditLog = hasPermissionStore('view_audit_log');

  const TAB_LABELS: Record<string, string> = {
    general: 'General',
    roles: 'Roles',
    channels: 'Channels',
    members: 'Members',
    invites: 'Invite Codes',
    soundboard: 'Soundboard',
    emojis: 'Custom Emojis',
    apps: 'Apps',
    bots: 'Bots',
    audit: 'Audit Log',
  };
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="sidebar">
      <div class="sidebar-inner">
        <h5 class="sidebar-title">Server Settings</h5>
        <button class="sidebar-item" class:active={activeSection === 'general'} onclick={() => activeSection = 'general'}>General</button>
        <button class="sidebar-item" class:active={activeSection === 'roles'} onclick={() => activeSection = 'roles'}>Roles</button>
        {#if $isAdmin || $canManageChannelsGroups}
          <button class="sidebar-item" class:active={activeSection === 'channels'} onclick={() => activeSection = 'channels'}>Channels</button>
        {/if}
        <button class="sidebar-item" class:active={activeSection === 'members'} onclick={() => activeSection = 'members'}>Members</button>
        <button class="sidebar-item" class:active={activeSection === 'invites'} onclick={() => activeSection = 'invites'}>Invite Codes</button>
        
        <div class="sidebar-separator"></div>
        <h5 class="sidebar-title">Customization</h5>
        <button class="sidebar-item" class:active={activeSection === 'soundboard'} onclick={() => activeSection = 'soundboard'}>Soundboard</button>
        <button class="sidebar-item" class:active={activeSection === 'emojis'} onclick={() => activeSection = 'emojis'}>Custom Emojis</button>
        <button class="sidebar-item" class:active={activeSection === 'apps'} onclick={() => activeSection = 'apps'}>Apps</button>
        
        {#if $isAdmin || $canManageBots || $canViewAuditLog}
          <div class="sidebar-separator"></div>
          <h5 class="sidebar-title">Administration</h5>
          {#if $isAdmin || $canManageBots}
            <button class="sidebar-item" class:active={activeSection === 'bots'} onclick={() => activeSection = 'bots'}>Bots</button>
          {/if}
          {#if $isAdmin || $canViewAuditLog}
            <button class="sidebar-item" class:active={activeSection === 'audit'} onclick={() => activeSection = 'audit'}>Audit Log</button>
          {/if}
        {/if}
        
        <div class="sidebar-separator"></div>
        {#if isOwner}
          <button class="sidebar-item danger-nav-btn" onclick={handleDeleteServer}>
            <span>Delete Server</span>
            <Icon name="x" size={16} />
          </button>
        {:else}
          <button class="sidebar-item danger-nav-btn" onclick={handleLeaveServer}>
            <span>Leave Server</span>
            <Icon name="logout" size={16} />
          </button>
        {/if}
      </div>
    </div>

    <div class="content-area">
      <div class="content-wrapper">
        <h3 class="content-title">{TAB_LABELS[activeSection] ?? activeSection}</h3>
        
        {#if activeSection === 'general'}
          <GeneralSettings {onclose} />
        {:else if activeSection === 'roles'}
          <RolesSettings />
        {:else if activeSection === 'channels'}
          <ChannelManagement serverId={getActiveServerId()} />
        {:else if activeSection === 'members'}
          <MemberManagement />
        {:else if activeSection === 'invites'}
          <InvitesSettings />
        {:else if activeSection === 'soundboard'}
          <SoundboardSettings />
        {:else if activeSection === 'emojis'}
          <EmojiSettings />
        {:else if activeSection === 'apps'}
          <AppsSettings />
        {:else if activeSection === 'bots'}
          <BotSettings />
        {:else if activeSection === 'audit'}
          <AuditLogViewer />
        {/if}
      </div>

      <div class="esc-container">
        <button class="close-modal-btn" onclick={onclose} aria-label="Close settings">
          <Icon name="x" size={24} />
        </button>
        <span class="esc-hint">ESC</span>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    z-index: 1000;
    animation: overlayIn 0.3s var(--ease-out);
  }

  @keyframes overlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    display: flex;
    width: 100%;
    height: 100%;
    background: rgba(8, 8, 15, 0.85);
    position: relative;
    animation: modalIn 0.4s var(--ease-elastic);
  }

  @keyframes modalIn {
    from { transform: scale(1.05); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  /* Sidebar */
  .sidebar {
    flex: 0 0 240px;
    background: rgba(8, 8, 15, 0.5);
    display: flex;
    justify-content: flex-end;
    padding-top: 60px;
    z-index: 2;
    border-right: 1px solid var(--glass-border);
  }

  .sidebar-inner {
    width: 218px;
    padding: 0 12px 40px 20px;
    display: flex;
    flex-direction: column;
  }

  .sidebar-title {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
    padding: 12px 10px 8px;
    letter-spacing: 0.08em;
  }

  .sidebar-item {
    padding: 10px 12px;
    margin-bottom: 2px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 600;
    text-align: left;
    transition: all 0.2s var(--ease-out);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sidebar-item:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
    padding-left: 16px;
  }

  .sidebar-item.active {
    background: var(--accent);
    color: white;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .sidebar-separator {
    height: 1px;
    background: var(--glass-border);
    margin: 12px 10px;
    opacity: 0.5;
  }

  .danger-nav-btn {
    margin-top: 8px;
    color: var(--danger);
  }

  .danger-nav-btn:hover {
    background: rgba(248, 113, 113, 0.1) !important;
    color: var(--danger) !important;
  }

  /* Content Area */
  .content-area {
    flex: 1;
    background: transparent;
    display: flex;
    padding-top: 60px;
    position: relative;
    overflow: hidden;
  }

  .content-wrapper {
    flex: 1;
    max-width: 800px;
    padding: 0 40px 120px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--glass-border) transparent;
  }

  .content-title {
    font-size: 1.75rem;
    font-weight: 800;
    color: white;
    margin-bottom: 24px;
    letter-spacing: -0.02em;
  }

  /* Close Button Overhaul */
  .esc-container {
    position: absolute;
    top: 60px;
    right: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    z-index: 10;
  }

  .close-modal-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition: all 0.3s var(--ease-elastic);
  }

  .close-modal-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: white;
    color: white;
    transform: rotate(90deg) scale(1.1);
  }

  .esc-hint {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  @media (max-width: 768px) {
    .sidebar { display: none; }
    .content-area { padding-top: 20px; }
    .content-wrapper { padding: 0 16px 40px; }
    .esc-container { top: 20px; right: 16px; }
  }
</style>
