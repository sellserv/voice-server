<script lang="ts">
  import { onMount } from 'svelte';
  import type { Channel, Message } from '@voip-server/shared';
  import {
    messagesByChannel,
    hasMoreByChannel,
    loadMessages,
    loadingMessages,
    addReaction,
    removeReaction,
  } from '$lib/stores/messages';
  import { currentUser } from '$lib/stores/auth';
  import { sendWs, onWsEvent } from '$lib/ws';
  import { api } from '$lib/api';
  import MessageBubble from './MessageBubble.svelte';
  import MessageInput from './MessageInput.svelte';
  import VirtualMessageList from './VirtualMessageList.svelte';
  import EffectsOverlay from './EffectsOverlay.svelte';
  import Icon from './Icon.svelte';
  import { toast } from '$lib/stores/toast';
  import { initiateCall } from '$lib/stores/call';
  import { resolveAsset } from '$lib/stores/server';
  import { plainTextPreview } from '$lib/utils';

  let { channel }: { channel: Channel } = $props();

  let virtualList: ReturnType<typeof VirtualMessageList> | undefined = $state();
  let typingUsers = $state<string[]>([]);
  let dragOver = $state(false);
  let uploading = $state(false);
  let searchQuery = $state('');
  let searchResults = $state<Message[]>([]);
  let searching = $state(false);
  let showSearch = $state(false);
  let showPins = $state(false);
  let pinnedMessages = $state<Message[]>([]);
  let loadingPins = $state(false);
  let replyingTo = $state<Message | null>(null);
  let isDm = $derived(channel.type === 'dm');
  let dmOtherUser = $derived(
    isDm ? channel.dm_participants?.find((p) => p.id !== $currentUser?.id) : null,
  );

  // Track channel-specific messages
  let messages = $derived($messagesByChannel.get(channel.id) || []);
  let hasMore = $derived($hasMoreByChannel.get(channel.id) ?? true);

  // Message grouping: check if message should show compact (no avatar/name)
  function isGrouped(msg: Message, idx: number): boolean {
    if (idx === 0) return false;
    if (msg.type === 'call') return false;
    const prev = messages[idx - 1];
    if (!prev) return false;
    if (prev.type === 'call') return false;
    if (prev.user_id !== msg.user_id) return false;
    // Within 5 minutes
    const diff = new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff < 5 * 60 * 1000;
  }

  async function fetchPinnedMessages() {
    loadingPins = true;
    try {
      const res = await api.get<{ messages: Message[] }>(`/api/channels/${channel.id}/pins`);
      pinnedMessages = res.messages || [];
    } catch {
      pinnedMessages = [];
    } finally {
      loadingPins = false;
    }
  }

  // Load messages when channel changes
  $effect(() => {
    const id = channel.id;
    if (!$messagesByChannel.has(id)) {
      loadMessages(id);
    }
    // Reset search, reply, and pins when channel changes
    showSearch = false;
    showPins = false;
    searchQuery = '';
    searchResults = [];
    pinnedMessages = [];
    replyingTo = null;
  });

  onMount(() => {
    const unsub = onWsEvent((event) => {
      if (event.type === 'message:reacted' && event.channelId === channel.id) {
        addReaction(event.messageId, event.channelId, event.emoji, event.userId);
        return;
      }
      if (event.type === 'message:unreacted' && event.channelId === channel.id) {
        removeReaction(event.messageId, event.channelId, event.emoji, event.userId);
        return;
      }
      if (event.type === 'typing:update' && event.channelId === channel.id) {
        if (event.userId === $currentUser?.id) return;
        if (event.isTyping) {
          typingUsers = [...typingUsers.filter((u) => u !== event.username), event.username];
        } else {
          typingUsers = typingUsers.filter((u) => u !== event.username);
        }
      }
    });
    return unsub;
  });

  function loadOlder() {
    if (!hasMore || $loadingMessages) return;
    const firstMsg = messages[0];
    if (firstMsg) {
      loadMessages(channel.id, firstMsg.created_at);
    }
  }

  function handleSend(content: string, fileId?: string) {
    sendWs({
      type: 'chat:send',
      channelId: channel.id,
      content,
      fileId,
      replyToId: replyingTo?.id,
    });
    sendWs({ type: 'typing:stop', channelId: channel.id });
    replyingTo = null;
  }

  function handleReply(message: Message) {
    replyingTo = message;
  }

  function cancelReply() {
    replyingTo = null;
  }

  function scrollToMessage(id: string) {
    const el = virtualList?.getContainer();
    if (!el) return;
    const msgEl = el.querySelector(`[data-message-id="${id}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight');
      setTimeout(() => msgEl.classList.remove('highlight'), 2000);
    }
  }

  function handleTyping() {
    sendWs({ type: 'typing:start', channelId: channel.id });
  }

  function handleTypingStop() {
    sendWs({ type: 'typing:stop', channelId: channel.id });
  }

  function handlePaneDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragOver = true;
    }
  }

  function handlePaneDragLeave(e: DragEvent) {
    if (e.currentTarget && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      dragOver = false;
    }
  }

  async function handlePaneDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (!file || uploading) return;
    uploading = true;
    try {
      const result = await api.upload(file);
      handleSend(file.name, result.id);
    } catch (err: any) {
      toast.error('Upload failed: ' + err.message);
    } finally {
      uploading = false;
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      searchResults = [];
      return;
    }
    searching = true;
    try {
      const res = await api.get<{ messages: Message[] }>(
        `/api/messages/search?q=${encodeURIComponent(searchQuery.trim())}&limit=25`,
      );
      searchResults = res.messages || [];
    } catch {
      searchResults = [];
    } finally {
      searching = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="chat-pane"
  class:drag-over={dragOver}
  ondragover={handlePaneDragOver}
  ondragleave={handlePaneDragLeave}
  ondrop={handlePaneDrop}
>
  <div class="chat-header">
    <div class="header-left">
      {#if isDm && dmOtherUser}
        <span class="dm-header-avatar">
          {#if dmOtherUser.avatar_url}
            <img src={resolveAsset(dmOtherUser.avatar_url)} alt="" class="dm-header-avatar-img" />
          {:else}
            {(dmOtherUser.display_name || dmOtherUser.username).charAt(0).toUpperCase()}
          {/if}
        </span>
        <span class="hash">@</span>
        <h2>{dmOtherUser.display_name || dmOtherUser.username}</h2>
      {:else}
        <span class="hash">#</span>
        <h2>{channel.name}</h2>
        {#if channel.topic}
          <span class="topic-divider"></span>
          <span class="topic">{channel.topic}</span>
        {/if}
      {/if}
    </div>
    {#if isDm && dmOtherUser}
      <button
        class="header-icon-btn"
        title="Start call"
        aria-label="Start call"
        onclick={() =>
          initiateCall(
            dmOtherUser!.id,
            dmOtherUser!.display_name || dmOtherUser!.username,
            dmOtherUser!.avatar_url,
          )}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path
            d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2z"
          /></svg
        >
      </button>
      <button
        class="header-icon-btn"
        title="Video call"
        aria-label="Video call"
        onclick={() =>
          initiateCall(
            dmOtherUser!.id,
            dmOtherUser!.display_name || dmOtherUser!.username,
            dmOtherUser!.avatar_url,
            true,
          )}
      >
        <Icon name="video" size={20} />
      </button>
    {/if}
    <button
      class="header-icon-btn"
      class:active={showPins}
      onclick={() => {
        showPins = !showPins;
        if (showPins) {
          showSearch = false;
          fetchPinnedMessages();
        }
      }}
      title="Pinned messages"
      aria-label="Pinned messages"
    >
      <Icon name="pin" size={20} strokeWidth={2.5} style="transform: rotate(45deg);" />
    </button>
    <button
      class="search-toggle"
      class:active={showSearch}
      onclick={() => {
        showSearch = !showSearch;
        if (showSearch) {
          showPins = false;
          searchQuery = '';
          searchResults = [];
        }
      }}
      title="Search messages"
      aria-label="Search messages"
    >
      <Icon name="search" size={20} strokeWidth={2.5} />
    </button>
  </div>

  {#if showPins}
    <div class="pins-popover">
      <div class="pins-header">
        <Icon name="pin" size={16} strokeWidth={2.5} style="transform: rotate(45deg);" />
        <span>Pinned Messages</span>
      </div>
      <div class="pins-content">
        {#if loadingPins}
          <div class="pins-status">
            <div class="search-spinner"></div>
          </div>
        {:else if pinnedMessages.length === 0}
          <div class="pins-status">
            <Icon name="pin" size={32} strokeWidth={1.5} class="empty-pin-icon" style="transform: rotate(45deg); opacity: 0.2;" />
            <p>No pinned messages in this channel.</p>
          </div>
        {:else}
          {#each pinnedMessages as message (message.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="pin-item" onclick={() => { scrollToMessage(message.id); showPins = false; }}>
              <div class="pin-item-header">
                <span class="pin-author">{message.display_name || message.username}</span>
                <span class="pin-time">{new Date(message.created_at).toLocaleDateString()}</span>
              </div>
              <div class="pin-text">{plainTextPreview(message.content || '')}</div>
              {#if message.file_url}
                <div class="pin-attachment">Attachment</div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  {#if showSearch}
    <div class="search-bar">
      <input
        type="text"
        class="search-input"
        placeholder="Search messages..."
        bind:value={searchQuery}
        oninput={handleSearch}
        autofocus
      />
      {#if searching}
        <span class="search-spinner"></span>
      {/if}
    </div>
    {#if searchResults.length > 0}
      <div class="search-results">
        <div class="search-results-header">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
        </div>
        {#each searchResults as message (message.id)}
          <MessageBubble {message} grouped={false} />
        {/each}
      </div>
    {:else if searchQuery.trim() && !searching}
      <div class="search-empty">No results found</div>
    {/if}
  {:else}
    {#key channel.id}
      <div class="chat-messages-area">
        <EffectsOverlay channelId={channel.id} />
        {#if messages.length === 0 && !$loadingMessages}
          <div class="empty-channel">
            <div class="empty-icon">
              {#if isDm && dmOtherUser}
                {(dmOtherUser.display_name || dmOtherUser.username).charAt(0).toUpperCase()}
              {:else}
                #
              {/if}
            </div>
            {#if isDm && dmOtherUser}
              <h3>@{dmOtherUser.display_name || dmOtherUser.username}</h3>
              <p>This is the beginning of your direct message history.</p>
            {:else}
              <h3>Welcome to #{channel.name}!</h3>
              <p>This is the start of the <strong>#{channel.name}</strong> channel. {channel.topic ? `Topic: ${channel.topic}` : ''}</p>
            {/if}
          </div>
        {:else}
          <VirtualMessageList
            bind:this={virtualList}
            {messages}
            loading={$loadingMessages}
            {hasMore}
            onloadmore={loadOlder}
          >
            {#snippet renderMessage(message, idx)}
              <MessageBubble
                {message}
                grouped={isGrouped(message, idx)}
                onReply={handleReply}
                onScrollToMessage={scrollToMessage}
              />
            {/snippet}
          </VirtualMessageList>
        {/if}

        {#if typingUsers.length > 0}
          <div class="typing-indicator">
            {typingUsers.join(', ')}
            {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </div>
        {/if}
      </div>
    {/key}

    <MessageInput
      onSend={handleSend}
      onTyping={handleTyping}
      onTypingStop={handleTypingStop}
      {replyingTo}
      onCancelReply={cancelReply}
      channelId={channel.id}
      placeholder={isDm && dmOtherUser ? `Message @${dmOtherUser.display_name || dmOtherUser.username}` : `Message #${channel.name}`}
    />
  {/if}
</div>

<style>
  .chat-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    position: relative;
    background: transparent;
  }

  .chat-pane.drag-over {
    background: rgba(124, 92, 252, 0.05);
  }

  .chat-pane.drag-over::after {
    content: 'Drop to upload';
    position: absolute;
    inset: 10px;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: 800;
    color: var(--accent);
    background: rgba(12, 12, 22, 0.8);
    backdrop-filter: blur(10px);
    z-index: 1000;
    pointer-events: none;
  }

  .chat-header {
    height: 56px;
    display: flex;
    align-items: center;
    padding: 0 20px;
    border-bottom: 1px solid var(--glass-border);
    background: rgba(12, 12, 22, 0.4);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    flex-shrink: 0;
    z-index: 10;
    gap: 16px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  }

  .header-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .dm-header-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 800;
    overflow: hidden;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .dm-header-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .hash {
    font-size: 1.5rem;
    color: var(--text-dim);
    font-weight: 400;
    line-height: 1;
    opacity: 0.6;
  }

  h2 {
    font-size: 1rem;
    font-weight: 800;
    color: white;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }

  .topic-divider {
    width: 1px;
    height: 24px;
    background: var(--glass-border);
    margin: 0 4px;
    opacity: 0.5;
  }

  .topic {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  .pins-popover {
    position: absolute;
    top: 64px;
    right: 20px;
    width: 400px;
    max-height: 500px;
    display: flex;
    flex-direction: column;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(32px);
    -webkit-backdrop-filter: blur(32px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-lg);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    z-index: 100;
    animation: pinsIn 0.3s var(--ease-elastic);
  }

  @keyframes pinsIn {
    from { opacity: 0; transform: translateY(-10px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .pins-header {
    padding: var(--space-4) var(--space-5);
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--glass-border);
    font-weight: 800;
    font-size: 0.95rem;
    color: white;
    letter-spacing: -0.01em;
  }

  .pins-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-3);
    scrollbar-width: thin;
  }

  .pins-status {
    padding: 40px var(--space-5);
    text-align: center;
    color: var(--text-dim);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .empty-pin-icon {
    opacity: 0.2;
  }

  .pin-item {
    padding: var(--space-3) var(--space-4);
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius);
    margin-bottom: 8px;
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
  }

  .pin-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
  }

  .pin-item-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .pin-author {
    font-size: 0.85rem;
    font-weight: 800;
    color: var(--accent);
  }

  .pin-time {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-dim);
  }

  .pin-text {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.9);
    line-height: 1.4;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .pin-attachment {
    margin-top: 8px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 8px;
    border-radius: 4px;
    width: fit-content;
  }

  .search-toggle, .header-icon-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    transition: all 0.3s var(--ease-elastic);
    flex-shrink: 0;
    cursor: pointer;
    border: none;
    outline: none;
  }

  .search-toggle:hover, .header-icon-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
    transform: scale(1.1);
  }

  .search-toggle.active {
    color: var(--accent);
    background: rgba(124, 92, 252, 0.1);
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px var(--space-5);
    background: rgba(0, 0, 0, 0.2);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--glass-border);
    flex-shrink: 0;
    animation: searchSlide 0.3s var(--ease-out);
  }

  @keyframes searchSlide {
    from { transform: translateY(-100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .search-input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
  }

  .search-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.05);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
    padding: 12px 0;
    scrollbar-width: thin;
  }

  .search-results-header {
    padding: 8px var(--space-6);
    font-size: 0.8rem;
    color: var(--text-dim);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .chat-messages-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }

  .empty-channel {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 60px var(--space-8);
    gap: var(--space-3);
  }

  .empty-channel h3 {
    font-size: 2.5rem;
    font-weight: 900;
    color: white;
    margin: 0;
    letter-spacing: -0.03em;
  }

  .empty-channel p {
    font-size: 1.1rem;
    color: var(--text-muted);
    max-width: 520px;
    margin: 0;
    line-height: 1.6;
    font-weight: 500;
  }

  .empty-icon {
    width: 80px;
    height: 80px;
    border-radius: var(--radius-lg);
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    margin-bottom: var(--space-4);
    font-size: 2.5rem;
    font-weight: 800;
    box-shadow: 0 8px 32px var(--accent-glow);
    transform: rotate(-5deg);
  }

  .typing-indicator {
    padding: 0 var(--space-6) 12px;
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 700;
    min-height: 24px;
    opacity: 0.8;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .typing-indicator::before {
    content: '';
    width: 4px;
    height: 4px;
    background: var(--accent);
    border-radius: 50%;
    animation: typingDot 1s infinite;
  }

  @keyframes typingDot {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.5); opacity: 0.5; }
  }

  :global(.message.highlight) {
    background: rgba(124, 92, 252, 0.08) !important;
    box-shadow: inset 4px 0 0 var(--accent);
    animation: highlightFade 2s forwards;
  }

  @keyframes highlightFade {
    from { background: rgba(124, 92, 252, 0.15); }
    to { background: transparent; }
  }

  @media (max-width: 768px) {
    .chat-header {
      padding: 0 12px;
      height: 48px;
    }

    .topic-divider, .topic {
      display: none;
    }

    .empty-channel {
      padding: 40px 20px;
    }

    .empty-channel h3 {
      font-size: 1.75rem;
    }
  }
</style>
