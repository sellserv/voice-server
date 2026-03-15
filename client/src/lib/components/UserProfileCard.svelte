<script lang="ts">
  import { onMount } from 'svelte';
  import { onlineUsers } from '$lib/stores/presence';
  import { currentUser } from '$lib/stores/auth';
  import { openOrCreateDm } from '$lib/stores/channels';
  import { initiateCall } from '$lib/stores/call';
  import { toast } from '$lib/stores/toast';
  import { resolveAsset } from '$lib/stores/server';
  import { nameStyle } from '$lib/nameColor';
  import Icon from './Icon.svelte';

  let {
    user,
    anchorEl,
    onclose,
    onviewscreen,
  }: {
    user: any;
    anchorEl: HTMLElement;
    onclose: () => void;
    onviewscreen?: (userId: string) => void;
  } = $props();

  let cardEl: HTMLElement;
  let cardStyle = $state('');

  function updatePosition() {
    if (!anchorEl || !cardEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();

    let top = rect.top;
    let left = rect.right + 12;

    // Check right edge
    if (left + cardRect.width > window.innerWidth - 20) {
      left = rect.left - cardRect.width - 12;
    }

    // Check bottom edge
    if (top + cardRect.height > window.innerHeight - 20) {
      top = window.innerHeight - cardRect.height - 20;
    }

    // Ensure it doesn't go off top
    top = Math.max(20, top);

    cardStyle = `top: ${top}px; left: ${left}px;`;
  }

  onMount(() => {
    updatePosition();
    const timer = setTimeout(updatePosition, 0); // Second pass after layout

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') onclose();
    }

    function handleClickOutside(e: MouseEvent) {
      if (cardEl && !cardEl.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
        onclose();
      }
    }

    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('click', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('click', handleClickOutside);
      clearTimeout(timer);
    };
  });

  function formatDate(dateStr?: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="profile-card" bind:this={cardEl} style={cardStyle} onclick={(e) => e.stopPropagation()}>
  <div class="banner" style:background-color={user.role_color || 'var(--accent)'}>
    {#if user.banner_url}
      <img src={resolveAsset(user.banner_url)} alt="" class="banner-img" />
    {/if}
  </div>

  <div class="card-body">
    <div class="avatar-section">
      <div class="avatar">
        <div class="avatar-inner">
          {#if user.avatar_url}
            <img src={resolveAsset(user.avatar_url)} alt="" class="avatar-img" />
          {:else}
            <span class="avatar-initial">{(user.display_name || user.username).charAt(0).toUpperCase()}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="info">
      <h3
        class="display-name"
        style={nameStyle(user.name_color, undefined, user.name_font)}
      >
        {user.display_name || user.username}
      </h3>
      <p class="username-text">@{user.username}</p>
    </div>

    {#if user.bio}
      <div class="section">
        <h4 class="section-label">About Me</h4>
        <p class="bio-text">{user.bio}</p>
      </div>
    {/if}

    {#if user.role_names && user.role_names.length > 0}
      <div class="section">
        <h4 class="section-label">Roles</h4>
        <div class="role-badges">
          {#each user.role_names as rName, i}
            <div
              class="role-badge"
              style:background-color="{(user.role_colors ?? [])[i] || '#99aab5'}15"
              style:border-color="{(user.role_colors ?? [])[i] || '#99aab5'}30"
              style:color={(user.role_colors ?? [])[i] || '#99aab5'}
            >
              <span class="role-dot" style:background-color={(user.role_colors ?? [])[i] || '#99aab5'}
              ></span>
              {rName}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if user.created_at}
      <div class="section">
        <h4 class="section-label">Member Since</h4>
        <p class="date-text">{formatDate(user.created_at)}</p>
      </div>
    {/if}

    {#if user.id !== $currentUser?.id}
      <div class="profile-actions">
        <button
          class="dm-btn"
          onclick={async () => {
            try {
              await openOrCreateDm(user.id);
              onclose();
            } catch (err: any) {
              toast.error('Failed to open DM: ' + err.message);
            }
          }}
        >
          <Icon name="message-square" size={16} />
          Message
        </button>
        <button
          class="call-btn"
          onclick={() => {
            initiateCall(user.id, user.display_name || user.username, user.avatar_url);
            onclose();
          }}
        >
          <Icon name="volume" size={16} />
          Call
        </button>
        <button
          class="call-btn video-call"
          onclick={() => {
            initiateCall(user.id, user.display_name || user.username, user.avatar_url, true);
            onclose();
          }}
        >
          <Icon name="video" size={16} />
          Video
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .profile-card {
    position: fixed;
    width: min(380px, calc(100vw - 24px));
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-lg);
    box-shadow: 
      0 20px 50px rgba(0, 0, 0, 0.6),
      var(--glass-glow);
    z-index: 200;
    overflow: hidden;
    animation: cardIn 0.3s var(--ease-elastic);
  }

  @keyframes cardIn {
    from { opacity: 0; transform: scale(0.9) translateY(20px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .banner {
    height: 140px;
    position: relative;
    overflow: hidden;
    background: var(--accent);
    mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  }

  .banner-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .card-body {
    padding: 60px 20px 20px;
    position: relative;
  }

  .avatar-section {
    position: absolute;
    top: -50px;
    left: 20px;
    display: flex;
    justify-content: flex-start;
    z-index: 2;
  }

  .avatar {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: rgba(8, 8, 15, 0.8);
    backdrop-filter: blur(10px);
    padding: 6px;
    box-shadow: var(--shadow-lg);
  }

  .avatar-inner {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-mid);
    border: 2px solid rgba(255, 255, 255, 0.1);
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-initial {
    font-size: 1.8rem;
    font-weight: 800;
    color: var(--accent);
  }

  .info {
    margin-bottom: 24px;
    background: rgba(255, 255, 255, 0.03);
    padding: 16px;
    border-radius: var(--radius);
    border: 1px solid var(--glass-border);
  }

  .display-name {
    font-size: 1.5rem;
    font-weight: 800;
    color: white;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .username-text {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
    margin: 2px 0 0;
    opacity: 0.8;
  }

  .section {
    margin-bottom: 24px;
    padding: 0 4px;
  }

  .section-label {
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin: 0 0 10px;
  }

  .bio-text {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.2);
    padding: 12px;
    border-radius: var(--radius-sm);
    border: 1px solid rgba(255, 255, 255, 0.03);
  }

  .role-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .role-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 0.7rem;
    font-weight: 700;
    border: 1px solid transparent;
    transition: all 0.2s;
  }

  .role-badge:hover {
    transform: translateY(-1px);
    filter: brightness(1.2);
  }

  .role-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 8px currentColor;
  }

  .date-text {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-muted);
    margin: 0;
  }

  .profile-actions {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .dm-btn, .call-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    padding: 12px;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 700;
    transition: all 0.3s var(--ease-out);
    color: white;
    border: none;
    cursor: pointer;
  }

  .dm-btn {
    background: var(--accent);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .dm-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px var(--accent-glow);
  }

  .call-btn {
    background: var(--success);
    box-shadow: 0 4px 12px rgba(52, 211, 153, 0.2);
  }

  .call-btn:hover {
    filter: brightness(1.1);
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(52, 211, 153, 0.3);
  }

  .call-btn.video-call {
    background: var(--accent);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .call-btn.video-call:hover {
    background: var(--accent-hover);
    box-shadow: 0 6px 16px var(--accent-glow);
  }
</style>
