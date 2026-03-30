<script lang="ts">
  import { currentUser } from '$lib/stores/auth';
  import { toast, confirm } from '$lib/stores/toast';
  import { hasPermissionStore } from '$lib/stores/permissions';
  import { channelGroups, deleteChannelGroup, renameChannelGroup } from '$lib/stores/channels';
  import { activeServerId } from '$lib/stores/servers';
  import VoiceContextMenu from './VoiceContextMenu.svelte';
  import ChannelContextMenu from './ChannelContextMenu.svelte';
  import ChannelPermissionsModal from './ChannelPermissionsModal.svelte';
  import GroupPermissionsModal from './GroupPermissionsModal.svelte';
  import GroupContextMenu from './GroupContextMenu.svelte';
  import SidebarHeader from './sidebar/SidebarHeader.svelte';
  import ChannelList from './sidebar/ChannelList.svelte';
  import VoiceControls from './sidebar/VoiceControls.svelte';
  import SidebarFooter from './sidebar/SidebarFooter.svelte';
  import InviteModal from './InviteModal.svelte';


  let switching = $state(false);
  $effect(() => {
    $activeServerId; // track
    switching = true;
    const t = setTimeout(() => (switching = false), 100);
    return () => clearTimeout(t);
  });

  let showInviteModal = $state(false);
  let contextMenuTarget: { userId: string; username: string; x: number; y: number } | null =
    $state(null);
  let channelContextTarget: {
    channelId: string;
    channelName: string;
    x: number;
    y: number;
  } | null = $state(null);
  let permissionsChannelId: string | null = $state(null);
  let permissionsGroupId: string | null = $state(null);
  let groupContextTarget: { groupId: string; groupName: string; x: number; y: number } | null =
    $state(null);

  const canManageChannels = hasPermissionStore('manage_channels');
  const canManageGroups = hasPermissionStore('manage_channel_groups');
  const isAdmin = hasPermissionStore('administrator');

  let channelListRef: ChannelList | undefined = $state();

  function handlePeerContextMenu(
    e: MouseEvent,
    member: { userId: string; username: string; display_name?: string },
  ) {
    if (member.userId === $currentUser?.id) return;
    e.preventDefault();
    contextMenuTarget = {
      userId: member.userId,
      username: member.display_name || member.username,
      x: e.clientX,
      y: e.clientY,
    };
  }

  function handleChannelContextMenu(e: MouseEvent, channelId: string, channelName: string) {
    e.preventDefault();
    channelContextTarget = { channelId, channelName, x: e.clientX, y: e.clientY };
  }

  function handleGroupContextMenu(e: MouseEvent, groupId: string, groupName: string) {
    if (!$canManageGroups) return;
    e.preventDefault();
    groupContextTarget = { groupId, groupName, x: e.clientX, y: e.clientY };
  }

  function startGroupRename(groupId: string) {
    channelListRef?.startGroupRename(groupId);
    groupContextTarget = null;
  }

  async function handleDeleteGroup(groupId: string) {
    groupContextTarget = null;
    if (
      !(await confirm('Delete this group? Channels inside will become ungrouped.', {
        title: 'Delete Group',
        confirmLabel: 'Delete',
        dangerAction: true,
      }))
    )
      return;
    try {
      await deleteChannelGroup(groupId);
    } catch (err: any) {
      toast.error('Failed to delete group: ' + err.message);
    }
  }

  let {
    onviewscreen,
    onopenwatchviewer,
    onopensettings,
    onserversettings,
  }: {
    onviewscreen?: (userId: string) => void;
    onopenwatchviewer?: () => void;
    onopensettings?: () => void;
    onserversettings?: () => void;
  } = $props();
</script>

<aside class="sidebar">
  <SidebarHeader
    onserversettings={() => onserversettings?.()}
    oninvite={() => (showInviteModal = true)}
  />

  <div class="channel-list-wrapper" class:switching>
    <ChannelList
      bind:this={channelListRef}
      onpeercontextmenu={handlePeerContextMenu}
      onchannelcontextmenu={handleChannelContextMenu}
      ongroupcontextmenu={handleGroupContextMenu}
      {onviewscreen}
    />
  </div>

  <div class="sidebar-bottom">
    <VoiceControls {onopenwatchviewer} />

    <SidebarFooter onsettings={() => onopensettings?.()} />
  </div>
</aside>

{#if showInviteModal}
  <InviteModal onclose={() => (showInviteModal = false)} />
{/if}

{#if channelContextTarget}
  <ChannelContextMenu
    channelId={channelContextTarget?.channelId}
    channelName={channelContextTarget?.channelName}
    anchorX={channelContextTarget?.x ?? 0}
    anchorY={channelContextTarget?.y ?? 0}
    onclose={() => (channelContextTarget = null)}
    onrename={(id) => channelListRef?.startRename(id)}
    onpermissions={(id) => {
      permissionsChannelId = id;
    }}
  />
{/if}

{#if permissionsChannelId}
  <ChannelPermissionsModal
    channelId={permissionsChannelId}
    onclose={() => (permissionsChannelId = null)}
  />
{/if}

{#if permissionsGroupId}
  <GroupPermissionsModal groupId={permissionsGroupId} onclose={() => (permissionsGroupId = null)} />
{/if}

{#if groupContextTarget}
  <GroupContextMenu
    groupId={groupContextTarget.groupId}
    groupName={groupContextTarget.groupName}
    anchorX={groupContextTarget.x}
    anchorY={groupContextTarget.y}
    onclose={() => (groupContextTarget = null)}
    onrename={(id) => channelListRef?.startGroupRename(id)}
    onpermissions={(id) => {
      permissionsGroupId = id;
    }}
  />
{/if}

{#if contextMenuTarget}
  <VoiceContextMenu
    userId={contextMenuTarget?.userId}
    username={contextMenuTarget?.username}
    anchorX={contextMenuTarget?.x ?? 0}
    anchorY={contextMenuTarget?.y ?? 0}
    onclose={() => (contextMenuTarget = null)}
    canDisconnect={$isAdmin}
  />
{/if}

<style>
  .sidebar {
    width: var(--sidebar-width);
    height: 100%;
    background: var(--glass-bg-heavy);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-right: 1px solid var(--glass-border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.1);
  }

  .channel-list-wrapper {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    transition: opacity 100ms var(--ease-out);
  }

  .channel-list-wrapper.switching {
    opacity: 0;
  }

  .sidebar-bottom {
    flex-shrink: 0;
    position: relative;
  }
</style>
