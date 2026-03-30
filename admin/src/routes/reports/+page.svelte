<script lang="ts">
  import { api } from '$lib/api';

  let reports: any[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let reportFilter: 'open' | 'all' = $state('open');
  let actionLoading = $state('');

  function formatDateTime(iso: string) {
    return new Date(iso + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  async function loadReports(filter: 'open' | 'all') {
    reportFilter = filter;
    loading = true;
    error = '';
    try {
      const url = filter === 'open' ? '/api/admin/reports?status=open' : '/api/admin/reports';
      reports = await api.get<any[]>(url);
    } catch (e: any) {
      error = e.message || 'Failed to load reports';
    } finally {
      loading = false;
    }
  }

  async function resolveReport(reportId: string, status: 'resolved' | 'dismissed') {
    actionLoading = reportId;
    error = '';
    try {
      await api.post(`/api/admin/reports/${reportId}`, { status });
      await loadReports(reportFilter);
    } catch (e: any) {
      error = e?.message || 'Failed to update report';
    } finally {
      actionLoading = '';
    }
  }

  $effect(() => {
    loadReports('open');
  });
</script>

<h1 class="page-title">Reports</h1>

<div class="filter-tabs">
  <button class:active={reportFilter === 'open'} onclick={() => loadReports('open')}>Open</button>
  <button class:active={reportFilter === 'all'} onclick={() => loadReports('all')}>All</button>
</div>

{#if loading}
  <div class="status-box">
    <p>Loading reports...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
    <button class="retry-btn" onclick={() => loadReports(reportFilter)}>Retry</button>
  </div>
{:else}
  <div class="report-list">
    {#each reports as report (report.id)}
      <div class="report-card">
        <div class="report-header">
          <span class="report-badge {report.status}">{report.status}</span>
          <span class="report-users">
            <strong>{report.reporter_username}</strong> &rarr; <strong>{report.reported_username}</strong>
          </span>
          <span class="report-time">{formatDateTime(report.created_at)}</span>
        </div>
        {#if report.message_content}
          <div class="report-preview">"{report.message_content}"</div>
        {/if}
        <div class="report-reason"><strong>Reason:</strong> {report.reason}</div>
        {#if report.status === 'open'}
          <div class="report-actions">
            <button
              class="btn-success-small"
              disabled={actionLoading === report.id}
              onclick={() => resolveReport(report.id, 'resolved')}
            >Resolve</button>
            <button
              class="btn-subtle-small"
              disabled={actionLoading === report.id}
              onclick={() => resolveReport(report.id, 'dismissed')}
            >Dismiss</button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="status-box"><p>No {reportFilter === 'open' ? 'open ' : ''}reports found.</p></div>
    {/each}
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

  /* Filter tabs */
  .filter-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
  }

  .filter-tabs button {
    padding: 6px 16px;
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-dim);
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }

  .filter-tabs button.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .filter-tabs button:hover:not(.active) {
    background: var(--bg-light);
    color: var(--text-muted);
  }

  /* Report cards */
  .report-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .report-card {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .report-header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .report-badge {
    font-size: 0.6rem;
    font-weight: 800;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .report-badge.open {
    background: var(--warning);
    color: #000;
  }

  .report-badge.resolved {
    background: var(--success);
    color: white;
  }

  .report-badge.dismissed {
    background: var(--text-dim);
    color: white;
  }

  .report-users {
    font-size: 0.9rem;
    color: var(--text);
  }

  .report-time {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .report-preview {
    background: var(--bg-mid);
    padding: 12px;
    border-radius: 4px;
    font-style: italic;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .report-reason {
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .report-actions {
    display: flex;
    gap: 8px;
  }

  .btn-success-small {
    padding: 6px 14px;
    background: var(--success);
    color: white;
    border: none;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
    font-family: inherit;
  }

  .btn-success-small:hover {
    filter: brightness(1.1);
  }

  .btn-success-small:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-subtle-small {
    padding: 6px 14px;
    background: var(--bg-light);
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
    font-family: inherit;
  }

  .btn-subtle-small:hover {
    background: var(--bg-mid);
    color: var(--text);
  }

  .btn-subtle-small:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
