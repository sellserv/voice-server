<script lang="ts">
  import { getUserVolume, setUserVolume, toggleUserMute } from '$lib/stores/settings';
  import { setUserAudioVolume } from '$lib/webrtc';
  import { sendWs } from '$lib/ws';
  import Icon from './Icon.svelte';

  let {
    userId,
    username,
    anchorX,
    anchorY,
    onclose,
    canDisconnect = false,
  }: {
    userId: string;
    username: string;
    anchorX: number;
    anchorY: number;
    onclose: () => void;
    canDisconnect?: boolean;
  } = $props();

  let saved = $state(getUserVolume(userId));
  let volume = $state(saved.volume);
  let muted = $state(saved.muted);

  let menuEl: HTMLDivElement | undefined = $state();

  // Clamp position to viewport
  let left = $derived.by(() => {
    const w = menuEl?.offsetWidth ?? 200;
    return Math.min(anchorX, window.innerWidth - w - 8);
  });
  let top = $derived.by(() => {
    const h = menuEl?.offsetHeight ?? 160;
    return Math.min(anchorY, window.innerHeight - h - 8);
  });

  function handleVolumeInput(e: Event) {
    volume = Number((e.target as HTMLInputElement).value);
    setUserVolume(userId, volume);
    setUserAudioVolume(userId, volume, muted);
  }

  function handleMuteToggle() {
    muted = toggleUserMute(userId);
    setUserAudioVolume(userId, volume, muted);
  }

  function handleDisconnect() {
    sendWs({ type: 'voice:disconnect', userId });
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
    <Icon name="users" size={14} class="header-icon" />
    <span class="header-text">{username}</span>
  </div>

  <div class="menu-group">
    <button class="menu-item" onclick={handleMuteToggle}>
      {#if muted}
        <Icon name="mic-off" size={16} class="menu-icon" />
        <span>Unmute User</span>
      {:else}
        <Icon name="mic" size={16} class="menu-icon" />
        <span>Mute User</span>
      {/if}
    </button>
  </div>

  <div class="menu-separator"></div>

  <div class="menu-section">
    <div class="section-label">
      <span>User Volume</span>
      <span class="volume-value">{muted ? 0 : volume}%</span>
    </div>
    <div class="slider-container">
      <input
        type="range"
        min="0"
        max="100"
        value={volume}
        disabled={muted}
        oninput={handleVolumeInput}
        class="volume-slider"
      />
    </div>
  </div>

  {#if canDisconnect}
    <div class="menu-separator"></div>
    <div class="menu-group">
      <button class="menu-item danger" onclick={handleDisconnect}>
        <Icon name="phone-off" size={16} class="menu-icon" />
        <span>Disconnect User</span>
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

  .menu-section {
    padding: 8px 12px;
  }

  .section-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .volume-value {
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .slider-container {
    display: flex;
    align-items: center;
    height: 20px;
  }

  .volume-slider {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-mid);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .volume-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    box-shadow: 0 0 10px rgba(var(--accent-rgb), 0.5);
    transition: transform 150ms;
  }

  .volume-slider::-webkit-slider-thumb:hover {
    transform: scale(1.2);
  }

  .volume-slider:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .menu-icon {
    opacity: 0.7;
  }

  .menu-item:hover .menu-icon {
    opacity: 1;
  }
</style>
