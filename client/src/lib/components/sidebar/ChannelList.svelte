<script lang="ts">
  import {
    activeChannelId,
    unreadChannels,
    unreadCounts,
    mentionCounts,
    markChannelRead,
    clearMentions,
    renameChannel,
    groupedChannels,
    channelGroups,
    renameChannelGroup,
  } from '$lib/stores/channels';
  import { SvelteSet } from 'svelte/reactivity';
  import { toast } from '$lib/stores/toast';
  import { inVoiceChannel, voiceChannelMembers, speakingUsers } from '$lib/stores/media';
  import { usersMap } from '$lib/stores/users';
  import { resolveAsset } from '$lib/stores/server';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { activeScreenShares } from '$lib/stores/screenShare';
  import { joinVoice } from '$lib/webrtc';
  import { nameStyle } from '$lib/nameColor';
  import Icon from '../Icon.svelte';

  let {
    onpeercontextmenu,
    onchannelcontextmenu,
    ongroupcontextmenu,
    onviewscreen,
  }: {
    onpeercontextmenu: (
      e: MouseEvent,
      member: { userId: string; username: string; display_name?: string },
    ) => void;
    onchannelcontextmenu: (e: MouseEvent, channelId: string, channelName: string) => void;
    ongroupcontextmenu: (e: MouseEvent, groupId: string, groupName: string) => void;
    onviewscreen?: (userId: string) => void;
  } = $props();

  const _canManageChannels = hasPermissionStore('manage_channels');
  const _canManageGroups = hasPermissionStore('manage_channel_groups');

  let editingChannelId: string | null = $state(null);
  let editingChannelName = $state('');

  // Channel groups state
  let collapsedGroups = new SvelteSet<string>();
  let editingGroupId: string | null = $state(null);
  let editingGroupName = $state('');

  let joining = $state(false);

  // Expose startRename and startGroupRename for context menu usage
  export function startRename(channelId: string) {
    const allCh = $groupedChannels.flatMap((g) => g.channels);
    const ch = allCh.find((c) => c.id === channelId);
    if (!ch) return;
    editingChannelId = channelId;
    editingChannelName = ch.name;
  }

  export function startGroupRename(groupId: string) {
    const g = $channelGroups.find((g) => g.id === groupId);
    if (!g) return;
    editingGroupId = groupId;
    editingGroupName = g.name;
  }

  async function submitRename() {
    if (!editingChannelId || !editingChannelName.trim()) {
      editingChannelId = null;
      return;
    }
    try {
      await renameChannel(editingChannelId, editingChannelName.trim());
    } catch (err: any) {
      toast.error('Failed to rename channel: ' + err.message);
    }
    editingChannelId = null;
  }

  function cancelRename() {
    editingChannelId = null;
  }

  async function submitGroupRename() {
    if (!editingGroupId || !editingGroupName.trim()) {
      editingGroupId = null;
      return;
    }
    try {
      await renameChannelGroup(editingGroupId, editingGroupName.trim());
    } catch (err: any) {
      toast.error('Failed to rename group: ' + err.message);
    }
    editingGroupId = null;
  }

  function cancelGroupRename() {
    editingGroupId = null;
  }

  function toggleGroupCollapse(groupId: string) {
    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
    } else {
      collapsedGroups.add(groupId);
    }
  }

  async function handleJoinVoice(channelId: string) {
    if ($inVoiceChannel === channelId) return;
    joining = true;
    try {
      await joinVoice(channelId);
      $inVoiceChannel = channelId;
    } catch (err: any) {
      toast.error('Failed to join voice: ' + err.message);
    } finally {
      joining = false;
    }
  }
</script>

