<script lang="ts">
  import { api } from '$lib/api';
  import { textChannels, loadChannels } from '$lib/stores/channels';
  import { toast } from '$lib/stores/toast';
  import type { Bot } from '@voip-server/shared';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId } from '$lib/stores/servers';

  interface AutomodConfig {
    blockedWords: string[];
    action: 'delete' | 'warn' | 'both';
    warnMessage?: string;
  }

  let bots = $state<Bot[]>([]);
  let savingBot = $state(false);
  let uploadingBotAvatar = $state<string | null>(null);

  // Automod editing state per bot
  let automodState = $state<Record<string, { words: string; action: string; warnMessage: string }>>({});

  function initAutomodState(botList: Bot[]) {
    const state: Record<string, { words: string; action: string; warnMessage: string }> = {};
    for (const bot of botList) {
      if (bot.type !== 'automod') continue;
      let parsed: AutomodConfig = { blockedWords: [], action: 'delete', warnMessage: '' };
      if (bot.config) {
        try { parsed = { ...parsed, ...JSON.parse(bot.config) }; } catch {}
      }
      state[bot.id] = {
        words: parsed.blockedWords.join(', '),
        action: parsed.action || 'delete',
        warnMessage: parsed.warnMessage || '',
      };
    }
    automodState = state;
  }

  $effect(() => {
    const serverId = getActiveServerId();
    api
      .get<Bot[]>(`/api/servers/${serverId}/bots`)
      .then((b) => {
        bots = b;
        initAutomodState(b);
      })
      .catch((err: any) => {
        toast.error(err.message || 'Failed to load bots');
      });
    loadChannels();
  });

  async function saveBot(bot: Bot) {
    savingBot = true;
    try {
      const serverId = getActiveServerId();
      const payload: Record<string, any> = {
        name: bot.name,
        channel_id: bot.channel_id,
        enabled: bot.enabled,
        greeting: bot.greeting,
        avatar_url: bot.avatar_url,
        dm_enabled: bot.dm_enabled,
        dm_greeting: bot.dm_greeting,
      };

      if (bot.type === 'automod' && automodState[bot.id]) {
        const state = automodState[bot.id];
        const config: AutomodConfig = {
          blockedWords: state.words.split(',').map(w => w.trim()).filter(Boolean),
          action: state.action as AutomodConfig['action'],
          warnMessage: state.warnMessage || undefined,
        };
        payload.config = JSON.stringify(config);
      }

      const updated = await api.put<Bot>(`/api/servers/${serverId}/bots/${bot.id}`, payload);
      bots = bots.map((b) => (b.id === updated.id ? updated : b));
      initAutomodState(bots);
      toast.success('Bot saved!');
    } catch (e: any) {
      toast.error('Error: ' + e.message);
    } finally {
      savingBot = false;
    }
  }

  async function handleBotAvatarUpload(bot: Bot) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      uploadingBotAvatar = bot.id;
      try {
        const result = await api.upload(file);
        bot.avatar_url = `/uploads/${result.stored_name}`;
      } catch (e: any) {
        toast.error('Error uploading avatar: ' + e.message);
      } finally {
        uploadingBotAvatar = null;
      }
    };
    input.click();
  }
</script>

