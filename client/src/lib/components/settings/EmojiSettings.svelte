<script lang="ts">
  import { api } from '$lib/api';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { toast } from '$lib/stores/toast';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId } from '$lib/stores/servers';
  import Icon from '../Icon.svelte';

  let emojis = $state<any[]>([]);
  let newEmojiName = $state('');
  let emojiFile = $state<File | null>(null);
  let uploadingEmoji = $state(false);
  let emojiFileInput = $state<HTMLInputElement>();

  const canManageEmojis = hasPermissionStore('manage_emojis');

  $effect(() => {
    const serverId = getActiveServerId();
    api
      .get<any[]>(`/api/servers/${serverId}/custom-emojis`)
      .then((e) => {
        emojis = e;
      })
      .catch(() => {});
  });

  function handleEmojiFile(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) emojiFile = input.files[0];
  }

  async function uploadEmoji() {
    if (!emojiFile || !newEmojiName.trim()) return;
    uploadingEmoji = true;
    try {
      const serverId = getActiveServerId();
      const result = await api.upload(emojiFile);
      await api.post(`/api/servers/${serverId}/admin/custom-emojis`, {
        name: newEmojiName.trim(),
        file_id: result.fileId || result.id,
      });
      newEmojiName = '';
      emojiFile = null;
      const e = await api.get<any[]>(`/api/servers/${serverId}/custom-emojis`);
      emojis = e;
      toast.success('Emoji added!');
    } catch (e: any) {
      toast.error('Error: ' + e.message);
    } finally {
      uploadingEmoji = false;
    }
  }

  async function deleteEmoji(id: string) {
    if (!(await confirm(`Delete this emoji? Members won't be able to use it anymore.`))) return;
    try {
      const serverId = getActiveServerId();
      await api.delete(`/api/servers/${serverId}/admin/custom-emojis/${id}`);
      emojis = emojis.filter((e) => e.id !== id);
    } catch (e: any) {
      toast.error(e.message);
    }
  }
</script>

<div class="emoji-settings">
  <p class="section-desc">
    Upload custom emojis that members of this server can use in chat and reactions.
  </p>

  {#if $canManageEmojis}
    <div class="upload-card">
      <div class="card-header">
        <Icon name="plus" size={18} />
        <span>Upload Emoji</span>
      </div>
      <div class="upload-row">
        <div class="emoji-preview-box" onclick={() => emojiFileInput?.click()}>
          {#if emojiFile}
            <img src={URL.createObjectURL(emojiFile)} alt="Preview" />
          {:else}
            <Icon name="search" size={24} class="placeholder-icon" />
          {/if}
          <div class="hover-overlay">Choose</div>
        </div>
        <div class="upload-controls">
          <input
            type="text"
            class="fancy-input"
            placeholder="Emoji name (e.g. happy_cat)"
            bind:value={newEmojiName}
          />
          <button
            class="btn-accent"
            onclick={uploadEmoji}
            disabled={uploadingEmoji || !emojiFile || !newEmojiName.trim()}
          >
            {uploadingEmoji ? 'Uploading...' : 'Add Emoji'}
          </button>
        </div>
      </div>
      <input
        type="file"
        accept="image/*"
        bind:this={emojiFileInput}
        onchange={handleEmojiFile}
        style="display:none"
      />
    </div>
  {/if}

  <div class="emoji-grid-section">
    <div class="grid-header">
      <span class="count-label">{emojis.length} / 50 Emojis</span>
    </div>

    <div class="emoji-grid">
      {#each emojis as emoji (emoji.id)}
        <div class="emoji-card">
          <div class="emoji-thumb">
            <img src={resolveAsset(`/uploads/${emoji.stored_name}`)} alt={emoji.name} />
          </div>
          <div class="emoji-info">
            <span class="emoji-name">:{emoji.name}:</span>
            {#if $canManageEmojis}
              <button class="delete-btn" onclick={() => deleteEmoji(emoji.id)} title="Delete Emoji">
                <Icon name="x" size={14} />
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="empty-state">
          <Icon name="star" size={48} class="empty-icon" />
          <p>No custom emojis yet</p>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .emoji-settings {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .section-desc {
    font-size: var(--font-md);
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* Upload Card */
  .upload-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    color: white;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }

  .upload-row {
    display: flex;
    gap: 20px;
    align-items: center;
  }

  .emoji-preview-box {
    width: 80px;
    height: 80px;
    background: var(--bg-darkest);
    border: 2px dashed var(--border);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: all 0.2s;
  }

  .emoji-preview-box:hover {
    border-color: var(--accent);
    background: rgba(124, 92, 252, 0.05);
  }

  .emoji-preview-box img {
    max-width: 80%;
    max-height: 80%;
    object-fit: contain;
  }

  .placeholder-icon {
    color: var(--text-dim);
    opacity: 0.5;
  }

  .hover-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 0.7rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .emoji-preview-box:hover .hover-overlay {
    opacity: 1;
  }

  .upload-controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .fancy-input {
    padding: 12px 16px;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: white;
    font-size: 0.95rem;
    outline: none;
    transition: all 0.2s;
  }

  .fancy-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .btn-accent {
    background: var(--accent);
    color: white;
    padding: 10px 24px;
    border-radius: 4px;
    font-weight: 700;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-accent:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  /* Emoji Grid */
  .emoji-grid-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .grid-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 8px;
  }

  .count-label {
    font-size: 0.75rem;
    font-weight: 800;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 12px;
  }

  .emoji-card {
    background: var(--bg-darker);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: transform 0.15s var(--ease-out);
  }

  .emoji-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent-subtle);
    box-shadow: var(--shadow-lg);
  }

  .emoji-thumb {
    height: 80px;
    background: var(--bg-darkest);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }

  .emoji-thumb img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .emoji-info {
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    background: rgba(0, 0, 0, 0.1);
  }

  .emoji-name {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delete-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-dim);
    transition: all 0.1s;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .delete-btn:hover {
    background: var(--danger);
    color: white;
  }

  .empty-state {
    grid-column: 1 / -1;
    padding: 60px 24px;
    text-align: center;
    color: var(--text-dim);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .empty-icon {
    opacity: 0.2;
  }
</style>
