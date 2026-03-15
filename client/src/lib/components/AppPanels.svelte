<script lang="ts">
  import {
    showSoundboardPanel,
    showWatchUrlPanel,
    showVoiceChangerPanel,
    showPollsPanel,
    showPingGraph,
    pingMs,
  } from '$lib/stores/media';
  import { serverSettings } from '$lib/stores/serverSettings';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { startWatch } from '$lib/stores/watchTogether';
  import SoundboardPicker from './SoundboardPicker.svelte';
  import VoiceChangerPanel from './VoiceChangerPanel.svelte';
  import PollPanel from './PollPanel.svelte';
  import Icon from './Icon.svelte';
  import { untrack } from 'svelte';

  const canUseApps = hasPermissionStore('use_apps');

  let watchUrlValue = $state('');
  let pingHistory = $state<{ time: number; ms: number }[]>([]);

  // Track ping history (last 30 seconds)
  $effect(() => {
    const ms = $pingMs;
    if (ms !== null) {
      const now = Date.now();
      const prev = untrack(() => pingHistory);
      // Keep 30 seconds of history for a better graph
      pingHistory = [...prev.filter((p) => now - p.time < 30000), { time: now, ms }];
    }
  });

  // Graph calculations
  const maxPing = $derived(Math.max(100, ...pingHistory.map(p => p.ms), $pingMs || 0));
  const avgPing = $derived(pingHistory.length ? Math.round(pingHistory.reduce((a, b) => a + b.ms, 0) / pingHistory.length) : 0);
  
  const graphPoints = $derived.by(() => {
    if (pingHistory.length < 2) return "";
    const now = Date.now();
    const width = 280;
    const height = 80;
    
    // Ensure history is sorted by time and within 30s
    const history = pingHistory
      .filter(p => now - p.time <= 30000)
      .sort((a, b) => a.time - b.time);
      
    if (history.length < 2) return "";

    return history.map((p) => {
      // Map time to X: (time - start) / 30000 * width
      // We want "Now" to be on the right (x=280)
      const x = width - ((now - p.time) / 30000) * width;
      const y = height - (p.ms / maxPing) * height;
      return `${Math.max(0, Math.min(width, x))},${Math.max(0, Math.min(height, y))}`;
    }).join(" ");
  });

  function submitWatchUrl() {
    const url = watchUrlValue.trim();
    startWatch(url || undefined);
    $showWatchUrlPanel = false;
    watchUrlValue = '';
  }
</script>

