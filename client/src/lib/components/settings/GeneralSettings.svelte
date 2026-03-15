<script lang="ts">
  import { api } from '$lib/api';
  import { serverSettings, loadServerSettings } from '$lib/stores/serverSettings';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId, activeServer } from '$lib/stores/servers';
  import { currentUser } from '$lib/stores/auth';
  import { voiceChannels } from '$lib/stores/channels';

  let { onclose }: { onclose: () => void } = $props();

  let serverName = $state($serverSettings.name);
  let iconPreview = $state<string | null>(
    $serverSettings.icon_url ? resolveAsset($serverSettings.icon_url) : null,
  );
  let iconFile = $state<File | null>(null);
  let afkChannelId = $state<string | null>($serverSettings.afk_channel_id);
  let afkTimeout = $state(Math.round(($serverSettings.afk_timeout || 300) / 60));
  let saving = $state(false);
  let iconFileInput: HTMLInputElement;

  function handleIconFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      iconFile = file;
      iconPreview = URL.createObjectURL(file);
    }
  }


  async function saveGeneral() {
    saving = true;
    try {
      const serverId = getActiveServerId();
      let icon_file_id: string | null | undefined = undefined;
      if (iconFile) {
        const result = await api.upload(iconFile);
        icon_file_id = result.fileId || result.id;
      }
      await api.put(`/api/servers/${serverId}/settings`, {
        name: serverName || undefined,
        icon_file_id,
        afk_channel_id: afkChannelId || null,
        afk_timeout: afkTimeout * 60,
      });
      await loadServerSettings();
    } finally {
      saving = false;
    }
  }
</script>

<div class="section">
  <label class="field">
    <span>Server Name</span>
    <input type="text" class="text-input" bind:value={serverName} maxlength="64" />
  </label>

  <div class="field">
    <span>Server Icon</span>
    <div class="icon-row">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="icon-preview" onclick={() => iconFileInput?.click()}>
        {#if iconPreview}
          <img src={iconPreview} alt="" class="icon-img" />
        {:else}
          <span class="icon-letter">{serverName?.charAt(0)?.toUpperCase() || 'S'}</span>
        {/if}
        <div class="icon-overlay">Edit</div>
      </div>
      <input
        type="file"
        accept="image/*"
        bind:this={iconFileInput}
        onchange={handleIconFile}
        style="display:none"
      />
    </div>
  </div>

  <div class="field">
    <span>AFK Voice Channel</span>
    <select class="text-input" bind:value={afkChannelId}>
      <option value="">None (disabled)</option>
      {#each $voiceChannels as ch}
        <option value={ch.id}>{ch.name}</option>
      {/each}
    </select>
    <span class="hint">Idle users in voice will be moved to this channel</span>
  </div>

  <div class="field">
    <span>AFK Timeout (minutes)</span>
    <input type="number" class="text-input" bind:value={afkTimeout} min="1" max="60" style="max-width: 120px" />
    <span class="hint">How long a user must be idle before being moved (1-60 min)</span>
  </div>

  <button class="save-btn" onclick={saveGeneral} disabled={saving}>
    {#if saving}<span class="spinner spinner-sm"></span> Saving...{:else}Save Changes{/if}
  </button>

</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field span {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .text-input {
    padding: 8px 12px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    font-family: var(--font);
    font-size: 14px;
    transition:
      border-color 150ms var(--ease-out),
      box-shadow 150ms var(--ease-out);
  }

  .text-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 8px var(--accent-glow);
    outline: none;
  }

  .icon-row {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .icon-preview {
    width: 72px;
    height: 72px;
    border-radius: var(--radius-round);
    background: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  .icon-preview:hover .icon-overlay {
    opacity: 1;
  }

  .icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .icon-letter {
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--accent);
  }

  .icon-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 150ms var(--ease-out);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.7;
  }

  .save-btn {
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

  .save-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 0 24px var(--accent-glow);
    transform: translateY(-1px);
  }

</style>
