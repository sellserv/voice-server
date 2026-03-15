<script lang="ts">
  import { serverSettings } from '$lib/stores/serverSettings';
  import {
    inVoiceChannel,
    showSoundboardPanel,
    showWatchUrlPanel,
    showVoiceChangerPanel,
    showPollsPanel,
  } from '$lib/stores/media';
  import { watchSession } from '$lib/stores/watchTogether';
  import { toast } from '$lib/stores/toast';
  import { voiceChangerEnabled } from '$lib/stores/settings';
  import Icon from './Icon.svelte';

  let { onSelectApp, onclose }: { onSelectApp: (appId: string) => void; onclose?: () => void } =
    $props();

  function handleSoundboard() {
    if (!$inVoiceChannel) {
      toast.error('You must be in a voice channel or call to use the soundboard');
      onclose?.();
      return;
    }
    showSoundboardPanel.update((v) => !v);
    onclose?.();
  }

  function handleWatchTogether() {
    if (!$inVoiceChannel) {
      toast.error('You must be in a voice channel or call to use Watch Party');
      onclose?.();
      return;
    }
    if ($watchSession) {
      onclose?.();
    } else {
      showWatchUrlPanel.update((v) => !v);
      onclose?.();
    }
  }

  function handleVoiceChanger() {
    showVoiceChangerPanel.update((v) => !v);
    onclose?.();
  }

  function handlePolls() {
    showPollsPanel.update((v) => !v);
    onclose?.();
  }

  function handleEffects() {
    onSelectApp('effects');
    onclose?.();
  }

  let hasAnyApps = $derived($serverSettings.enabled_apps.length > 0);
</script>

<div class="apps-popover">
  <div class="apps-header">Apps</div>
  {#if hasAnyApps}
    <div class="apps-grid">
      {#if $serverSettings.enabled_apps.includes('soundboard')}
        <button class="app-item" onclick={handleSoundboard}>
          <div class="app-icon">
            <Icon name="music" size={20} />
          </div>
          <span class="app-label">Soundboard</span>
        </button>
      {/if}
      {#if $serverSettings.enabled_apps.includes('watch-party')}
        <button class="app-item" onclick={handleWatchTogether}>
          <div class="app-icon">
            <Icon name="play" size={20} />
          </div>
          <span class="app-label">{$watchSession ? 'Watch Party (active)' : 'Watch Party'}</span>
        </button>
      {/if}
      {#if $serverSettings.enabled_apps.includes('voice-changer')}
        <button class="app-item" onclick={handleVoiceChanger}>
          <div class="app-icon">
            <Icon name="mic" size={20} />
          </div>
          <span class="app-label">Voice Changer{$voiceChangerEnabled ? ' (on)' : ''}</span>
        </button>
      {/if}
      {#if $serverSettings.enabled_apps.includes('polls')}
        <button class="app-item" onclick={handlePolls}>
          <div class="app-icon">
            <Icon name="bar-chart" size={20} />
          </div>
          <span class="app-label">Polls</span>
        </button>
      {/if}
      {#if $serverSettings.enabled_apps.includes('effects')}
        <button class="app-item" onclick={handleEffects}>
          <div class="app-icon">
            <Icon name="star" size={20} />
          </div>
          <span class="app-label">Effects</span>
        </button>
      {/if}
    </div>
  {:else}
    <div class="apps-empty">
      <p>No apps are enabled.</p>
      <p>Ask a server admin to enable apps in Server Settings.</p>
    </div>
  {/if}
</div>

<style>
  .apps-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 12px;
    z-index: 100;
    width: 260px;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border-bright);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--glass-shadow);
    animation: appsIn 0.15s var(--ease-out);
  }

  @keyframes appsIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .apps-header {
    padding: 12px 16px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
  }

  .apps-grid {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .app-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s var(--ease-out);
    text-align: left;
    border: none;
    color: var(--text-muted);
  }

  .app-item:hover {
    background: var(--bg-hover);
    color: var(--text);
    transform: translateX(2px);
  }

  .app-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-mid);
    border-radius: 6px;
    color: var(--accent);
    flex-shrink: 0;
    transition: all 0.1s var(--ease-out);
  }

  .app-item:hover .app-icon {
    background: var(--accent);
    color: white;
    transform: scale(1.05);
  }

  .app-label {
    font-size: var(--font-md);
    font-weight: 500;
    flex: 1;
  }

  .apps-empty {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-dim);
    font-size: var(--font-sm);
    line-height: 1.5;
  }

  .apps-empty p {
    margin: 0;
  }

  .apps-empty p + p {
    margin-top: 8px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
