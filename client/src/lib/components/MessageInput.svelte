<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import EmojiPicker from './EmojiPicker.svelte';
  import GifPicker from './GifPicker.svelte';
  import AppsMenu from './AppsMenu.svelte';
  import EffectsPanel from './EffectsPanel.svelte';
  import Icon from './Icon.svelte';

  import { toast } from '$lib/stores/toast';
  import { roles, hasPermissionStore } from '$lib/stores/permissions';
  import { serverSettings } from '$lib/stores/serverSettings';
  import { allUsers as usersStore, fetchUsers } from '$lib/stores/users';
  import type { Message } from '@voip-server/shared';
  import { resolveAsset } from '$lib/stores/server';
  import { plainTextPreview } from '$lib/utils';

  let {
    onSend,
    onTyping,
    onTypingStop,
    replyingTo = null,
    onCancelReply,
    channelId,
    placeholder = 'Send a message...',
  }: {
    onSend: (content: string, fileId?: string) => void;
    onTyping: () => void;
    onTypingStop: () => void;
    replyingTo?: Message | null;
    onCancelReply?: () => void;
    channelId: string;
    placeholder?: string;
  } = $props();

  let content = $state('');
  let typingTimeout: ReturnType<typeof setTimeout> | null = null;
  let uploading = $state(false);
  let fileInput: HTMLInputElement;
  let dragOver = $state(false);
  let textarea: HTMLTextAreaElement;

  let showEmojiPicker = $state(false);
  let showGifPicker = $state(false);
  let showAppsMenu = $state(false);
  let activeApp = $state<string | null>(null);
  let inputBar: HTMLDivElement;

  const canUseApps = hasPermissionStore('use_apps');

  // Mention autocomplete state
  let mentionQuery = $state<string | null>(null);
  let mentionStartIdx = $state(0);
  let mentionSelectedIdx = $state(0);
  let mentionReplacements = $state<{ display: string; syntax: string }[]>([]);

  interface MentionCandidate {
    type: 'everyone' | 'role' | 'user';
    id: string;
    label: string;
    avatar_url?: string | null;
    color?: string;
  }

  let mentionCandidates = $derived.by(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const results: MentionCandidate[] = [];

    // @everyone
    if ('everyone'.startsWith(q)) {
      results.push({ type: 'everyone', id: 'everyone', label: 'everyone' });
    }

    // Roles
    for (const role of $roles) {
      if (role.name.toLowerCase().startsWith(q)) {
        results.push({ type: 'role', id: role.id, label: role.name, color: role.color });
      }
    }

    // Users
    for (const user of $usersStore) {
      const name = user.display_name || user.username;
      if (name.toLowerCase().startsWith(q) || user.username.toLowerCase().startsWith(q)) {
        results.push({
          type: 'user',
          id: user.id,
          label: name,
          avatar_url: user.avatar_url,
          color: user.role_color,
        });
      }
    }

    return results.slice(0, 10);
  });

  onMount(() => {
    fetchUsers();
  });

  function detectMention() {
    if (!textarea) {
      mentionQuery = null;
      return;
    }
    const pos = textarea.selectionStart;
    const text = content.slice(0, pos);
    // Find the last '@' that starts a mention (preceded by start-of-string or whitespace)
    const match = text.match(/(?:^|\s)@(\w*)$/);
    if (match) {
      mentionQuery = match[1];
      mentionStartIdx = pos - match[1].length - 1; // position of '@'
      mentionSelectedIdx = 0;
    } else {
      mentionQuery = null;
    }
  }

  function selectMention(candidate: MentionCandidate) {
    const beforeAt = content.slice(0, mentionStartIdx);
    const afterQuery = content.slice(mentionStartIdx + 1 + (mentionQuery?.length ?? 0));
    let syntax: string;
    let display: string;
    if (candidate.type === 'everyone') {
      syntax = '<@everyone>';
      display = '@everyone';
    } else if (candidate.type === 'role') {
      syntax = `<@role:${candidate.id}>`;
      display = `@${candidate.label}`;
    } else {
      syntax = `<@${candidate.id}>`;
      display = `@${candidate.label}`;
    }

    mentionReplacements.push({ display, syntax });
    content = beforeAt + display + ' ' + afterQuery;
    mentionQuery = null;

    requestAnimationFrame(() => {
      const newPos = beforeAt.length + display.length + 1;
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Mention navigation
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIdx = (mentionSelectedIdx + 1) % mentionCandidates.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIdx =
          (mentionSelectedIdx - 1 + mentionCandidates.length) % mentionCandidates.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(mentionCandidates[mentionSelectedIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mentionQuery = null;
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleInput() {
    onTyping();
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => onTypingStop(), 3000);
    autoResize();
    detectMention();
  }

  function autoResize() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  function send() {
    let trimmed = content.trim();
    if (!trimmed) return;
    // Convert display mentions back to raw syntax
    for (const { display, syntax } of mentionReplacements) {
      trimmed = trimmed.replace(display, syntax);
    }
    onSend(trimmed);
    content = '';
    mentionReplacements = [];
    mentionQuery = null;
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
    if (textarea) textarea.style.height = 'auto';
  }

  async function uploadFile(file: File) {
    uploading = true;
    try {
      const result = await api.upload(file);
      onSend(file.name, result.id);
    } catch (e: any) {
      toast.error('Upload failed: ' + e.message);
    } finally {
      uploading = false;
    }
  }

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) uploadFile(file);
    input.value = '';
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) uploadFile(file);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function toggleEmojiPicker() {
    showGifPicker = false;
    showAppsMenu = false;
    activeApp = null;
    showEmojiPicker = !showEmojiPicker;
  }

  function toggleGifPicker() {
    showEmojiPicker = false;
    showAppsMenu = false;
    activeApp = null;
    showGifPicker = !showGifPicker;
  }

  function toggleAppsMenu() {
    showEmojiPicker = false;
    showGifPicker = false;
    if (activeApp) {
      activeApp = null;
      return;
    }
    showAppsMenu = !showAppsMenu;
  }

  function handleSelectApp(appId: string) {
    showAppsMenu = false;
    activeApp = appId;
  }

  function handleCloseApp() {
    activeApp = null;
  }

  function handleEmojiSelect(emoji: string) {
    // Custom emoji: <:name:url> → show :name: in input, swap to full syntax on send
    const customMatch = emoji.match(/^<:([^:]+):(.+)>$/);
    if (customMatch) {
      const display = `:${customMatch[1]}:`;
      mentionReplacements.push({ display, syntax: emoji });
      insertAtCursor(display);
    } else {
      insertAtCursor(emoji);
    }
  }

  function insertAtCursor(text: string) {
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      content = content.slice(0, start) + text + content.slice(end);
      const newPos = start + text.length;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
      });
    } else {
      content += text;
    }
  }

  function handleGifSelect(gifUrl: string) {
    showGifPicker = false;
    onSend(gifUrl);
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as Node;
    if (!target.isConnected) return;
    if (!inputBar?.contains(target)) {
      showEmojiPicker = false;
      showGifPicker = false;
      showAppsMenu = false;
      activeApp = null;
    }
  }
