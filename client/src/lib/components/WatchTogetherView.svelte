<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    syncWatch,
    watchSyncEvent,
    queueVideo,
    skipVideo,
    nextVideo,
    joinWatch,
    transferHost,
  } from '$lib/stores/watchTogether';
  import type { QueueItem, WatchViewer } from '$lib/stores/watchTogether';
  import { pingMs } from '$lib/stores/media';
  import type { Channel } from '@voip-server/shared';
  import ChatPane from './ChatPane.svelte';
  import { resolveAsset } from '$lib/stores/server';
  import Icon from './Icon.svelte';

  let {
    videoId,
    hostUserId,
    hostUsername,
    isHost,
    queue,
    viewers,
    onleave,
    channel,
  }: {
    videoId: string | null;
    hostUserId: string;
    hostUsername: string;
    isHost: boolean;
    queue: QueueItem[];
    viewers: WatchViewer[];
    onleave: () => void;
    channel: Channel | null;
  } = $props();

  let iframeEl: HTMLIFrameElement | undefined = $state();
  let player: any = null;
  let ignoreStateChange = false;
  let syncInterval: ReturnType<typeof setInterval> | null = null;
  let queueInputValue = $state('');
  let sidebarTab = $state<'party' | 'chat'>('party');
  let contextMenu = $state<{ userId: string; username: string; x: number; y: number } | null>(null);

  // Build the iframe src for YouTube embed
  let iframeSrc = $derived(
    videoId
      ? `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1&origin=${encodeURIComponent(window.location.origin)}`
      : null,
  );

  function loadYouTubeApi(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).YT?.Player) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
      if (existing) {
        const prev = (window as any).onYouTubeIframeAPIReady;
        (window as any).onYouTubeIframeAPIReady = () => {
          prev?.();
          resolve();
        };
        return;
      }
      (window as any).onYouTubeIframeAPIReady = () => resolve();
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => reject(new Error('Failed to load YouTube API'));
      document.head.appendChild(tag);
    });
  }

  function attachPlayer() {
    if (!iframeEl || player) return;
    try {
      player = new (window as any).YT.Player(iframeEl, {
        events: {
          onReady: () => {
            if (isHost) startHostSync();
          },
          onStateChange: (e: any) => {
            if (!isHost || ignoreStateChange) return;
            const YT = (window as any).YT;
            if (e.data === YT.PlayerState.PLAYING) {
              syncWatch('playing', player.getCurrentTime());
            } else if (e.data === YT.PlayerState.PAUSED) {
              syncWatch('paused', player.getCurrentTime());
            } else if (e.data === YT.PlayerState.ENDED) {
              nextVideo();
            }
          },
        },
      });
    } catch {
      // API not available
    }
  }

  function detachPlayer() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    player = null;
  }

  $effect(() => {
    if (!iframeEl || !videoId) {
      detachPlayer();
      return;
    }
    detachPlayer();
    const el = iframeEl;
    async function init() {
      try {
        await loadYouTubeApi();
        await new Promise((r) => setTimeout(r, 500));
        if (el === iframeEl && videoId) attachPlayer();
      } catch {
        // ignore
      }
    }
    init();
  });

  onMount(() => {
    joinWatch();
  });

  function startHostSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
      if (!player?.getPlayerState) return;
      const YT = (window as any).YT;
      const state = player.getPlayerState();
      if (state === YT.PlayerState.PLAYING) {
        syncWatch('playing', player.getCurrentTime());
      }
    }, 3000);
  }

  $effect(() => {
    const sync = $watchSyncEvent;
    if (!sync || isHost || !player?.seekTo) return;
    const adjustedTime = sync.time + ($pingMs ?? 0) / 2 / 1000;
    ignoreStateChange = true;
    const timeDiff = Math.abs(player.getCurrentTime() - adjustedTime);
    if (timeDiff > 0.5) {
      player.seekTo(adjustedTime, true);
    }
    if (sync.state === 'playing') {
      player.playVideo();
    } else {
      player.pauseVideo();
    }
    setTimeout(() => {
      ignoreStateChange = false;
    }, 500);
  });

  onDestroy(() => {
    detachPlayer();
  });

  function handleQueueSubmit() {
    const url = queueInputValue.trim();
    if (!url) return;
    queueVideo(url);
    queueInputValue = '';
  }

  function handleViewerContextMenu(e: MouseEvent, viewer: WatchViewer) {
    if (!isHost || viewer.userId === hostUserId) return;
    e.preventDefault();
    contextMenu = {
      userId: viewer.userId,
      username: viewer.display_name || viewer.username,
      x: e.clientX,
      y: e.clientY,
    };
  }

  function handleTransferHost() {
    if (!contextMenu) return;
    transferHost(contextMenu.userId);
    contextMenu = null;
  }

  function closeContextMenu() {
    contextMenu = null;
  }
</script>

