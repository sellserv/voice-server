<script lang="ts">
  import { api } from '$lib/api';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { toast } from '$lib/stores/toast';
  import AudioTrimmer from '../AudioTrimmer.svelte';
  import EmojiPicker from '../EmojiPicker.svelte';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId } from '$lib/stores/servers';
  import Icon from '../Icon.svelte';

  let sounds = $state<any[]>([]);
  let newSoundName = $state('');
  let soundFile = $state<File | null>(null);
  let uploadingSound = $state(false);
  let soundFileInput = $state<HTMLInputElement>();
  let trimmedBlob = $state<Blob | null>(null);
  let trimmedDuration = $state(0);
  let showTrimmer = $state(false);

  let customEmojis = $state<any[]>([]);
  let selectedEmojiId = $state<string | null>(null);
  let selectedEmojiUrl = $state<string | null>(null);
  let selectedEmoji = $state<string | null>(null);
  let showEmojiPicker = $state(false);
  let emojiPickerWrapper = $state<HTMLDivElement>();

  let pickerPos = $derived.by(() => {
    if (!showEmojiPicker || !emojiPickerWrapper) return { top: 0, left: 0 };
    const rect = emojiPickerWrapper.getBoundingClientRect();
    return {
      top: rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - 360) // ensure it doesn't go off screen
    };
  });

  const canManageSoundboard = hasPermissionStore('manage_soundboard');

  let hasEmoji = $derived(!!selectedEmojiId || !!selectedEmoji);

  $effect(() => {
    const serverId = getActiveServerId();
    api
      .get<any[]>(`/api/servers/${serverId}/soundboard`)
      .then((s) => {
        sounds = s;
      })
      .catch(() => {});
    api
      .get<any[]>(`/api/servers/${serverId}/custom-emojis`)
      .then((e) => {
        customEmojis = e;
      })
      .catch(() => {});
  });

  $effect(() => {
    if (!showEmojiPicker) return;
    function handleClickOutside(e: MouseEvent) {
      if (emojiPickerWrapper && !emojiPickerWrapper.contains(e.target as Node)) {
        showEmojiPicker = false;
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  function handleEmojiSelect(value: string) {
    const customMatch = value.match(/^<:(.+?):(.+)>$/);
    if (customMatch) {
      const [, name, src] = customMatch;
      const found = customEmojis.find((e) => e.name === name);
      if (found) {
        selectedEmojiId = found.id;
        selectedEmojiUrl = src;
        selectedEmoji = null;
      }
    } else {
      selectedEmoji = value;
      selectedEmojiId = null;
      selectedEmojiUrl = null;
    }
    showEmojiPicker = false;
  }

  function handleSoundFile(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) {
      soundFile = input.files[0];
      trimmedBlob = null;
      trimmedDuration = 0;
      showTrimmer = true;
    }
  }

  async function uploadSound() {
    if (!trimmedBlob || !newSoundName.trim() || !hasEmoji) return;
    uploadingSound = true;
    try {
      const serverId = getActiveServerId();
      const result = await api.upload(trimmedBlob, 'trimmed.wav');
      const body: any = { name: newSoundName.trim(), file_id: result.fileId || result.id };
      if (selectedEmojiId) body.emoji_id = selectedEmojiId;
      if (selectedEmoji) body.emoji = selectedEmoji;
      await api.post(`/api/servers/${serverId}/soundboard`, body);
      newSoundName = '';
      soundFile = null;
      trimmedBlob = null;
      trimmedDuration = 0;
      showTrimmer = false;
      selectedEmojiId = null;
      selectedEmojiUrl = null;
      selectedEmoji = null;
      const s = await api.get<any[]>(`/api/servers/${serverId}/soundboard`);
      sounds = s;
      toast.success('Sound added!');
    } catch (e: any) {
      toast.error('Error: ' + e.message);
    } finally {
      uploadingSound = false;
    }
  }

  async function deleteSound(id: string) {
    if (!(await confirm(`Delete this sound?`))) return;
    try {
      const serverId = getActiveServerId();
      await api.delete(`/api/servers/${serverId}/soundboard/${id}`);
      sounds = sounds.filter((s) => s.id !== id);
    } catch (e: any) {
      toast.error(e.message);
    }
  }
</script>

<div class="soundboard-settings">
  <p class="section-desc">
    Add short audio clips that members can play in voice channels.
  </p>

  {#if $canManageSoundboard}
    <div class="upload-card">
      <div class="card-header">
        <Icon name="plus" size={18} />
        <span>Add New Sound</span>
      </div>
      
      <div class="upload-row">
        <div class="emoji-select-wrapper" bind:this={emojiPickerWrapper}>
          <button
            class="emoji-preview-box"
            onclick={() => (showEmojiPicker = !showEmojiPicker)}
            title="Select emoji"
          >
            {#if selectedEmojiUrl}
              <img src={selectedEmojiUrl} alt="emoji" class="emoji-img" />
            {:else if selectedEmoji}
              <span class="emoji-unicode">{selectedEmoji}</span>
            {:else}
              <Icon name="star" size={24} class="placeholder-icon" />
            {/if}
            <div class="hover-overlay">Icon</div>
          </button>
          {#if showEmojiPicker}
            <div class="emoji-picker-popover" style="top: {pickerPos.top}px; left: {pickerPos.left}px;">
              <EmojiPicker onSelect={handleEmojiSelect} />
            </div>
          {/if}
        </div>

        <div class="upload-controls">
          <input
            type="text"
            class="fancy-input"
            placeholder="Sound name"
            bind:value={newSoundName}
          />
          
          <div class="file-actions">
            <button class="btn-subtle" onclick={() => soundFileInput?.click()}>
              {soundFile ? soundFile.name.slice(0, 20) : 'Choose Audio'}
            </button>
            <input
              type="file"
              accept="audio/*"
              bind:this={soundFileInput}
              onchange={handleSoundFile}
              style="display:none"
            />
            <button
              class="btn-accent"
              onclick={uploadSound}
              disabled={uploadingSound || !trimmedBlob || !newSoundName.trim() || !hasEmoji}
            >
              {uploadingSound ? 'Uploading...' : 'Add Sound'}
            </button>
          </div>
        </div>
      </div>

      {#if showTrimmer && soundFile}
        <div class="trimmer-overlay">
          <AudioTrimmer
            file={soundFile}
            maxDuration={7}
            onconfirm={(blob, duration) => {
              trimmedBlob = blob;
              trimmedDuration = duration;
              showTrimmer = false;
            }}
            oncancel={() => {
              showTrimmer = false;
              soundFile = null;
              trimmedBlob = null;
              trimmedDuration = 0;
            }}
          />
        </div>
      {/if}

      {#if trimmedBlob && !showTrimmer}
        <div class="trim-summary">
          <Icon name="play" size={14} />
          <span class="trim-label">Trimmed: {trimmedDuration.toFixed(1)}s</span>
          <button class="btn-text-small" onclick={() => (showTrimmer = true)}>Re-trim</button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid-section">
    <div class="grid-header">
      <span class="count-label">{sounds.length} / 24 Sounds</span>
    </div>

    <div class="sound-grid">
      {#each sounds as sound (sound.id)}
        <div class="sound-card">
          <div class="sound-top">
            <div class="sound-icon-box">
              {#if sound.emoji_stored_name}
                <img src={resolveAsset(`/uploads/${sound.emoji_stored_name}`)} alt="" />
              {:else if sound.emoji}
                <span class="emoji-text">{sound.emoji}</span>
              {:else}
                <Icon name="music" size={18} />
              {/if}
            </div>
            <div class="sound-details">
              <span class="sound-name">{sound.name}</span>
              <span class="sound-meta">Sound effect</span>
            </div>
            {#if $canManageSoundboard}
              <button class="delete-btn" onclick={() => deleteSound(sound.id)} title="Delete Sound">
                <Icon name="x" size={14} />
              </button>
            {/if}
          </div>
          <div class="sound-preview">
            <audio controls src={resolveAsset(`/uploads/${sound.stored_name}`)} preload="none"></audio>
          </div>
        </div>
      {:else}
        <div class="empty-state">
          <Icon name="music" size={48} class="empty-icon" />
          <p>No sounds uploaded yet</p>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .soundboard-settings {
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
    align-items: flex-start;
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

  .emoji-img { max-width: 60%; max-height: 60%; object-fit: contain; }
  .emoji-unicode { font-size: 1.8rem; }
  .placeholder-icon { color: var(--text-dim); opacity: 0.5; }

  .hover-overlay {
    position: absolute; inset: 0;
    background: rgba(0, 0, 0, 0.6); color: white;
    font-size: 0.7rem; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    text-transform: uppercase; opacity: 0; transition: opacity 0.1s;
  }

  .emoji-preview-box:hover .hover-overlay { opacity: 1; }

  .upload-controls { flex: 1; display: flex; flex-direction: column; gap: 12px; }

  .fancy-input {
    padding: 12px 16px; background: var(--bg-darkest);
    border: 1px solid var(--border); border-radius: 6px;
    color: white; font-size: 0.95rem; outline: none; transition: all 0.2s;
  }
  .fancy-input:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }

  .file-actions { display: flex; gap: 10px; }

  .btn-accent {
    background: var(--accent); color: white; padding: 10px 24px;
    border-radius: 4px; font-weight: 700; border: none; cursor: pointer;
  }

  .btn-subtle {
    background: var(--bg-mid); color: white; padding: 10px 20px;
    border-radius: 4px; font-weight: 600; font-size: 0.9rem; border: none; cursor: pointer;
  }

  .trim-summary {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; background: rgba(52, 211, 153, 0.1);
    border: 1px solid rgba(52, 211, 153, 0.2); border-radius: 8px;
    color: var(--accent-success); font-size: 0.9rem; font-weight: 600;
  }

  .btn-text-small {
    background: transparent; color: white; border: none;
    cursor: pointer; font-size: 0.8rem; font-weight: 700;
    text-decoration: underline; margin-left: auto;
  }

  .trimmer-overlay {
    margin-top: 10px;
    width: 100%;
  }

  /* Sound Grid */
  .grid-section { display: flex; flex-direction: column; gap: 16px; }
  .grid-header {
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--border); padding-bottom: 8px;
  }
  .count-label {
    font-size: 0.75rem; font-weight: 800; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.05em;
  }

  .sound-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }

  .sound-card {
    background: var(--bg-darker); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden; display: flex;
    flex-direction: column; transition: all 0.2s;
  }

  .sound-card:hover { border-color: var(--accent-subtle); transform: translateY(-2px); }

  .sound-top {
    padding: 12px; display: flex; align-items: center; gap: 12px;
  }

  .sound-icon-box {
    width: 40px; height: 40px; background: var(--bg-darkest);
    border-radius: 8px; display: flex; align-items: center;
    justify-content: center; flex-shrink: 0; color: var(--accent);
  }
  .sound-icon-box img { max-width: 60%; max-height: 60%; }
  .emoji-text { font-size: 1.25rem; }

  .sound-details { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .sound-name { font-weight: 700; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sound-meta { font-size: 0.75rem; color: var(--text-dim); }

  .delete-btn {
    width: 28px; height: 28px; border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; color: var(--text-dim);
    transition: all 0.1s; border: none; cursor: pointer;
  }
  .delete-btn:hover { background: var(--danger); color: white; }

  .sound-preview { padding: 0 12px 12px; }
  .sound-preview audio { width: 100%; height: 32px; filter: invert(1) hue-rotate(180deg); opacity: 0.6; }

  .empty-state {
    grid-column: 1 / -1; padding: 60px 24px; text-align: center;
    color: var(--text-dim); display: flex; flex-direction: column;
    align-items: center; gap: 16px;
  }
  .empty-icon { opacity: 0.2; }

  .emoji-picker-popover { position: fixed; z-index: 2000; }
  .emoji-picker-popover :global(.emoji-popover) { position: static; margin-bottom: 0; }
</style>
