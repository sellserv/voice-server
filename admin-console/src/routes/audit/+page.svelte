<script lang="ts">
  import { goto } from '$app/navigation';

  let { data } = $props();

  let entries = $derived(data.entries);
  let total = $derived(data.total);
  let currentPage = $derived(data.page);
  let totalPages = $derived(Math.ceil(total / 50));

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

  function goToPage(page: number) {
    goto(`/audit?page=${page}`);
  }
</script>

<h3 class="content-title">Audit Log</h3>

<div class="audit-list">
  {#each entries as entry (entry.id)}
    <div class="audit-row">
      <span class="audit-badge" style:color={eventColor(entry.event_type)}>
        {eventLabel(entry.event_type)}
      </span>
      <div class="audit-main">
        <span class="audit-actor">{entry.actor_name || 'System'}</span>
        {#if entry.target_name}
          <svg class="audit-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
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

{#if totalPages > 1}
  <div class="pagination">
    <button disabled={currentPage <= 1} onclick={() => goToPage(currentPage - 1)}>Prev</button>
    <span class="page-info">{currentPage} / {totalPages}</span>
    <button disabled={currentPage >= totalPages} onclick={() => goToPage(currentPage + 1)}>Next</button>
  </div>
{/if}

<style>
  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }

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

  .audit-arrow { color: var(--text-dim); flex-shrink: 0; }

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
