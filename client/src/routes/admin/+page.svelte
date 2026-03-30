<script lang="ts">
  import { api } from '$lib/api';
  import { confirm } from '$lib/stores/toast';
  import { officialInstance } from '$lib/stores/features';

  let stats: any = $state(null);
  let loading = $state(true);
  let error = $state('');
  let registrationOpen = $state(true);
  let alphaBilling = $state(false);
  let instanceName = $state('SellServ Voice');
  let instanceNameInput = $state('SellServ Voice');
  let termsUrl = $state('');
  let termsUrlInput = $state('');
  let privacyUrl = $state('');
  let privacyUrlInput = $state('');

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
    const confirmed = await confirm(message, {
      title: `${action.charAt(0).toUpperCase() + action.slice(1)} Registration`,
      confirmLabel: `${action.charAt(0).toUpperCase() + action.slice(1)} Registration`,
      dangerAction: registrationOpen,
    });
    if (!confirmed) return;
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { allow_registration: !registrationOpen });
      registrationOpen = !!result.allow_registration;
    } catch (e: any) {
      error = e?.message || 'Failed to update settings';
    }
  }

  async function toggleAlphaBilling() {
    const action = alphaBilling ? 'disable' : 'enable';
    const message = alphaBilling
      ? 'Are you sure you want to disable alpha billing? Users will need a Pro subscription to access premium features.'
      : 'Are you sure you want to enable alpha billing? All users will get Pro features for free.';
    const confirmed = await confirm(message, {
      title: `${action.charAt(0).toUpperCase() + action.slice(1)} Alpha Billing`,
      confirmLabel: `${action.charAt(0).toUpperCase() + action.slice(1)} Alpha Billing`,
      dangerAction: alphaBilling,
    });
    if (!confirmed) return;
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

  function formatBytes(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  $effect(() => {
    loadData();
  });
</script>

<h3 class="content-title">Overview</h3>

{#if loading}
  <div class="status-box">
    <div class="spinner"></div>
    <p>Loading instance data...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
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
    <h4 class="section-title">Platform Settings</h4>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Instance Name</span>
        <span class="setting-desc">Shown on the login and registration page</span>
      </div>
      <div class="name-input-group">
        <input
          type="text"
          class="name-input"
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
    {#if $officialInstance}
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
    {/if}

    <h4 class="section-title" style="margin-top: 24px;">Legal</h4>
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-name">Terms of Service URL</span>
        <span class="setting-desc">Shown as a required checkbox on registration</span>
      </div>
      <div class="name-input-group">
        <input
          type="url"
          class="name-input"
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
      <div class="name-input-group">
        <input
          type="url"
          class="name-input"
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

  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }
  .spinner {
    width: 32px; height: 32px; border: 3px solid var(--bg-light);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
