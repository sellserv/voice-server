<script lang="ts">
  import { api } from '$lib/api';
  import { getActiveServerId } from '$lib/stores/servers';

  interface AuditEntry {
    id: number;
    event_type: string;
    user_id: string | null;
    target_id: string | null;
    actor_name: string | null;
    target_name: string | null;
    ip: string | null;
    details: string | null;
    created_at: string;
  }

  interface AuditLogResponse {
    entries: AuditEntry[];
    total: number;
    page: number;
    limit: number;
  }

  const EVENT_TYPES = [
    'role_change',
    'user_kick',
    'user_ban',
    'user_unban',
    'permission_change',
    'invite_create',
    'invite_delete',
    'report_submitted',
  ];

  let entries = $state<AuditEntry[]>([]);
  let total = $state(0);
  let page = $state(1);
  let limit = $state(25);
  let filterEventType = $state('');
  let loading = $state(false);

  let totalPages = $derived(Math.max(1, Math.ceil(total / limit)));

  async function fetchLog(p: number, filter: string) {
    loading = true;
    try {
      const serverId = getActiveServerId();
      let url = `/api/servers/${serverId}/admin/audit-log?page=${p}&limit=${limit}`;
      if (filter) url += `&event_type=${encodeURIComponent(filter)}`;
      const res = await api.get<AuditLogResponse>(url);
      entries = res.entries;
      total = res.total;
    } catch {
      entries = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    fetchLog(page, filterEventType);
  });

  function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString();
  }

  function formatEventType(t: string): string {
    return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function parseDetails(raw: string | null): string {
    if (!raw) return '-';
    try {
      const obj = JSON.parse(raw);
      return Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
    } catch {
      return raw;
    }
  }

  function handleFilterChange() {
    page = 1;
  }

  function prevPage() {
    if (page > 1) page--;
  }

  function nextPage() {
    if (page < totalPages) page++;
  }
</script>

<div class="section">
  <div class="controls-row">
    <label class="filter-label">
      <span>Filter by event type</span>
      <select class="filter-select" bind:value={filterEventType} onchange={handleFilterChange}>
        <option value="">All events</option>
        {#each EVENT_TYPES as et}
          <option value={et}>{formatEventType(et)}</option>
        {/each}
      </select>
    </label>
    <span class="total-count">{total} total entries</span>
  </div>

  {#if loading}
    <p class="empty">Loading audit log...</p>
  {:else if entries.length === 0}
    <p class="empty">No audit log entries found.</p>
  {:else}
    <div class="table-wrap">
      <table class="audit-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Event Type</th>
            <th>Actor</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {#each entries as entry (entry.id)}
            <tr>
              <td class="cell-time">{formatTime(entry.created_at)}</td>
              <td><span class="event-badge">{formatEventType(entry.event_type)}</span></td>
              <td class="cell-actor">{entry.actor_name ?? entry.user_id ?? '-'}</td>
              <td class="cell-actor">{entry.target_name ?? entry.target_id ?? '-'}</td>
              <td class="cell-details">{parseDetails(entry.details)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="pagination">
    <button class="small-btn" onclick={prevPage} disabled={page <= 1}>Prev</button>
    <span class="page-info">Page {page} of {totalPages}</span>
    <button class="small-btn" onclick={nextPage} disabled={page >= totalPages}>Next</button>
  </div>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .controls-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .filter-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .filter-label span {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .filter-select {
    padding: 8px 12px;
    background: var(--bg-mid);
    color: var(--text);
    border: 1px solid var(--border-light);
    border-radius: var(--radius);
    font-family: var(--font);
    font-size: 0.85rem;
    cursor: pointer;
    transition: border-color 150ms var(--ease-out);
    min-width: 200px;
  }

  .filter-select:focus {
    border-color: var(--accent);
    outline: none;
  }

  .total-count {
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .table-wrap {
    overflow-x: auto;
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
  }

  .audit-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .audit-table th {
    text-align: left;
    padding: 8px 12px;
    background: var(--bg-dark);
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border-light);
    white-space: nowrap;
  }

  .audit-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-light);
    color: var(--text);
    vertical-align: top;
  }

  .audit-table tbody tr:hover {
    background: var(--bg-hover);
  }

  .audit-table tbody tr:last-child td {
    border-bottom: none;
  }

  .cell-time {
    white-space: nowrap;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .cell-actor {
    font-size: 0.85rem;
    color: var(--text-muted);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cell-details {
    font-size: 0.8rem;
    color: var(--text-muted);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--accent-glow);
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .page-info {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .small-btn {
    padding: 6px 14px;
    background: var(--bg-light);
    color: var(--text-muted);
    border: 1px solid var(--border-light);
    border-radius: var(--radius);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 150ms var(--ease-out);
  }

  .small-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  .small-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty {
    font-size: 0.85rem;
    color: var(--text-dim);
    text-align: center;
    padding: 20px;
  }
</style>
