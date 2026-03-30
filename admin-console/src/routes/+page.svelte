<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  let stats = $derived(data.stats);
  let settings = $derived(form?.settings ?? data.settings);

  let registrationOpen = $derived(!!settings.allow_registration);
  let alphaBilling = $derived(!!settings.alpha_billing);
  let instanceName = $derived(settings.instance_name || 'SellServ Voice');
  let termsUrl = $derived(settings.terms_url || '');
  let privacyUrl = $derived(settings.privacy_url || '');

  let instanceNameInput = $state('');
  let termsUrlInput = $state('');
  let privacyUrlInput = $state('');

  $effect(() => {
    instanceNameInput = instanceName;
  });

  $effect(() => {
    termsUrlInput = termsUrl;
  });

  $effect(() => {
    privacyUrlInput = privacyUrl;
  });

  function formatBytes(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function confirmToggle(label: string, currentlyOn: boolean): boolean {
    const action = currentlyOn ? 'disable' : 'enable';
    return window.confirm(`Are you sure you want to ${action} ${label}?`);
  }
</script>

<h3 class="content-title">Overview</h3>

{#if stats}
  <div class="stats-grid">
    <div class="stat-card">
      <span class="stat-value">{stats.online}</span>
      <span class="stat-label">Online Now</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{stats.users}</span>
      <span class="stat-label">Total Users</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{stats.servers}</span>
      <span class="stat-label">Servers</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{stats.messages.toLocaleString()}</span>
      <span class="stat-label">Messages</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{stats.files.toLocaleString()}</span>
      <span class="stat-label">Files</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">{formatBytes(stats.disk_usage_bytes)}</span>
      <span class="stat-label">Disk Usage</span>
    </div>
    <div class="stat-card" class:alert={stats.open_reports > 0}>
      <span class="stat-value">{stats.open_reports}</span>
      <span class="stat-label">Open Reports</span>
    </div>
  </div>

  <div class="settings-section">
    <h4 class="section-title">Platform Settings</h4>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Instance Name</span>
        <span class="setting-desc">Shown on the login and registration page</span>
      </div>
      <form
        method="POST"
        action="?/updateSettings"
        use:enhance={() => {
          return async ({ update }) => { await update(); };
        }}
      >
        <input type="hidden" name="key" value="instance_name" />
        <div class="name-input-group">
          <input
            type="text"
            class="name-input"
            name="value"
            bind:value={instanceNameInput}
            maxlength="100"
          />
          {#if instanceNameInput.trim() !== instanceName}
            <button type="submit" class="save-btn">Save</button>
          {/if}
        </div>
      </form>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">User Registration</span>
        <span class="setting-desc">Allow new users to create accounts</span>
      </div>
      <form
        method="POST"
        action="?/updateSettings"
        use:enhance={({ cancel }) => {
          if (!confirmToggle('User Registration', registrationOpen)) {
            cancel();
            return;
          }
          return async ({ update }) => { await update(); };
        }}
      >
        <input type="hidden" name="key" value="allow_registration" />
        <input type="hidden" name="value" value={(!registrationOpen).toString()} />
        <button type="submit" class="toggle-btn" class:active={registrationOpen}>
          <span class="toggle-knob"></span>
        </button>
      </form>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Alpha Billing</span>
        <span class="setting-desc">Give all users Pro features for free during alpha</span>
      </div>
      <form
        method="POST"
        action="?/updateSettings"
        use:enhance={({ cancel }) => {
          if (!confirmToggle('Alpha Billing', alphaBilling)) {
            cancel();
            return;
          }
          return async ({ update }) => { await update(); };
        }}
      >
        <input type="hidden" name="key" value="alpha_billing" />
        <input type="hidden" name="value" value={(!alphaBilling).toString()} />
        <button type="submit" class="toggle-btn" class:active={alphaBilling}>
          <span class="toggle-knob"></span>
        </button>
      </form>
    </div>

    <h4 class="section-title" style="margin-top: 24px;">Legal</h4>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Terms of Service URL</span>
        <span class="setting-desc">Shown as a required checkbox on registration</span>
      </div>
      <form
        method="POST"
        action="?/updateSettings"
        use:enhance={() => {
          return async ({ update }) => { await update(); };
        }}
      >
        <input type="hidden" name="key" value="terms_url" />
        <div class="name-input-group">
          <input
            type="url"
            class="name-input"
            name="value"
            bind:value={termsUrlInput}
            placeholder="https://example.com/terms"
          />
          {#if termsUrlInput.trim() !== termsUrl}
            <button type="submit" class="save-btn">Save</button>
          {/if}
        </div>
      </form>
    </div>

    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Privacy Policy URL</span>
        <span class="setting-desc">Shown as a required checkbox on registration</span>
      </div>
      <form
        method="POST"
        action="?/updateSettings"
        use:enhance={() => {
          return async ({ update }) => { await update(); };
        }}
      >
        <input type="hidden" name="key" value="privacy_url" />
        <div class="name-input-group">
          <input
            type="url"
            class="name-input"
            name="value"
            bind:value={privacyUrlInput}
            placeholder="https://example.com/privacy"
          />
          {#if privacyUrlInput.trim() !== privacyUrl}
            <button type="submit" class="save-btn">Save</button>
          {/if}
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .stat-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-card.alert { border-color: var(--danger); }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 800;
    color: white;
  }

  .stat-card.alert .stat-value { color: var(--danger); }

  .stat-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .settings-section {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }

  .section-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .setting-row + .setting-row {
    margin-top: -1px;
  }

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text);
  }

  .setting-desc {
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .name-input-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name-input {
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    padding: 6px 10px;
    font-size: 0.85rem;
    width: 200px;
    outline: none;
  }

  .name-input:focus {
    border-color: var(--accent);
  }

  .save-btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .save-btn:hover {
    filter: brightness(1.1);
  }

  .toggle-btn {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    cursor: pointer;
    position: relative;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .toggle-btn.active {
    background: var(--accent);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s;
  }

  .toggle-btn.active .toggle-knob {
    transform: translateX(20px);
  }

  form {
    display: flex;
    align-items: center;
  }
</style>
