<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
  import { resolveAsset } from '$lib/stores/server';
  import { myStatus, isAutoIdled, updateUserStatus } from '$lib/stores/presence';
  import { sendWs } from '$lib/ws';
  import type { UserStatus } from '@voip-server/shared';
  import { inVoiceChannel, isMutedStore, isDeafenedStore } from '$lib/stores/media';
  import { toggleMute, toggleDeafen } from '$lib/webrtc';
  import Icon from '$lib/components/Icon.svelte';
  import Avatar from '$lib/components/Avatar.svelte';

  let {
    onsettings,
  }: {
    onsettings: () => void;
  } = $props();

  let showStatusPicker = $state(false);

  function setStatus(status: UserStatus) {
    $myStatus = status;
    $isAutoIdled = false;
    if ($currentUser) {
      updateUserStatus($currentUser.id, status);
    }
    sendWs({ type: 'presence:setStatus', status });
    showStatusPicker = false;
  }

  function handleMuteToggle() {
    if ($isMutedStore && $isDeafenedStore) return;
    const muted = toggleMute();
    $isMutedStore = muted;
  }

  function handleDeafenToggle() {
    const deaf = toggleDeafen();
    $isDeafenedStore = deaf;
    if (deaf && !$isMutedStore) {
      const muted = toggleMute();
      $isMutedStore = muted;
    }
  }
</script>

<div class="sidebar-footer">
  {#if showStatusPicker}
    <button type="button" class="status-picker-backdrop" onclick={() => (showStatusPicker = false)} aria-label="Close status picker"></button>
    <div class="status-picker">
      <div class="status-picker-header">Set Status</div>
      <button class="status-option" onclick={() => setStatus('online')}>
        <span class="status-preview-dot online"></span> Online
      </button>
      <button class="status-option" onclick={() => setStatus('idle')}>
        <span class="status-preview-dot idle"></span> Away
      </button>
      <button class="status-option" onclick={() => setStatus('dnd')}>
        <span class="status-preview-dot dnd"></span> Do Not Disturb
      </button>
      <button class="status-option" onclick={() => setStatus('invisible')}>
        <span class="status-preview-dot invisible"></span> Invisible
      </button>
    </div>
  {/if}

  <div class="user-footer">
    <div class="user-pill-container">
      <button type="button" class="user-pill" onclick={() => (showStatusPicker = !showStatusPicker)} title="Change Status" aria-label="Change Status" aria-expanded={showStatusPicker}>
        <Avatar
          src={$currentUser?.avatar_url}
          alt={$currentUser?.display_name || $currentUser?.username || '?'}
          size={32}
          userId={$currentUser?.id}
          showStatus={true}
        />
        <div class="user-details">
          <span class="user-name">{$currentUser?.display_name}</span>
          <span class="user-tag">@{$currentUser?.username}</span>
        </div>
      </button>

      <div class="footer-actions">
        {#if $inVoiceChannel}
          <button
            class="action-btn"
            class:active-danger={$isMutedStore}
            title={$isMutedStore ? 'Unmute' : 'Mute'}
            aria-label={$isMutedStore ? 'Unmute' : 'Mute'}
            onclick={handleMuteToggle}
          >
            <Icon name={$isMutedStore ? 'mic-off' : 'mic'} size={22} strokeWidth={2} />
          </button>
          <button
            class="action-btn"
            class:active-danger={$isDeafenedStore}
            title={$isDeafenedStore ? 'Undeafen' : 'Deafen'}
            aria-label={$isDeafenedStore ? 'Undeafen' : 'Deafen'}
            onclick={handleDeafenToggle}
          >
            <Icon name={$isDeafenedStore ? 'headphones-off' : 'headphones'} size={22} strokeWidth={2} />
          </button>
        {/if}
        <button
          class="settings-btn"
          title="User Settings"
          aria-label="User Settings"
          onclick={() => onsettings()}
        >
          <Icon name="settings" size={22} strokeWidth={2} />
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .sidebar-footer {
    flex-shrink: 0;
    padding: 8px;
    background: rgba(0, 0, 0, 0.1);
    position: relative;
  }

  .user-footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .user-pill-container {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    background: var(--bg-darkest);
    border-radius: 8px;
    border: 1px solid var(--border);
    min-width: 0;
  }

  .user-pill {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    transition: background 0.1s var(--ease-out);
    background: none;
    border: none;
    color: inherit;
    text-align: left;
  }

  .user-pill:hover {
    background: var(--bg-hover);
  }

  .user-details {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .user-name {
    font-weight: 700;
    font-size: 0.9rem;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-tag {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .action-btn, .settings-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-icon);
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-out);
    border: none;
    cursor: pointer;
    outline: none;
  }

  .action-btn:hover, .settings-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
  }

  .action-btn.active-danger {
    color: var(--danger);
  }

  .action-btn.active-danger:hover {
    background: rgba(248, 113, 113, 0.1);
  }

  .settings-btn:hover {
    transform: rotate(90deg) scale(1.1);
  }

  /* Status Picker */
  .status-picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: none;
    border: none;
    padding: 0;
    cursor: default;
  }

  .status-picker {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 8px;
    right: 8px;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border-bright);
    border-radius: 8px;
    padding: 6px;
    z-index: 1001;
    box-shadow: var(--shadow-lg);
    animation: slideUp 0.1s var(--ease-out);
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .status-picker-header {
    padding: 8px 10px;
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .status-option {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    color: var(--text-muted);
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 600;
    text-align: left;
    transition: all 0.1s;
    border: none;
    cursor: pointer;
  }

  .status-option:hover {
    background: var(--bg-hover);
    color: white;
  }

  .status-preview-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-preview-dot.online { background: var(--success); }
  .status-preview-dot.idle { background: var(--warning); }
  .status-preview-dot.dnd { background: var(--danger); }
  .status-preview-dot.invisible { background: var(--text-dim); }
</style>