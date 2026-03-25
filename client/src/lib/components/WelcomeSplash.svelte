<script lang="ts">
  import { onlineFriends, friends } from '$lib/stores/friends';
  import { dmChannels, activeChannelId, openOrCreateDm } from '$lib/stores/channels';
  import { currentUser } from '$lib/stores/auth';
  import Avatar from './Avatar.svelte';
  import type { FriendInfo, Channel } from '@voip-server/shared';

  let recentDms = $derived([...$dmChannels]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)
  );

  let hasOnlineFriends = $derived($onlineFriends.length > 0);
  let hasDms = $derived(recentDms.length > 0);
  let isEmpty = $derived($friends.length === 0 && !hasDms);

  function getDmName(channel: Channel): string {
    const other = channel.dm_participants?.find(p => p.id !== $currentUser?.id);
    return other?.display_name || other?.username || channel.name || 'Unknown';
  }

  function getDmParticipant(channel: Channel) {
    return channel.dm_participants?.find(p => p.id !== $currentUser?.id) ?? null;
  }

  const greetings = [
    'Hey', 'Hi', "What's up", 'Welcome back', 'Howdy', 'Yo',
    "What's good", 'Sup', 'Hiya',
  ];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];
  const isQuestion = ['What\'s up', "What's good", 'Sup'].includes(greeting);

  async function handleFriendClick(friend: FriendInfo) {
    await openOrCreateDm(friend.id);
  }
</script>

<div class="welcome-container">
  <div class="welcome-inner glass-panel" style="padding: 60px; background: rgba(255, 255, 255, 0.015);">
    <a href="https://info.sellserv.net" target="_blank" rel="noopener" class="logo-link">
      <img src="/icon-512x512.png" alt="Logo" class="welcome-logo" />
    </a>
    <h1 class="welcome-heading">{greeting}, {$currentUser?.display_name ?? 'User'}{isQuestion ? '?' : ''}</h1>

    {#if isEmpty}
      <div class="empty-state glass-panel" style="background: rgba(0,0,0,0.2); border: 1px dashed var(--border);">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
        <p class="empty-text">Add some friends to get started</p>
      </div>
    {/if}

    {#if hasOnlineFriends}
      <section class="section">
        <h2 class="section-heading">Online Friends</h2>
        <div class="friends-row">
          {#each $onlineFriends as friend (friend.id)}
            <button class="friend-card glass-panel" onclick={() => handleFriendClick(friend)}>
              <Avatar src={friend.avatar_url} alt={friend.display_name} size={48} userId={friend.id} />
              <span class="friend-name">{friend.display_name}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if hasDms}
      <section class="section">
        <h2 class="section-heading">Recent Conversations</h2>
        <div class="dm-list">
          {#each recentDms as channel (channel.id)}
            {@const dmUser = getDmParticipant(channel)}
            <button
              class="dm-card glass-panel"
              class:active={$activeChannelId === channel.id}
              onclick={() => activeChannelId.set(channel.id)}
            >
              <Avatar src={dmUser?.avatar_url} alt={getDmName(channel)} size={36} />
              <span class="dm-name">{getDmName(channel)}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .welcome-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--space-8);
    background: var(--bg-darkest);
  }

  .welcome-inner {
    max-width: 680px;
    width: 100%;
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    animation: welcomeIn 0.5s var(--ease-out);
  }

  @keyframes welcomeIn {
    from { opacity: 0; transform: scale(0.98) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .logo-link {
    display: flex;
    justify-content: center;
    margin-bottom: var(--space-6);
    transition: transform 0.3s var(--ease-elastic);
  }

  .logo-link:hover {
    transform: scale(1.15) rotate(5deg);
  }

  .welcome-logo {
    width: 80px;
    height: 80px;
    border-radius: 20px;
    box-shadow: var(--shadow-lg);
  }

  .welcome-heading {
    margin: 0 0 var(--space-8);
    font-size: 2.2rem;
    font-weight: 800;
    color: white;
    text-align: center;
    letter-spacing: -0.03em;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: 60px var(--space-6);
    border-radius: var(--radius-lg);
    text-align: center;
  }

  .empty-icon {
    width: 56px;
    height: 56px;
    color: var(--accent);
    opacity: 0.8;
  }

  .empty-text {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-muted);
  }

  /* Sections */
  .section {
    margin-bottom: var(--space-8);
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .section-heading {
    margin: 0 0 var(--space-4);
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-dim);
    padding-left: 4px;
  }

  /* Online friends horizontal row */
  .friends-row {
    display: flex;
    gap: var(--space-4);
    overflow-x: auto;
    padding: 4px 4px 16px;
    scrollbar-width: none;
  }

  .friends-row::-webkit-scrollbar {
    display: none;
  }

  .friend-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5);
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
    flex-shrink: 0;
    min-width: 110px;
    border: 1px solid var(--border);
  }

  .friend-card:hover {
    background: var(--bg-hover);
    transform: translateY(-4px);
    border-color: var(--accent-subtle);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .friend-name {
    font-size: 0.9rem;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 90px;
    text-align: center;
  }

  /* Recent DM list */
  .dm-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .dm-card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    background: rgba(255, 255, 255, 0.03);
    border-radius: var(--radius);
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
    width: 100%;
    text-align: left;
    border: 1px solid var(--border);
  }

  .dm-card:hover {
    background: var(--bg-hover);
    transform: translateX(4px);
    border-color: var(--accent-subtle);
  }

  .dm-card.active {
    background: var(--bg-active);
    border-color: var(--accent);
    box-shadow: inset 4px 0 0 var(--accent);
  }

  .dm-name {
    font-size: 1rem;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