<div class="section">
  <p class="section-desc">
    Configure server bots. Bots appear in the user list and can perform automated actions.
  </p>

  {#each bots as bot (bot.id)}
    <div class="edit-panel">
      <div class="bot-header">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="bot-avatar-picker" onclick={() => handleBotAvatarUpload(bot)}>
          {#if bot.avatar_url}
            <img src={resolveAsset(bot.avatar_url)} alt="" class="bot-avatar-img" />
          {:else}
            <span class="bot-avatar-initial">{bot.name.charAt(0).toUpperCase()}</span>
          {/if}
          <div class="bot-avatar-overlay">{uploadingBotAvatar === bot.id ? '...' : 'Edit'}</div>
        </div>
        <span class="bot-type-label">{bot.type === 'welcome' ? 'Welcome Bot' : bot.type === 'automod' ? 'Automod Bot' : bot.type}</span>
      </div>

      <div class="perm-row">
        <span>Enabled</span>
        <button
          class="toggle-btn"
          class:active={bot.enabled}
          aria-label="Toggle Bot Enabled"
          onclick={() => (bot.enabled = !bot.enabled)}
        >
          <span class="toggle-knob"></span>
        </button>
      </div>

      <label class="field">
        <span>Bot Name</span>
        <input type="text" class="text-input" bind:value={bot.name} maxlength="32" />
      </label>

      {#if bot.type === 'welcome'}
        <label class="field">
          <span>Channel</span>
          <select
            class="text-input"
            value={bot.channel_id ?? ''}
            onchange={(e) => (bot.channel_id = e.currentTarget.value || null)}
          >
            <option value="">None</option>
            {#each $textChannels as ch (ch.id)}
              <option value={ch.id} selected={ch.id === bot.channel_id}># {ch.name}</option>
            {/each}
          </select>
        </label>

        <label class="field">
          <span>Channel Greeting Message</span>
          <input type="text" class="text-input" bind:value={bot.greeting} maxlength="500" />
          <span class="hint">Use {'{user}'} as a placeholder for the new member's name</span>
        </label>

        <div class="divider"></div>

        <div class="perm-row">
          <span>DM New Users</span>
          <button
            class="toggle-btn"
            class:active={bot.dm_enabled}
            aria-label="Toggle DM New Users"
            onclick={() => (bot.dm_enabled = !bot.dm_enabled)}
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        {#if bot.dm_enabled}
          <label class="field">
            <span>DM Greeting Message</span>
            <textarea
              class="text-input dm-textarea"
              bind:value={bot.dm_greeting}
              maxlength="500"
              rows="3"
            ></textarea>
            <span class="hint"
              >Use {'{user}'} as a placeholder for the new member's name. Sent as a direct message.</span
            >
          </label>
        {/if}
      {/if}

      {#if bot.type === 'automod' && automodState[bot.id]}
        {@const state = automodState[bot.id]}
        <div class="divider"></div>

        <span class="config-heading">Automod Configuration</span>
        <span class="hint">Server owners and administrators are immune to automod filtering.</span>

        <label class="field">
          <span>Blocked Words</span>
          <textarea
            class="text-input dm-textarea"
            value={state.words}
            oninput={(e) => { state.words = e.currentTarget.value; automodState = { ...automodState }; }}
            placeholder="word1, word2, phrase three"
            rows="3"
          ></textarea>
          <span class="hint">Comma-separated list of words or phrases to filter</span>
        </label>

        <label class="field">
          <span>Action</span>
          <select
            class="text-input"
            value={state.action}
            onchange={(e) => { state.action = e.currentTarget.value; automodState = { ...automodState }; }}
          >
            <option value="delete">Delete Message</option>
            <option value="warn">Warn User</option>
            <option value="both">Delete & Warn</option>
          </select>
        </label>

        {#if state.action === 'warn' || state.action === 'both'}
          <label class="field">
            <span>Warning Message</span>
            <input
              type="text"
              class="text-input"
              value={state.warnMessage}
              oninput={(e) => { state.warnMessage = e.currentTarget.value; automodState = { ...automodState }; }}
              placeholder="Your message contained a blocked word."
              maxlength="500"
            />
          </label>
        {/if}
      {/if}

      <button class="action-btn primary" onclick={() => saveBot(bot)} disabled={savingBot}>
        {savingBot ? 'Saving...' : 'Save'}
      </button>
    </div>
  {:else}
    <p class="empty">No bots configured.</p>
  {/each}
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

  .edit-panel {
    padding: 16px;
    background: var(--bg-dark);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .bot-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .bot-type-label {
    font-weight: 600;
    font-size: 1rem;
  }

  .bot-avatar-picker {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-round);
    background: var(--bg-light);
    border: 1px solid var(--border-light);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
    transition: border-color 150ms var(--ease-out);
  }

  .bot-avatar-picker:hover {
    border-color: var(--accent);
  }

  .bot-avatar-picker:hover .bot-avatar-overlay {
    opacity: 1;
  }

  .bot-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .bot-avatar-initial {
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--accent);
  }

  .bot-avatar-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 150ms var(--ease-out);
  }

  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.9rem;
    color: var(--text-muted);
    padding: 4px 0;
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

  .divider {
    border-top: 1px solid var(--border-light);
    margin: 4px 0;
  }

  .dm-textarea {
    resize: vertical;
    min-height: 60px;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .config-heading {
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
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

  .empty {
    font-size: 0.85rem;
    color: var(--text-dim);
    text-align: center;
    padding: 20px;
  }
</style>