</script>

<svelte:document onclick={handleClickOutside} />

{#if replyingTo}
  <div class="reply-preview">
    <div class="reply-preview-content">
      <svg
        class="reply-preview-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></svg
      >
      <span class="reply-preview-author">{replyingTo.display_name || replyingTo.username}</span>
      <span class="reply-preview-text"
        >{plainTextPreview(replyingTo.content || '').slice(0, 100) || 'Attachment'}</span
      >
    </div>
    <button class="reply-preview-close" onclick={() => onCancelReply?.()}>&times;</button>
  </div>
{/if}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="input-bar"
  class:drag-over={dragOver}
  ondrop={handleDrop}
  ondragover={handleDragOver}
  ondragleave={() => (dragOver = false)}
  bind:this={inputBar}
>
  {#if mentionQuery !== null && mentionCandidates.length > 0}
    <div class="mention-popup">
      {#each mentionCandidates as candidate, i (candidate.type + candidate.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="mention-item"
          class:selected={i === mentionSelectedIdx}
          onmousedown={(e) => {
            e.preventDefault();
            selectMention(candidate);
          }}
          onmouseenter={() => (mentionSelectedIdx = i)}
        >
          {#if candidate.type === 'everyone'}
            <span class="mention-icon mention-at">@</span>
          {:else if candidate.type === 'role'}
            <span
              class="mention-icon mention-role-dot"
              style:background={candidate.color || 'var(--text-dim)'}
            ></span>
          {:else}
            <span class="mention-avatar">
              {#if candidate.avatar_url}
                <img src={resolveAsset(candidate.avatar_url)} alt="" class="mention-avatar-img" />
              {:else}
                {candidate.label.charAt(0).toUpperCase()}
              {/if}
            </span>
          {/if}
          <span class="mention-label">{candidate.label}</span>
        </div>
      {/each}
    </div>
  {/if}
  {#if showEmojiPicker}
    <EmojiPicker onSelect={handleEmojiSelect} />
  {/if}
  {#if showGifPicker}
    <GifPicker onSelect={handleGifSelect} />
  {/if}
  {#if showAppsMenu}
    <AppsMenu onSelectApp={handleSelectApp} onclose={() => (showAppsMenu = false)} />
  {/if}
  {#if activeApp === 'effects'}
    <EffectsPanel {channelId} onclose={handleCloseApp} />
  {/if}
  <div class="input-row">
    <div class="left-actions">
      <button
        class="action-btn"
        onclick={() => fileInput.click()}
        disabled={uploading}
        title="Upload file"
      >
        {#if uploading}
          <span class="upload-spinner"></span>
        {:else}
          <Icon name="paperclip" size={20} strokeWidth={2.5} />
        {/if}
      </button>
      <input type="file" bind:this={fileInput} onchange={handleFileSelect} style="display: none" />
      
      <button
        class="action-btn"
        onclick={toggleAppsMenu}
        title="Apps"
        class:active={showAppsMenu || activeApp !== null}
      >
        <Icon name="grid" size={20} strokeWidth={2.5} />
      </button>
    </div>

    <div class="text-input-wrap">
      <textarea
        class="text-input"
        bind:value={content}
        bind:this={textarea}
        onkeydown={handleKeyDown}
        oninput={handleInput}
        placeholder={placeholder}
        rows="1"
      ></textarea>
    </div>

    <div class="right-actions">
      <button
        class="action-btn picker-btn"
        onclick={toggleGifPicker}
        title="GIF"
        class:active={showGifPicker}
      >
        GIF
      </button>
      
      <button
        class="action-btn"
        onclick={toggleEmojiPicker}
        title="Emoji"
        class:active={showEmojiPicker}
      >
        <Icon name="smile" size={20} strokeWidth={2.5} />
      </button>

      {#if content.trim()}
        <button class="send-btn" onclick={send}>
          <Icon name="paper-plane" size={20} strokeWidth={2.5} />
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .input-bar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 20px 24px;
    flex-shrink: 0;
    position: relative;
    z-index: 20;
  }

  .input-row {
    display: flex;
    align-items: center; /* Changed from flex-end for better icon centering */
    gap: 4px;
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    border-radius: 14px;
    padding: 4px 8px;
    transition: all 0.3s var(--ease-out);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  }

  .input-row:focus-within {
    border-color: var(--accent);
    background: rgba(255, 255, 255, 0.05);
    box-shadow: 
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px var(--accent-glow);
  }

  .left-actions, .right-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .action-btn {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-icon);
    border-radius: 8px;
    transition: all 0.2s var(--ease-elastic);
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    font-weight: 800;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
    transform: scale(1.1);
  }

  .action-btn.active {
    color: var(--accent);
    background: rgba(124, 92, 252, 0.1);
  }

  .text-input-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 8px;
  }

  .text-input {
    flex: 1;
    padding: 10px 0;
    background: none;
    color: white;
    border: none;
    resize: none;
    max-height: 200px;
    line-height: 1.5;
    outline: none;
    font-size: 1rem;
    font-family: inherit;
    font-weight: 500;
  }

  .text-input::placeholder {
    color: var(--text-dim);
    opacity: 0.5;
  }

  .send-btn {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: white;
    border-radius: 8px;
    transition: all 0.3s var(--ease-elastic);
    flex-shrink: 0;
    box-shadow: 0 4px 12px var(--accent-glow);
    margin-left: 4px;
    animation: sendBtnIn 0.3s var(--ease-elastic);
  }

  @keyframes sendBtnIn {
    from { transform: scale(0) rotate(-45deg); opacity: 0; }
    to { transform: scale(1) rotate(0); opacity: 1; }
  }

  .send-btn:hover {
    background: var(--accent-hover);
    transform: scale(1.1) translateX(2px);
    box-shadow: 0 6px 16px var(--accent-glow);
  }

  .upload-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mention-popup {
    position: absolute;
    bottom: 100%;
    left: 20px;
    right: 20px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(32px);
    -webkit-backdrop-filter: blur(32px);
    border: 1px solid var(--glass-border-bright);
    border-radius: var(--radius);
    padding: 8px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
    z-index: 50;
    margin-bottom: 12px;
    animation: popupIn 0.2s var(--ease-out);
    scrollbar-width: thin;
  }

  @keyframes popupIn {
    from { opacity: 0; transform: translateY(15px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s var(--ease-out);
    margin-bottom: 2px;
  }

  .mention-item:last-child {
    margin-bottom: 0;
  }

  .mention-item.selected {
    background: var(--accent);
    color: white;
    padding-left: 16px;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .mention-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .mention-at {
    font-weight: 800;
    font-size: 1rem;
    color: var(--accent);
    background: rgba(124, 92, 252, 0.15);
    border-radius: 50%;
  }

  .mention-item.selected .mention-at {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  .mention-role-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 10px currentColor;
  }

  .mention-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 800;
    flex-shrink: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .mention-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mention-label {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
    flex: 1;
  }

  .reply-preview {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.02);
    backdrop-filter: blur(8px);
    border: 1px solid var(--glass-border);
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    margin: 0 20px -8px;
    position: relative;
    z-index: 1;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
  }

  .reply-preview-content {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .reply-preview-icon {
    color: var(--accent);
    flex-shrink: 0;
    opacity: 0.8;
  }

  .reply-preview-author {
    font-size: 0.85rem;
    font-weight: 800;
    color: white;
    flex-shrink: 0;
  }

  .reply-preview-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  .reply-preview-close {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    border-radius: 50%;
    font-size: 16px;
    transition: all 0.2s var(--ease-out);
  }

  .reply-preview-close:hover {
    color: white;
    background: var(--danger);
    transform: scale(1.1) rotate(90deg);
  }

  @media (max-width: 768px) {
    .input-bar {
      padding: 0 12px 16px;
    }

    .input-row {
      gap: 6px;
      padding: 0 8px;
    }

    .picker-btn, .attach-btn, .send-btn {
      width: 32px;
    }
  }
</style>