{#if contextMenu}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="ctx-backdrop" onclick={closeContextMenu}></div>
{/if}

<div class="watch-container">
  <div class="watch-header">
    <div class="header-left">
      <div class="header-icon-wrap">
        <Icon name="play" size={18} />
      </div>
      <span class="header-title">Watch Together</span>
      <span class="header-sep"></span>
      <div class="host-pill">
        <span class="host-avatar">
          {hostUsername.charAt(0).toUpperCase()}
        </span>
        <span class="host-name">{hostUsername}</span>
        <Icon name="star" size={12} class="host-star" />
      </div>
    </div>
    <button class="leave-btn" onclick={onleave}>
      <Icon name="logout" size={16} />
      <span>Leave Party</span>
    </button>
  </div>

  <div class="watch-body">
    <div class="video-panel">
      {#if iframeSrc}
        <iframe
          bind:this={iframeEl}
          src={iframeSrc}
          class="yt-iframe"
          title="YouTube video player"
          allow="autoplay; encrypted-media"
          allowfullscreen
        ></iframe>
      {:else}
        <div class="empty-state">
          <div class="empty-icon-circle">
            <Icon name="play" size={48} />
          </div>
          <h3>No video playing</h3>
          <p>Add a YouTube link to the queue to start watching!</p>
        </div>
      {/if}
    </div>

    <div class="sidebar">
      <div class="sidebar-tabs">
        <button
          class="sidebar-tab"
          class:active={sidebarTab === 'party'}
          onclick={() => (sidebarTab = 'party')}
        >
          <Icon name="users" size={16} />
          <span>Party</span>
        </button>
        <button
          class="sidebar-tab"
          class:active={sidebarTab === 'chat'}
          onclick={() => (sidebarTab = 'chat')}
        >
          <Icon name="message-square" size={16} />
          <span>Chat</span>
        </button>
      </div>

      {#if sidebarTab === 'party'}
        <div class="sidebar-content scrollable">
          <div class="sidebar-section">
            <h4 class="section-label">Viewers — {viewers.length}</h4>
            <div class="viewer-list">
              {#each viewers as viewer (viewer.userId)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="viewer-item" oncontextmenu={(e) => handleViewerContextMenu(e, viewer)}>
                  <div class="viewer-avatar-wrap">
                    {#if viewer.avatar_url}
                      <img src={resolveAsset(viewer.avatar_url)} alt="" class="viewer-avatar-img" />
                    {:else}
                      {(viewer.display_name || viewer.username).charAt(0).toUpperCase()}
                    {/if}
                  </div>
                  <span class="viewer-name">{viewer.display_name || viewer.username}</span>
                  {#if viewer.userId === hostUserId}
                    <Icon name="star" size={14} class="host-star-small" />
                  {/if}
                </div>
              {/each}
            </div>
          </div>

          <div class="sidebar-section flex-1">
            <div class="section-header-row">
              <h4 class="section-label">Queue — {queue.length}</h4>
              {#if isHost && queue.length > 0}
                <button class="small-action-btn" onclick={() => skipVideo()}>
                  <Icon name="play" size={12} />
                  <span>Skip</span>
                </button>
              {/if}
            </div>
            
            <div class="queue-list">
              {#each queue as item, i (item.videoId + i)}
                <div class="queue-card">
                  <div class="queue-thumb-wrap">
                    <img
                      class="queue-thumb"
                      src="https://img.youtube.com/vi/{item.videoId}/mqdefault.jpg"
                      alt=""
                    />
                    <span class="queue-pos">{i + 1}</span>
                  </div>
                  <div class="queue-info">
                    <span class="queue-title" title={item.title || item.videoId}
                      >{item.title || item.videoId}</span
                    >
                    <span class="queue-added-by">Added by {item.addedByUsername}</span>
                  </div>
                </div>
              {:else}
                <div class="queue-empty-state">
                  <Icon name="music" size={24} />
                  <p>Queue is empty</p>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <div class="sidebar-footer">
          <form class="queue-input-bar" onsubmit={(e) => { e.preventDefault(); handleQueueSubmit(); }}>
            <input
              type="text"
              class="fancy-input"
              placeholder="Paste YouTube link..."
              bind:value={queueInputValue}
            />
            <button type="submit" class="fancy-add-btn" disabled={!queueInputValue.trim()}>
              <Icon name="plus" size={18} strokeWidth={2.5} />
            </button>
          </form>
        </div>
      {:else}
        <div class="sidebar-chat">
          {#if channel}
            <ChatPane {channel} />
          {:else}
            <div class="chat-empty">
              <Icon name="message-square" size={32} />
              <p>No channel selected</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

{#if contextMenu}
  <div class="ctx-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    <button class="ctx-item" onclick={handleTransferHost}>
      <Icon name="star" size={14} />
      <span>Transfer Host</span>
    </button>
  </div>
{/if}

<style>
  .watch-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-dark);
    animation: fadeIn 0.2s var(--ease-out);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Header */
  .watch-header {
    height: 56px;
    background: var(--bg-darker);
    border-bottom: 1px solid var(--border);
    padding: 0 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    z-index: 10;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .header-icon-wrap {
    width: 32px;
    height: 32px;
    background: var(--accent);
    color: white;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-glow);
  }

  .header-title {
    font-size: 1.1rem;
    font-weight: 800;
    color: white;
    letter-spacing: -0.01em;
  }

  .header-sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }

  .host-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-darkest);
    padding: 4px 12px 4px 4px;
    border-radius: 20px;
    border: 1px solid var(--border);
  }

  .host-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-dim);
  }

  .host-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .host-star {
    color: var(--warning);
  }

  .leave-btn {
    background: var(--danger);
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s;
    border: none;
    cursor: pointer;
  }

  .leave-btn:hover {
    background: var(--danger-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(248, 113, 113, 0.2);
  }

  /* Body */
  .watch-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .video-panel {
    flex: 1;
    background: #000;
    position: relative;
    min-width: 0;
  }

  .yt-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 40px;
    text-align: center;
    color: var(--text-dim);
    gap: 16px;
  }

  .empty-icon-circle {
    width: 80px;
    height: 80px;
    background: var(--bg-darker);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    opacity: 0.5;
    border: 2px dashed var(--border);
  }

  .empty-state h3 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 800;
    color: white;
  }

  /* Sidebar */
  .sidebar {
    width: 340px;
    background: var(--bg-darker);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .sidebar-tabs {
    display: flex;
    padding: 8px;
    gap: 4px;
    background: var(--bg-darkest);
    border-bottom: 1px solid var(--border);
  }

  .sidebar-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    font-weight: 700;
    font-size: 0.85rem;
    transition: all 0.15s;
    border: none;
    cursor: pointer;
  }

  .sidebar-tab:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sidebar-tab.active {
    background: var(--bg-light);
    color: white;
  }

  .sidebar-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .scrollable {
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .sidebar-section {
    padding: 20px 16px;
    border-bottom: 1px solid var(--border);
  }

  .flex-1 { flex: 1; display: flex; flex-direction: column; min-height: 0; }

  .section-label {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin-bottom: 12px;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-header-row .section-label { margin-bottom: 0; }

  .small-action-btn {
    padding: 4px 10px;
    background: var(--bg-light);
    color: white;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    cursor: pointer;
  }

  .small-action-btn:hover { background: var(--accent); }

  /* Viewer List */
  .viewer-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .viewer-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 8px;
    transition: background 0.1s;
    cursor: pointer;
  }

  .viewer-item:hover { background: var(--bg-hover); }

  .viewer-avatar-wrap {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.8rem;
    overflow: hidden;
    flex-shrink: 0;
  }

  .viewer-avatar-img { width: 100%; height: 100%; object-fit: cover; }

  .viewer-name {
    flex: 1;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .host-star-small { color: var(--warning); }

  /* Queue */
  .queue-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  .queue-card {
    display: flex;
    gap: 12px;
    padding: 8px;
    background: var(--bg-darkest);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .queue-thumb-wrap {
    position: relative;
    width: 80px;
    height: 45px;
    border-radius: 4px;
    overflow: hidden;
    background: #000;
    flex-shrink: 0;
  }

  .queue-thumb { width: 100%; height: 100%; object-fit: cover; opacity: 0.8; }

  .queue-pos {
    position: absolute;
    top: 2px;
    left: 2px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 0.6rem;
    font-weight: 800;
    padding: 1px 4px;
    border-radius: 2px;
  }

  .queue-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }

  .queue-title {
    font-size: 0.85rem;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .queue-added-by {
    font-size: 0.7rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .queue-empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--text-dim);
    opacity: 0.5;
    gap: 8px;
  }

  /* Sidebar Footer */
  .sidebar-footer {
    padding: 16px;
    background: var(--bg-darkest);
    border-top: 1px solid var(--border);
  }

  .queue-input-bar {
    display: flex;
    gap: 8px;
    background: var(--bg-dark);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .fancy-input {
    flex: 1;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: white;
    font-size: 0.85rem;
    outline: none;
  }

  .fancy-add-btn {
    width: 36px;
    height: 36px;
    background: var(--accent);
    color: white;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }

  .fancy-add-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: scale(1.05);
  }

  /* Context Menu */
  .ctx-backdrop { position: fixed; inset: 0; z-index: 1999; }
  .ctx-menu {
    position: fixed;
    z-index: 2000;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px;
    box-shadow: var(--shadow-lg);
    min-width: 180px;
    animation: fadeIn 0.1s;
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    color: var(--text-muted);
    border-radius: 4px;
    font-size: 0.9rem;
    font-weight: 600;
    transition: all 0.1s;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .ctx-item:hover { background: var(--bg-hover); color: white; }
  .ctx-item :global(svg) { color: var(--warning); }

  /* Chat */
  .sidebar-chat { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .chat-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-dim);
    gap: 12px;
    opacity: 0.5;
  }

  @media (max-width: 768px) {
    .watch-body { flex-direction: column; }
    .sidebar { width: 100%; max-height: 50vh; border-left: none; border-top: 1px solid var(--border); }
  }
</style>
