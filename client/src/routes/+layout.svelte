<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { checkAuth, currentUser, authLoading, logout } from '$lib/stores/auth';
  import { connectWs, disconnectWs, onWsEvent, sendWs, wsConnected, wsKicked } from '$lib/ws';
  import {
    loadChannels,
    channels,
    activeChannelId,
    activeChannel,
    textChannels,
    voiceChannels,
    markChannelUnread,
    updateChannel,
    registerChannelServer,
    channelServerMap,
    dmChannels,
    loadDmChannels,
    channelGroups,
    loadChannelGroups,
    unreadCounts,
    incrementMention,
  } from '$lib/stores/channels';
  import { addMessage, editMessage, removeMessage, pinMessage, unpinMessage } from '$lib/stores/messages';
  import { setOnlineUsers, setUserOnline, setUserOffline, updateUserActivity, myStatus } from '$lib/stores/presence';
  import { startIdleDetection, stopIdleDetection } from '$lib/idleDetector';
  import {
    setVoicePeers,
    addVoicePeer,
    removeVoicePeer,
    setSpeaking,
    setSoundboardSpeaking,
    inVoiceChannel,
    setAllChannelMembers,
    addChannelMember,
    removeChannelMember,
    updateChannelMemberMute,
    updateChannelMemberDeafen,
    updateChannelMemberProfile,
  } from '$lib/stores/media';
  import { isDesktop, serverUrl, resolveAsset, sessionExpired, resetSessionExpired, loadServerUrlFromStore } from '$lib/stores/server';
  import { serverSettings, loadServerSettings } from '$lib/stores/serverSettings';
  import { servers, activeServerId, activeServer, loadServers, isDmView, switchServer, serverNotificationLevels } from '$lib/stores/servers';
  import {
    loadRoles,
    roles,
    channelOverrides,
    loadChannelOverrides,
    groupOverrides,
    loadGroupOverrides,
  } from '$lib/stores/permissions';
  import { get } from 'svelte/store';
  import { fetchUsers, refreshUsers, resetUsersStore, allUsers } from '$lib/stores/users';
  import { addScreenShare, removeScreenShare, activeScreenShares } from '$lib/stores/screenShare';
  import {
    setVideoProducerOwner,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
  } from '$lib/webrtc';
  import {
    playJoinSound,
    playLeaveSound,
    playMessageSound,
    playRingSound,
    playCallAcceptSound,
  } from '$lib/sounds';
  import { activeCall } from '$lib/stores/call';
  import { soundboardVolume } from '$lib/stores/settings';
  import { initNotifications, notifyMessage, notifyCall, notifyMention } from '$lib/notifications';
  import { checkForUpdates } from '$lib/updater';
  import { isDeafenedStore } from '$lib/stores/media';
  import NavDock from '$lib/components/NavDock.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import HomeSidebar from '$lib/components/HomeSidebar.svelte';
  import CallOverlay from '$lib/components/CallOverlay.svelte';
  import UserList from '$lib/components/UserList.svelte';
  import ServerConnect from '$lib/components/ServerConnect.svelte';
  import ScreenShareViewer from '$lib/components/ScreenShareViewer.svelte';
  import {
    watchSession,
    watchSyncEvent,
    watchQueue,
    watchViewers,
  } from '$lib/stores/watchTogether';
  import { toast } from '$lib/stores/toast';
  import Toast from '$lib/components/Toast.svelte';
  import StoreUpdateModal from '$lib/components/StoreUpdateModal.svelte';
  import InvitationNotification from '$lib/components/InvitationNotification.svelte';
  import { loadInvitations, addInvitation } from '$lib/stores/invitations';
  import { loadFriends, loadPendingRequests, addFriendFromWs, removeFriendFromWs, addPendingFromWs, removePendingByUser } from '$lib/stores/friends';
  import QuickSwitcher from '$lib/components/QuickSwitcher.svelte';
  import AppPanels from '$lib/components/AppPanels.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import ServerSettings from '$lib/components/ServerSettings.svelte';

  let { children } = $props();

  let needsServer = $derived(isDesktop && !$serverUrl);
  let initialized = $state(false);
  let hasConnectedOnce = false;
  let viewingScreenUserId = $state<string | null>(null);
  let showMobileSidebar = $state(false);
  let showMobileUserList = $state(false);
  let showQuickSwitcher = $state(false);
  let showSettingsModal = $state(false);
  let showServerSettings = $state(false);

  // Track active soundboard playbacks by playbackId
  const activeSoundboardAudio = new SvelteMap<string, { audio: HTMLAudioElement; userId: string }>();

  // Update active soundboard audio volume when deafen state or soundboard volume changes
  $effect(() => {
    const vol = $isDeafenedStore ? 0 : $soundboardVolume / 100;
    for (const item of activeSoundboardAudio.values()) {
      item.audio.volume = vol;
    }
  });

  // Close mobile drawers when channel changes + persist last channel per server
  $effect(() => {
    const chId = $activeChannelId;
    const sId = $activeServerId;
    showMobileSidebar = false;
    showMobileUserList = false;
    if (chId && sId) {
      localStorage.setItem('lastChannelId_' + sId, chId);
    }
  });

  // Reactive tab title with unread count
  $effect(() => {
    const total = Array.from($unreadCounts.values()).reduce((a, b) => a + b, 0);
    const name = $serverSettings?.name || 'SellServ Voice';
    document.title = total > 0 ? `(${total}) ${name}` : name;
  });

  // Ring sound stop function
  let stopRing: (() => void) | null = null;

  // Stop ring sound when call is cleared locally (e.g. user hangs up)
  activeCall.subscribe((call) => {
    if (!call && stopRing) {
      stopRing();
      stopRing = null;
    }
  });

  // Get the screen share data for the user we're viewing
  let viewingScreenShare = $derived(
    viewingScreenUserId ? $activeScreenShares.get(viewingScreenUserId) : null,
  );

  let appLoading = $state(false);

  async function initApp() {
    if (initialized) return;
    initialized = true;

    await checkAuth();

    if ($currentUser) {
      appDataLoaded = true;
      appLoading = true;
      try {
        // Load everything sequentially to avoid nginx rate limit
        const serverList = await loadServers();
        await loadDmChannels();

        if (serverList.length > 0) {
          const lastServer = localStorage.getItem('lastServerId');
          const serverId = serverList.find(s => s.id === lastServer)?.id ?? serverList[0].id;
          activeServerId.set(serverId);
          isDmView.set(false);
        } else {
          isDmView.set(true);
        }

        // Wait for server-scoped data to load (triggered by activeServerId $effect)
        // Give it time to complete before removing loading screen
        await new Promise(r => setTimeout(r, 300));

        await loadInvitations().catch(e => console.warn('[App] Failed to load invitations:', e));
        await loadFriends().catch(e => console.warn('[App] Failed to load friends:', e));
        await loadPendingRequests().catch(e => console.warn('[App] Failed to load pending requests:', e));
      } catch (e) {
        console.error('[App] Failed to load app data:', e);
      }
      appLoading = false;
      connectWs();
      startIdleDetection();
      checkForUpdates();
      initNotifications();

      if ('serviceWorker' in navigator && !isDesktop) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }
  }

  onMount(() => {
    if (isDesktop) {
      document.body.classList.add('has-titlebar');
      // Load persisted server URL from electron-store (async, triggers $effect when done)
      loadServerUrlFromStore();
    }

    const unsub = onWsEvent((event) => {
      switch (event.type) {
        case 'chat:message':
          addMessage(event.message);
          if (event.message.user_id !== $currentUser?.id) {
            const serverId = channelServerMap.get(event.message.channel_id);
            const level = serverId ? ($serverNotificationLevels.get(serverId) || 'default') : 'default';

            const content = event.message.content || '';
            const isMention = $currentUser &&
              (content.includes(`<@${$currentUser.id}>`) || content.includes('<@everyone>'));

            // Determine if we should notify based on server level
            const shouldNotify = level === 'nothing' ? false
              : level === 'mentions' ? !!isMention
              : true; // 'all' or 'default'

            if (shouldNotify) {
              playMessageSound();
            }

            if (event.message.channel_id !== $activeChannelId) {
              markChannelUnread(event.message.channel_id);
              if (isMention) {
                incrementMention(event.message.channel_id);
                if (shouldNotify) {
                  const ch = $channels.find((c) => c.id === event.message.channel_id) ||
                    $dmChannels.find((c) => c.id === event.message.channel_id);
                  notifyMention(
                    ch?.name || 'DM',
                    event.message.display_name || event.message.username || 'Unknown',
                    content,
                  );
                }
              } else if (shouldNotify) {
                notifyMessage(
                  event.message.username || 'Unknown',
                  event.message.display_name || undefined,
                  content,
                );
              }
            } else if (shouldNotify) {
              if (isMention) {
                notifyMention(
                  $activeChannel?.name || 'DM',
                  event.message.display_name || event.message.username || 'Unknown',
                  content,
                );
              } else {
                notifyMessage(
                  event.message.username || 'Unknown',
                  event.message.display_name || undefined,
                  content,
                );
              }
            }
          }
          // Bump DM channel to top of list on new message
          dmChannels.update((list) => {
            const idx = list.findIndex((c) => c.id === event.message.channel_id);
            if (idx > 0) {
              const [dm] = list.splice(idx, 1);
              return [dm, ...list];
            }
            return list;
          });
          break;
        case 'chat:edited':
          editMessage(event.message);
          break;
        case 'chat:deleted':
          removeMessage(event.messageId, event.channelId);
          break;
        case 'presence:list':
          setOnlineUsers(event.users);
          $myStatus = event.ownStatus;
          // Re-sync on reconnect only — skip the initial connection since
          // initApp already loaded everything and firing duplicate requests
          // trips the nginx rate limit (503s)
          if (hasConnectedOnce) {
            // Sequential re-sync to avoid nginx rate limit (503s)
            (async () => {
              await loadServers().catch(e => console.warn('[App] Reconnect: loadServers failed:', e));
              await loadChannels().catch(e => console.warn('[App] Reconnect: loadChannels failed:', e));
              await loadDmChannels().catch(e => console.warn('[App] Reconnect: loadDmChannels failed:', e));
              await refreshUsers().catch(e => console.warn('[App] Reconnect: refreshUsers failed:', e));
              await loadServerSettings().catch(e => console.warn('[App] Reconnect: loadServerSettings failed:', e));
              await loadRoles().catch(e => console.warn('[App] Reconnect: loadRoles failed:', e));
              await loadChannelGroups().catch(e => console.warn('[App] Reconnect: loadChannelGroups failed:', e));
              await loadChannelOverrides().catch(e => console.warn('[App] Reconnect: loadChannelOverrides failed:', e));
              await loadGroupOverrides().catch(e => console.warn('[App] Reconnect: loadGroupOverrides failed:', e));
              await loadFriends().catch(e => console.warn('[App] Reconnect: loadFriends failed:', e));
              await loadPendingRequests().catch(e => console.warn('[App] Reconnect: loadPendingRequests failed:', e));
            })();
          }
          hasConnectedOnce = true;
          break;
        case 'presence:update':
          if (event.online) {
            setUserOnline(event.userId, event.username, event.display_name, event.status, event.activity);
            refreshUsers();
          } else {
            setUserOffline(event.userId);
          }
          break;
        case 'presence:activity':
          updateUserActivity(event.userId, event.activity);
          break;
        case 'voice:peers':
          setVoicePeers(
            event.channelId,
            event.peers.map((p) => ({ ...p, avatar_url: p.avatar_url, speaking: false })),
          );
          for (const p of event.peers) {
            if (p.screenShareProducerId) {
              setVideoProducerOwner(p.screenShareProducerId, p.userId);
              addScreenShare(p.userId, {
                producerId: p.screenShareProducerId,
                username: p.username,
              });
            }
          }
          break;
        case 'voice:channelMembers':
          setAllChannelMembers(event.channels);
          break;
        case 'voice:joined': {
          addVoicePeer({
            userId: event.userId,
            username: event.username,
            display_name: event.display_name,
            avatar_url: event.avatar_url,
            muted: event.muted ?? false,
            speaking: false,
          });
          addChannelMember(event.channelId, {
            userId: event.userId,
            username: event.username,
            display_name: event.display_name,
            avatar_url: event.avatar_url,
            muted: event.muted ?? false,
            deafened: event.deafened ?? false,
          });
          const voiceServerId = channelServerMap.get(event.channelId);
          const voiceLevel = voiceServerId ? ($serverNotificationLevels.get(voiceServerId) || 'default') : 'default';
          if (voiceLevel !== 'nothing') {
            playJoinSound();
          }
          break;
        }
        case 'voice:left': {
          removeVoicePeer(event.userId);
          removeChannelMember(event.channelId, event.userId);
          const voiceServerId = channelServerMap.get(event.channelId);
          const voiceLevel = voiceServerId ? ($serverNotificationLevels.get(voiceServerId) || 'default') : 'default';
          if (voiceLevel !== 'nothing') {
            playLeaveSound();
          }
          break;
        }
        case 'voice:speaking':
          setSpeaking(event.userId, event.speaking);
          break;
        case 'voice:muteUpdate':
          updateChannelMemberMute(event.channelId, event.userId, event.muted);
          break;
        case 'voice:deafenUpdate':
          updateChannelMemberDeafen(event.channelId, event.userId, event.deafened);
          break;
        case 'friend:requestReceived':
          addPendingFromWs(event.request);
          toast('New friend request from ' + event.request.user.display_name);
          break;
        case 'friend:requestAccepted':
          addFriendFromWs(event.friend);
          removePendingByUser(event.userId);
          toast.success(event.friend.display_name + ' accepted your friend request');
          break;
        case 'friend:removed':
          removeFriendFromWs(event.userId);
          break;
        case 'friend:blocked':
          removeFriendFromWs(event.userId);
          break;
        case 'voice:afkMoved':
          inVoiceChannel.set(event.channelId);
          joinVoice(event.channelId).catch(() => {});
          toast.warning('You were moved to the AFK channel due to inactivity');
          break;
        case 'dm:created':
          dmChannels.update((list) =>
            list.some((c) => c.id === event.channel.id) ? list : [event.channel, ...list],
          );
          break;
        case 'channel:created':
          if (event.serverId) registerChannelServer(event.channel.id, event.serverId);
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channels.update((list) => [...list, event.channel]);
          break;
        case 'channel:updated':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          updateChannel(event.channel);
          break;
        case 'channel:deleted':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channels.update((list) => list.filter((c) => c.id !== event.channelId));
          if ($activeChannelId === event.channelId) {
            $activeChannelId = $channels.find((c) => c.type === 'text')?.id ?? null;
          }
          break;
        case 'user:banned':
          if (event.userId === $currentUser?.id) {
            disconnectWs();
            logout();
          }
          refreshUsers();
          break;
        case 'user:updated':
          refreshUsers().then(() => {
            const users = get(allUsers);
            const user = users.find((u) => u.id === event.userId);
            if (user) {
              updateChannelMemberProfile(event.userId, {
                username: user.username,
                display_name: user.display_name,
                avatar_url: user.avatar_url,
              });
              // Sync role info if this is the current user
              if (event.userId === get(currentUser)?.id) {
                currentUser.update((u) =>
                  u
                    ? {
                        ...u,
                        role_id: user.role_id,
                        role_ids: user.role_ids,
                        role_name: user.role_name,
                        role_names: user.role_names,
                        role_color: user.role_color,
                        role_colors: user.role_colors,
                      }
                    : u,
                );
              }
            }
          });
          break;
        case 'message:pinned':
          pinMessage(event.messageId, event.channelId, event.pinnedBy);
          break;
        case 'message:unpinned':
          unpinMessage(event.messageId, event.channelId);
          break;
        case 'soundboard:play':
          try {
            const audio = new Audio(resolveAsset(event.soundUrl));
            audio.volume = $isDeafenedStore ? 0 : $soundboardVolume / 100;
            const pbId = event.playbackId;
            const pbUserId = event.userId;
            activeSoundboardAudio.set(pbId, { audio, userId: pbUserId });

            setSoundboardSpeaking(pbUserId, 1);

            let cleaned = false;
            const cleanup = () => {
              if (cleaned) return;
              cleaned = true;
              activeSoundboardAudio.delete(pbId);
              setSoundboardSpeaking(pbUserId, -1);
            };

            audio.addEventListener('ended', cleanup);
            audio.play().then(() => {
              // Fallback: if ended never fires, clean up after duration + buffer
              const dur = audio.duration;
              if (dur && isFinite(dur)) {
                setTimeout(cleanup, (dur * 1000) + 500);
              }
            }).catch(cleanup);
          } catch {}
          break;
        case 'soundboard:stop': {
          const entry = activeSoundboardAudio.get(event.playbackId);
          if (entry) {
            entry.audio.pause();
            activeSoundboardAudio.delete(event.playbackId);
            setSoundboardSpeaking(entry.userId, -1);
          }
          break;
        }
        case 'screen:started':
          setVideoProducerOwner(event.producerId, event.userId);
          addScreenShare(event.userId, {
            producerId: event.producerId,
            username: event.username,
          });
          break;
        case 'screen:stopped':
          removeScreenShare(event.userId);
          if (viewingScreenUserId === event.userId) {
            viewingScreenUserId = null;
          }
          break;
        case 'watch:started':
          watchSession.set({
            channelId: event.channelId,
            hostUserId: event.hostUserId,
            hostUsername: event.hostUsername,
            videoId: event.videoId,
          });
          break;
        case 'watch:synced':
          watchSyncEvent.set({ state: event.state, time: event.time });
          break;
        case 'watch:queueUpdated':
          watchQueue.set(event.queue);
          break;
        case 'watch:viewersUpdated':
          watchViewers.set(event.viewers);
          break;
        case 'watch:sessionUpdated':
          watchSession.update((s) =>
            s
              ? {
                  ...s,
                  hostUserId: event.hostUserId,
                  hostUsername: event.hostUsername,
                  videoId: event.videoId,
                }
              : s,
          );
          break;
        case 'watch:stopped':
          watchSession.set(null);
          watchSyncEvent.set(null);
          watchQueue.set([]);
          watchViewers.set([]);
          break;
        case 'channelGroup:created':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channelGroups.update((list) =>
            list.some((g) => g.id === event.group.id) ? list : [...list, event.group],
          );
          break;
        case 'channelGroup:updated':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channelGroups.update((list) =>
            list.map((g) => (g.id === event.group.id ? event.group : g)),
          );
          break;
        case 'channelGroup:deleted':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channelGroups.update((list) => list.filter((g) => g.id !== event.groupId));
          // Channels become ungrouped — clear group_id on affected channels
          channels.update((list) =>
            list.map((c) => (c.group_id === event.groupId ? { ...c, group_id: null } : c)),
          );
          break;
        case 'channelOverrides:updated':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channelOverrides.update((current) => {
            const filtered = current.filter((o) => o.channel_id !== event.channelId);
            return [...filtered, ...event.overrides];
          });
          break;
        case 'groupOverrides:updated':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          groupOverrides.update((current) => {
            const filtered = current.filter((o) => o.group_id !== event.groupId);
            return [...filtered, ...event.overrides];
          });
          break;
        case 'role:created':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          roles.update((list) =>
            list.some((r) => r.id === event.role.id) ? list : [...list, event.role],
          );
          break;
        case 'role:updated':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          roles.update((list) => list.map((r) => (r.id === event.role.id ? event.role : r)));
          break;
        case 'role:deleted':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          roles.update((list) => list.filter((r) => r.id !== event.roleId));
          break;
        case 'roles:reordered':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          roles.set(event.roles);
          break;
        case 'channels:reordered':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channels.update((list) => {
            const orderMap = new Map(event.order.map((id: string, i: number) => [id, i]));
            return list
              .map((c) => (orderMap.has(c.id) ? { ...c, sort_order: orderMap.get(c.id)! } : c))
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          });
          break;
        case 'channelGroups:reordered':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          channelGroups.update((list) => {
            const orderMap = new Map(event.order.map((id: string, i: number) => [id, i]));
            return list
              .map((g) => (orderMap.has(g.id) ? { ...g, sort_order: orderMap.get(g.id)! } : g))
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          });
          break;
        case 'server:settingsUpdated':
          if (event.serverId && event.serverId !== get(activeServerId)) break;
          serverSettings.set(event.settings);
          break;
        case 'server:deleted':
          servers.update((list) => list.filter((s) => s.id !== event.serverId));
          if (get(activeServerId) === event.serverId) {
            const remaining = get(servers);
            if (remaining.length > 0) {
              switchServer(remaining[0].id);
            } else {
              isDmView.set(true);
            }
          }
          break;
        case 'server:memberLeft':
          if (event.userId === $currentUser?.id) {
            servers.update((list) => list.filter((s) => s.id !== event.serverId));
            if (get(activeServerId) === event.serverId) {
              const remaining = get(servers);
              if (remaining.length > 0) {
                switchServer(remaining[0].id);
              } else {
                isDmView.set(true);
              }
            }
          }
          break;
        case 'server:memberJoined':
          loadServers().catch(() => {});
          break;
        case 'server:memberUpdated':
          if (event.serverId === get(activeServerId)) {
            refreshUsers().catch(() => {});
            updateChannelMemberProfile(event.userId, {
              display_name: event.nickname,
              avatar_url: event.avatar_url,
            });
          }
          if (event.userId === $currentUser?.id) {
            loadServers().catch(() => {});
          }
          break;
        case 'server:invitation':
          addInvitation(event.invitation);
          break;
        case 'server:updated':
          servers.update((list) =>
            list.map((s) => (s.id === event.server.id ? event.server : s)),
          );
          break;
        case 'call:ringing':
          // Caller gets confirmation that the call is ringing
          activeCall.update((c) => (c ? { ...c, callId: event.callId, video: !!event.video } : c));
          stopRing?.();
          stopRing = playRingSound();
          break;        case 'call:incoming':
          stopRing?.();
          stopRing = playRingSound();
          notifyCall(event.callerName);
          activeCall.set({
            callId: event.callId,
            peerId: event.callerId,
            peerName: event.callerName,
            peerAvatar: event.callerAvatar,
            status: 'incoming',
            video: !!event.video,
          });
          break;        case 'call:accepted':
          stopRing?.();
          stopRing = null;
          playCallAcceptSound();
          activeCall.update((c) =>
            c ? { ...c, status: 'active', channelId: event.channelId } : c,
          );
          $inVoiceChannel = event.channelId;
          joinVoice(event.channelId);
          break;
        case 'call:rejected':
          stopRing?.();
          stopRing = null;
          activeCall.set(null);
          break;
        case 'call:ended': {
          stopRing?.();
          stopRing = null;
          const endedCall = $activeCall;
          if (endedCall?.channelId && $inVoiceChannel === endedCall.channelId) {
            leaveVoice();
            $inVoiceChannel = null;
          }
          // Mark DM as unread for missed calls (system message is inserted server-side)
          if (
            endedCall &&
            endedCall.status === 'incoming' &&
            (event.reason === 'timeout' || event.reason === 'ended')
          ) {
            const dmChannel = $dmChannels.find((dm) =>
              dm.dm_participant_ids?.includes(endedCall.peerId),
            );
            if (dmChannel) {
              markChannelUnread(dmChannel.id);
            }
          }
          if (event.reason === 'busy') {
            toast.error('User is busy');
          }
          activeCall.set(null);
          break;
        }
      }
    });

    // Desktop game activity detection
    let cleanupGameDetection: (() => void) | null = null;
    if (window.electronAPI?.onGameActivityChanged) {
      cleanupGameDetection = window.electronAPI.onGameActivityChanged(async (game) => {
        const settings = await window.electronAPI!.getGameSettings();
        if (!settings.enabled) return;
        sendWs({
          type: 'presence:activity',
          game,
          visibility: settings.visibility,
          serverIds: settings.visibility === 'selected' ? settings.selectedServerIds : undefined,
        });
      });
    }

    // Debug: allow testing game activity from browser console
    // Usage: window.setGameActivity('Valorant') or window.setGameActivity(null)
    (window as any).setGameActivity = (game: string | null) => {
      sendWs({ type: 'presence:activity', game, visibility: 'all' });
    };

    if (!needsServer) {
      initApp();
    }

    return () => {
      unsub();
      cleanupGameDetection?.();
      stopIdleDetection();
      disconnectWs();
    };
  });

  // When serverUrl is set (after ServerConnect), initialize the app
  $effect(() => {
    if ($serverUrl && !initialized && !needsServer) {
      initApp();
    }
  });

  // When user becomes authenticated after initApp already ran (login/register flow),
  // connect WebSocket and load app data
  let appDataLoaded = $state(false);
  $effect(() => {
    if ($currentUser && initialized && !appDataLoaded) {
      appDataLoaded = true;
      // Load servers first, then set active server; server-scoped data loaded by $effect
      loadServers().then(async (serverList) => {
        await loadDmChannels();
        loadFriends().catch(() => {});
        loadPendingRequests().catch(() => {});
        if (serverList.length > 0) {
          const lastServer = localStorage.getItem('lastServerId');
          const serverId = serverList.find(s => s.id === lastServer)?.id ?? serverList[0].id;
          activeServerId.set(serverId);
          isDmView.set(false);
        } else {
          isDmView.set(true);
        }
      }).catch((e) => console.error('[App] Failed to load app data:', e));
      connectWs();
      startIdleDetection();
      checkForUpdates();
      initNotifications();

      if ('serviceWorker' in navigator && !isDesktop) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }
  });

  // React to activeServerId changes — reload all server-scoped data
  let lastLoadedServerId = '';

  $effect(() => {
    const id = $activeServerId;
    const dmView = $isDmView;
    if (id && !dmView && id !== lastLoadedServerId) {
      lastLoadedServerId = id;
      resetUsersStore();

      // Load server data sequentially to avoid rate limits
      (async () => {
        try {
          await loadChannels();
          const channelList = get(channels);
          const lastChannel = localStorage.getItem('lastChannelId_' + id);
          const target = channelList.find((c: any) => c.id === lastChannel && c.type === 'text')
            || channelList.find((c: any) => c.type === 'text');
          if (target) {
            activeChannelId.set(target.id);
          }
          await loadChannelGroups();
          await fetchUsers();
          await loadRoles();
          await loadServerSettings();
          await loadChannelOverrides();
          await loadGroupOverrides();
        } catch (e) {
          console.error('[App] Failed to load server data:', e);
        }
      })();
    }
  });

  // Auto-rejoin voice channel after WebSocket reconnects (e.g. server restart)
  let prevWsConnected = false;
  $effect(() => {
    const connected = $wsConnected;
    const wasDisconnected = !prevWsConnected;
    prevWsConnected = connected;

    if (connected && wasDisconnected && $inVoiceChannel) {
      const channelId = $inVoiceChannel;
      console.log('[App] WS reconnected, auto-rejoining voice channel:', channelId);
      // Clean up stale WebRTC state, then rejoin
      leaveVoice();
      $inVoiceChannel = channelId;
      joinVoice(channelId).catch((e) => {
        console.error('[App] Failed to auto-rejoin voice:', e);
        $inVoiceChannel = null;
      });
    }
  });

  // When session expires (401/4001 with stale token), force logout
  $effect(() => {
    if ($sessionExpired) {
      disconnectWs();
      stopIdleDetection();
      currentUser.set(null);
      appDataLoaded = false;
      initialized = false;
      resetSessionExpired();
    }
  });

  function handleViewScreen(userId: string) {
    viewingScreenUserId = userId;
  }


  // Clear watch session when user leaves voice
  $effect(() => {
    if (!$inVoiceChannel && $watchSession) {
      watchSession.set(null);
      watchSyncEvent.set(null);
      watchQueue.set([]);
      watchViewers.set([]);
    }
  });

  async function handleLogout() {
    if ($inVoiceChannel) leaveVoice();
    disconnectWs();
    await logout();
  }

  function handleReconnect() {
    $wsKicked = false;
    connectWs();
  }

  // Swipe gesture tracking for mobile sidebar
  let touchStartX = 0;
  let touchStartY = 0;

  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }

  function handleTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);

    // Ignore vertical swipes
    if (dy > 50) return;

    // Swipe right from left edge to open sidebar
    if (dx > 80 && touchStartX < 40) {
      showMobileSidebar = true;
    }
    // Swipe left to close sidebar
    else if (dx < -80 && showMobileSidebar) {
      showMobileSidebar = false;
    }
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      showQuickSwitcher = !showQuickSwitcher;
    }
    // Mute: Ctrl+Shift+M
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      if ($inVoiceChannel) toggleMute();
    }
    // Deafen: Ctrl+Shift+D
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if ($inVoiceChannel) toggleDeafen();
    }
    // Disconnect: Ctrl+Shift+E
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      if ($inVoiceChannel) {
        leaveVoice();
        $inVoiceChannel = null;
      }
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

