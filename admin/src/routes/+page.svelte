<script lang="ts">
  import { api } from '$lib/api';

  let stats: any = $state(null);
  let loading = $state(true);
  let error = $state('');

  // Settings
  let registrationOpen = $state(true);
  let alphaBilling = $state(false);
  let instanceName = $state('SellServ Voice');
  let instanceNameInput = $state('SellServ Voice');
  let termsUrl = $state('');
  let termsUrlInput = $state('');
  let privacyUrl = $state('');
  let privacyUrlInput = $state('');

  function formatBytes(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const [st, is] = await Promise.all([
        api.get<any>('/api/admin/stats'),
        api.get<any>('/api/admin/instance-settings'),
      ]);
      stats = st;
      registrationOpen = !!is.allow_registration;
      alphaBilling = !!is.alpha_billing;
      instanceName = is.instance_name || 'SellServ Voice';
      instanceNameInput = instanceName;
      termsUrl = is.terms_url || '';
      termsUrlInput = termsUrl;
      privacyUrl = is.privacy_url || '';
      privacyUrlInput = privacyUrl;
    } catch (e: any) {
      error = e.message || 'Failed to load data';
    } finally {
      loading = false;
    }
  }

  async function toggleRegistration() {
    const action = registrationOpen ? 'disable' : 'enable';
    const message = registrationOpen
      ? 'Are you sure you want to disable registration? New users will not be able to create accounts.'
      : 'Are you sure you want to enable registration? Anyone with access to the site will be able to create an account.';
    if (!window.confirm(message)) return;
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { allow_registration: !registrationOpen });
      registrationOpen = !!result.allow_registration;
    } catch (e: any) {
      error = e?.message || 'Failed to update settings';
    }
  }

  async function toggleAlphaBilling() {
    const message = alphaBilling
      ? 'Are you sure you want to disable alpha billing? Users will need a Pro subscription to access premium features.'
      : 'Are you sure you want to enable alpha billing? All users will get Pro features for free.';
    if (!window.confirm(message)) return;
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { alpha_billing: !alphaBilling });
      alphaBilling = !!result.alpha_billing;
    } catch (e: any) {
      error = e?.message || 'Failed to update settings';
    }
  }

  async function saveInstanceName() {
    if (!instanceNameInput.trim() || instanceNameInput.trim() === instanceName) return;
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { instance_name: instanceNameInput.trim() });
      instanceName = result.instance_name || 'SellServ Voice';
      instanceNameInput = instanceName;
    } catch (e: any) {
      error = e?.message || 'Failed to update instance name';
    }
  }

  async function saveTermsUrl() {
    if (termsUrlInput.trim() === termsUrl) return;
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { terms_url: termsUrlInput.trim() });
      termsUrl = result.terms_url || '';
      termsUrlInput = termsUrl;
    } catch (e: any) {
      error = e?.message || 'Failed to update Terms URL';
    }
  }

  async function savePrivacyUrl() {
    if (privacyUrlInput.trim() === privacyUrl) return;
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { privacy_url: privacyUrlInput.trim() });
      privacyUrl = result.privacy_url || '';
      privacyUrlInput = privacyUrl;
    } catch (e: any) {
      error = e?.message || 'Failed to update Privacy URL';
    }
  }

  $effect(() => {
    loadData();
  });
</script>

<h1 class="page-title">Dashboard</h1>

{#if loading}
  <div class="status-box">
    <p>Loading dashboard data...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
    <button class="retry-btn" onclick={loadData}>Retry</button>
  </div>
{:else if stats}
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
    <h2 class="section-title">Platform Settings</h2>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Instance Name</span>
        <span class="setting-desc">Shown on the login and registration page</span>
      </div>
      <div class="input-group">
        <input
          type="text"
          class="setting-input"
          bind:value={instanceNameInput}
          maxlength="100"
          onkeydown={(e) => e.key === 'Enter' && saveInstanceName()}
        />
        {#if instanceNameInput.trim() !== instanceName}
          <button class="save-btn" onclick={saveInstanceName}>Save</button>
        {/if}
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">User Registration</span>
        <span class="setting-desc">Allow new users to create accounts</span>
      </div>
      <button
        class="toggle-btn"
        class:active={registrationOpen}
        onclick={toggleRegistration}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Alpha Billing</span>
        <span class="setting-desc">Give all users Pro features for free during alpha</span>
      </div>
      <button
        class="toggle-btn"
        class:active={alphaBilling}
        onclick={toggleAlphaBilling}
      >
        <span class="toggle-knob"></span>
      </button>
    </div>

    <h2 class="section-title" style="margin-top: 24px;">Legal</h2>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Terms of Service URL</span>
        <span class="setting-desc">Shown as a required checkbox on registration</span>
      </div>
      <div class="input-group">
        <input
          type="url"
          class="setting-input"
          bind:value={termsUrlInput}
          placeholder="https://example.com/terms"
          onkeydown={(e) => e.key === 'Enter' && saveTermsUrl()}
        />
        {#if termsUrlInput.trim() !== termsUrl}
          <button class="save-btn" onclick={saveTermsUrl}>Save</button>
        {/if}
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Privacy Policy URL</span>
        <span class="setting-desc">Shown as a required checkbox on registration</span>
      </div>
      <div class="input-group">
        <input
          type="url"
          class="setting-input"
          bind:value={privacyUrlInput}
          placeholder="https://example.com/privacy"
          onkeydown={(e) => e.key === 'Enter' && savePrivacyUrl()}
        />
        {#if privacyUrlInput.trim() !== privacyUrl}
          <button class="save-btn" onclick={savePrivacyUrl}>Save</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .page-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 24px;
  }

  .status-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .status-box.error {
    color: var(--danger);
  }

  .retry-btn {
    padding: 8px 16px;
    background: var(--bg-light);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--bg-mid);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 16px;
  }

  .stat-card {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat-card.alert {
    border-color: var(--danger);
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 800;
    color: white;
  }

  .stat-card.alert .stat-value {
    color: var(--danger);
  }

  .stat-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.05em;
  }

  .settings-section {
    margin-top: 32px;
    padding-top: 24px;
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
    border-radius: 6px;
    margin-bottom: 8px;
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

  .input-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .setting-input {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    padding: 6px 10px;
    font-size: 0.85rem;
    width: 220px;
    outline: none;
  }

  .setting-input:focus {
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
</style>
