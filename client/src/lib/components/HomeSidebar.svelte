<script lang="ts">
  import { friends, pendingRequests, blockedUsers, loadBlockedUsers, loadPendingRequests, sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend, unblockUser } from '$lib/stores/friends';
  import { pendingInvitations, acceptInvitation, declineInvitation, loadInvitations } from '$lib/stores/invitations';
  import { dmChannels, activeChannelId, openOrCreateDm } from '$lib/stores/channels';
  import { isDmView, servers, switchServer } from '$lib/stores/servers';
  import { onlineUsers } from '$lib/stores/presence';
  import { currentUser } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';

  import { resolveAsset } from '$lib/stores/server';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import SidebarFooter from './sidebar/SidebarFooter.svelte';
  import type { FriendInfo, FriendRequest, Channel, ServerInvitation } from '@voip-server/shared';

  let { onopensettings }: { onopensettings?: () => void } = $props();

  // View: 'dms' shows DM list (default), 'friends' shows friends management, 'invites' shows server invites
  let view: 'dms' | 'friends' | 'invites' = $state('dms');
  let friendTab: 'all' | 'online' | 'pending' | 'blocked' = $state('online');
  let friendSearch = $state('');
  let addFriendError = $state('');
  let addFriendMode = $state(false);
  let searchActive = $state(false);
  let searchQuery = $state('');
  let searchInputEl: HTMLInputElement | undefined = $state();

  let inviteProcessing = $state<string | null>(null);

  let incomingRequests = $derived($pendingRequests.filter(r => r.direction === 'incoming'));
  let outgoingRequests = $derived($pendingRequests.filter(r => r.direction === 'outgoing'));
  let onlineFriends = $derived($friends.filter(f => f.online));
  let sortedDmChannels = $derived([...$dmChannels].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ));
  let pendingCount = $derived(incomingRequests.length);
  let totalPendingCount = $derived(pendingCount + $pendingInvitations.length);

  $effect(() => {
    if (friendTab === 'blocked') {
      loadBlockedUsers();
    }
  });

  $effect(() => {
    if (view === 'invites') {
      loadInvitations();
    }
  });

  async function handleAddFriend(e: Event) {
    e.preventDefault();
    addFriendError = '';
    const username = friendSearch.trim();
    if (!username) return;
    try {
      const targetUser = await api.get<{ id: string; username: string; display_name: string; avatar_url: string | null }>(`/api/users/lookup?username=${encodeURIComponent(username)}`);
      if (targetUser.id === $currentUser?.id) {
        addFriendError = "You can't add yourself";
        return;
      }
      await sendFriendRequest(targetUser.id);
      await loadPendingRequests();
      friendSearch = '';
      addFriendMode = false;
      toast.success('Friend request sent to ' + targetUser.display_name);
    } catch (err: any) {
      addFriendError = err.message || 'User not found';
    }
  }

  async function handleDm(friend: FriendInfo) {
    await openOrCreateDm(friend.id);
    view = 'dms';
  }

  async function handleRemove(friend: FriendInfo) {
    try {
      if (friend.friendship_id) {
        await removeFriend(friend.friendship_id);
      } else {
        await removeFriend(friend.id);
      }
    } catch (err: any) {
      toast.error('Failed to remove friend: ' + err.message);
    }
  }

  async function handleAccept(req: FriendRequest) {
    try {
      await acceptFriendRequest(req.id);
      toast.success('Friend request accepted');
    } catch (err: any) {
      toast.error('Failed to accept: ' + err.message);
    }
  }

  async function handleDecline(req: FriendRequest) {
    try {
      await declineFriendRequest(req.id);
    } catch (err: any) {
      toast.error('Failed to decline: ' + err.message);
    }
  }

  async function handleAcceptInvite(invite: ServerInvitation) {
    inviteProcessing = invite.id;
    try {
      const server = await acceptInvitation(invite.id);
      if (server) {
        servers.update((list) => [...list, server]);
        switchServer(server.id);
        toast.success(`Joined ${server.name}!`);
      }
    } catch (err: any) {
      toast.error('Failed to join: ' + err.message);
    } finally {
      inviteProcessing = null;
    }
  }

  async function handleDeclineInvite(invite: ServerInvitation) {
    inviteProcessing = invite.id;
    try {
      await declineInvitation(invite.id);
      toast.success('Invitation declined');
    } catch (err: any) {
      toast.error('Failed to decline: ' + err.message);
    } finally {
      inviteProcessing = null;
    }
  }

  async function handleUnblock(user: FriendInfo) {
    try {
      await unblockUser(user.id);
      toast.success('User unblocked');
    } catch (err: any) {
      toast.error('Failed to unblock: ' + err.message);
    }
  }

  function getDmParticipantName(channel: Channel): string {
    if (channel.dm_participants && channel.dm_participants.length > 0) {
      const other = channel.dm_participants.find(p => p.id !== $currentUser?.id);
      return other?.display_name || other?.username || 'Unknown';
    }
    return channel.name || 'Unknown';
  }

  function getDmParticipant(channel: Channel) {
    if (channel.dm_participants && channel.dm_participants.length > 0) {
      return channel.dm_participants.find(p => p.id !== $currentUser?.id) ?? null;
    }
    return null;
  }

  function isDmUserOnline(channel: Channel): boolean {
    const user = getDmParticipant(channel);
    return user ? $onlineUsers.has(user.id) : false;
  }

  // Search results: filter DMs and friends by query
  let searchResults = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { dms: sortedDmChannels, friends: [] as FriendInfo[] };
    const filteredDms = sortedDmChannels.filter(ch => {
      const name = getDmParticipantName(ch).toLowerCase();
      return name.includes(q);
    });
    const dmUserIds = new Set(filteredDms.map(ch => getDmParticipant(ch)?.id).filter(Boolean));
    const filteredFriends = $friends.filter(f =>
      !dmUserIds.has(f.id) &&
      (f.display_name.toLowerCase().includes(q) || f.username.toLowerCase().includes(q))
    );
    return { dms: filteredDms, friends: filteredFriends };
  });

  function openSearch() {
    searchActive = true;
    searchQuery = '';
    requestAnimationFrame(() => searchInputEl?.focus());
  }

  function closeSearch() {
    searchActive = false;
    searchQuery = '';
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeSearch();
  }

  async function handleSearchFriendClick(friend: FriendInfo) {
    await openOrCreateDm(friend.id);
    closeSearch();
  }

  function handleSearchDmClick(channelId: string) {
    activeChannelId.set(channelId);
    isDmView.set(true);
    closeSearch();
  }

  function formatStatus(userId: string | undefined): string {
    if (!userId) return '';
    const user = $onlineUsers.get(userId);
    if (!user) return 'Offline';
    switch (user.status) {
      case 'online': return 'Online';
      case 'idle': return 'Away';
      case 'dnd': return 'Do Not Disturb';
      case 'invisible': return 'Offline';
      default: return 'Online';
    }
  }
