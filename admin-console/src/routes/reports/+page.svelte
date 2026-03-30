<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';

  let { data } = $props();

  let reports = $derived(data.reports);
  let filter = $derived(data.filter);
  let actionLoading = $state('');

  function formatDateTime(iso: string) {
    return new Date(iso + 'Z').toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function setFilter(f: string) {
    if (f === 'open') {
      goto('/reports');
    } else {
      goto('/reports?filter=all');
    }
  }
</script>

<h3 class="content-title">Reports</h3>

<div class="filter-tabs">
  <button class:active={filter === 'open'} onclick={() => setFilter('open')}>Open</button>
  <button class:active={filter === 'all'} onclick={() => setFilter('all')}>All</button>
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
          <form
            method="POST"
            action="?/resolve"
            use:enhance={() => {
              actionLoading = report.id;
              return async ({ update }) => {
                await update();
                await invalidateAll();
                actionLoading = '';
              };
            }}
          >
            <input type="hidden" name="reportId" value={report.id} />
            <button type="submit" class="btn-success-small" disabled={actionLoading === report.id}>
              Resolve
            </button>
          </form>
          <form
            method="POST"
            action="?/dismiss"
            use:enhance={() => {
              actionLoading = report.id;
              return async ({ update }) => {
                await update();
                await invalidateAll();
                actionLoading = '';
              };
            }}
          >
            <input type="hidden" name="reportId" value={report.id} />
            <button type="submit" class="btn-subtle-small" disabled={actionLoading === report.id}>
              Dismiss
            </button>
          </form>
        </div>
      {/if}
    </div>
  {:else}
    <div class="status-box"><p>No {filter === 'open' ? 'open ' : ''}reports found.</p></div>
  {/each}
</div>

<style>
  .content-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 24px;
  }

  .status-box { padding: 40px; text-align: center; color: var(--text-dim); }

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

  .btn-success-small:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .btn-subtle-small:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  form {
    display: contents;
  }
</style>
