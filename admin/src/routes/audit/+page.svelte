<script lang="ts">
  import { api } from '$lib/api';

  let auditEntries: any[] = $state([]);
  let auditTotal = $state(0);
  let auditPage = $state(1);
  let loading = $state(true);
  let error = $state('');

  let totalAuditPages = $derived(Math.ceil(auditTotal / 50));

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

  async function loadAuditPage(page: number) {
    loading = true;
    error = '';
    try {
      const offset = (page - 1) * 50;
      const a = await api.get<any>(`/api/admin/audit-log?limit=50&offset=${offset}`);
      auditEntries = a.entries;
      auditTotal = a.total;
      auditPage = page;
    } catch (e: any) {
      error = e?.message || 'Failed to load audit log';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadAuditPage(1);
  });
</script>

<h1 class="page-title">Audit Log</h1>

{#if loading}
  <div class="status-box">
    <p>Loading audit log...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
    <button class="retry-btn" onclick={() => loadAuditPage(auditPage)}>Retry</button>
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
            <span class="audit-arrow">&rarr;</span>
            <span class="audit-target">{entry.target_name}</span>
          {/if}
        </div>
        <span class="audit-ip">{entry.ip || ''}</span>
        <span class="audit-time">{formatDateTime(entry.created_at)}</span>
      </div>
    {:else}
      <div class="status-box"><p>No audit log entries found.</p></div>
    {/each}
  </div>

  {#if totalAuditPages > 1}
    <div class="pagination">
      <button disabled={auditPage <= 1} onclick={() => loadAuditPage(auditPage - 1)}>Previous</button>
      <span class="page-info">Page {auditPage} of {totalAuditPages}</span>
      <button disabled={auditPage >= totalAuditPages} onclick={() => loadAuditPage(auditPage + 1)}>Next</button>
    </div>
  {/if}
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

  /* Audit List */
  .audit-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .audit-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 12px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .audit-row:hover {
    background: var(--bg-light);
  }

  .audit-badge {
    font-size: 0.75rem;
    font-weight: 700;
    width: 120px;
    flex-shrink: 0;
  }

  .audit-main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .audit-actor {
    font-weight: 600;
    color: white;
  }

  .audit-arrow {
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  .audit-target {
    color: var(--text-muted);
  }

  .audit-ip {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-family: monospace;
    white-space: nowrap;
  }

  .audit-time {
    font-size: 0.75rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

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
    padding: 8px 16px;
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
  }

  .pagination button:hover:not(:disabled) {
    background: var(--bg-light);
  }

  .pagination button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .page-info {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