</script>

<aside class="sidebar">
  <!-- Search bar -->
  <div class="search-bar">
    {#if searchActive}
      <div class="search-input-wrap">
        <Icon name="search" size={14} class="search-icon" />
        <input
          bind:this={searchInputEl}
          class="search-input"
          type="text"
          placeholder="Find or start a conversation"
          bind:value={searchQuery}
          onkeydown={handleSearchKeydown}
          onblur={() => { if (!searchQuery) closeSearch(); }}
        />
        {#if searchQuery}
          <button class="search-clear" onclick={() => { searchQuery = ''; searchInputEl?.focus(); }}>
            <Icon name="x" size={12} />
          </button>
        {/if}
      </div>
    {:else}
      <button class="search-btn" onclick={openSearch}>
        <Icon name="search" size={14} />
        <span>Find or start a conversation</span>
      </button>
    {/if}
  </div>

  {#if searchActive && searchQuery.trim()}
    <!-- Search results -->
    <div class="search-results scrollable">
      {#if searchResults.dms.length === 0 && searchResults.friends.length === 0}
        <div class="empty-state">No results found</div>
      {:else}
        {#if searchResults.dms.length > 0}
          <div class="section-label">Conversations</div>
          {#each searchResults.dms as channel (channel.id)}
            {@const dmUser = getDmParticipant(channel)}
            {@const isOnline = isDmUserOnline(channel)}
            <button class="item-row" onclick={() => handleSearchDmClick(channel.id)}>
              <div class="avatar-wrap">
                <Avatar src={dmUser?.avatar_url} alt={getDmParticipantName(channel)} size={32} userId={dmUser?.id} showStatus />
              </div>
              <div class="item-info">
                <span class="item-name">{getDmParticipantName(channel)}</span>
                {#if dmUser?.id && $onlineUsers.get(dmUser.id)?.activity}
                  <span class="activity-text">Playing {$onlineUsers.get(dmUser.id)?.activity}</span>
                {:else if isOnline}
                  <span class="status-text">{formatStatus(dmUser?.id)}</span>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
        {#if searchResults.friends.length > 0}
          <div class="section-label">Friends</div>
          {#each searchResults.friends as friend (friend.id)}
            <button class="item-row" onclick={() => handleSearchFriendClick(friend)}>
              <div class="avatar-wrap">
                <Avatar src={friend.avatar_url} alt={friend.display_name} size={32} userId={friend.id} showStatus />
              </div>
              <div class="item-info">
                <span class="item-name">{friend.display_name}</span>
                {#if $onlineUsers.get(friend.id)?.activity}
                  <span class="activity-text">Playing {$onlineUsers.get(friend.id)?.activity}</span>
                {:else}
                  <span class="status-text">{formatStatus(friend.id)}</span>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  {:else}
    <!-- Navigation buttons -->
    <div class="nav-section">
      <button
        class="nav-btn"
        class:active={view === 'friends'}
        onclick={() => { view = 'friends'; activeChannelId.set(''); }}
      >
        <Icon name="users" size={20} />
        <span>Friends</span>
        {#if pendingCount > 0}
          <span class="badge">{pendingCount}</span>
        {/if}
      </button>

      <button
        class="nav-btn"
        class:active={view === 'invites'}
        onclick={() => { view = 'invites'; activeChannelId.set(''); }}
      >
        <Icon name="plus" size={20} />
        <span>Invites</span>
        {#if $pendingInvitations.length > 0}
          <span class="badge">{$pendingInvitations.length}</span>
        {/if}
      </button>
    </div>

    <div class="divider-line"></div>

    <div class="scrollable">
      {#if view === 'dms'}
        <!-- Direct Messages -->
        <div class="section-header">
          <span class="section-label">Direct Messages</span>
          <button class="icon-action-btn" title="New DM" onclick={() => { view = 'friends'; addFriendMode = false; }}>
            <Icon name="plus" size={16} />
          </button>
        </div>

        <div class="dm-list">
          {#if sortedDmChannels.length === 0}
            <div class="empty-state">No conversations yet</div>
          {:else}
            {#each sortedDmChannels as channel (channel.id)}
              {@const dmUser = getDmParticipant(channel)}
              {@const isOnline = isDmUserOnline(channel)}
              <button
                class="item-row"
                class:active={$activeChannelId === channel.id}
                onclick={() => { activeChannelId.set(channel.id); isDmView.set(true); }}
              >
                <div class="avatar-wrap">
                  <Avatar src={dmUser?.avatar_url} alt={dmUser?.display_name || dmUser?.username || channel.name || '?'} size={32} userId={dmUser?.id} showStatus />
                </div>
                <div class="item-info">
                  <span class="item-name">{getDmParticipantName(channel)}</span>
                  {#if isOnline}
                    <span class="status-text">{formatStatus(dmUser?.id)}</span>
                  {/if}
                </div>
              </button>
            {/each}
          {/if}
        </div>
      {:else if view === 'invites'}
        <div class="friends-view-header">
          <button class="back-icon-btn" onclick={() => { view = 'dms'; addFriendMode = false; }}>
            <Icon name="chevron-down" size={16} class="back-icon" />
          </button>
          <span class="view-title">Server Invites</span>
        </div>

        <div class="friend-list">
          {#if $pendingInvitations.length === 0}
            <div class="empty-state">No pending invitations</div>
          {:else}
            <div class="group-label">Pending Invitations — {$pendingInvitations.length}</div>
            {#each $pendingInvitations as invite (invite.id)}
              <div class="item-row friend-row">
                <div class="avatar-wrap">
                  <div class="server-invite-icon">
                    {#if invite.server_icon_url}
                      <img src={resolveAsset(invite.server_icon_url)} alt="" />
                    {:else}
                      <span>{invite.server_name.charAt(0).toUpperCase()}</span>
                    {/if}
                  </div>
                </div>
                <div class="item-info">
                  <span class="item-name">{invite.server_name}</span>
                  <span class="status-text">Invited by {invite.inviter_name}</span>
                </div>
                <div class="action-buttons force-show">
                  <button 
                    class="circle-btn success" 
                    title="Join" 
                    onclick={() => handleAcceptInvite(invite)}
                    disabled={inviteProcessing === invite.id}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                  <button 
                    class="circle-btn danger" 
                    title="Decline" 
                    onclick={() => handleDeclineInvite(invite)}
                    disabled={inviteProcessing === invite.id}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {:else}
        <!-- Friends view -->
        <div class="friends-view-header">
          <button class="back-icon-btn" onclick={() => { view = 'dms'; addFriendMode = false; }}>
            <Icon name="chevron-down" size={16} class="back-icon" />
          </button>
          <span class="view-title">Friends</span>
          <button class="add-friend-chip" class:active={addFriendMode} onclick={() => addFriendMode = !addFriendMode}>
            Add Friend
          </button>
        </div>

        {#if addFriendMode}
          <div class="add-friend-panel">
            <form onsubmit={handleAddFriend} class="add-friend-form">
              <input type="text" bind:value={friendSearch} placeholder="Enter a username" class="fancy-input" />
              <button type="submit" disabled={!friendSearch.trim()} class="fancy-btn">Send</button>
            </form>
            {#if addFriendError}
              <p class="error-msg">{addFriendError}</p>
            {/if}
          </div>
        {/if}

        <div class="tab-switcher">
          <button class:active={friendTab === 'online'} onclick={() => friendTab = 'online'}>Online</button>
          <button class:active={friendTab === 'all'} onclick={() => friendTab = 'all'}>All</button>
          <button class:active={friendTab === 'pending'} onclick={() => friendTab = 'pending'}>
            Pending{#if pendingCount} <span class="badge-inline">{pendingCount}</span>{/if}
          </button>
          <button class:active={friendTab === 'blocked'} onclick={() => friendTab = 'blocked'}>Blocked</button>
        </div>

        <div class="friend-list">
          {#if friendTab === 'online'}
            {#if onlineFriends.length === 0}
              <div class="empty-state">No friends online</div>
            {:else}
              <div class="group-label">Online — {onlineFriends.length}</div>
              {#each onlineFriends as friend (friend.id)}
                <div class="item-row friend-row">
                  <div class="avatar-wrap">
                    <Avatar src={friend.avatar_url} alt={friend.display_name} size={32} userId={friend.id} showStatus />
                  </div>
                  <div class="item-info">
                    <span class="item-name">{friend.display_name}</span>
                    {#if $onlineUsers.get(friend.id)?.activity}
                      <span class="activity-text">Playing {$onlineUsers.get(friend.id)?.activity}</span>
                    {:else}
                      <span class="status-text">{friend.status || 'Online'}</span>
                    {/if}
                  </div>
                  <div class="action-buttons">
                    <button class="circle-btn" title="Message" onclick={() => handleDm(friend)}>
                      <Icon name="message-square" size={16} />
                    </button>
                    <button class="circle-btn danger" title="Remove" onclick={() => handleRemove(friend)}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          {:else if friendTab === 'all'}
            {#if $friends.length === 0}
              <div class="empty-state">No friends yet</div>
            {:else}
              <div class="group-label">All Friends — {$friends.length}</div>
              {#each $friends as friend (friend.id)}
                <div class="item-row friend-row">
                  <div class="avatar-wrap">
                    <Avatar src={friend.avatar_url} alt={friend.display_name} size={32} userId={friend.id} showStatus />
                  </div>
                  <div class="item-info">
                    <span class="item-name">{friend.display_name}</span>
                    <span class="status-text">{friend.online ? (friend.status || 'Online') : 'Offline'}</span>
                  </div>
                  <div class="action-buttons">
                    <button class="circle-btn" title="Message" onclick={() => handleDm(friend)}>
                      <Icon name="message-square" size={16} />
                    </button>
                    <button class="circle-btn danger" title="Remove" onclick={() => handleRemove(friend)}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          {:else if friendTab === 'pending'}
            {#if $pendingRequests.length === 0}
              <div class="empty-state">No pending requests</div>
            {:else}
              {#if incomingRequests.length > 0}
                <div class="group-label">Incoming — {incomingRequests.length}</div>
              {/if}
              {#each incomingRequests as req (req.id)}
                <div class="item-row friend-row">
                  <div class="avatar-wrap">
                    <Avatar src={req.user.avatar_url} alt={req.user.display_name} size={32} />
                  </div>
                  <div class="item-info">
                    <span class="item-name">{req.user.display_name}</span>
                    <span class="status-text">Incoming request</span>
                  </div>
                  <div class="action-buttons force-show">
                    <button class="circle-btn success" title="Accept" onclick={() => handleAccept(req)}>
                      <Icon name="plus" size={16} />
                    </button>
                    <button class="circle-btn danger" title="Decline" onclick={() => handleDecline(req)}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              {/each}
              {#if outgoingRequests.length > 0}
                <div class="group-label">Outgoing — {outgoingRequests.length}</div>
              {/if}
              {#each outgoingRequests as req (req.id)}
                <div class="item-row friend-row">
                  <div class="avatar-wrap">
                    <Avatar src={req.user.avatar_url} alt={req.user.display_name} size={32} />
                  </div>
                  <div class="item-info">
                    <span class="item-name">{req.user.display_name}</span>
                    <span class="status-text">Outgoing request</span>
                  </div>
                  <div class="action-buttons force-show">
                    <button class="circle-btn danger" title="Cancel" onclick={() => handleDecline(req)}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>
              {/each}
            {/if}
          {:else}
            {#if $blockedUsers.length === 0}
              <div class="empty-state">No blocked users</div>
            {:else}
              <div class="group-label">Blocked — {$blockedUsers.length}</div>
              {#each $blockedUsers as user (user.id)}
                <div class="item-row friend-row">
                  <div class="avatar-wrap">
                    <Avatar src={user.avatar_url} alt={user.display_name} size={32} />
                  </div>
                  <div class="item-info">
                    <span class="item-name">{user.display_name}</span>
                  </div>
                  <div class="action-buttons force-show">
                    <button class="text-action-btn" onclick={() => handleUnblock(user)}>Unblock</button>
                  </div>
                </div>
              {/each}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Footer (Pinned to bottom) -->
  <SidebarFooter onsettings={() => onopensettings?.()} />
</aside>

<style>
  .sidebar {
    width: var(--sidebar-width);
    height: 100%;
    background: rgba(8, 8, 15, 0.4);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    z-index: 10;
  }

  /* Search bar */
  .search-bar {
    padding: 16px 12px 12px;
    flex-shrink: 0;
  }

  .search-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s var(--ease-out);
  }

  .search-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.1);
    color: var(--text-muted);
  }

  .search-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    box-shadow: 0 0 12px var(--accent-glow);
    animation: searchFocus 0.2s var(--ease-out);
  }

  @keyframes searchFocus {
    from { transform: scale(0.98); opacity: 0.5; }
    to { transform: scale(1); opacity: 1; }
  }

  .search-input {
    flex: 1;
    padding: 8px 0;
    background: transparent;
    border: none;
    color: white;
    font-size: 0.85rem;
    outline: none;
    font-weight: 500;
  }

  .search-input::placeholder {
    color: var(--text-dim);
    opacity: 0.5;
  }

  /* Navigation */
  .nav-section {
    padding: 4px 10px;
    flex-shrink: 0;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    font-weight: 700;
    transition: all 0.2s var(--ease-out);
    border: none;
    cursor: pointer;
    margin-bottom: 2px;
  }

  .nav-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
  }

  .nav-btn.active {
    background: var(--accent);
    color: white;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .badge {
    margin-left: auto;
    background: var(--danger);
    color: white;
    font-size: 0.7rem;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 20px;
    text-align: center;
    box-shadow: 0 4px 10px rgba(248, 113, 113, 0.3);
  }

  .divider-line {
    height: 1px;
    background: var(--glass-border);
    margin: 12px 16px;
    opacity: 0.5;
  }

  /* DM & Lists */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px 18px;
    flex-shrink: 0;
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .icon-action-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .icon-action-btn:hover {
    color: white;
    background: rgba(255, 255, 255, 0.05);
    transform: rotate(90deg);
  }

  .scrollable {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 0 10px 16px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.05) transparent;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
    font-weight: 600;
    transition: all 0.2s var(--ease-out);
    text-align: left;
    border: none;
    cursor: pointer;
    position: relative;
    margin-bottom: 2px;
  }

  .item-row:hover {
    background: rgba(255, 255, 255, 0.05);
    color: white;
  }

  .item-row.active {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }

  .item-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 15%;
    bottom: 15%;
    width: 3px;
    background: var(--accent);
    border-radius: 0 4px 4px 0;
    box-shadow: 0 0 8px var(--accent-glow);
  }

  .avatar-wrap {
    position: relative;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .status-text {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-weight: 600;
    opacity: 0.8;
  }

  .activity-text {
    font-size: 0.7rem;
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.9;
  }

  /* Friends view specific */
  .friends-view-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px 12px;
    flex-shrink: 0;
  }

  .back-icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .back-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .back-icon {
    transform: rotate(90deg);
  }

  .view-title {
    font-size: 1.15rem;
    font-weight: 800;
    color: white;
    flex: 1;
    letter-spacing: -0.02em;
  }

  .add-friend-chip {
    padding: 6px 14px;
    background: var(--success);
    color: white;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 800;
    transition: all 0.3s var(--ease-elastic);
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(52, 211, 153, 0.2);
  }

  .add-friend-chip:hover {
    filter: brightness(1.1);
    transform: scale(1.05) translateY(-1px);
    box-shadow: 0 6px 16px rgba(52, 211, 153, 0.3);
  }

  .add-friend-chip.active {
    background: rgba(255, 255, 255, 0.05);
    color: white;
    box-shadow: none;
    border: 1px solid var(--glass-border);
  }

  .tab-switcher {
    display: flex;
    padding: 0 12px;
    gap: 4px;
    flex-shrink: 0;
    margin-bottom: 12px;
  }

  .tab-switcher button {
    flex: 1;
    padding: 8px 4px;
    background: transparent;
    color: var(--text-dim);
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-radius: var(--radius-sm);
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .tab-switcher button:hover {
    color: white;
    background: rgba(255, 255, 255, 0.03);
  }

  .tab-switcher button.active {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
  }

  .badge-inline {
    background: var(--danger);
    color: white;
    padding: 1px 5px;
    border-radius: 8px;
    font-size: 0.6rem;
    margin-left: 4px;
    font-weight: 800;
  }

  .group-label {
    padding: 20px 14px 8px;
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    opacity: 0.8;
  }

  .friend-row {
    cursor: default;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    opacity: 0;
    transition: all 0.2s var(--ease-out);
    transform: translateX(10px);
  }

  .friend-row:hover .action-buttons, .action-buttons.force-show {
    opacity: 1;
    transform: translateX(0);
  }

  .circle-btn {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-muted);
    border-radius: 50%;
    transition: all 0.3s var(--ease-elastic);
    border: 1px solid var(--glass-border);
    cursor: pointer;
  }

  .circle-btn:hover {
    background: var(--accent);
    color: white;
    transform: scale(1.1) translateY(-2px);
    border-color: transparent;
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .circle-btn.success:hover {
    background: var(--success);
    box-shadow: 0 4px 12px rgba(52, 211, 153, 0.3);
  }

  .circle-btn.danger:hover {
    background: var(--danger);
    box-shadow: 0 4px 12px rgba(248, 113, 113, 0.3);
  }

  .server-invite-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9rem;
    font-weight: 800;
    color: white;
    overflow: hidden;
    border: 1px solid var(--glass-border);
  }

  .server-invite-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .text-action-btn {
    background: rgba(255, 255, 255, 0.05);
    color: white;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 800;
    border: 1px solid var(--glass-border);
    cursor: pointer;
    transition: all 0.2s;
  }

  .text-action-btn:hover {
    background: var(--accent);
    border-color: transparent;
    transform: translateY(-1px);
  }

  .empty-state {
    padding: 60px 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.95rem;
    font-weight: 600;
    opacity: 0.6;
  }

  /* Add Friend Panel */
  .add-friend-panel {
    padding: 0 12px 16px;
    animation: panelIn 0.3s var(--ease-out);
  }

  @keyframes panelIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .add-friend-form {
    display: flex;
    gap: 8px;
    background: rgba(0, 0, 0, 0.3);
    padding: 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .fancy-input {
    flex: 1;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: white;
    font-size: 0.9rem;
    outline: none;
    font-weight: 600;
  }

  .fancy-btn {
    background: var(--accent);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-weight: 800;
    font-size: 0.8rem;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .fancy-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .error-msg {
    color: var(--danger);
    font-size: 0.75rem;
    margin-top: 8px;
    font-weight: 700;
    padding-left: 8px;
  }
</style>
