<script lang="ts">
  import { activeCall, acceptCall, rejectCall, endCall } from '$lib/stores/call';
  import { leaveVoice, startVideo, stopVideo, toggleMute } from '$lib/webrtc';
  import { inVoiceChannel, isMutedStore } from '$lib/stores/media';
  import { localVideoStream, remoteVideos, clearAllVideo } from '$lib/stores/video';
  import { get } from 'svelte/store';
  import { resolveAsset } from '$lib/stores/server';
  import Icon from './Icon.svelte';

  let elapsed = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let cameraOn = $state(false);
  let localVideoEl = $state<HTMLVideoElement>();
  let remoteVideoEl = $state<HTMLVideoElement>();

  $effect(() => {
    if ($activeCall?.status === 'active') {
      elapsed = 0;
      timer = setInterval(() => {
        elapsed += 1;
      }, 1000);
    } else {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      elapsed = 0;
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  });

  // Bind local video stream to element
  $effect(() => {
    if (localVideoEl && $localVideoStream) {
      localVideoEl.srcObject = $localVideoStream;
    }
  });

  // Bind remote video stream to element
  $effect(() => {
    if (remoteVideoEl && $activeCall?.peerId) {
      const stream = $remoteVideos.get($activeCall.peerId);
      if (stream) remoteVideoEl.srcObject = stream;
    }
  });

  const hasRemoteVideo = $derived(
    $activeCall?.peerId ? $remoteVideos.has($activeCall.peerId) : false
  );

  const isVideoCall = $derived($activeCall?.video ?? false);
  const showVideoView = $derived($activeCall?.status === 'active' && (hasRemoteVideo || cameraOn));

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async function toggleCamera() {
    if (cameraOn) {
      stopVideo();
      cameraOn = false;
    } else {
      try {
        await startVideo();
        cameraOn = true;
      } catch (err) {
        console.error('Failed to start camera:', err);
      }
    }
  }

  function acceptWithVideo(callId: string) {
    acceptCall(callId);
    setTimeout(async () => {
      try {
        await startVideo();
        cameraOn = true;
      } catch (err) {
        console.error('Failed to start camera after accepting:', err);
      }
    }, 1500);
  }

  function handleEndCall(callId: string) {
    const call = get(activeCall);
    if (call?.channelId && get(inVoiceChannel) === call.channelId) {
      leaveVoice();
      inVoiceChannel.set(null);
    }
    cameraOn = false;
    clearAllVideo();
    endCall(callId);
  }
</script>

{#if $activeCall}
  <div class="call-overlay" class:active={$activeCall.status === 'active'} class:video-active={showVideoView}>
    {#if $activeCall.status === 'incoming'}
      <div class="call-card incoming">
        <div class="call-avatar-container">
          <div class="call-avatar-ring"></div>
          <div class="call-avatar">
            {#if $activeCall.peerAvatar}
              <img src={resolveAsset($activeCall.peerAvatar)} alt="" class="call-avatar-img" />
            {:else}
              <span class="call-avatar-initial">{$activeCall.peerName.charAt(0).toUpperCase()}</span>
            {/if}
          </div>
        </div>
        <div class="call-info">
          <span class="call-name">{$activeCall.peerName}</span>
          <span class="call-status">Incoming {isVideoCall ? 'Video' : 'Voice'} Call...</span>
        </div>
        <div class="call-actions">
          {#if isVideoCall}
            <button
              class="call-btn accept"
              title="Accept with Video"
              onclick={() => acceptWithVideo($activeCall!.callId)}
            >
              <Icon name="video" size={22} />
            </button>
            <button
              class="call-btn accept-audio"
              title="Accept Audio Only"
              onclick={() => acceptCall($activeCall!.callId)}
            >
              <Icon name="volume" size={22} />
            </button>
          {:else}
            <button
              class="call-btn accept"
              title="Accept"
              onclick={() => acceptCall($activeCall!.callId)}
            >
              <Icon name="volume" size={24} />
            </button>
          {/if}
          <button
            class="call-btn reject"
            title="Decline"
            onclick={() => rejectCall($activeCall!.callId)}
          >
            <Icon name="phone-off" size={24} />
          </button>
        </div>
      </div>

    {:else if $activeCall.status === 'outgoing'}
      <div class="call-card outgoing">
        <div class="call-avatar-container">
          <div class="call-avatar-ring outgoing-ring"></div>
          <div class="call-avatar">
            {#if $activeCall.peerAvatar}
              <img src={resolveAsset($activeCall.peerAvatar)} alt="" class="call-avatar-img" />
            {:else}
              <span class="call-avatar-initial">{$activeCall.peerName.charAt(0).toUpperCase()}</span>
            {/if}
          </div>
        </div>
        <div class="call-info">
          <span class="call-name">{$activeCall.peerName}</span>
          <span class="call-status">{isVideoCall ? 'Video' : 'Voice'} Calling...</span>
        </div>
        <div class="call-actions">
          <button
            class="call-btn reject"
            title="Cancel"
            onclick={() => handleEndCall($activeCall!.callId)}
          >
            <Icon name="phone-off" size={24} />
          </button>
        </div>
      </div>

    {:else if $activeCall.status === 'active'}
      {#if showVideoView}
        <!-- Full video call view -->
        <div class="video-call-overlay">
          <div class="remote-video-container">
            {#if hasRemoteVideo}
              <video bind:this={remoteVideoEl} autoplay playsinline class="remote-video"></video>
            {:else}
              <div class="video-avatar-placeholder">
                <div class="video-avatar-large">
                  {#if $activeCall.peerAvatar}
                    <img src={resolveAsset($activeCall.peerAvatar)} alt="" />
                  {:else}
                    <span>{$activeCall.peerName.charAt(0).toUpperCase()}</span>
                  {/if}
                </div>
                <span class="video-waiting-text">Waiting for video...</span>
              </div>
            {/if}
          </div>

          {#if $localVideoStream}
            <div class="local-pip">
              <video bind:this={localVideoEl} autoplay playsinline muted class="local-video"></video>
            </div>
          {/if}

          <div class="video-controls">
            <div class="video-controls-info">
              <span class="video-call-name">{$activeCall.peerName}</span>
              <span class="video-call-time">{formatTime(elapsed)}</span>
            </div>
            <div class="video-btns">
              <button
                class="control-btn"
                class:off={$isMutedStore}
                title={$isMutedStore ? 'Unmute' : 'Mute'}
                onclick={() => toggleMute()}
              >
                <Icon name={$isMutedStore ? 'mic-off' : 'mic'} size={20} />
              </button>
              <button
                class="control-btn"
                class:off={!cameraOn}
                title={cameraOn ? 'Turn off camera' : 'Turn on camera'}
                onclick={toggleCamera}
              >
                <Icon name={cameraOn ? 'video' : 'video-off'} size={20} />
              </button>
              <button
                class="control-btn end"
                title="End Call"
                onclick={() => handleEndCall($activeCall!.callId)}
              >
                <Icon name="phone-off" size={20} />
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Audio-only call bar -->
        <div class="call-bar">
          <div class="call-bar-left">
            <div class="active-dot"></div>
            <div class="call-bar-avatar">
              {#if $activeCall.peerAvatar}
                <img src={resolveAsset($activeCall.peerAvatar)} alt="" class="call-bar-img" />
              {:else}
                {$activeCall.peerName.charAt(0).toUpperCase()}
              {/if}
            </div>
            <div class="call-bar-details">
              <span class="call-bar-name">{$activeCall.peerName}</span>
              <span class="call-bar-time">{formatTime(elapsed)}</span>
            </div>
          </div>
          <div class="call-bar-actions">
            <button
              class="action-btn toggle"
              class:off={$isMutedStore}
              title={$isMutedStore ? 'Unmute' : 'Mute'}
              onclick={() => toggleMute()}
            >
              <Icon name={$isMutedStore ? 'mic-off' : 'mic'} size={18} />
            </button>
            <button
              class="action-btn toggle"
              title="Turn on camera"
              onclick={toggleCamera}
            >
              <Icon name="video" size={18} />
            </button>
            <button
              class="action-btn disconnect"
              title="End Call"
              onclick={() => handleEndCall($activeCall!.callId)}
            >
              <Icon name="phone-off" size={20} />
            </button>
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .call-overlay {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    animation: slideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  .call-overlay.video-active {
    top: 0;
    left: auto;
    right: 0;
    bottom: 0;
    transform: none;
    width: calc(100vw - var(--nav-dock-width) - var(--sidebar-width));
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-40px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  /* Incoming/Outgoing Card */
  .call-card {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 24px 28px;
    background: rgba(20, 20, 35, 0.85);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    box-shadow:
      0 30px 60px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.05);
    min-width: 360px;
  }

  .call-avatar-container {
    position: relative;
    width: 64px;
    height: 64px;
    flex-shrink: 0;
  }

  .call-avatar-ring {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--accent);
    animation: ringPulse 2s infinite;
  }

  .outgoing-ring { border-color: var(--text-dim); }

  @keyframes ringPulse {
    0% { transform: scale(1); opacity: 0.8; }
    100% { transform: scale(1.4); opacity: 0; }
  }

  .call-avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--bg-mid);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 2;
    border: 2px solid rgba(255, 255, 255, 0.1);
  }

  .call-avatar-img { width: 100%; height: 100%; object-fit: cover; }
  .call-avatar-initial { font-size: 1.5rem; font-weight: 800; color: var(--accent); }

  .call-info { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .call-name { font-weight: 800; font-size: 1.1rem; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .call-status { font-size: 0.85rem; color: var(--text-dim); font-weight: 600; }

  .call-actions { display: flex; gap: 10px; }

  .call-btn {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
    color: white;
  }

  .call-btn.accept {
    background: var(--accent-success);
    box-shadow: 0 0 20px rgba(52, 211, 153, 0.3);
  }
  .call-btn.accept:hover { background: #34d399; transform: scale(1.1); }

  .call-btn.accept-audio {
    background: var(--accent);
    box-shadow: 0 0 20px var(--accent-glow);
  }
  .call-btn.accept-audio:hover { background: var(--accent-hover); transform: scale(1.1); }

  .call-btn.reject {
    background: var(--danger);
    box-shadow: 0 0 20px rgba(248, 113, 113, 0.3);
  }
  .call-btn.reject:hover { background: #f87171; transform: scale(1.1) rotate(-15deg); }

  /* Active Audio Call Bar */
  .call-bar {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 10px 20px;
    background: rgba(10, 10, 20, 0.8);
    backdrop-filter: blur(32px);
    -webkit-backdrop-filter: blur(32px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 30px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    min-width: 280px;
  }

  .call-bar-left { display: flex; align-items: center; gap: 12px; flex: 1; }

  .active-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-success);
    box-shadow: 0 0 8px var(--accent-success);
    animation: blink 2s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .call-bar-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-mid);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 0.8rem;
    color: var(--accent);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .call-bar-img { width: 100%; height: 100%; object-fit: cover; }
  .call-bar-details { display: flex; flex-direction: column; }
  .call-bar-name { font-weight: 700; font-size: 0.9rem; color: white; }
  .call-bar-time { font-size: 0.75rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }

  .call-bar-actions { display: flex; gap: 8px; }

  .action-btn.toggle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .action-btn.toggle:hover { background: rgba(255, 255, 255, 0.2); }
  .action-btn.toggle.off { color: var(--text-dim); }

  .action-btn.disconnect {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--danger);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .action-btn.disconnect:hover { background: #f87171; transform: scale(1.1); }

  /* Video Call View */
  .video-call-overlay {
    width: 100%;
    max-width: 100%;
    height: 100%;
    background: rgba(10, 10, 20, 0.95);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: none;
    border-radius: 0;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    animation: videoIn 0.3s var(--ease-out);
  }

  @keyframes videoIn {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  .remote-video-container {
    flex: 1;
    background: #0a0a14;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .remote-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-avatar-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .video-avatar-large {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: var(--bg-mid);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 3px solid rgba(255, 255, 255, 0.1);
  }

  .video-avatar-large img { width: 100%; height: 100%; object-fit: cover; }
  .video-avatar-large span { font-size: 2.5rem; font-weight: 800; color: var(--accent); }
  .video-waiting-text { font-size: 0.85rem; color: var(--text-dim); font-weight: 600; }

  .local-pip {
    position: absolute;
    bottom: 80px;
    right: 24px;
    width: 240px;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    border: 2px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 5;
  }

  .local-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .video-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(12px);
  }

  .video-controls-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .video-call-name { font-weight: 700; font-size: 0.9rem; color: white; }
  .video-call-time { font-size: 0.75rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }

  .video-btns { display: flex; gap: 10px; }

  .control-btn {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    border: none;
    cursor: pointer;
  }

  .control-btn:hover { background: rgba(255, 255, 255, 0.2); transform: scale(1.05); }
  .control-btn.off { background: rgba(255, 255, 255, 0.05); color: var(--text-dim); }
  .control-btn.end { background: var(--danger); }
  .control-btn.end:hover { background: #f87171; transform: scale(1.1); }
</style>
