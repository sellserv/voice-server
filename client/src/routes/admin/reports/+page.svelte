<script lang="ts">
  import { api } from '$lib/api';

  let reports: any[] = $state([]);
  let loading = $state(true);
  let error = $state('');
  let reportFilter: 'open' | 'all' = $state('open');

  // Action states
  let actionLoading = $state('');

  async function loadData() {
    loading = true;
    error = '';
    try {
      reports = await api.get<any[]>('/api/admin/reports?status=open');
    } catch (e: any) {
      error = e.message || 'Failed to load data';
    } finally {
      loading = false;
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

  function formatDateTime(iso: string) {
    return new Date(iso + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  $effect(() => {
    loadData();
  });
</script>

<h3 class="content-title">Reports</h3>

{#if loading}
  <div class="status-box">
    <div class="spinner"></div>
    <p>Loading reports...</p>
  </div>
{:else if error}
  <div class="status-box error">
    <p>{error}</p>
  </div>
{:else}
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

  /* Filter Tabs */
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

  /* Report List */
  .report-list {
    display: flex;
    flex-direction: column;
    gap: 0;
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
  .report-badge.dismissed { background: var(--text-dim); color: white; }

  .report-users {
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .report-time {
    font-size: 0.75rem;
    color: var(--text-dim);
    margin-left: auto;
  }

  .report-preview {
    background: var(--bg-darkest);
    padding: 12px;
    border-radius: 4px;
    font-style: italic;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .report-reason {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .report-actions {
    display: flex;
    gap: 8px;
  }

  .btn-success-small {
    background: var(--success);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-subtle-small {
    background: var(--bg-light);
    color: var(--text-muted);
    border: none;
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-subtle-small:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
