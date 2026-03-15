<script lang="ts">
  import { api } from '$lib/api';
  import { serverSettings, loadServerSettings } from '$lib/stores/serverSettings';
  import { toast } from '$lib/stores/toast';
  import { getActiveServerId } from '$lib/stores/servers';

  let enabledApps = $state<string[]>($serverSettings.enabled_apps);
  let savingApps = $state(false);

  async function saveApps() {
    savingApps = true;
    try {
      const serverId = getActiveServerId();
      await api.put(`/api/servers/${serverId}/settings`, { enabled_apps: enabledApps });
      await loadServerSettings();
    } catch (e: any) {
      toast.error('Error: ' + e.message);
    } finally {
      savingApps = false;
    }
  }
</script>

<div class="section">
  <p class="section-desc">
    Enable or disable apps for this server. Members need the <strong>Use Apps</strong> permission to access
    enabled apps.
  </p>

  <div class="list">
    <div class="list-item">
      <div class="app-info">
        <span class="app-name">Soundboard</span>
        <span class="app-desc">Play sound effects in voice channels</span>
      </div>
      <button
        class="toggle-btn"
        class:active={enabledApps.includes('soundboard')}
        aria-label="Toggle Soundboard"
        onclick={() => {
          if (enabledApps.includes('soundboard')) {
            enabledApps = enabledApps.filter((a) => a !== 'soundboard');
          } else {
            enabledApps = [...enabledApps, 'soundboard'];
          }
        }}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>

    <div class="list-item">
      <div class="app-info">
        <span class="app-name">Watch Party</span>
        <span class="app-desc">Watch YouTube videos together in voice channels</span>
      </div>
      <button
        class="toggle-btn"
        class:active={enabledApps.includes('watch-party')}
        aria-label="Toggle Watch Party"
        onclick={() => {
          if (enabledApps.includes('watch-party')) {
            enabledApps = enabledApps.filter((a) => a !== 'watch-party');
          } else {
            enabledApps = [...enabledApps, 'watch-party'];
          }
        }}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>
    <div class="list-item">
      <div class="app-info">
        <span class="app-name">Voice Changer</span>
        <span class="app-desc">Apply voice effects and presets to your microphone</span>
      </div>
      <button
        class="toggle-btn"
        class:active={enabledApps.includes('voice-changer')}
        aria-label="Toggle Voice Changer"
        onclick={() => {
          if (enabledApps.includes('voice-changer')) {
            enabledApps = enabledApps.filter((a) => a !== 'voice-changer');
          } else {
            enabledApps = [...enabledApps, 'voice-changer'];
          }
        }}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>
    <div class="list-item">
      <div class="app-info">
        <span class="app-name">Polls</span>
        <span class="app-desc">Create and vote in real-time polls</span>
      </div>
      <button
        class="toggle-btn"
        class:active={enabledApps.includes('polls')}
        aria-label="Toggle Polls"
        onclick={() => {
          if (enabledApps.includes('polls')) {
            enabledApps = enabledApps.filter((a) => a !== 'polls');
          } else {
            enabledApps = [...enabledApps, 'polls'];
          }
        }}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>
    <div class="list-item">
      <div class="app-info">
        <span class="app-name">Effects</span>
        <span class="app-desc">Send visual effects like confetti to chat</span>
      </div>
      <button
        class="toggle-btn"
        class:active={enabledApps.includes('effects')}
        aria-label="Toggle Effects"
        onclick={() => {
          if (enabledApps.includes('effects')) {
            enabledApps = enabledApps.filter((a) => a !== 'effects');
          } else {
            enabledApps = [...enabledApps, 'effects'];
          }
        }}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>
  </div>

  <button
    class="action-btn primary"
    style="margin-top: 10px;"
    onclick={saveApps}
    disabled={savingApps}
  >
    {#if savingApps}<span class="spinner spinner-sm"></span> Saving...{:else}Save Changes{/if}
  </button>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-mid);
    border-radius: var(--radius);
  }

  .app-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .app-name {
    font-weight: 500;
    font-size: 0.9rem;
  }

  .app-desc {
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .toggle-btn {
    position: relative;
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: var(--bg-mid);
    border: 1px solid var(--border-light);
    cursor: pointer;
    transition: all 150ms var(--ease-out);
    padding: 0;
    flex-shrink: 0;
  }

  .toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text);
    transition: transform 150ms var(--ease-out);
  }

  .toggle-btn.active .toggle-knob {
    transform: translateX(20px);
  }

  .action-btn.primary {
    padding: 8px 22px;
    background: var(--accent);
    color: white;
    border-radius: var(--radius);
    font-weight: 700;
    font-size: 0.9rem;
    box-shadow: 0 0 16px var(--accent-glow);
    transition: all 150ms var(--ease-out);
    white-space: nowrap;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 0 24px var(--accent-glow);
    transform: translateY(-1px);
  }
</style>
