<script lang="ts">
  import { api } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let auditEntries: any[] = $state([]);
  let auditTotal = $state(0);
  let auditPage = $state(1);
  let loading = $state(true);
  let error = $state('');

  let totalAuditPages = $derived(Math.ceil(auditTotal / 50));

  async function loadData() {
    loading = true;
    error = '';
    try {
      const a = await api.get<any>('/api/admin/audit-log?limit=50');
      auditEntries = a.entries;
      auditTotal = a.total;
    } catch (e: any) {
      error = e.message || 'Failed to load data';
    } finally {
      loading = false;
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

  function formatDateTime(iso: string) {
    return new Date(iso + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
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

  $effect(() => {
    loadData();
  });
</script>

<h3 class="content-title">Audit Log</h3>

{#if loading}
  <div class="status-box">
    <div class="spinner"></div>
    <p>Loading audit log...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
  </div>
{:else}
  <div class="audit-list">
    {#each auditEntries as entry (entry.id)}
      <div class="audit-row">
        <span class="audit-badge" style:color={eventColor(entry.event_type)}>
          {eventLabel(entry.event_type)}
        </span>
        <div class="audit-main">
          <span class="audit-actor">{entry.actor_name || 'System'}</span>
          {#if entry.target_name}
            <Icon name="arrow-right" size={12} />
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

<style>
  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }
  .spinner {
    width: 32px; height: 32px; border: 3px solid var(--bg-light);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite; margin: 0 auto 12px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

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
  .audit-ip { font-size: 0.75rem; color: var(--text-dim); font-family: monospace; }
  .audit-time { font-size: 0.75rem; color: var(--text-dim); white-space: nowrap; }

  /* Pagination */
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }

  .pagination button {
    padding: 6px 16px;
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-weight: 600;
    cursor: pointer;
  }

  .pagination button:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  .pagination button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-info {
    font-size: 0.85rem;
    color: var(--text-dim);
  }
</style>
