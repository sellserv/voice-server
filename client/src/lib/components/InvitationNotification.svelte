<script lang="ts">
  import { pendingInvitations, acceptInvitation, declineInvitation, loadInvitations } from '$lib/stores/invitations';
  import { servers, switchServer } from '$lib/stores/servers';
  import { resolveAsset } from '$lib/stores/server';
  import type { ServerInvitation } from '@voip-server/shared';

  let processing = $state<string | null>(null);

  async function accept(invite: ServerInvitation) {
    processing = invite.id;
    const server = await acceptInvitation(invite.id);
    if (server) {
      servers.update((list) => [...list, server]);
      switchServer(server.id);
    }
    processing = null;
  }

  async function decline(invite: ServerInvitation) {
    processing = invite.id;
    await declineInvitation(invite.id);
    processing = null;
  }
</script>

{#if $pendingInvitations.length > 0}
  <div class="invitations-container">
    {#each $pendingInvitations as invite (invite.id)}
      <div class="invitation-card">
        <div class="invite-icon">
          {#if invite.server_icon_url}
            <img src={resolveAsset(invite.server_icon_url)} alt="" class="invite-icon-img" />
          {:else}
            <span class="invite-icon-initial">{invite.server_name.charAt(0).toUpperCase()}</span>
          {/if}
        </div>
        <div class="invite-info">
          <span class="invite-server">{invite.server_name}</span>
          <span class="invite-from">Invited by {invite.inviter_name}</span>
        </div>
        <div class="invite-actions">
          <button
            class="invite-btn accept"
            onclick={() => accept(invite)}
            disabled={processing === invite.id}
          >Join</button>
          <button
            class="invite-btn decline"
            onclick={() => decline(invite)}
            disabled={processing === invite.id}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .invitations-container {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 900;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 360px;
  }

  .invitation-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--glass-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-shadow), var(--glass-glow);
    animation: slideDown 250ms var(--ease-out);
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .invite-icon {
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .invite-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .invite-icon-initial {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text);
  }

  .invite-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .invite-server {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .invite-from {
    font-size: 0.75rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .invite-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .invite-btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 150ms var(--ease-out);
  }

  .invite-btn.accept {
    background: var(--accent);
    color: white;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .invite-btn.accept:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .invite-btn.decline {
    background: var(--bg-light);
    color: var(--text-muted);
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .invite-btn.decline:hover:not(:disabled) {
    background: var(--danger);
    color: white;
  }

  .invite-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
