<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { getActiveServerId } from '$lib/stores/servers';
  import { currentUser } from '$lib/stores/auth';
  import { sendWs, onWsEvent } from '$lib/ws';
  import type { Poll } from '@voip-server/shared';
  import Icon from './Icon.svelte';

  let { pollId }: { pollId: string } = $props();

  let poll = $state<Poll | null>(null);
  let loading = $state(true);
  let closing = $state(false);

  const serverId = getActiveServerId();

  const isCreator = $derived(poll && $currentUser && poll.creator_id === $currentUser.id);

  async function loadPoll() {
    try {
      const polls = await api.get<Poll[]>(`/api/servers/${serverId}/polls`);
      poll = polls.find(p => p.id === pollId) || null;
    } catch (err: any) {
      console.error('Failed to load poll:', err);
    } finally {
      loading = false;
    }
  }

  function handleVote(optionId: string) {
    if (!poll || !poll.is_active) return;

    let selected: string[] = [];
    if (poll.allow_multiple) {
      const current = poll.options.filter(o => o.voted_by_me).map(o => o.id);
      if (current.includes(optionId)) {
        selected = current.filter(id => id !== optionId);
      } else {
        selected = [...current, optionId];
      }
    } else {
      selected = [optionId];
    }

    sendWs({ type: 'poll:vote', pollId, optionIds: selected });

    // Optimistic update
    if (poll) {
      poll = {
        ...poll,
        options: poll.options.map(o => ({
          ...o,
          voted_by_me: selected.includes(o.id)
        }))
      };
    }
  }

  onMount(() => {
    loadPoll();

    return onWsEvent((event) => {
      if (event.type === 'poll:updated' && event.pollId === pollId) {
        if (poll) {
          poll = {
            ...poll,
            options: poll.options.map(o => {
              const updated = event.options.find((uo: any) => uo.id === o.id);
              return updated ? { ...o, vote_count: updated.vote_count } : o;
            }),
            total_votes: event.totalVotes,
            is_active: (event as any).isActive !== undefined ? (event as any).isActive : poll.is_active
          };
        }
      } else if (event.type === 'poll:deleted' && event.pollId === pollId) {
        poll = null;
      }
    });
  });

  function getPercent(votes: number, total: number) {
    if (!total) return 0;
    return Math.round((votes / total) * 100);
  }

  async function handleClose() {
    if (!poll || closing) return;
    closing = true;
    try {
      await api.patch(`/api/servers/${serverId}/polls/${pollId}/close`, {});
    } catch (err: any) {
      console.error('Failed to close poll:', err);
    } finally {
      closing = false;
    }
  }

  const winners = $derived.by(() => {
    if (!poll || poll.is_active || poll.total_votes === 0) return [];
    let max = -1;
    poll.options.forEach(o => {
      if ((o.vote_count || 0) > max) max = o.vote_count || 0;
    });
    return poll.options.filter(o => (o.vote_count || 0) === max).map(o => o.id);
  });
</script>