{#if $showSoundboardPanel && $canUseApps && $serverSettings.enabled_apps.includes('soundboard')}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="app-panel-backdrop" onclick={() => ($showSoundboardPanel = false)}></div>
  <div class="app-panel-fixed app-panel-style">
    <SoundboardPicker />
  </div>
{/if}

{#if $showVoiceChangerPanel && $canUseApps && $serverSettings.enabled_apps.includes('voice-changer')}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="app-panel-backdrop" onclick={() => ($showVoiceChangerPanel = false)}></div>
  <div class="app-panel-fixed app-panel-style">
    <VoiceChangerPanel />
  </div>
{/if}

{#if $showPollsPanel && $canUseApps && $serverSettings.enabled_apps.includes('polls')}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="app-panel-backdrop" onclick={() => ($showPollsPanel = false)}></div>
  <div class="app-panel-fixed app-panel-style">
    <PollPanel />
  </div>
{/if}

{#if $showWatchUrlPanel && $canUseApps && $serverSettings.enabled_apps.includes('watch-party')}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="app-panel-backdrop" onclick={() => ($showWatchUrlPanel = false)}></div>
  <div class="app-panel-fixed app-panel-style watch-url-popup">
    <div class="watch-url-header">
      <div class="watch-url-icon">
        <Icon name="play" size={24} />
      </div>
      <span class="watch-url-title">Watch Together</span>
    </div>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        submitWatchUrl();
      }}
    >
      <input
        type="text"
        class="watch-url-input"
        placeholder="Paste a YouTube URL..."
        bind:value={watchUrlValue}
        onkeydown={(e) => {
          if (e.key === 'Escape') $showWatchUrlPanel = false;
        }}
        autofocus
      />
      <button type="submit" class="watch-url-submit" disabled={!watchUrlValue.trim()}>
        <span>Watch</span>
        <Icon name="arrow-right" size={16} strokeWidth={2.5} />
      </button>
    </form>
    <div class="watch-url-divider">
      <span>or</span>
    </div>
    <button
      class="watch-start-empty"
      onclick={() => {
        startWatch();
        $showWatchUrlPanel = false;
      }}
    >
      <Icon name="plus" size={14} strokeWidth={2.5} />
      Start empty session
    </button>
  </div>
{/if}

{#if $showPingGraph}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="app-panel-backdrop" onclick={() => ($showPingGraph = false)}></div>
  <div class="app-panel-fixed app-panel-style ping-panel">
    <div class="ping-header">
      <div class="ping-title-group">
        <Icon name="activity" size={16} color="var(--success)" />
        <span class="ping-title">Connection Status</span>
      </div>
      <div class="ping-current">
        <span class="ping-value">{$pingMs || 0}</span>
        <span class="ping-unit">ms</span>
      </div>
    </div>

    <div class="ping-stats">
      <div class="stat-item">
        <span class="stat-label">AVERAGE</span>
        <span class="stat-value">{avgPing}ms</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">PEAK</span>
        <span class="stat-value">{maxPing === 100 && pingHistory.every(p => p.ms < 100) ? Math.max(...pingHistory.map(p => p.ms), 0) : maxPing}ms</span>
      </div>
    </div>

    <div class="ping-graph-container">
      <svg viewBox="0 0 280 80" class="ping-svg">
        <!-- Grid Lines -->
        <line x1="0" y1="0" x2="280" y2="0" class="grid-line" />
        <line x1="0" y1="40" x2="280" y2="40" class="grid-line" />
        <line x1="0" y1="80" x2="280" y2="80" class="grid-line" />
        
        {#if graphPoints}
          {@const points = graphPoints.split(' ')}
          {@const firstX = points[0].split(',')[0]}
          {@const lastX = points[points.length - 1].split(',')[0]}
          <!-- Area under the curve -->
          <polyline
            points="{firstX},80 {graphPoints} {lastX},80"
            class="graph-area"
          />
          <!-- The line itself -->
          <polyline
            points={graphPoints}
            class="graph-line"
          />
        {/if}
      </svg>
      <div class="graph-labels">
        <span>30s ago</span>
        <span>Now</span>
      </div>
    </div>

    <div class="connection-info">
      <div class="info-row">
        <span class="info-label">Protocol</span>
        <span class="info-value">WebRTC / Opus</span>
      </div>
      <div class="info-row">
        <span class="info-label">Encryption</span>
        <span class="info-value">SRTP (DTLS)</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .app-panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: transparent;
  }

  .app-panel-fixed {
    position: fixed;
    bottom: 80px;
    left: calc(var(--nav-dock-width) + 12px);
    width: 320px;
    z-index: 1001;
    animation: panelIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes panelIn {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .app-panel-style {
    background: rgba(15, 15, 25, 0.85);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    box-shadow: 
      0 20px 50px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.05);
    overflow: hidden;
  }

  /* Watch Together Specific */
  .watch-url-popup {
    padding: 24px;
  }

  .watch-url-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
    text-align: center;
  }

  .watch-url-icon {
    width: 48px;
    height: 48px;
    background: var(--accent);
    color: white;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-glow);
  }

  .watch-url-title {
    font-size: 1.25rem;
    font-weight: 800;
    color: white;
    letter-spacing: -0.01em;
  }

  .watch-url-popup form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .watch-url-input {
    width: 100%;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    font-size: var(--font-sm);
    outline: none;
    transition: all 0.2s;
  }

  .watch-url-input:focus {
    border-color: var(--accent);
    background: rgba(0, 0, 0, 0.4);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .watch-url-submit {
    padding: 12px;
    background: var(--accent);
    color: white;
    font-weight: 700;
    font-size: 1rem;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .watch-url-submit:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: var(--shadow-glow);
  }

  .watch-url-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .watch-url-divider {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 20px 0;
    color: var(--text-dim);
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .watch-url-divider::before, .watch-url-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .watch-start-empty {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 600;
    border-radius: 6px;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .watch-start-empty:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  /* Ping Panel */
  .ping-panel {
    padding: 16px;
    width: 320px;
    background: rgba(10, 10, 15, 0.95);
  }

  .ping-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .ping-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ping-title {
    font-size: 0.9rem;
    font-weight: 700;
    color: white;
    letter-spacing: -0.01em;
  }

  .ping-current {
    display: flex;
    align-items: baseline;
    gap: 2px;
  }

  .ping-value {
    font-size: 1.2rem;
    font-weight: 900;
    color: var(--success);
    font-variant-numeric: tabular-nums;
  }

  .ping-unit {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-dim);
  }

  .ping-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 20px;
  }

  .stat-item {
    background: rgba(255, 255, 255, 0.03);
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .stat-label {
    display: block;
    font-size: 0.6rem;
    font-weight: 800;
    color: var(--text-dim);
    margin-bottom: 2px;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.9rem;
    font-weight: 700;
    color: white;
  }

  .ping-graph-container {
    margin-bottom: 20px;
    position: relative;
  }

  .ping-svg {
    width: 100%;
    height: 80px;
    overflow: visible;
  }

  .grid-line {
    stroke: rgba(255, 255, 255, 0.05);
    stroke-width: 1;
  }

  .graph-line {
    fill: none;
    stroke: var(--success);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .graph-area {
    fill: rgba(34, 197, 94, 0.1);
    stroke: none;
  }

  .graph-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-dim);
  }

  .connection-info {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
  }

  .info-label {
    color: var(--text-dim);
    font-weight: 600;
  }

  .info-value {
    color: var(--text-muted);
    font-weight: 500;
  }
</style>
