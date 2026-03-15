<script lang="ts">
  import { onlineUsers } from '$lib/stores/presence';
  import { resolveAsset } from '$lib/stores/server';

  let {
    src = '',
    alt = '',
    size = 36,
    userId = '',
    showStatus = false,
    class: className = '',
  }: {
    src?: string | null;
    alt?: string;
    size?: number;
    userId?: string;
    showStatus?: boolean;
    class?: string;
  } = $props();

  let loaded = $state(false);
  let error = $state(false);

  const statusColor = $derived.by(() => {
    if (!showStatus || !userId) return null;
    const user = $onlineUsers.get(userId);
    if (!user) return 'var(--text-dim)'; // offline
    switch (user.status) {
      case 'online':
        return 'var(--success)';
      case 'idle':
        return 'var(--warning)';
      case 'dnd':
        return 'var(--danger)';
      case 'invisible':
        return null;
      default:
        return 'var(--text-dim)';
    }
  });

  // Reset loaded state when src changes
  $effect(() => {
    src;
    loaded = false;
    error = false;
  });
</script>

<div
  class="avatar {className}"
  style="width: {size}px; height: {size}px; font-size: {size * 0.4}px;"
>
  {#if src && !error}
    <img
      src={resolveAsset(src)}
      {alt}
      class:loaded
      onload={() => (loaded = true)}
      onerror={() => (error = true)}
      width={size}
      height={size}
    />
  {/if}
  {#if !loaded || !src || error}
    <div class="placeholder">
      {alt?.[0]?.toUpperCase() || '?'}
    </div>
  {/if}
  {#if showStatus && statusColor}
    <span class="status-dot" style="background: {statusColor}"></span>
  {/if}
</div>

<style>
  .avatar {
    position: relative;
    border-radius: var(--radius-round);
    overflow: visible;
    flex-shrink: 0;
  }

  img {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-round);
    object-fit: cover;
    opacity: 0;
    transition: opacity 200ms var(--ease-out);
  }

  img.loaded {
    opacity: 1;
  }

  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-mid);
    border-radius: var(--radius-round);
    color: var(--text-muted);
    font-weight: 600;
  }

  .status-dot {
    position: absolute;
    bottom: -1px;
    right: -1px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2.5px solid var(--bg-dark);
    z-index: 1;
  }
</style>