{#if loading}
  <div class="poll-loading">
    <div class="spinner"></div>
  </div>
{:else if poll}
  <div class="poll-card" class:closed={!poll.is_active}>
    <div class="poll-header">
      <div class="poll-icon-wrap">
        <Icon name={poll.is_active ? 'bar-chart' : 'lock'} size={15} />
      </div>
      <span class="poll-question">{poll.question}</span>
      {#if !poll.is_active}
        <span class="closed-badge">Closed</span>
      {/if}
    </div>

    <div class="poll-options">
      {#each poll.options as opt (opt.id)}
        {@const percent = getPercent(opt.vote_count || 0, poll.total_votes || 0)}
        {@const isWinner = winners.includes(opt.id)}
        <button
          class="poll-option"
          class:voted={opt.voted_by_me}
          class:winner={isWinner}
          disabled={!poll.is_active}
          onclick={() => handleVote(opt.id)}
        >
          <div class="option-fill" style="width: {percent}%" class:winner-fill={isWinner}></div>
          <div class="option-content">
            <div class="option-left">
              {#if isWinner}
                <span class="winner-crown">
                  <Icon name="crown" size={14} />
                </span>
              {/if}
              <span class="option-text">{opt.text}</span>
            </div>
            <span class="option-stats">{opt.vote_count || 0} ({percent}%)</span>
          </div>
        </button>
      {/each}
    </div>

    <div class="poll-footer">
      <span class="vote-count">{poll.total_votes || 0} vote{(poll.total_votes || 0) !== 1 ? 's' : ''}</span>
      {#if poll.allow_multiple}
        <span class="poll-badge">Multiple Choice</span>
      {/if}
      {#if isCreator && poll.is_active}
        <button class="close-poll-btn" onclick={handleClose} disabled={closing}>
          <Icon name="lock" size={12} />
          <span>{closing ? 'Closing...' : 'Close Poll'}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .poll-card {
    margin-top: 8px;
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border-bright);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 420px;
    box-shadow: var(--glass-shadow), var(--glass-glow);
    animation: cardIn 0.25s var(--ease-out);
  }

  @keyframes cardIn {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .poll-card.closed {
    opacity: 0.85;
    border-color: var(--glass-border);
  }

  .poll-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .poll-icon-wrap {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(var(--accent-rgb), 0.15);
    border-radius: 8px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .poll-question {
    font-weight: 700;
    color: white;
    font-size: 0.95rem;
    line-height: 1.3;
  }

  .closed-badge {
    margin-left: auto;
    font-size: 0.6rem;
    font-weight: 700;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-dim);
    padding: 3px 8px;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }

  .poll-options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .poll-option {
    position: relative;
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--glass-border);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    text-align: left;
    transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  }

  .poll-option:disabled {
    cursor: default;
  }

  .poll-option:hover:not(:disabled) {
    border-color: rgba(var(--accent-rgb), 0.4);
    background: rgba(var(--accent-rgb), 0.04);
  }

  .poll-option.voted {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(var(--accent-rgb), 0.15),
                inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .poll-option.winner {
    border-color: rgba(251, 191, 36, 0.5);
    background: rgba(251, 191, 36, 0.04);
    box-shadow: 0 0 12px rgba(251, 191, 36, 0.08),
                inset 0 1px 0 rgba(251, 191, 36, 0.06);
  }

  .option-fill {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    background: rgba(var(--accent-rgb), 0.12);
    transition: width 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
    border-radius: 0 4px 4px 0;
  }

  .option-fill.winner-fill {
    background: linear-gradient(90deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.25));
  }

  .poll-option.voted .option-fill {
    background: rgba(var(--accent-rgb), 0.22);
  }

  .option-content {
    position: relative;
    padding: 9px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 1;
  }

  .option-left {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .winner-crown {
    color: #fbbf24;
    display: flex;
    align-items: center;
    filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.4));
    animation: crownIn 0.4s var(--ease-out);
  }

  @keyframes crownIn {
    from { opacity: 0; transform: scale(0.5) rotate(-15deg); }
    to { opacity: 1; transform: scale(1) rotate(0deg); }
  }

  .option-text {
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .poll-option.voted .option-text {
    color: white;
  }

  .poll-option.winner .option-text {
    color: #fbbf24;
    font-weight: 700;
  }

  .option-stats {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-dim);
    font-family: var(--font-mono);
    flex-shrink: 0;
    margin-left: 12px;
  }

  .poll-option.winner .option-stats {
    color: #fbbf24;
  }

  .poll-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.7rem;
    color: var(--text-dim);
    font-weight: 600;
    padding-top: 2px;
  }

  .poll-badge {
    padding: 2px 7px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--glass-border);
    border-radius: 5px;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .close-poll-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--glass-border);
    border-radius: 5px;
    color: var(--text-dim);
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.2s;
  }

  .close-poll-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .close-poll-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .poll-loading {
    padding: 20px;
    display: flex;
    justify-content: center;
  }
</style>
