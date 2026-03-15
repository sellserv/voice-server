<script lang="ts">
  import {
    inVoiceChannel,
    pingMs,
    showSoundboardPanel,
    showWatchUrlPanel,
    showVoiceChangerPanel,
    showPingGraph,
  } from '$lib/stores/media';
  import { isScreenSharing } from '$lib/stores/screenShare';
  import { leaveVoice, startScreenShare, stopScreenShare } from '$lib/webrtc';
  import Icon from '../Icon.svelte';

  let pingBars = $derived(
    $pingMs === null ? 1 : $pingMs < 50 ? 4 : $pingMs < 100 ? 3 : $pingMs < 200 ? 2 : 1,
  );
  let pingColor = $derived(
    $pingMs === null
      ? 'var(--text-dim)'
      : $pingMs < 80
        ? 'var(--success)'
        : $pingMs < 150
          ? 'var(--warning)'
          : 'var(--danger)',
  );

  function handleLeaveVoice() {
    leaveVoice();
    $inVoiceChannel = null;
  }

  async function handleScreenShare() {
    if ($isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        await startScreenShare();
      } catch (e: any) {
        console.error('Screen share failed:', e);
      }
    }
  }
</script>

{#if $inVoiceChannel}
  <div class="voice-status">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="voice-status-info" onclick={() => ($showPingGraph = !$showPingGraph)}>
      <svg class="wifi-icon" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="18" width="4" height="4" rx="0.5" fill={pingBars >= 1 ? pingColor : 'var(--bg-light)'} />
        <rect x="8" y="14" width="4" height="8" rx="0.5" fill={pingBars >= 2 ? pingColor : 'var(--bg-light)'} />
        <rect x="14" y="9" width="4" height="13" rx="0.5" fill={pingBars >= 3 ? pingColor : 'var(--bg-light)'} />
        <rect x="20" y="4" width="4" height="18" rx="0.5" fill={pingBars >= 4 ? pingColor : 'var(--bg-light)'} />
      </svg>
      <div class="voice-status-text">
        <span class="voice-status-label">Voice Connected</span>
        {#if $pingMs !== null}
          <span class="voice-status-ping">{$pingMs}ms</span>
        {/if}
      </div>
    </div>
    <div class="voice-status-actions">
      <button
        class="voice-status-btn"
        class:active-screen={$isScreenSharing}
        title={$isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        aria-label={$isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        onclick={handleScreenShare}
      >
        <Icon name="monitor" size={20} strokeWidth={2.5} />
      </button>
      <button
        class="voice-disconnect-btn"
        title="Disconnect"
        aria-label="Disconnect"
        onclick={handleLeaveVoice}
      >
        <Icon name="phone-off" size={20} strokeWidth={2.5} />
      </button>
    </div>
  </div>
{/if}

<style>
  .voice-status {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-top: 1px solid var(--glass-border);
    background: rgba(0, 0, 0, 0.1);
  }

  .voice-status-info {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-out);
    flex: 1;
    min-width: 0;
  }

  .voice-status-info:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .wifi-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .voice-status-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .voice-status-label {
    color: var(--success);
    font-weight: 800;
    font-size: 0.8rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }

  .voice-status-ping {
    color: var(--text-dim);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .voice-status-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .voice-status-btn, .voice-disconnect-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-elastic);
    border: 1px solid var(--glass-border);
    cursor: pointer;
    background: rgba(255, 255, 255, 0.03);
    outline: none;
  }

  .voice-status-btn {
    color: var(--text-icon);
  }

  .voice-status-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    transform: scale(1.05);
  }

  .voice-status-btn.active-screen {
    color: var(--success);
    background: rgba(52, 211, 153, 0.1);
    border-color: rgba(52, 211, 153, 0.2);
  }

  .voice-disconnect-btn {
    color: var(--danger);
  }

  .voice-disconnect-btn:hover {
    background: rgba(248, 113, 113, 0.1);
    color: var(--danger);
    transform: scale(1.05);
    border-color: rgba(248, 113, 113, 0.2);
  }
</style>
