<script lang="ts">
  import { api } from '$lib/api';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import type { InviteCode } from '@voip-server/shared';
  import { getActiveServerId } from '$lib/stores/servers';

  let inviteCodes = $state<InviteCode[]>([]);
  let creatingCode = $state(false);
  let newCodeMaxUses = $state('');

  const canManageInvites = hasPermissionStore('manage_invite_codes');

  $effect(() => {
    const serverId = getActiveServerId();
    api
      .get<InviteCode[]>(`/api/servers/${serverId}/admin/invite-codes`)
      .then((codes) => {
        inviteCodes = codes;
      })
      .catch(() => {});
  });

  async function createInviteCode() {
    creatingCode = true;
    try {
      const serverId = getActiveServerId();
      const body: { max_uses?: number } = {};
      const parsed = parseInt(newCodeMaxUses);
      if (!isNaN(parsed) && parsed > 0) body.max_uses = parsed;
      const code = await api.post<InviteCode>(`/api/servers/${serverId}/admin/invite-codes`, body);
      inviteCodes = [code, ...inviteCodes];
      newCodeMaxUses = '';
    } finally {
      creatingCode = false;
    }
  }

  async function deleteInviteCode(id: string) {
    const serverId = getActiveServerId();
    await api.delete(`/api/servers/${serverId}/admin/invite-codes/${id}`);
    inviteCodes = inviteCodes.filter((c) => c.id !== id);
  }
</script>

<div class="section">
  {#if $canManageInvites}
    <div class="create-row">
      <input
        type="text"
        class="text-input"
        placeholder="Max uses (empty = unlimited)"
        bind:value={newCodeMaxUses}
        style="flex:1"
      />
      <button class="action-btn primary" onclick={createInviteCode} disabled={creatingCode}>
        {#if creatingCode}<span class="spinner spinner-sm"></span> Creating...{:else}Create{/if}
      </button>
    </div>
  {/if}

  <div class="list">
    {#each inviteCodes as code (code.id)}
      <div class="list-item">
        <span class="mono">{code.code}</span>
        <span class="dim">{code.use_count} / {code.max_uses ?? '\u221e'} uses</span>
        {#if $canManageInvites}
          <button class="small-btn danger" onclick={() => deleteInviteCode(code.id)}>Delete</button>
        {/if}
      </div>
    {:else}
      <p class="empty">No invite codes yet.</p>
    {/each}
  </div>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .text-input {
    padding: 8px 12px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    font-family: var(--font);
    font-size: 14px;
    transition:
      border-color 150ms var(--ease-out),
      box-shadow 150ms var(--ease-out);
  }

  .text-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 8px var(--accent-glow);
    outline: none;
  }

  .create-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--bg-mid);
    border-radius: var(--radius);
  }

  .mono {
    font-family: monospace;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .dim {
    flex: 1;
    font-size: 0.8rem;
    color: var(--text-muted);
    text-align: right;
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

  .small-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .small-btn.danger {
    color: var(--danger);
    border-color: rgba(248, 113, 113, 0.2);
  }

  .small-btn.danger:hover {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }

  .action-btn.primary {
    padding: 8px 22px;
    background: var(--accent);
    color: white;
    border-radius: var(--radius);
    font-weight: 700;
    font-size: 0.9rem;
    box-shadow: 0 0 16px var(--accent-glow);
    transition: all 150ms var(--ease-out);
    white-space: nowrap;
  }

  .action-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 0 24px var(--accent-glow);
    transform: translateY(-1px);
  }

  .empty {
    font-size: 0.85rem;
    color: var(--text-dim);
    text-align: center;
    padding: 20px;
  }
</style>
