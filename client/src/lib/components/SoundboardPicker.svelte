<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { sendWs } from '$lib/ws';
  import { soundboardVolume } from '$lib/stores/settings';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId } from '$lib/stores/servers';
  import Icon from './Icon.svelte';

  let sounds = $state<any[]>([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      const serverId = getActiveServerId();
      sounds = await api.get<any[]>(`/api/servers/${serverId}/soundboard`);
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  });

  function playSound(soundId: string) {
    sendWs({ type: 'soundboard:play', soundId });
  }

  function handleSliderDown(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    updateSlider(e, el);

    const move = (ev: PointerEvent) => updateSlider(ev, el);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function updateSlider(e: PointerEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const pct = Math.round(
      Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
    );
    $soundboardVolume = pct;
  }
</script>

<div class="soundboard-container">
  <div class="sb-header">
    <div class="header-left">
      <Icon name="music" size={18} />
      <span>Soundboard</span>
    </div>
    <div class="sb-volume">
      <Icon name="volume" size={14} class="volume-icon" />
      <div
        class="custom-slider"
        onpointerdown={handleSliderDown}
        role="slider"
        aria-valuenow={$soundboardVolume}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class="slider-track">
          <div class="slider-fill" style="width: {$soundboardVolume}%"></div>
        </div>
        <div class="slider-thumb" style="left: {$soundboardVolume}%"></div>
      </div>
      <span class="volume-value">{$soundboardVolume}</span>
    </div>
  </div>

  <div class="sb-content scrollable">
    {#if loading}
      <div class="sb-status">
        <div class="spinner"></div>
        <span>Loading sounds...</span>
      </div>
    {:else if sounds.length === 0}
      <div class="sb-status">
        <Icon name="music" size={32} class="empty-icon" />
        <p>No sounds available</p>
      </div>
    {:else}
      <div class="sb-grid">
        {#each sounds as sound (sound.id)}
          <button class="sb-btn" onclick={() => playSound(sound.id)} title={sound.name}>
            <div class="sb-btn-inner">
              <div class="sb-icon-wrap">
                {#if sound.emoji_stored_name}
                  <img
                    class="sb-emoji"
                    src={resolveAsset(`/uploads/${sound.emoji_stored_name}`)}
                    alt=""
                  />
                {:else if sound.emoji}
                  <span class="sb-emoji-unicode">{sound.emoji}</span>
                {:else}
                  <Icon name="play" size={12} />
                {/if}
              </div>
              <span class="sb-name">{sound.name}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .soundboard-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 440px;
    background: transparent;
  }

  .sb-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    font-size: 1rem;
    color: white;
    letter-spacing: -0.01em;
  }

  .sb-volume {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 0, 0, 0.3);
    padding: 8px 14px;
    border-radius: 20px;
    border: 1px solid var(--glass-border);
    box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
  }

  .volume-icon {
    color: var(--text-dim);
    opacity: 0.8;
  }

  .volume-value {
    font-size: 0.75rem;
    color: white;
    min-width: 24px;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
    text-align: right;
  }

  .sb-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    min-height: 200px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.05) transparent;
  }

  .sb-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    color: var(--text-dim);
    gap: 16px;
    text-align: center;
  }

  .empty-icon {
    opacity: 0.2;
  }

  .sb-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .sb-btn {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    padding: 10px;
    cursor: pointer;
    transition: all 0.3s var(--ease-elastic);
    text-align: left;
    color: var(--text-muted);
    outline: none;
  }

  .sb-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
    color: white;
    transform: scale(1.02) translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .sb-btn:active {
    transform: scale(0.95);
  }

  .sb-btn-inner {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .sb-icon-wrap {
    width: 36px;
    height: 36px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.3s var(--ease-elastic);
    border: 1px solid var(--glass-border);
  }

  .sb-btn:hover .sb-icon-wrap {
    background: var(--accent);
    color: white;
    border-color: transparent;
    box-shadow: 0 0 15px var(--accent-glow);
    transform: scale(1.1) rotate(5deg);
  }

  .sb-emoji {
    width: 22px;
    height: 22px;
    object-fit: contain;
  }

  .sb-emoji-unicode {
    font-size: 1.4rem;
    line-height: 1;
  }

  .sb-name {
    font-size: 0.9rem;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }

  .custom-slider {
    position: relative;
    width: 80px;
    height: 16px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .slider-track {
    width: 100%;
    height: 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .slider-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    box-shadow: 0 0 8px var(--accent-glow);
  }

  .slider-thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
    pointer-events: none;
    border: 2px solid var(--accent);
    transition: transform 0.2s;
  }

  .custom-slider:hover .slider-thumb {
    transform: translate(-50%, -50%) scale(1.2);
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.05);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>

