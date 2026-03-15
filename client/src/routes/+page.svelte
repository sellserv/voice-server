<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
  import { activeChannel } from '$lib/stores/channels';
  import {
    watchSession,
    watchQueue,
    watchViewers,
    leaveWatch,
    stopWatch,
  } from '$lib/stores/watchTogether';
  import { servers, isDmView } from '$lib/stores/servers';
  import LoginPage from '$lib/components/LoginPage.svelte';
  import NoServerSplash from '$lib/components/NoServerSplash.svelte';
  import ChatPane from '$lib/components/ChatPane.svelte';
  import WatchTogetherView from '$lib/components/WatchTogetherView.svelte';
  import WelcomeSplash from '$lib/components/WelcomeSplash.svelte';

  // If not logged in, show login. Otherwise show active channel.

  function handleLeaveWatch() {
    leaveWatch();
    if ($watchSession && $currentUser && $watchSession.hostUserId === $currentUser.id) {
      stopWatch();
    }
  }
</script>

{#if !$currentUser}
  <LoginPage />
{:else if $watchSession}
  <WatchTogetherView
    videoId={$watchSession.videoId}
    hostUserId={$watchSession.hostUserId}
    hostUsername={$watchSession.hostUsername}
    isHost={$watchSession.hostUserId === $currentUser?.id}
    queue={$watchQueue}
    viewers={$watchViewers}
    onleave={handleLeaveWatch}
    channel={$activeChannel}
  />
{:else if $isDmView && $servers.length === 0}
  <NoServerSplash />
{:else if $isDmView && $activeChannel?.type === 'dm'}
  <ChatPane channel={$activeChannel} />
{:else if $isDmView}
  <WelcomeSplash />
{:else if $activeChannel}
  {#if $activeChannel.type === 'text'}
    <ChatPane channel={$activeChannel} />
  {:else}
    <div class="voice-placeholder">
      <div class="empty-icon">
        <svg
          viewBox="0 0 24 24"
          width="32"
          height="32"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </div>
      <h2>{$activeChannel.name}</h2>
      <p>This is a voice channel.</p>
      <p class="hint">Use the sidebar to join or leave voice.</p>
    </div>
  {/if}
{:else}
  <div class="empty-state">
    <div class="empty-icon">
      <svg
        viewBox="0 0 24 24"
        width="32"
        height="32"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </div>
    <h2>Welcome</h2>
    <p>Select a channel from the sidebar to get started.</p>
    <p class="hint">Tip: Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to quickly find channels</p>
  </div>
{/if}

<style>
  .voice-placeholder,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-muted);
    text-align: center;
    padding: 20px;
  }

  .empty-state h2,
  .voice-placeholder h2 {
    color: var(--text);
    font-size: 1.4rem;
    margin: 0;
  }

  .empty-state p,
  .voice-placeholder p {
    margin: 0;
    max-width: 300px;
  }

  .empty-icon {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-round);
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    margin-bottom: 4px;
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-dim);
    margin-top: 8px;
  }

  kbd {
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-mid);
    border: 1px solid var(--border);
    font-size: 0.8em;
    font-family: inherit;
  }
</style>
