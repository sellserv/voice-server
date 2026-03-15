<script lang="ts">
  import { tick } from 'svelte';
  import { type Snippet } from 'svelte';
  import type { Message } from '@voip-server/shared';

  let {
    messages,
    renderMessage,
    onloadmore,
    loading = false,
    hasMore = true,
  }: {
    messages: Message[];
    renderMessage: Snippet<[Message, number]>;
    onloadmore?: () => void;
    loading?: boolean;
    hasMore?: boolean;
  } = $props();

  let container: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);
  let containerHeight = $state(600);
  let shouldAutoScroll = $state(true);
  let hasNewMessages = $state(false);
  let loadingMore = $state(false);
  let prevMessageCount = $state(0);

  const ITEM_HEIGHT = 72; // estimated average message height
  const OVERSCAN = 5;
  const VIRTUALIZE_THRESHOLD = 200; // only virtualize when enough messages to matter

  // Skip virtualization for small message lists to avoid height-estimate bugs
  let useVirtualization = $derived(messages.length > VIRTUALIZE_THRESHOLD);

  // Calculate visible range
  let startIndex = $derived(
    useVirtualization ? Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN) : 0,
  );
  let endIndex = $derived(
    useVirtualization
      ? Math.min(messages.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN)
      : messages.length,
  );
  let visibleMessages = $derived(messages.slice(startIndex, endIndex));

  let topSpace = $derived(useVirtualization ? startIndex * ITEM_HEIGHT : 0);
  let bottomSpace = $derived(
    useVirtualization ? Math.max(0, (messages.length - endIndex) * ITEM_HEIGHT) : 0,
  );

  function handleScroll() {
    if (!container) return;
    scrollTop = container.scrollTop;
    containerHeight = container.clientHeight;

    const { scrollHeight, clientHeight } = container;
    shouldAutoScroll = scrollHeight - container.scrollTop - clientHeight < 60;

    // Clear new messages indicator when user scrolls to bottom
    if (shouldAutoScroll) hasNewMessages = false;

    // Load more when scrolled near top
    if (container.scrollTop < 100 && hasMore && !loading && !loadingMore && onloadmore) {
      loadingMore = true;
      onloadmore();
      // Debounce: prevent re-triggering until load completes or timeout
      tick().then(() => {
        setTimeout(() => {
          loadingMore = false;
        }, 500);
      });
    }
  }

  // Auto-scroll when new messages arrive and user is at bottom
  $effect(() => {
    const count = messages.length;
    if (count > prevMessageCount && prevMessageCount > 0) {
      // New messages arrived (not initial load)
      if (shouldAutoScroll && container) {
        tick().then(() => {
          if (container) container.scrollTop = container.scrollHeight;
        });
      } else {
        hasNewMessages = true;
      }
    }
    prevMessageCount = count;
  });

  // Initialize container dimensions on mount
  $effect(() => {
    if (container) {
      containerHeight = container.clientHeight;
    }
  });

  export function scrollToBottom() {
    if (container) {
      shouldAutoScroll = true;
      hasNewMessages = false;
      tick().then(() => {
        if (container) container.scrollTop = container.scrollHeight;
      });
    }
  }

  export function getContainer(): HTMLDivElement | undefined {
    return container;
  }

  export function isAtBottom(): boolean {
    return shouldAutoScroll;
  }
</script>

<div class="virtual-list" bind:this={container} onscroll={handleScroll}>
  {#if loading && messages.length === 0}
    <div class="skeleton-messages">
      {#each [1, 2, 3, 4, 5] as _}
        <div class="skeleton-message">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-content">
            <div class="skeleton-line skeleton-name"></div>
            <div class="skeleton-line skeleton-text"></div>
            <div class="skeleton-line skeleton-text short"></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if hasMore && messages.length > 0}
    <div class="load-more">
      {#if loading}
        Loading older messages...
      {/if}
    </div>
  {/if}

  <div style="height: {topSpace}px" aria-hidden="true"></div>
  {#each visibleMessages as message, i (message.id)}
    {@render renderMessage(message, startIndex + i)}
  {/each}
  <div style="height: {bottomSpace}px" aria-hidden="true"></div>
</div>

{#if hasNewMessages}
  <button class="jump-btn" onclick={scrollToBottom}>
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg
    >
    New messages
  </button>
{/if}

<style>
  .virtual-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0;
  }

  .jump-btn {
    position: absolute;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--accent);
    color: white;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
    box-shadow:
      var(--shadow-lg),
      0 0 20px var(--accent-glow);
    z-index: 5;
    animation: jumpIn 150ms var(--ease-out);
    transition: all 150ms var(--ease-out);
  }

  .jump-btn:hover {
    background: var(--accent-hover);
  }

  @keyframes jumpIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .skeleton-messages {
    padding: 16px 0;
  }

  .skeleton-message {
    display: flex;
    gap: 12px;
    padding: 10px 20px;
  }

  .skeleton-avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--bg-light);
    flex-shrink: 0;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .skeleton-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }

  .skeleton-line {
    height: 12px;
    border-radius: 6px;
    background: var(--bg-light);
    animation: shimmer 1.5s ease-in-out infinite;
  }

  .skeleton-name {
    width: 120px;
    height: 14px;
  }

  .skeleton-text {
    width: 85%;
  }

  .skeleton-text.short {
    width: 55%;
  }

  @keyframes shimmer {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.8;
    }
  }

  .load-more {
    text-align: center;
    color: var(--text-dim);
    padding: 20px;
    font-size: 0.9rem;
  }
</style>
