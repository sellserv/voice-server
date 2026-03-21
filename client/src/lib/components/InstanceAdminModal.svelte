<script lang="ts">
  import { api } from '$lib/api';
  import { resolveAsset } from '$lib/stores/server';
  import { confirm } from '$lib/stores/toast';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let activeTab = $state('stats');
  let stats: any = $state(null);
  let users: any[] = $state([]);
  let servers: any[] = $state([]);
  let reports: any[] = $state([]);
  let auditEntries: any[] = $state([]);
  let auditTotal = $state(0);
  let auditPage = $state(1);
  let loading = $state(true);
  let error = $state('');
  let registrationOpen = $state(true);
  let instanceName = $state('SellServ Voice');
  let instanceNameInput = $state('SellServ Voice');
  let minAppVersion = $state('0.0.0');
  let minAppVersionInput = $state('0.0.0');
  let reportFilter: 'open' | 'all' = $state('open');

  // User detail
  let selectedUser: any = $state(null);
  let userDetailLoading = $state(false);

  // Action states
  let actionLoading = $state('');

  async function loadData() {
    loading = true;
    error = '';
    try {
      const [st, u, s, r, a, is] = await Promise.all([
        api.get<any>('/api/admin/stats'),
        api.get<any[]>('/api/admin/users'),
        api.get<any[]>('/api/admin/servers'),
        api.get<any[]>('/api/admin/reports?status=open'),
        api.get<any>('/api/admin/audit-log?limit=50'),
        api.get<any>('/api/admin/instance-settings'),
      ]);
      stats = st;
      users = u;
      servers = s;
      reports = r;
      auditEntries = a.entries;
      auditTotal = a.total;
      registrationOpen = !!is.allow_registration;
      instanceName = is.instance_name || 'SellServ Voice';
      instanceNameInput = instanceName;
      minAppVersion = is.min_app_version || '0.0.0';
      minAppVersionInput = minAppVersion;
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

  async function saveMinAppVersion() {
    const trimmed = minAppVersionInput.trim();
    if (!trimmed || trimmed === minAppVersion) return;
    if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
      error = 'Version must be in format X.Y.Z';
      return;
    }
    try {
      const result = await api.patch<any>('/api/admin/instance-settings', { min_app_version: trimmed });
      minAppVersion = result.min_app_version || '0.0.0';
      minAppVersionInput = minAppVersion;
    } catch (e: any) {
      error = e?.message || 'Failed to update minimum app version';
    }
  }

  async function loadReports(filter: 'open' | 'all') {
    reportFilter = filter;
    try {
      const url = filter === 'open' ? '/api/admin/reports?status=open' : '/api/admin/reports';
      reports = await api.get<any[]>(url);
    } catch (e: any) {
      error = e.message || 'Failed to load reports';
    }
  }

  async function loadAuditPage(page: number) {
    try {
      const a = await api.get<any>(`/api/admin/audit-log?limit=50&page=${page}`);
      auditEntries = a.entries;
      auditTotal = a.total;
      auditPage = page;
    } catch (e: any) {
      error = e?.message || 'Failed to load audit log page';
    }
  }

  async function loadUserDetail(userId: string) {
    userDetailLoading = true;
    error = '';
    try {
      selectedUser = await api.get<any>(`/api/admin/users/${userId}`);
    } catch (e: any) {
      error = e?.message || 'Failed to load user details';
    } finally {
      userDetailLoading = false;
    }
  }

  async function toggleBan(user: any) {
    actionLoading = user.id;
    error = '';
    try {
      if (user.banned) {
        await api.post(`/api/admin/users/${user.id}/unban`);
      } else {
        await api.post(`/api/admin/users/${user.id}/ban`, { reason: 'Banned by instance admin' });
      }
      users = await api.get<any[]>('/api/admin/users');
      stats = await api.get<any>('/api/admin/stats');
      if (selectedUser?.id === user.id) {
        selectedUser = await api.get<any>(`/api/admin/users/${user.id}`);
      }
    } catch (e: any) {
      error = e?.message || 'Failed to update ban status';
    } finally {
      actionLoading = '';
    }
  }

  async function handleDeleteServer(serverId: string, serverName: string) {
    if (!confirm(`Delete server "${serverName}"? This cannot be undone.`)) return;
    actionLoading = serverId;
    error = '';
    try {
      await api.delete(`/api/admin/servers/${serverId}`);
      servers = servers.filter(s => s.id !== serverId);
      stats = await api.get<any>('/api/admin/stats');
    } catch (e: any) {
      error = e?.message || 'Failed to delete server';
    } finally {
      actionLoading = '';
    }
  }

  async function resolveReport(reportId: string, status: 'resolved' | 'dismissed') {
    actionLoading = reportId;
    error = '';
    try {
      await api.post(`/api/admin/reports/${reportId}`, { status });
      await loadReports(reportFilter);
      stats = await api.get<any>('/api/admin/stats');
    } catch (e: any) {
      error = e?.message || 'Failed to update report';
    } finally {
      actionLoading = '';
    }
  }

  $effect(() => {
    loadData();
  });

  function formatDate(iso: string) {
    return new Date(iso + 'Z').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }

  function formatDateTime(iso: string) {
    return new Date(iso + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  }

  function eventLabel(type: string) {
    const labels: Record<string, string> = {
      failed_login: 'Failed Login',
      successful_login: 'Login',
      password_change: 'Password Change',
      mfa_enable: 'MFA Enabled',
      mfa_disable: 'MFA Disabled',
      role_change: 'Role Change',
      user_ban: 'User Banned',
      user_unban: 'User Unbanned',
      permission_change: 'Permission Change',
      admin_settings_change: 'Settings Change',
      invite_create: 'Invite Created',
      invite_delete: 'Invite Deleted',
      platform_ban: 'Platform Ban',
      platform_unban: 'Platform Unban',
      report_submitted: 'Report Filed',
      report_resolved: 'Report Resolved',
      server_deleted: 'Server Deleted',
    };
    return labels[type] || type;
  }

  function eventColor(type: string) {
    if (type.includes('ban') || type === 'failed_login' || type === 'server_deleted') return 'var(--danger)';
    if (type.includes('unban') || type === 'successful_login') return 'var(--success)';
    if (type.includes('report')) return 'var(--warning)';
    return 'var(--text-dim)';
  }

  const TAB_LABELS: Record<string, string> = {
    stats: 'Overview',
    users: 'Users',
    servers: 'Servers',
    reports: 'Reports',
    audit: 'Audit Log',
  };

  let totalAuditPages = $derived(Math.ceil(auditTotal / 50));
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="sidebar">
      <div class="sidebar-inner">
        <h5 class="sidebar-title">Instance Admin</h5>
        <button class="sidebar-item" class:active={activeTab === 'stats'} onclick={() => activeTab = 'stats'}>Overview</button>
        <button class="sidebar-item" class:active={activeTab === 'users'} onclick={() => { activeTab = 'users'; selectedUser = null; }}>Users</button>
        <button class="sidebar-item" class:active={activeTab === 'servers'} onclick={() => activeTab = 'servers'}>Servers</button>
        <button class="sidebar-item" class:active={activeTab === 'reports'} onclick={() => activeTab = 'reports'}>
          Reports
          {#if stats?.open_reports > 0}
            <span class="badge">{stats.open_reports}</span>
          {/if}
        </button>
        <button class="sidebar-item" class:active={activeTab === 'audit'} onclick={() => activeTab = 'audit'}>Audit Log</button>
      </div>
    </div>

    <div class="content-area">
      <div class="content-wrapper">
        <h3 class="content-title">{TAB_LABELS[activeTab]}</h3>

        {#if loading}
          <div class="status-box">
            <div class="spinner"></div>
            <p>Loading instance data...</p>
          </div>
        {:else if error}
          <div class="status-box error">
            <Icon name="x" size={32} />
            <p>{error}</p>
          </div>

        {:else if activeTab === 'stats'}
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
                <span class="setting-name">Minimum App Version</span>
                <span class="setting-desc">Microsoft Store (AppX) users below this version will be forced to update</span>
              </div>
              <div class="name-input-group">
                <input
                  type="text"
                  class="name-input version-input"
                  bind:value={minAppVersionInput}
                  placeholder="0.0.0"
                  maxlength="20"
                  onkeydown={(e) => e.key === 'Enter' && saveMinAppVersion()}
                />
                {#if minAppVersionInput.trim() !== minAppVersion}
                  <button class="save-btn" onclick={saveMinAppVersion}>Save</button>
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
          </div>

        {:else if activeTab === 'users'}
          {#if selectedUser}
            <button class="back-btn" onclick={() => selectedUser = null}>
              <Icon name="chevron-down" size={16} style="transform: rotate(90deg)" />
              Back to users
            </button>
            {#if userDetailLoading}
              <div class="status-box"><div class="spinner"></div></div>
            {:else}
              <div class="user-detail-card">
                <div class="detail-header">
                  <div class="detail-avatar">
                    {#if selectedUser.avatar_url}
                      <img src={resolveAsset(selectedUser.avatar_url)} alt="" />
                    {:else}
                      <span class="avatar-initial">{selectedUser.username.charAt(0).toUpperCase()}</span>
                    {/if}
                  </div>
                  <div class="detail-names">
                    <span class="detail-display">{selectedUser.display_name || selectedUser.username}</span>
                    <span class="detail-username">@{selectedUser.username}</span>
                    {#if selectedUser.banned}
                      <span class="badge-banned">BANNED</span>
                    {/if}
                  </div>
                </div>
                <div class="detail-grid">
                  <div class="detail-field">
                    <span class="field-label">Email</span>
                    <span class="field-value">{selectedUser.email || 'None'}</span>
                  </div>
                  <div class="detail-field">
                    <span class="field-label">Last IP</span>
                    <span class="field-value mono">{selectedUser.last_ip || 'Unknown'}</span>
                  </div>
                  <div class="detail-field">
                    <span class="field-label">Messages</span>
                    <span class="field-value">{selectedUser.message_count?.toLocaleString()}</span>
                  </div>
                  <div class="detail-field">
                    <span class="field-label">Joined</span>
                    <span class="field-value">{formatDate(selectedUser.created_at)}</span>
                  </div>
                </div>
                
                {#if selectedUser.servers?.length}
                  <div class="detail-section">
                    <span class="section-title">Servers — {selectedUser.servers.length}</span>
                    <div class="server-tags">
                      {#each selectedUser.servers as s}
                        <span class="server-tag">{s.name}</span>
                      {/each}
                    </div>
                  </div>
                {/if}

                <div class="detail-footer">
                  <button
                    class="btn-danger"
                    disabled={actionLoading === selectedUser.id}
                    onclick={() => toggleBan(selectedUser)}
                  >
                    {selectedUser.banned ? 'Unban User' : 'Ban from Platform'}
                  </button>
                </div>
              </div>
            {/if}
          {:else}
            <div class="admin-list">
              {#each users as user (user.id)}
                <button class="list-item clickable" onclick={() => loadUserDetail(user.id)}>
                  <div class="item-avatar">
                    {#if user.avatar_url}
                      <img src={resolveAsset(user.avatar_url)} alt="" />
                    {:else}
                      <span class="avatar-initial">{user.username.charAt(0).toUpperCase()}</span>
                    {/if}
                  </div>
                  <div class="item-info">
                    <span class="item-name">
                      {user.display_name || user.username}
                      {#if user.banned}<span class="badge-banned sm">BANNED</span>{/if}
                    </span>
                    <span class="item-sub">@{user.username} &middot; {user.message_count} messages</span>
                  </div>
                  <div class="item-meta">
                    <span class="meta-main">{user.server_count} servers</span>
                    <span class="meta-sub">{formatDate(user.created_at)}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

        {:else if activeTab === 'servers'}
          <div class="admin-list">
            {#each servers as server (server.id)}
              <div class="list-item">
                <div class="item-avatar">
                  {#if server.icon_url}
                    <img src={resolveAsset(server.icon_url)} alt="" />
                  {:else}
                    <span class="avatar-initial">{server.name.charAt(0).toUpperCase()}</span>
                  {/if}
                </div>
                <div class="item-info">
                  <span class="item-name">{server.name}</span>
                  <span class="item-sub">Owner: {server.owner_username || 'Unknown'} &middot; {server.channel_count} channels</span>
                </div>
                <div class="item-meta">
                  <span class="meta-main">{server.member_count} members</span>
                  <span class="meta-sub">{formatDate(server.created_at)}</span>
                </div>
                <button
                  class="circle-btn danger"
                  title="Delete server"
                  disabled={actionLoading === server.id}
                  onclick={() => handleDeleteServer(server.id, server.name)}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            {/each}
          </div>

        {:else if activeTab === 'reports'}
          <div class="filter-tabs">
            <button class:active={reportFilter === 'open'} onclick={() => loadReports('open')}>Open</button>
            <button class:active={reportFilter === 'all'} onclick={() => loadReports('all')}>All</button>
          </div>
          <div class="report-list">
            {#each reports as report (report.id)}
              <div class="report-card">
                <div class="report-header">
                  <span class="report-badge {report.status}">{report.status}</span>
                  <span class="report-users">
                    <strong>{report.reporter_username}</strong> reported <strong>{report.reported_username}</strong>
                  </span>
                  <span class="report-time">{formatDateTime(report.created_at)}</span>
                </div>
                {#if report.message_content}
                  <div class="report-preview">"{report.message_content}"</div>
                {/if}
                <div class="report-reason"><strong>Reason:</strong> {report.reason}</div>
                {#if report.status === 'open'}
                  <div class="report-actions">
                    <button class="btn-success-small" onclick={() => resolveReport(report.id, 'resolved')}>Resolve</button>
                    <button class="btn-subtle-small" onclick={() => resolveReport(report.id, 'dismissed')}>Dismiss</button>
                  </div>
                {/if}
              </div>
            {:else}
              <div class="status-box"><p>No {reportFilter === 'open' ? 'open ' : ''}reports found.</p></div>
            {/each}
          </div>

        {:else if activeTab === 'audit'}
          <div class="audit-list">
            {#each auditEntries as entry (entry.id)}
              <div class="audit-row">
                <span class="audit-badge" style:color={eventColor(entry.event_type)}>
                  {eventLabel(entry.event_type)}
                </span>
                <div class="audit-main">
                  <span class="audit-actor">{entry.actor_name || 'System'}</span>
                  {#if entry.target_name}
                    <Icon name="arrow-right" size={12} class="audit-arrow" />
                    <span class="audit-target">{entry.target_name}</span>
                  {/if}
                </div>
                <span class="audit-ip">{entry.ip || ''}</span>
                <span class="audit-time">{formatDateTime(entry.created_at)}</span>
              </div>
            {/each}
          </div>
          {#if totalAuditPages > 1}
            <div class="pagination">
              <button disabled={auditPage <= 1} onclick={() => loadAuditPage(auditPage - 1)}>Prev</button>
              <span class="page-info">{auditPage} / {totalAuditPages}</span>
              <button disabled={auditPage >= totalAuditPages} onclick={() => loadAuditPage(auditPage + 1)}>Next</button>
            </div>
          {/if}
        {/if}
      </div>

      <div class="esc-container">
        <button class="close-modal-btn" onclick={onclose} aria-label="Close admin panel">
          <Icon name="x" size={24} />
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-darkest);
    display: flex;
    z-index: 1000;
    animation: overlayIn 0.2s var(--ease-out);
  }

  @keyframes overlayIn {
    from { opacity: 0; transform: scale(1.1); }
    to { opacity: 1; transform: scale(1); }
  }

  .modal {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--bg-dark);
    position: relative;
  }

  /* Sidebar */
  .sidebar {
    flex: 0 0 218px;
    background: var(--bg-darker);
    display: flex;
    justify-content: flex-end;
    padding-top: 60px;
    z-index: 2;
  }

  .sidebar-inner {
    width: 190px;
    padding: 0 6px 40px 20px;
    display: flex;
    flex-direction: column;
  }

  .sidebar-title {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    padding: 6px 10px;
    margin-bottom: 4px;
  }

  .sidebar-item {
    padding: 10px 12px;
    margin-bottom: 2px;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: var(--font-md);
    font-weight: 500;
    text-align: left;
    transition: all 0.1s var(--ease-out);
    background: transparent;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sidebar-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sidebar-item.active {
    background: var(--bg-active);
    color: var(--text);
  }

  .badge {
    background: var(--danger);
    color: white;
    font-size: 0.7rem;
    font-weight: 800;
    padding: 1px 6px;
    border-radius: 10px;
  }

  /* Content Area */
  .content-area {
    flex: 1;
    background: var(--bg-dark);
    display: flex;
    padding-top: 60px;
    position: relative;
    overflow: hidden;
  }

  .content-wrapper {
    flex: 1;
    max-width: 800px;
    padding: 0 40px 80px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  /* Stats Grid */
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

  /* Admin List */
  .admin-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px;
    background: transparent;
    border-radius: 8px;
    border: none;
    width: 100%;
    text-align: left;
    transition: background 0.1s;
  }

  .list-item.clickable { cursor: pointer; }
  .list-item:hover { background: var(--bg-hover); }

  .item-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-mid);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .item-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .avatar-initial { font-weight: 700; color: var(--text-dim); }

  .item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .item-name {
    font-size: 1rem;
    font-weight: 600;
    color: white;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .item-sub { font-size: 0.8rem; color: var(--text-dim); }

  .item-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  .meta-main { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
  .meta-sub { font-size: 0.75rem; color: var(--text-dim); }

  .badge-banned {
    background: var(--danger);
    color: white;
    font-size: 0.6rem;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .badge-banned.sm { padding: 1px 4px; font-size: 0.55rem; }

  /* User Detail */
  .back-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    color: var(--accent);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
    margin-bottom: 20px;
    padding: 0;
  }

  .back-btn:hover { text-decoration: underline; }

  .user-detail-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .detail-avatar {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--bg-mid);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .detail-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .detail-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .detail-field { display: flex; flex-direction: column; gap: 4px; }

  .field-label { font-size: 0.7rem; font-weight: 800; color: var(--text-dim); text-transform: uppercase; }
  .field-value { color: white; font-weight: 500; }

  .server-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .server-tag {
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .detail-footer { padding-top: 20px; border-top: 1px solid var(--border); }

  /* Reports */
  .filter-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .filter-tabs button {
    padding: 6px 16px;
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-weight: 600;
    cursor: pointer;
  }

  .filter-tabs button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .report-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .report-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .report-badge {
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .report-badge.open { background: var(--warning); color: #000; }
  .report-badge.resolved { background: var(--success); color: white; }

  .report-preview {
    background: var(--bg-darkest);
    padding: 12px;
    border-radius: 4px;
    font-style: italic;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  /* Audit Log */
  .audit-list { display: flex; flex-direction: column; gap: 2px; }
  .audit-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 12px;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .audit-row:hover { background: var(--bg-hover); }

  .audit-badge { font-size: 0.75rem; font-weight: 700; width: 120px; flex-shrink: 0; }
  .audit-main { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .audit-actor { font-weight: 600; color: white; }
  .audit-target { color: var(--text-muted); }
  .audit-time { font-size: 0.75rem; color: var(--text-dim); white-space: nowrap; }

  /* Misc */
  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }
  .spinner {
    width: 32px; height: 32px; border: 3px solid var(--bg-light);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .btn-danger {
    background: var(--danger); color: white; padding: 10px 24px;
    border-radius: 4px; font-weight: 600; border: none; cursor: pointer;
  }

  .close-modal-btn {
    width: 40px; height: 40px; border-radius: 50%;
    border: 2px solid var(--text-dim); display: flex;
    align-items: center; justify-content: center;
    background: transparent; color: var(--text-dim);
    cursor: pointer; transition: all 0.15s var(--ease-out);
  }
  .close-modal-btn:hover {
    background: rgba(255, 255, 255, 0.05); border-color: var(--text);
    color: var(--text); transform: rotate(90deg) scale(1.1);
  }
  .esc-container { position: absolute; top: 60px; right: 40px; }

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

  .version-input {
    width: 100px;
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

  @media (max-width: 768px) {
    .sidebar { display: none; }
    .content-area { padding-top: 20px; }
    .content-wrapper { padding: 0 16px 40px; }
    .esc-container { top: 20px; right: 16px; }
  }
</style>
