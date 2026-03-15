<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Message } from '@voip-server/shared';
  import { currentUser } from '$lib/stores/auth';
  import { sendWs } from '$lib/ws';
  import EmojiPicker from './EmojiPicker.svelte';
  import LinkPreviewCard from './LinkPreviewCard.svelte';
  import Avatar from './Avatar.svelte';
  import { confirm } from '$lib/stores/toast';
  import { api } from '$lib/api';
  import { onlineUsers } from '$lib/stores/presence';
  import { roles, hasPermissionStore } from '$lib/stores/permissions';
  import { usersMap as allUsersMap, fetchUsers } from '$lib/stores/users';
  import UserProfileCard from './UserProfileCard.svelte';
  import PollMessage from './PollMessage.svelte';

  import { nameStyle } from '$lib/nameColor';
  import { resolveAsset } from '$lib/stores/server';
  import { plainTextPreview } from '$lib/utils';
  import Icon from './Icon.svelte';
  import { servers, switchServer } from '$lib/stores/servers';
  import { toast } from '$lib/stores/toast';
  import type { ServerInvitation, Server } from '@voip-server/shared';

  import { SvelteSet } from 'svelte/reactivity';

  let {
    message,
    grouped = false,
    onReply,
    onScrollToMessage,
  }: {
    message: Message;
    grouped?: boolean;
    onReply?: (message: Message) => void;
    onScrollToMessage?: (id: string) => void;
  } = $props();

  let editing = $state(false);
  let editContent = $state('');
  let showActions = $state(false);
  let showReactionPicker = $state(false);
  let pickerPosition = $state<{ top: number; left: number; flipBelow: boolean }>({
    top: 0,
    left: 0,
    flipBelow: false,
  });
  let reactionBtnEl: HTMLButtonElement;
  let pickerWrapperEl: HTMLDivElement;
  let profileUser = $state<ReturnType<typeof $allUsersMap.get> | null>(null);
  let profileAnchorEl = $state<HTMLElement | null>(null);
  let showReportModal = $state(false);
  let reportReason = $state('');
  let reportSubmitting = $state(false);
  let reportError = $state('');

  // Invitation state
  let inviteData = $state<ServerInvitation | null>(null);
  let loadingInvite = $state(false);
  let inviteActionProcessing = $state(false);

  $effect(() => {
    if (message.invite_id && !inviteData) {
      loadingInvite = true;
      api.get(`/api/invitations/${message.invite_id}`).then((inv: ServerInvitation) => {
        inviteData = inv;
        loadingInvite = false;
      }).catch(() => {
        loadingInvite = false;
      });
    }
  });

  async function acceptInvite() {
    if (!inviteData || inviteActionProcessing) return;
    inviteActionProcessing = true;
    try {
      const server = await api.post<Server>(`/api/invitations/${inviteData.id}/accept`);
      servers.update(list => [...list, server]);
      switchServer(server.id);
      toast.success(`Joined ${server.name}!`);
      inviteData = { ...inviteData, status: 'accepted' };
    } catch (e: any) {
      toast.error(e.message || 'Failed to join');
    } finally {
      inviteActionProcessing = false;
    }
  }

  async function declineInvite() {
    if (!inviteData || inviteActionProcessing) return;
    inviteActionProcessing = true;
    try {
      await api.post(`/api/invitations/${inviteData.id}/decline`);
      toast.success('Invitation declined');
      inviteData = { ...inviteData, status: 'declined' };
    } catch (e: any) {
      toast.error(e.message || 'Failed to decline');
    } finally {
      inviteActionProcessing = false;
    }
  }

  async function submitReport() {
    if (!reportReason.trim()) return;
    reportSubmitting = true;
    reportError = '';
    try {
      await api.post('/api/reports', { message_id: message.id, reason: reportReason.trim() });
      showReportModal = false;
      reportReason = '';
    } catch (e: any) {
      reportError = e?.message || 'Failed to submit report';
    } finally {
      reportSubmitting = false;
    }
  }

  function handleContentClick(e: MouseEvent) {
    const mention = (e.target as HTMLElement).closest('.mention-user[data-user-id]');
    if (!mention) return;
    const userId = mention.getAttribute('data-user-id');
    if (!userId) return;
    const user = $allUsersMap.get(userId);
    if (!user) return;
    profileUser = user;
    profileAnchorEl = mention as HTMLElement;
  }

  function closeProfileCard() {
    profileUser = null;
    profileAnchorEl = null;
  }

  const isGiphyUrl = $derived(message.content ? /^https:\/\/(media\d?|i)\.giphy\.com\//.test(message.content) : false);

  function extractUrls(text: string | null | undefined): string[] {
    if (!text) return [];
    const urlRegex = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]}>])/g;
    const matches = text.match(urlRegex);
    if (!matches) return [];
    // Deduplicate, exclude Giphy URLs, cap at 5
    const seen = new SvelteSet<string>();
    return matches
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return !/^https:\/\/(media\d?|i)\.giphy\.com\//.test(url);
      })
      .slice(0, 5);
  }

  const messageUrls = $derived(extractUrls(message.content));

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderReactionEmoji(emoji: string): string {
    const match = emoji.match(/^<:([a-zA-Z0-9_]+):(\/uploads\/[^>]+)>$/);
    if (match) {
      return `<img class="custom-emoji-reaction" src="${escapeHtml(resolveAsset(match[2]))}" alt=":${escapeHtml(match[1])}:" />`;
    }
    return escapeHtml(emoji);
  }

  const isOwn = $derived($currentUser?.id === message.user_id);
  const isAdmin = $derived($currentUser?.role === 'admin');
  const canPinStore = hasPermissionStore('pin_messages');

  function handlePin() {
    sendWs({ type: message.pinned ? 'message:unpin' : 'message:pin', messageId: message.id });
  }

  function renderContent(text: string): string {
    // First HTML-escape, then replace custom emoji markup
    let safe = escapeHtml(text);

    // Mention: <@everyone> (after escaping: &lt;@everyone&gt;)
    safe = safe.replace(
      /&lt;@everyone&gt;/g,
      '<span class="mention mention-everyone">@everyone</span>',
    );

    // Mention: <@role:roleId> (after escaping: &lt;@role:roleId&gt;)
    safe = safe.replace(/&lt;@role:([a-f0-9-]+)&gt;/g, (_match, roleId) => {
      const role = $roles.find((r) => r.id === roleId);
      const name = role?.name ?? 'unknown-role';
      const color = role?.color
        ? ` style="background: ${escapeHtml(role.color)}22; color: ${escapeHtml(role.color)}"`
        : '';
      return `<span class="mention mention-role"${color}>@${escapeHtml(name)}</span>`;
    });

    // Mention: <@userId> (after escaping: &lt;@userId&gt;) — must not match role: or everyone
    safe = safe.replace(/&lt;@([a-f0-9-]+)&gt;/g, (_match, userId) => {
      const user = $allUsersMap.get(userId);
      const name = user?.display_name || user?.username || 'unknown';
      return `<span class="mention mention-user" data-user-id="${escapeHtml(userId)}" role="button" tabindex="0">@${escapeHtml(name)}</span>`;
    });

    // Custom emoji format: <:name:/uploads/fileId> (after escaping: &lt;:name:/uploads/fileId&gt;)
    safe = safe.replace(
      /&lt;:([a-zA-Z0-9_]+):(\/uploads\/[^&]+)&gt;/g,
      (_match, name, src) =>
        `<img class="custom-emoji" src="${resolveAsset(src)}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" />`,
    );

    // URL linkification — decode HTML entities for href, keep escaped text for display
    safe = safe.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]}>])/g, (url) => {
      // Reverse only known safe HTML entities to reconstruct the real URL for href
      const href = url
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      // Encode the href to ensure no attribute breakout
      const safeHref = encodeURI(decodeURI(href));
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="message-link">${url}</a>`;
    });

    return safe;
  }
  function getReactionTooltip(reaction: {
    emoji: string;
    count: number;
    userIds: string[];
  }): string {
    const names = reaction.userIds.map((id) => {
      if (id === $currentUser?.id) return 'You';
      const online = $onlineUsers.get(id);
      if (online) return online.display_name || online.username;
      const user = $allUsersMap.get(id);
      return user?.display_name || user?.username || 'Unknown';
    });
    return names.join(', ');
  }

  function getFileType(mime?: string | null): 'image' | 'audio' | 'video' | 'other' {
    if (!mime) return 'image'; // fallback for legacy
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'other';
  }

  const fileType = $derived(getFileType(message.file_mime_type));

  function togglePin() {
    sendWs({ type: message.pinned ? 'message:unpin' : 'message:pin', messageId: message.id });
  }
  const timeStr = $derived(formatTime(message.created_at));

  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return (
      d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  function startEdit() {
    editContent = message.content;
    editing = true;
  }

  function saveEdit() {
    if (editContent.trim() && editContent.trim() !== message.content) {
      sendWs({ type: 'chat:edit', messageId: message.id, content: editContent.trim() });
    }
    editing = false;
  }

  function cancelEdit() {
    editing = false;
  }

  async function deleteMessage() {
    if (
      !(await confirm('Delete this message?', {
        title: 'Delete Message',
        confirmLabel: 'Delete',
        dangerAction: true,
      }))
    )
      return;
    sendWs({ type: 'chat:delete', messageId: message.id });
  }

  function toggleReaction(emoji: string) {
    const userId = $currentUser?.id;
    if (!userId) return;
    const reaction = message.reactions?.find((r) => r.emoji === emoji);
    if (reaction?.userIds.includes(userId)) {
      sendWs({ type: 'message:unreact', messageId: message.id, emoji });
    } else {
      sendWs({ type: 'message:react', messageId: message.id, emoji });
    }
  }

  function addNewReaction(emoji: string) {
    sendWs({ type: 'message:react', messageId: message.id, emoji });
    closePicker();
  }

  function closePicker() {
    showReactionPicker = false;
    showActions = false;
  }

  function handleDocumentClick(e: MouseEvent) {
    if (!showReactionPicker) return;
    if (
      pickerWrapperEl &&
      !pickerWrapperEl.contains(e.target as Node) &&
      reactionBtnEl &&
      !reactionBtnEl.contains(e.target as Node)
    ) {
      closePicker();
    }
  }

  const isMentioned = $derived(
    message.content?.includes(`<@${$currentUser?.id}>`) ||
      message.content?.includes('<@everyone>') ||
      (message.role_ids && $currentUser?.role_ids?.some((id) => message.role_ids?.includes(id))),
  );

  onMount(() => {
    fetchUsers();
    document.addEventListener('click', handleDocumentClick);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleDocumentClick);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="message"
  class:grouped
  class:mentioned={isMentioned}
  data-message-id={message.id}
  onmouseenter={() => (showActions = true)}
  onmouseleave={() => {
    if (!showReactionPicker) showActions = false;
  }}
>
  {#if grouped}
    <span class="grouped-time">{timeStr}</span>
  {:else}
    <Avatar
      src={message.avatar_url}
      alt={message.display_name || message.username || '?'}
      size={40}
      class="msg-avatar"
    />
  {/if}

  <div class="body">
    {#if message.reply_to_id}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="reply-ref" onclick={() => onScrollToMessage?.(message.reply_to_id!)}>
        <svg
          class="reply-ref-icon"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg
        >
        <span class="reply-ref-author"
          >{message.reply_to_display_name || message.reply_to_username || 'Unknown'}</span
        >
        <span class="reply-ref-text"
          >{plainTextPreview(message.reply_to_content || '') || 'Message deleted'}</span
        >
      </div>
    {/if}
    {#if !grouped}
      {@const authorData = $allUsersMap.get(message.user_id)}
      <div class="header">
        <span
          class="author"
          style={nameStyle(message.name_color, message.role_color, message.name_font)}
          >{authorData?.server_nickname || message.display_name || message.username}</span
        >
        <span class="time">{timeStr}</span>
        {#if message.pinned}
          <Icon name="pin" size={12} class="pinned-icon-small" />
        {/if}
        {#if message.edited_at}
          <span class="edited">(edited)</span>
        {/if}
      </div>
    {/if}

      {#if editing}
        <form
          class="edit-form"
          onsubmit={(e) => {
            e.preventDefault();
            saveEdit();
          }}
        >
          <input type="text" bind:value={editContent} class="edit-input" />
          <div class="edit-actions">
            <button type="button" class="small-btn" onclick={cancelEdit}>cancel</button>
            <button type="submit" class="small-btn save">save</button>
          </div>
        </form>
      {:else}
        {#if isGiphyUrl}
          <img src={message.content} alt="GIF" class="inline-image" />
        {:else if message.content && (!message.invite_id || !inviteData)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <p class="content" onclick={handleContentClick}>{@html renderContent(message.content)}</p>
        {/if}
      {#each messageUrls as previewUrl (previewUrl)}
        <LinkPreviewCard url={previewUrl} />
      {/each}

      {#if message.invite_id}
        {#if loadingInvite}
          <div class="invite-embed-loading">
            <div class="spinner-small"></div>
            <span>Loading invitation...</span>
          </div>
        {:else if inviteData}
          <div class="invite-embed">
            <div class="invite-embed-header">YOU'VE BEEN INVITED TO JOIN A SERVER</div>
            <div class="invite-embed-body">
              <div class="invite-server-icon">
                {#if inviteData.server_icon_url}
                  <img src={resolveAsset(inviteData.server_icon_url)} alt="" />
                {:else}
                  <span>{inviteData.server_name.charAt(0).toUpperCase()}</span>
                {/if}
              </div>
              <div class="invite-server-info">
                <span class="invite-server-name">{inviteData.server_name}</span>
                <div class="invite-server-stats">
                  <div class="status-dot online"></div>
                  <span>{inviteData.inviter_name} invited you</span>
                </div>
              </div>
              <div class="invite-embed-actions">
                {#if inviteData.status === 'accepted'}
                  <button class="invite-btn accepted" disabled>Joined</button>
                {:else if inviteData.status === 'declined' || inviteData.status === 'cancelled'}
                  <button class="invite-btn declined" disabled>
                    {inviteData.status === 'cancelled' ? 'Expired' : 'Declined'}
                  </button>
                {:else}
                  <button 
                    class="invite-btn accept" 
                    onclick={acceptInvite}
                    disabled={inviteActionProcessing}
                  >Join</button>
                  <button 
                    class="invite-btn decline" 
                    onclick={declineInvite}
                    disabled={inviteActionProcessing}
                  >
                    <Icon name="x" size={14} />
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/if}
      {/if}

      {#if message.poll_id}
        <PollMessage pollId={message.poll_id} />
      {/if}
      {#if message.file_id}
        <div class="file-attachment">
          {#if fileType === 'image'}
            <img
              src={resolveAsset(`/uploads/${message.file_id}`)}
              alt="attachment"
              class="inline-image"
              onerror={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          {:else if fileType === 'audio'}
            <audio
              controls
              src={resolveAsset(`/uploads/${message.file_id}`)}
              class="audio-player"
              preload="metadata"
            ></audio>
          {:else if fileType === 'video'}
            <video
              controls
              src={resolveAsset(`/uploads/${message.file_id}`)}
              class="video-player"
              preload="metadata"
            ></video>
          {:else}
            <a
              href={resolveAsset(`/uploads/${message.file_id}`)}
              class="file-download"
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
                  points="7 10 12 15 17 10"
                /><line x1="12" y1="15" x2="12" y2="3" /></svg
              >
              <span>{message.content || 'Download file'}</span>
            </a>
          {/if}
        </div>
      {/if}

      {#if message.reactions && message.reactions.length > 0}
        <div class="reactions">
          {#each message.reactions as reaction}
            <button
              class="reaction-pill"
              class:reacted={reaction.userIds.includes($currentUser?.id || '')}
              onclick={() => toggleReaction(reaction.emoji)}
              title={getReactionTooltip(reaction)}
            >
              <span class="reaction-emoji">{@html renderReactionEmoji(reaction.emoji)}</span>
              <span class="reaction-count">{reaction.count}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  {#if showActions && !editing}
    <div class="actions">
      <button
        class="action-btn"
        title="Reply"
        aria-label="Reply"
        onclick={() => onReply?.(message)}
      >
        <svg
          class="action-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg
        >
      </button>
      <button
        class="action-btn"
        title="Add Reaction"
        aria-label="Add Reaction"
        bind:this={reactionBtnEl}
        onclick={() => {
          if (!showReactionPicker && reactionBtnEl) {
            const rect = reactionBtnEl.getBoundingClientRect();
            const pickerHeight = 435;
            const flipBelow = rect.top < pickerHeight;
            pickerPosition = {
              top: flipBelow ? rect.bottom + 8 : rect.top - pickerHeight,
              left: Math.min(rect.left, window.innerWidth - 360),
              flipBelow,
            };
          }
          showReactionPicker = !showReactionPicker;
        }}
      >
        <svg
          class="action-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line
            x1="9"
            y1="9"
            x2="9.01"
            y2="9"
          /><line x1="15" y1="9" x2="15.01" y2="9" /></svg
        >
      </button>
      {#if $canPinStore}
        <button class="action-btn" title={message.pinned ? 'Unpin Message' : 'Pin Message'} aria-label={message.pinned ? 'Unpin' : 'Pin'} onclick={togglePin}>
          <Icon name="pin" size={18} style="transform: rotate(45deg);" />
        </button>
      {/if}
      {#if isOwn}
        <button class="action-btn" title="Edit" aria-label="Edit" onclick={startEdit}
          ><svg
            class="action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path
              d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
            /></svg
          ></button
        >
      {/if}
      {#if isOwn || isAdmin}
        <button class="action-btn delete" title="Delete" aria-label="Delete" onclick={deleteMessage}
          ><svg
            class="action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><polyline points="3 6 5 6 21 6" /><path
              d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
            /></svg
          ></button
        >
      {/if}
      {#if !isOwn}
        <button class="action-btn" title="Report" aria-label="Report" onclick={() => showReportModal = true}
          ><svg
            class="action-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg
          ></button
        >
      {/if}
    </div>
  {/if}
</div>

{#if showReactionPicker}
  <div
    class="reaction-picker-fixed"
    class:flip-below={pickerPosition.flipBelow}
    bind:this={pickerWrapperEl}
    style="top: {pickerPosition.top}px; left: {pickerPosition.left}px;"
  >
    <EmojiPicker onSelect={addNewReaction} />
  </div>
{/if}

{#if profileUser && profileAnchorEl}
  <UserProfileCard user={profileUser} anchorEl={profileAnchorEl} onclose={closeProfileCard} />
{/if}

{#if showReportModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="report-backdrop" onclick={() => { showReportModal = false; reportError = ''; }}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="report-modal" onclick={(e) => e.stopPropagation()}>
      <h3>Report Message</h3>
      <p class="report-preview">"{message.content?.slice(0, 120)}{(message.content?.length ?? 0) > 120 ? '...' : ''}"</p>
      <textarea
        class="report-input"
        bind:value={reportReason}
        placeholder="Why are you reporting this message?"
        rows="3"
        maxlength="500"
      ></textarea>
      {#if reportError}
        <p class="report-error">{reportError}</p>
      {/if}
      <div class="report-actions">
        <button class="report-cancel" onclick={() => { showReportModal = false; reportError = ''; }}>Cancel</button>
        <button class="report-submit" disabled={reportSubmitting || !reportReason.trim()} onclick={submitReport}>
          {reportSubmitting ? 'Submitting...' : 'Report'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .message {
    display: flex;
    gap: 16px;
    padding: 2px 20px;
    position: relative;
    transition: all 0.2s var(--ease-out);
    min-height: 28px;
  }

  .message:not(.grouped) {
    margin-top: 18px;
    padding-top: 4px;
  }

  .message:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .message.mentioned {
    background: rgba(251, 191, 36, 0.05);
  }

  .message.mentioned:hover {
    background: rgba(251, 191, 36, 0.08);
  }

  .message.mentioned::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--warning);
    box-shadow: 0 0 12px var(--warning);
  }

  .message.grouped {
    padding-top: 1px;
    padding-bottom: 1px;
    padding-left: 76px;
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 4px;
  }

  .author {
    font-weight: 800;
    font-size: 1rem;
    color: white;
    letter-spacing: -0.01em;
  }

  .time {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-weight: 600;
    opacity: 0.8;
  }

  .pinned-icon-small {
    color: var(--text-dim);
    transform: rotate(45deg);
    margin-left: 2px;
  }

  .grouped-time {
    position: absolute;
    left: 0;
    width: 76px;
    text-align: center;
    font-size: 0.65rem;
    color: var(--text-dim);
    opacity: 0;
    transition: all 0.2s var(--ease-out);
    pointer-events: none;
    line-height: 28px;
    font-weight: 700;
  }

  .message:hover .grouped-time {
    opacity: 1;
    transform: translateX(4px);
  }

  .content {
    color: rgba(255, 255, 255, 0.9);
    font-size: 1rem;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
    font-weight: 450;
  }

  .edited {
    font-size: 0.65rem;
    color: var(--text-dim);
    margin-left: 6px;
    font-weight: 700;
    opacity: 0.6;
  }

  .actions {
    position: absolute;
    right: 20px;
    top: -20px;
    display: flex;
    background: rgba(12, 12, 22, 0.95);
    backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius-sm);
    padding: 4px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s var(--ease-elastic);
    transform: translateY(10px) scale(0.95);
    z-index: 100;
  }

  .message:hover .actions {
    opacity: 1;
    visibility: visible;
    transform: translateY(0) scale(1);
  }

  .action-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    border-radius: 6px;
    transition: all 0.2s var(--ease-out);
    cursor: pointer;
  }

  .action-btn:hover {
    background: var(--accent);
    color: white;
    transform: scale(1.1);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .action-icon {
    width: 18px;
    height: 18px;
    stroke-width: 2.5;
  }

  .action-btn.delete:hover {
    background: var(--danger);
    box-shadow: 0 4px 12px rgba(248, 113, 113, 0.3);
  }

  .reaction-picker-fixed {
    position: fixed;
    z-index: 1000;
  }

  .reaction-picker-fixed :global(.emoji-popover) {
    position: static;
    bottom: auto;
    margin-bottom: 0;
  }

  /* Invitation Embed */
  .invite-embed {
    margin-top: 8px;
    background: var(--bg-darker);
    border: 1px solid var(--glass-border-bright);
    border-radius: 8px;
    padding: 16px;
    max-width: 432px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-sm);
  }

  .invite-embed-header {
    font-size: 0.7rem;
    font-weight: 800;
    color: var(--text-dim);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .invite-embed-body {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .invite-server-icon {
    width: 50px;
    height: 50px;
    border-radius: 16px;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 800;
    color: white;
    overflow: hidden;
    flex-shrink: 0;
    border: 1px solid var(--glass-border);
  }

  .invite-server-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .invite-server-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .invite-server-name {
    font-size: 1rem;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .invite-server-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .status-dot.online {
    width: 8px;
    height: 8px;
    background: var(--success);
    border-radius: 50%;
  }

  .invite-embed-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .invite-btn {
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .invite-btn.accept {
    background: var(--success);
    color: white;
  }

  .invite-btn.accept:hover:not(:disabled) {
    background: var(--success-hover);
    transform: translateY(-1px);
  }

  .invite-btn.decline {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    padding: 8px 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .invite-btn.decline:hover:not(:disabled) {
    background: var(--danger);
    color: white;
  }

  .invite-btn.accepted {
    background: rgba(255, 255, 255, 0.05);
    color: var(--success);
    cursor: default;
  }

  .invite-btn.declined {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-muted);
    cursor: default;
  }

  .invite-embed-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    background: var(--bg-darker);
    border-radius: 8px;
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .reaction-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--glass-border);
    border-radius: 20px;
    font-size: 1.1rem;
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
  }

  .reaction-emoji {
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  :global(.custom-emoji-reaction) {
    width: 1.25rem;
    height: 1.25rem;
    object-fit: contain;
    vertical-align: middle;
  }

  :global(.custom-emoji) {
    height: 1.75rem;
    width: auto;
    min-width: 1.75rem;
    object-fit: contain;
    vertical-align: middle;
    margin: 0 2px;
  }

  .reaction-pill:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-1px);
  }

  .reaction-pill.reacted {
    background: rgba(124, 92, 252, 0.15);
    border-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .reaction-count {
    font-size: 0.8rem;
    font-weight: 800;
    color: var(--text-muted);
  }

  .reaction-pill.reacted .reaction-count {
    color: var(--accent);
  }

  .reply-ref {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    margin-bottom: 8px;
    border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
    max-width: 90%;
    border: 1px solid var(--glass-border);
    border-left-width: 3px;
    border-left-color: var(--accent);
  }

  .reply-ref:hover {
    background: rgba(255, 255, 255, 0.05);
    transform: translateX(4px);
  }

  .reply-ref-author {
    font-size: 0.85rem;
    font-weight: 800;
    color: var(--accent);
  }

  .reply-ref-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  :global(.mention) {
    background: rgba(124, 92, 252, 0.15);
    color: var(--accent);
    padding: 0 6px;
    border-radius: 4px;
    font-weight: 700;
    transition: all 0.2s var(--ease-out);
    box-shadow: 0 0 8px rgba(124, 92, 252, 0.1);
  }

  :global(.mention:hover) {
    background: var(--accent);
    color: white;
    box-shadow: 0 0 15px var(--accent-glow);
  }

  :global(.mention-everyone) {
    background: rgba(251, 191, 36, 0.1);
    color: var(--warning);
    box-shadow: 0 0 8px rgba(251, 191, 36, 0.1);
  }

  /* Report modal overhaul */
  .report-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s var(--ease-out);
  }

  .report-modal {
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(32px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius);
    padding: 32px;
    width: 480px;
    max-width: 95vw;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    animation: modalIn 0.3s var(--ease-elastic);
  }

  @keyframes modalIn {
    from { transform: scale(0.9); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .report-modal h3 {
    margin: 0 0 16px;
    font-size: 1.25rem;
    font-weight: 800;
    color: white;
    letter-spacing: -0.02em;
  }

  .report-preview {
    font-size: 0.9rem;
    color: var(--text-muted);
    background: rgba(0, 0, 0, 0.2);
    padding: 16px;
    border-radius: var(--radius-sm);
    margin: 0 0 24px;
    font-style: italic;
    word-break: break-word;
    border: 1px solid var(--glass-border);
  }

  .report-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: white;
    padding: 14px;
    font-size: 1rem;
    resize: vertical;
    font-family: inherit;
    outline: none;
    transition: all 0.2s;
  }

  .report-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .report-error {
    color: var(--danger);
    font-size: 0.85rem;
    margin: 12px 0 0;
    font-weight: 700;
  }

  .report-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .report-cancel {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--glass-border);
    color: white;
    padding: 10px 24px;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
  }

  .report-cancel:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .report-submit {
    background: var(--danger);
    border: none;
    color: white;
    padding: 10px 24px;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    cursor: pointer;
    font-weight: 800;
    box-shadow: 0 4px 12px rgba(248, 113, 113, 0.2);
    transition: all 0.2s;
  }

  .report-submit:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(248, 113, 113, 0.3);
  }

  .report-submit:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (max-width: 768px) {
    .message {
      padding-left: 16px;
      padding-right: 16px;
      gap: 12px;
    }

    .message.grouped {
      padding-left: 68px;
    }

    .report-modal {
      width: calc(100vw - 32px);
      padding: 24px;
    }

    .actions {
      right: 12px;
      gap: 2px;
    }

    .action-btn {
      width: 30px;
      height: 30px;
    }
  }
</style>
