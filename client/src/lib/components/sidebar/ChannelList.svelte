<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
  import {
    textChannels,
    voiceChannels,
    activeChannelId,
    unreadChannels,
    unreadCounts,
    mentionCounts,
    markChannelRead,
    clearMentions,
    renameChannel,
    reorderChannels,
    moveChannelToGroup,
    groupedChannels,
    channelGroups,
    createChannelGroup,
    renameChannelGroup,
    deleteChannelGroup,
    reorderChannelGroups,
  } from '$lib/stores/channels';
  import { SvelteSet } from 'svelte/reactivity';
  import { toast, confirm } from '$lib/stores/toast';
  import { inVoiceChannel, voiceChannelMembers, speakingUsers } from '$lib/stores/media';
  import { usersMap } from '$lib/stores/users';
  import { resolveAsset } from '$lib/stores/server';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { activeScreenShares } from '$lib/stores/screenShare';
  import { joinVoice, leaveVoice } from '$lib/webrtc';
  import { nameStyle } from '$lib/nameColor';
  import Icon from '../Icon.svelte';

  let {
    onpeercontextmenu,
    onchannelcontextmenu,
    ongroupcontextmenu,
    onviewscreen,
    showNewGroupInput = $bindable(false),
    newGroupName = $bindable(''),
  }: {
    onpeercontextmenu: (
      e: MouseEvent,
      member: { userId: string; username: string; display_name?: string },
    ) => void;
    onchannelcontextmenu: (e: MouseEvent, channelId: string, channelName: string) => void;
    ongroupcontextmenu: (e: MouseEvent, groupId: string, groupName: string) => void;
    onviewscreen?: (userId: string) => void;
    showNewGroupInput?: boolean;
    newGroupName?: string;
  } = $props();

  const canManageChannels = hasPermissionStore('manage_channels');
  const canManageGroups = hasPermissionStore('manage_channel_groups');

  let editingChannelId: string | null = $state(null);
  let editingChannelName = $state('');
  let draggingChannelId: string | null = $state(null);
  let dragOverChannelId: string | null = $state(null);
  let dragOverGroupId: string | null | undefined = $state(undefined);
  let draggingGroupId: string | null = $state(null);

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

  async function handleCreateGroup() {
    if (!newGroupName.trim()) {
      showNewGroupInput = false;
      return;
    }
    try {
      await createChannelGroup(newGroupName.trim());
      newGroupName = '';
      showNewGroupInput = false;
    } catch (err: any) {
      toast.error('Failed to create group: ' + err.message);
    }
  }

  function toggleGroupCollapse(groupId: string) {
    if (collapsedGroups.has(groupId)) {
      collapsedGroups.delete(groupId);
    } else {
      collapsedGroups.add(groupId);
    }
  }

  // Drag and drop for reordering channels
  function handleDragStart(e: DragEvent, channelId: string) {
    if (!$canManageChannels) return;
    draggingChannelId = channelId;
    if (e.dataTransfer) {
      e.dataTransfer.setData('channelId', channelId);
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function handleDragOver(e: DragEvent, channelId: string) {
    if (!$canManageChannels || !draggingChannelId || draggingChannelId === channelId) return;
    e.preventDefault();
    dragOverChannelId = channelId;
  }

  function handleDragLeave() {
    dragOverChannelId = null;
  }

  async function handleDrop(e: DragEvent, targetId: string, siblings: any[]) {
    if (!$canManageChannels || !draggingChannelId || draggingChannelId === targetId) return;
    e.preventDefault();
    dragOverChannelId = null;

    const sourceId = draggingChannelId;
    draggingChannelId = null;

    const targetIdx = siblings.findIndex((c) => c.id === targetId);
    const sourceIdx = siblings.findIndex((c) => c.id === sourceId);

    if (targetIdx === -1) return;

    // Determine new position: if we're moving it "up", we insert at targetIdx
    // If moving "down", we insert at targetIdx
    let newPosition = siblings[targetIdx].position;

    try {
      await reorderChannels(sourceId, newPosition);
    } catch (err: any) {
      toast.error('Failed to reorder: ' + err.message);
    }
  }

  function handleDragEnd() {
    draggingChannelId = null;
    dragOverChannelId = null;
  }

  // Drag and drop for groups
  function handleGroupDragStart(e: DragEvent, groupId: string) {
    if (!$canManageGroups) return;
    draggingGroupId = groupId;
    if (e.dataTransfer) {
      e.dataTransfer.setData('groupId', groupId);
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function handleGroupDragOver(e: DragEvent, groupId: string | null) {
    if (!$canManageGroups) return;
    e.preventDefault();
    dragOverGroupId = groupId;
  }

  function handleGroupDragLeave() {
    dragOverGroupId = undefined;
  }

  async function handleGroupDrop(e: DragEvent, groupId: string | null) {
    if (!$canManageChannels || draggingGroupId) return;
    e.preventDefault();
    const channelId = e.dataTransfer?.getData('channelId');
    dragOverGroupId = undefined;

    if (!channelId) return;

    try {
      await moveChannelToGroup(channelId, groupId);
    } catch (err: any) {
      toast.error('Failed to move channel: ' + err.message);
    }
  }

  async function handleGroupReorderDrop(e: DragEvent, targetGroupId: string) {
    if (!$canManageGroups || !draggingGroupId || draggingGroupId === targetGroupId) return;
    e.preventDefault();
    const sourceGroupId = draggingGroupId;
    draggingGroupId = null;
    dragOverGroupId = undefined;

    const targetGroup = $channelGroups.find((g) => g.id === targetGroupId);
    if (!targetGroup) return;

    try {
      await reorderChannelGroups(sourceGroupId, targetGroup.position);
    } catch (err: any) {
      toast.error('Failed to reorder groups: ' + err.message);
    }
  }

  function handleGroupDragEnd() {
    draggingGroupId = null;
    dragOverGroupId = undefined;
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
          class:group-dragging={draggingGroupId === group.id}
          class:group-drag-over={dragOverGroupId === group.id}
          draggable={$canManageGroups ? 'true' : undefined}
          ondragstart={(e) => handleGroupDragStart(e, group.id)}
          ondragover={(e) => handleGroupDragOver(e, group.id)}
          ondragleave={handleGroupDragLeave}
          ondrop={(e) => {
            if (draggingGroupId) handleGroupReorderDrop(e, group.id);
            else handleGroupDrop(e, group.id);
          }}
          ondragend={handleGroupDragEnd}
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

      {#if !group && $canManageChannels}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="ungrouped-drop-zone"
          class:group-drag-over={dragOverGroupId === null}
          ondragover={(e) => handleGroupDragOver(e, null)}
          ondragleave={handleGroupDragLeave}
          ondrop={(e) => handleGroupDrop(e, null)}
        ></div>
      {/if}

      {#if !group || !collapsedGroups.has(group.id)}
        {#each groupChannels as channel (channel.id)}
          {#if channel.type === 'text'}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="channel-row"
              class:drag-over={dragOverChannelId === channel.id}
              draggable={$canManageChannels ? 'true' : undefined}
              ondragstart={(e) => handleDragStart(e, channel.id)}
              ondragover={(e) => handleDragOver(e, channel.id)}
              ondragleave={handleDragLeave}
              ondrop={(e) =>
                handleDrop(
                  e,
                  channel.id,
                  groupChannels.filter((c) => c.type === 'text'),
                )}
              ondragend={handleDragEnd}
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
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="channel-row"
              class:drag-over={dragOverChannelId === channel.id}
              draggable={$canManageChannels ? 'true' : undefined}
              ondragstart={(e) => handleDragStart(e, channel.id)}
              ondragover={(e) => handleDragOver(e, channel.id)}
              ondragleave={handleDragLeave}
              ondrop={(e) =>
                handleDrop(
                  e,
                  channel.id,
                  groupChannels.filter((c) => c.type === 'voice'),
                )}
              ondragend={handleDragEnd}
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

  {#if showNewGroupInput}
    <form
      class="new-group-form"
      onsubmit={(e) => {
        e.preventDefault();
        handleCreateGroup();
      }}
    >
      <input
        type="text"
        class="rename-input"
        placeholder="New Group Name"
        bind:value={newGroupName}
        maxlength="32"
        onkeydown={(e) => {
          if (e.key === 'Escape') showNewGroupInput = false;
        }}
        onblur={handleCreateGroup}
      />
    </form>
  {/if}
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
  }

  .channel-section {
    padding-top: 16px;
  }

  .group-header {
    display: flex;
    align-items: center;
    padding: 4px 0;
    margin-bottom: 4px;
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

  .new-group-form {
    padding: 8px 0;
  }

  .group-dragging {
    opacity: 0.4;
    transform: scale(0.98);
  }

  .group-header[draggable='true'] {
    cursor: grab;
  }

  .group-header[draggable='true']:active {
    cursor: grabbing;
  }

  .group-drag-over {
    background: var(--accent-subtle);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .ungrouped-drop-zone {
    height: 4px;
    margin: 4px 0;
    border-radius: 2px;
    transition: all 0.2s var(--ease-out);
  }

  .ungrouped-drop-zone.group-drag-over {
    height: 36px;
    background: var(--accent-subtle);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .channel-row {
    display: flex;
    align-items: center;
    position: relative;
    margin: 2px 0;
  }

  .channel-row.drag-over {
    box-shadow: 0 -2px 0 var(--accent);
  }

  .channel-row[draggable='true'] {
    cursor: grab;
  }

  .channel-row[draggable='true']:active {
    cursor: grabbing;
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
