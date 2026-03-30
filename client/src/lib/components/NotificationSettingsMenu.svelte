<script lang="ts">
  import { setServerNotificationLevel, setServerSuppressEveryone, setServerMuted } from '$lib/stores/servers';
  import { setChannelOverride, resetChannelOverride, muteDm, unmuteDm } from '$lib/stores/channelNotifications';
  import Icon from './Icon.svelte';

  let {
    type = 'server',
    serverId = '',
    channelId = '',
    currentLevel = 'mentions',
    currentMutedUntil = null as string | null,
    currentSuppressEveryone = false,
    onClose = () => {},
  }: {
    type: 'server' | 'channel' | 'dm';
    serverId?: string;
    channelId?: string;
    currentLevel?: string;
    currentMutedUntil?: string | null;
    currentSuppressEveryone?: boolean;
    onClose?: () => void;
  } = $props();

  const isMuted = $derived(
    currentMutedUntil && currentMutedUntil > new Date().toISOString()
  );

  const levels = type === 'channel'
    ? [
        { value: 'default', label: 'Use Server Default', icon: 'bell' },
        { value: 'all', label: 'All Messages', icon: 'bell' },
        { value: 'mentions', label: 'Only @Mentions', icon: 'at-sign' },
        { value: 'nothing', label: 'Nothing', icon: 'bell-off' },
      ]
    : type === 'server'
    ? [
        { value: 'all', label: 'All Messages', icon: 'bell' },
        { value: 'mentions', label: 'Only @Mentions', icon: 'at-sign' },
        { value: 'nothing', label: 'Nothing', icon: 'bell-off' },
      ]
    : [];

  const muteDurations = [
    { label: '15 Minutes', minutes: 15 },
    { label: '1 Hour', minutes: 60 },
    { label: '8 Hours', minutes: 480 },
    { label: '24 Hours', minutes: 1440 },
    { label: 'Until I turn it back on', minutes: 0 },
  ];

  async function setLevel(level: string) {
    if (type === 'server') {
      await setServerNotificationLevel(serverId, level);
    } else if (type === 'channel') {
      if (level === 'default') {
        await resetChannelOverride(serverId, channelId);
      } else {
        await setChannelOverride(serverId, channelId, level);
      }
    }
    onClose();
  }

  async function mute(minutes: number) {
    const until = minutes === 0
      ? '9999-12-31T23:59:59Z'
      : new Date(Date.now() + minutes * 60_000).toISOString();

    if (type === 'server') {
      await setServerMuted(serverId, until);
    } else if (type === 'channel') {
      await setChannelOverride(serverId, channelId, undefined, until);
    } else if (type === 'dm') {
      await muteDm(channelId, until);
    }
    onClose();
  }

  async function unmute() {
    if (type === 'server') {
      await setServerMuted(serverId, null);
    } else if (type === 'channel') {
      await setChannelOverride(serverId, channelId, undefined, null);
    } else if (type === 'dm') {
      await unmuteDm(channelId);
    }
    onClose();
  }

  async function toggleSuppressEveryone() {
    await setServerSuppressEveryone(serverId, !currentSuppressEveryone);
    onClose();
  }
</script>

<div class="notification-menu">
  {#if type !== 'dm'}
    <div class="menu-group">
      <div class="group-label">Notification Level</div>
      {#each levels as { value, label, icon }}
        <button
          class="menu-item"
          class:selected={currentLevel === value}
          onclick={() => setLevel(value)}
        >
          <Icon name={icon} size={16} class="menu-icon" />
          <span>{label}</span>
          {#if currentLevel === value}
            <Icon name="check" size={14} class="check-icon" />
          {/if}
        </button>
      {/each}
    </div>
    <div class="menu-separator"></div>
  {/if}

  {#if type === 'server'}
    <div class="menu-group">
      <button
        class="menu-item"
        class:selected={currentSuppressEveryone}
        onclick={toggleSuppressEveryone}
      >
        <Icon name="bell-off" size={16} class="menu-icon" />
        <span>Suppress @everyone and @here</span>
        {#if currentSuppressEveryone}
          <Icon name="check" size={14} class="check-icon" />
        {/if}
      </button>
    </div>
    <div class="menu-separator"></div>
  {/if}

  <div class="menu-group">
    {#if isMuted}
      <button class="menu-item" onclick={unmute}>
        <Icon name="bell" size={16} class="menu-icon" />
        <span>Unmute</span>
      </button>
    {:else}
      <div class="group-label">Mute</div>
      {#each muteDurations as { label, minutes }}
        <button class="menu-item" onclick={() => mute(minutes)}>
          <Icon name="bell-off" size={16} class="menu-icon" />
          <span>{label}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .notification-menu {
    min-width: 200px;
  }

  .menu-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 0;
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
</style>