{#if isDesktop}
  <TitleBar />
{/if}

{#if needsServer}
  <ServerConnect />
{:else if $authLoading || appLoading}
  <div class="loading-screen">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else if !$currentUser}
  {@render children()}
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="app-shell" ontouchstart={handleTouchStart} ontouchend={handleTouchEnd}>
    <!-- Mobile hamburger -->
    <button
      class="mobile-menu-btn"
      aria-label="Toggle sidebar"
      onclick={() => (showMobileSidebar = !showMobileSidebar)}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line
          x1="3"
          y1="18"
          x2="21"
          y2="18"
        /></svg
      >
    </button>
    <button
      class="mobile-users-btn"
      aria-label="Toggle user list"
      onclick={() => (showMobileUserList = !showMobileUserList)}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        ><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path
          d="M23 21v-2a4 4 0 0 0-3-3.87"
        /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg
      >
    </button>

    {#if showMobileSidebar}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="mobile-overlay" onclick={() => (showMobileSidebar = false)}></div>
    {/if}
    {#if showMobileUserList}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="mobile-overlay" onclick={() => (showMobileUserList = false)}></div>
    {/if}

    <div class="nav-dock-wrapper">
      <NavDock />
    </div>
    <div class="sidebar-wrapper" class:mobile-open={showMobileSidebar}>
      {#if $isDmView}
        <HomeSidebar onopensettings={() => (showSettingsModal = true)} />
      {:else}
        <Sidebar
          onviewscreen={handleViewScreen}
          onopensettings={() => (showSettingsModal = true)}
          onserversettings={() => (showServerSettings = true)}
        />
      {/if}
    </div>
    <main class="main-content">
      {#if !$wsConnected && initialized && !$wsKicked}
        <div class="reconnecting-banner">
          <div class="reconnecting-spinner"></div>
          Reconnecting...
        </div>
      {/if}
      {@render children()}
    </main>
    {#if !$isDmView}
      <div class="userlist-wrapper" class:mobile-open={showMobileUserList}>
        <UserList />
      </div>
    {/if}
  </div>

  {#if $wsKicked}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="kicked-overlay" onkeydown={(e) => e.key === 'Escape' && handleReconnect()}>
      <div class="kicked-modal">
        <h3>Disconnected</h3>
        <p>You connected from another location. This session was closed.</p>
        <button class="kicked-btn" onclick={handleReconnect}>Reconnect</button>
      </div>
    </div>
  {/if}

  {#if showSettingsModal}
    <SettingsModal onclose={() => (showSettingsModal = false)} onlogout={handleLogout} />
  {/if}

  {#if showServerSettings}
    <ServerSettings onclose={() => (showServerSettings = false)} />
  {/if}

  {#if viewingScreenUserId && viewingScreenShare}
    <ScreenShareViewer
      username={viewingScreenShare.username}
      stream={viewingScreenShare.stream}
      onclose={() => (viewingScreenUserId = null)}
    />
  {/if}
{/if}

<CallOverlay />
<Toast />
<StoreUpdateModal />
<InvitationNotification />
<AppPanels />

{#if showQuickSwitcher}
  <QuickSwitcher onclose={() => (showQuickSwitcher = false)} />
{/if}

<style>
  .loading-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 16px;
    color: var(--text-muted);
  }

  :global(.has-titlebar) .loading-screen {
    height: calc(100vh - 32px);
  }

  .loading-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--bg-light);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .app-shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
    position: relative;
  }

  :global(.has-titlebar) .app-shell {
    height: calc(100vh - 32px);
  }

  .nav-dock-wrapper {
    flex-shrink: 0;
  }

  .sidebar-wrapper {
    flex-shrink: 0;
  }

  .userlist-wrapper {
    flex-shrink: 0;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-gradient-main, var(--bg-dark));
  }

  .reconnecting-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px;
    background: var(--warning);
    color: var(--bg-darkest);
    font-size: 0.85rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .reconnecting-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(0, 0, 0, 0.2);
    border-top-color: var(--bg-darkest);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .kicked-overlay {
    position: fixed;
    inset: 0;
    background: var(--overlay);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .kicked-modal {
    background: var(--bg-dark);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    padding: 28px;
    width: 380px;
    text-align: center;
    box-shadow: var(--shadow-lg);
  }

  .kicked-modal h3 {
    font-size: 1.2rem;
    margin-bottom: 8px;
  }

  .kicked-modal p {
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: 20px;
    line-height: 1.5;
  }

  .kicked-btn {
    padding: 10px 24px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    border-radius: var(--radius);
    box-shadow: 0 0 20px var(--accent-glow);
    transition: all 150ms var(--ease-out);
  }

  .kicked-btn:hover {
    background: var(--accent-hover);
    box-shadow: 0 0 30px var(--accent-glow);
    transform: translateY(-1px);
  }

  /* Mobile */
  .mobile-menu-btn,
  .mobile-users-btn {
    display: none;
    position: fixed;
    z-index: 101;
    width: 40px;
    height: 40px;
    align-items: center;
    justify-content: center;
    background: var(--bg-mid);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }

  .mobile-menu-btn {
    top: 10px;
    left: 10px;
  }

  .mobile-users-btn {
    top: 10px;
    right: 10px;
  }

  .mobile-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99;
  }

  @media (max-width: 768px) {
    .nav-dock-wrapper {
      display: none;
    }

    .mobile-menu-btn,
    .mobile-users-btn {
      display: flex;
    }

    .mobile-overlay {
      display: block;
    }

    .sidebar-wrapper {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 100;
      transform: translateX(-100%);
      transition: transform 250ms var(--ease-out);
      width: 260px;
    }

    .sidebar-wrapper.mobile-open {
      transform: translateX(0);
    }

    .sidebar-wrapper :global(.sidebar) {
      width: 260px !important;
    }

    .userlist-wrapper {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 100;
      transform: translateX(100%);
      transition: transform 250ms var(--ease-out);
      width: 220px;
    }

    .userlist-wrapper.mobile-open {
      transform: translateX(0);
    }

    .userlist-wrapper :global(.user-list) {
      width: 220px !important;
    }

    .main-content {
      padding-top: 44px;
    }

    .kicked-modal {
      width: calc(100vw - 32px);
      max-width: 380px;
    }
  }
</style>