<div class="channel-list">
  {#each $groupedChannels as { group, channels: groupChannels } (group?.id ?? 'ungrouped')}
    <div class="channel-section">
      {#if group}
        <div
          class="group-header"
          oncontextmenu={(e) => ongroupcontextmenu(e, group.id, group.name)}
        >
          {#if editingGroupId === group.id}
            <form
              class="rename-form group-rename-form"
              onsubmit={(e) => {
                e.preventDefault();
                submitGroupRename();
              }}
            >
              <input
                type="text"
                class="rename-input"
                bind:value={editingGroupName}
                maxlength="32"
                onkeydown={(e) => {
                  if (e.key === 'Escape') cancelGroupRename();
                }}
                onblur={submitGroupRename}
              />
            </form>
          {:else}
            <button class="group-toggle" onclick={() => toggleGroupCollapse(group.id)}>
              <Icon
                name="chevron-down"
                size={12}
                class="collapse-icon {collapsedGroups.has(group.id) ? 'collapsed' : ''}"
              />
              <span class="section-title">{group.name}</span>
            </button>
          {/if}
        </div>
      {/if}

      {#if !group || !collapsedGroups.has(group.id)}
        {#each groupChannels as channel (channel.id)}
          {#if channel.type === 'text'}
            <div
              class="channel-row"
              oncontextmenu={(e) => onchannelcontextmenu(e, channel.id, channel.name)}
            >
              {#if editingChannelId === channel.id}
                <form
                  class="rename-form"
                  onsubmit={(e) => {
                    e.preventDefault();
                    submitRename();
                  }}
                >
                  <input
                    type="text"
                    class="rename-input"
                    bind:value={editingChannelName}
                    maxlength="32"
                    onkeydown={(e) => {
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onblur={submitRename}
                  />
                </form>
              {:else}
                <button
                  class="channel-btn"
                  class:active={$activeChannelId === channel.id}
                  class:unread={$unreadChannels.has(channel.id)}
                  onclick={() => {
                    $activeChannelId = channel.id;
                    markChannelRead(channel.id);
                    clearMentions(channel.id);
                  }}
                >
                  {#if $mentionCounts.has(channel.id)}
                    <span class="mention-badge">@{$mentionCounts.get(channel.id)}</span>
                  {:else if $unreadCounts.has(channel.id)}
                    <span class="unread-badge">{$unreadCounts.get(channel.id)}</span>
                  {/if}
                  <span class="channel-icon">
                    <Icon name="hash" size={20} class="svg-icon" />
                  </span>
                  <span class="channel-name">{channel.name}</span>
                </button>
              {/if}
            </div>
          {:else if channel.type === 'voice'}
            <div
              class="channel-row"
              oncontextmenu={(e) => onchannelcontextmenu(e, channel.id, channel.name)}
            >
              {#if editingChannelId === channel.id}
                <form
                  class="rename-form"
                  onsubmit={(e) => {
                    e.preventDefault();
                    submitRename();
                  }}
                >
                  <input
                    type="text"
                    class="rename-input"
                    bind:value={editingChannelName}
                    maxlength="32"
                    onkeydown={(e) => {
                      if (e.key === 'Escape') cancelRename();
                    }}
                    onblur={submitRename}
                  />
                </form>
              {:else}
                <button
                  class="channel-btn voice"
                  class:active={$inVoiceChannel === channel.id}
                  onclick={() => handleJoinVoice(channel.id)}
                  disabled={joining}
                >
                  <span class="channel-icon">
                    <Icon name="volume" size={20} class="svg-icon" />
                  </span>
                  <span class="channel-name">{channel.name}</span>
                </button>
              {/if}
            </div>
            {#if $voiceChannelMembers.has(channel.id)}
              <div class="voice-peers">
                {#each $voiceChannelMembers.get(channel.id) ?? [] as member (member.userId)}
                  {@const userData = $usersMap.get(member.userId)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="voice-peer"
                    class:speaking={$speakingUsers.has(member.userId)}
                    oncontextmenu={(e) => onpeercontextmenu(e, member)}
                  >
                    <div class="voice-peer-info">
                      <span class="peer-avatar">
                        {#if member.avatar_url}
                          <img
                            src={resolveAsset(member.avatar_url)}
                            alt=""
                            class="peer-avatar-img"
                          />
                        {:else}
                          {(member.display_name || member.username).charAt(0).toUpperCase()}
                        {/if}
                      </span>
                      <span
                        class="peer-name"
                        style={nameStyle(userData?.name_color, userData?.role_color, userData?.name_font)}
                        >{member.display_name || member.username}</span
                      >
                    </div>
                    {#if $activeScreenShares.has(member.userId)}
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="screen-icon"
                        title="Viewing screen share"
                        onclick={() => onviewscreen?.(member.userId)}
                      >
                        <Icon name="monitor" size={14} class="svg-icon-sm" />
                      </span>
                    {/if}
                    <div class="status-icons">
                      {#if member.deafened}
                        <span class="muted-icon" title="Deafened">
                          <Icon name="headphones-off" size={16} strokeWidth={2} />
                        </span>
                      {/if}
                      {#if member.muted}
                        <span class="muted-icon" title="Muted">
                          <Icon name="mic-off" size={16} strokeWidth={2} />
                        </span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {/each}
      {/if}
    </div>
  {/each}
</div>

<style>
  :global(.svg-icon) {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    opacity: 0.5;
    transition: all 0.2s var(--ease-out);
  }

  :global(.svg-icon-sm) {
    width: 14px;
    height: 14px;
  }

  .screen-icon {
    cursor: pointer;
    color: var(--success);
    display: inline-flex;
    opacity: 0.9;
    filter: drop-shadow(0 0 4px rgba(52, 211, 153, 0.3));
  }

  .channel-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 0 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.05) transparent;
    position: relative;
  }

  .channel-section {
    padding-top: 16px;
  }

  .group-header {
    display: flex;
    align-items: center;
    padding: 4px 0;
    margin-bottom: 4px;
    position: relative;
  }

  .group-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    color: var(--text-dim);
    width: 100%;
    text-align: left;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-out);
    border: none;
    cursor: pointer;
  }

  .group-toggle:hover {
    color: white;
    background: rgba(255, 255, 255, 0.03);
  }

  .section-title {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: inherit;
    padding-left: 2px;
  }

  :global(.collapse-icon) {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    transition: transform 0.3s var(--ease-elastic);
    opacity: 0.6;
  }

  :global(.collapse-icon.collapsed) {
    transform: rotate(-90deg);
  }

  .group-rename-form {
    flex: 1;
    padding: 0;
  }

  .channel-row {
    display: flex;
    align-items: center;
    position: relative;
    margin: 2px 0;
    transition: all 0.2s var(--ease-out);
  }

  .rename-form {
    flex: 1;
    padding: 2px 0;
  }

  .rename-input {
    width: 100%;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.3);
    color: white;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    outline: none;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .channel-row .channel-btn {
    flex: 1;
    min-width: 0;
  }

  .channel-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    transition: all 0.2s var(--ease-out);
    text-align: left;
    position: relative;
    font-size: 0.95rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
  }

  .channel-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
    padding-left: 12px;
  }

  .channel-btn:hover :global(.svg-icon) {
    opacity: 0.9;
    transform: scale(1.1);
  }

  .channel-btn.active {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }

  .channel-btn.active :global(.svg-icon) {
    opacity: 1;
    transform: scale(1.1);
  }

  .channel-btn.unread:not(.active) .channel-name {
    color: white;
    font-weight: 700;
  }

  .channel-btn.unread:not(.active) :global(.svg-icon) {
    opacity: 0.9;
  }

  .channel-btn::after {
    display: none;
  }

  .channel-icon {
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .channel-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    letter-spacing: -0.01em;
  }

  .unread-badge, .mention-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    line-height: 1;
    margin-left: 6px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .unread-badge {
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(4px);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .mention-badge {
    background: var(--danger);
    color: white;
    box-shadow: 0 4px 10px rgba(248, 113, 113, 0.3);
  }

  .voice-peers {
    padding: 4px 0 8px 32px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .voice-peer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 10px;
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
    transition: all 0.2s var(--ease-out);
    cursor: pointer;
    justify-content: space-between;
  }

  .voice-peer:hover {
    background: rgba(255, 255, 255, 0.03);
    color: white;
    padding-left: 12px;
  }

  .voice-peer-info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .voice-peer.speaking .peer-avatar {
    box-shadow:
      0 0 0 2px var(--speaking),
      0 0 12px 2px rgba(52, 211, 153, 0.3);
    transform: scale(1.05);
  }

  .peer-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 800;
    transition: all 0.3s var(--ease-elastic);
    overflow: hidden;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .peer-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .peer-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
    transition: opacity 0.2s;
  }

  .voice-peer:hover .peer-name {
    opacity: 1;
  }

  .status-icons {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .muted-icon {
    display: inline-flex;
    color: var(--text-icon);
    opacity: 0.8;
    transition: all 0.2s;
  }

  .voice-peer:hover .muted-icon {
    opacity: 1;
    color: var(--danger);
  }
</style>
