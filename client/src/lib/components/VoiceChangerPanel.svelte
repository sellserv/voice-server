<script lang="ts">
  import {
    voiceChangerEnabled,
    voiceChangerPreset,
    voiceChangerIntensity,
  } from '$lib/stores/settings';
  import { applyVoiceChanger } from '$lib/webrtc';
  import {
    VOICE_PRESETS,
    updateVoiceChangerIntensity,
    type VoicePresetId,
  } from '$lib/voiceChanger';

  async function toggleEnabled() {
    voiceChangerEnabled.set(!$voiceChangerEnabled);
    await applyVoiceChanger();
  }

  async function selectPreset(id: VoicePresetId) {
    voiceChangerPreset.set(id);
    if ($voiceChangerEnabled) {
      await applyVoiceChanger();
    }
  }

  async function handleIntensity(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    voiceChangerIntensity.set(value);
    if ($voiceChangerEnabled) {
      updateVoiceChangerIntensity(value);
    }
  }

  function handleSliderDown(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    updateSliderFromPointer(e, el);

    const move = (ev: PointerEvent) => updateSliderFromPointer(ev, el);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function updateSliderFromPointer(e: PointerEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const value = Math.round(
      Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
    );
    voiceChangerIntensity.set(value);
    if ($voiceChangerEnabled) {
      updateVoiceChangerIntensity(value);
    }
  }
</script>

<div class="vc-popover">
  <div class="vc-header">
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path
        d="M19 10v2a7 7 0 0 1-14 0v-2"
      /></svg
    >
    <span>Voice Changer</span>
    <button class="vc-toggle" class:active={$voiceChangerEnabled} onclick={toggleEnabled}>
      <span class="toggle-knob"></span>
    </button>
  </div>
  <div class="vc-presets">
    {#each VOICE_PRESETS as preset (preset.id)}
      <button
        class="vc-preset"
        class:selected={$voiceChangerPreset === preset.id}
        onclick={() => selectPreset(preset.id)}
        title={preset.description}
      >
        <div class="preset-icon-circle">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={preset.icon} />
          </svg>
          {#if $voiceChangerPreset === preset.id}
            <span class="preset-check">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                stroke-width="3"><polyline points="20 6 9 17 4 12" /></svg
              >
            </span>
          {/if}
        </div>
        <span class="vc-preset-name">{preset.name}</span>
      </button>
    {/each}
  </div>
  <div class="vc-slider">
    <span class="vc-slider-label">Intensity</span>
    <input
      type="range"
      min="0"
      max="100"
      value={$voiceChangerIntensity}
      oninput={handleIntensity}
      class="sr-only"
    />
    <div
      class="custom-slider"
      onpointerdown={handleSliderDown}
      role="slider"
      aria-valuenow={$voiceChangerIntensity}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div class="slider-track">
        <div class="slider-fill" style="width: {$voiceChangerIntensity}%"></div>
      </div>
      <div class="slider-thumb" style="left: {$voiceChangerIntensity}%"></div>
    </div>
    <span class="vc-slider-value">{$voiceChangerIntensity}%</span>
  </div>
</div>

<style>
  .vc-popover {
    width: 100%;
    z-index: 100;
  }

  .vc-header {
    padding: 16px 20px;
    font-weight: 800;
    font-size: 1rem;
    color: white;
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    letter-spacing: -0.01em;
  }

  .vc-toggle {
    width: 44px;
    height: 24px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.1);
    position: relative;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    cursor: pointer;
    flex-shrink: 0;
    border: none;
    outline: none;
  }

  .vc-toggle.active {
    background: var(--success);
    box-shadow: 0 0 12px rgba(52, 211, 153, 0.3);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }

  .vc-toggle.active .toggle-knob {
    transform: translateX(20px);
  }

  .vc-presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 16px;
  }

  .vc-preset {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.02);
    color: var(--text-muted);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-weight: 700;
    transition: all 0.3s var(--ease-elastic);
    cursor: pointer;
    outline: none;
    text-align: left;
  }

  .vc-preset:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
    color: white;
    transform: translateY(-2px);
  }

  .vc-preset.selected {
    background: rgba(124, 92, 252, 0.1);
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 15px var(--accent-glow);
  }

  .preset-icon-circle {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    position: relative;
    transition: all 0.3s var(--ease-elastic);
    border: 1px solid var(--glass-border);
  }

  .vc-preset:hover .preset-icon-circle {
    transform: scale(1.1) rotate(5deg);
    background: rgba(255, 255, 255, 0.05);
  }

  .vc-preset.selected .preset-icon-circle {
    background: var(--accent);
    color: white;
    border-color: transparent;
    box-shadow: 0 0 10px var(--accent-glow);
  }

  .preset-check {
    position: absolute;
    bottom: -4px;
    right: -4px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    border: 2px solid var(--accent);
  }

  .vc-preset-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }

  .vc-slider {
    padding: 16px 20px 20px;
    border-top: 1px solid var(--glass-border);
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(0, 0, 0, 0.1);
  }

  .vc-slider-label {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .custom-slider {
    flex: 1;
    position: relative;
    height: 20px;
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

  .vc-slider-value {
    font-size: 0.8rem;
    color: white;
    min-width: 32px;
    text-align: right;
    font-weight: 800;
    font-family: 'JetBrains Mono', monospace;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
</style>
