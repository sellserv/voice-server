# Video Calls Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webcam video support to direct calls, allowing users to start/stop video at any time during a call.

**Architecture:** Extends the existing MediaSoup audio pipeline with a video producer/consumer layer. Video streams are tracked in a dedicated store. The CallOverlay UI expands to show remote video full-screen with a local PiP preview when video is active, and collapses to the current compact bar for audio-only.

**Tech Stack:** MediaSoup (existing), Svelte 5, WebRTC getUserMedia

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `client/src/lib/stores/video.ts` | Local + remote video stream stores |
| Create | `client/src/lib/components/Icon.svelte` (add icon) | Add `video` and `video-off` icons |
| Modify | `client/src/lib/webrtc.ts` | `startVideo()`, `stopVideo()`, route video consumers to video store |
| Modify | `client/src/lib/components/CallOverlay.svelte` | Video UI: remote stream, local PiP, camera toggle, accept-with-video |
| Modify | `client/src/lib/components/UserProfileCard.svelte` | Add "Video Call" button |
| Modify | `client/src/lib/components/ChatPane.svelte` | Add video call button in DM header |

---

### Task 1: Add Video Icons to Icon.svelte

**Files:**
- Modify: `client/src/lib/components/Icon.svelte`

- [ ] **Step 1: Add video and video-off icons**

Add before the `{/if}` closing block, after the `clock` icon:

```svelte
{:else if name === 'video'}
  <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
{:else if name === 'video-off'}
  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><line x1="1" y1="1" x2="23" y2="23" />
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/components/Icon.svelte
git commit -m "feat: add video and video-off icons"
```

---

### Task 2: Create Video Store

**Files:**
- Create: `client/src/lib/stores/video.ts`

- [ ] **Step 1: Create the store**

```typescript
import { writable } from 'svelte/store';

// Local webcam preview stream
export const localVideoStream = writable<MediaStream | null>(null);

// Remote video streams keyed by userId
export const remoteVideos = writable<Map<string, MediaStream>>(new Map());

export function setRemoteVideo(userId: string, stream: MediaStream) {
  remoteVideos.update((m) => {
    m.set(userId, stream);
    return new Map(m);
  });
}

export function removeRemoteVideo(userId: string) {
  remoteVideos.update((m) => {
    m.delete(userId);
    return new Map(m);
  });
}

export function clearAllVideo() {
  localVideoStream.set(null);
  remoteVideos.set(new Map());
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/stores/video.ts
git commit -m "feat: add video stream stores for local and remote video"
```

---

### Task 3: Add startVideo/stopVideo to webrtc.ts

**Files:**
- Modify: `client/src/lib/webrtc.ts`

- [ ] **Step 1: Add imports at the top of webrtc.ts**

Add to the existing imports:

```typescript
import { localVideoStream, setRemoteVideo, removeRemoteVideo, clearAllVideo } from '$lib/stores/video';
```

- [ ] **Step 2: Add videoProducer variable**

Near the existing `screenProducer` variable declaration, add:

```typescript
let videoProducer: Producer | null = null;
let videoStream: MediaStream | null = null;
```

- [ ] **Step 3: Implement startVideo()**

Add after `stopScreenShare()`:

```typescript
export async function startVideo() {
  if (!sendTransport || !device) throw new Error('Not in a voice channel');

  videoStream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  const videoTrack = videoStream.getVideoTracks()[0];

  videoTrack.addEventListener('ended', () => {
    stopVideo();
  });

  videoProducer = await sendTransport.produce({ track: videoTrack });
  localVideoStream.set(videoStream);
}

export function stopVideo() {
  if (videoProducer) {
    videoProducer.close();
    videoProducer = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach((t) => t.stop());
    videoStream = null;
  }
  localVideoStream.set(null);
  sendWs({ type: 'screen:stop' });
}
```

Note: We reuse the `screen:stop` WS event since the server already calls `closeVideoProducer()` for it, which cleans up the peer's `videoProducer`. This is the same producer slot used by both screen share and webcam.

- [ ] **Step 4: Update video consumer routing**

In the `consumeProducer` function, find the `if (event.kind === 'video')` block (around line 616). Replace the screen-share-only routing with dual routing:

```typescript
if (event.kind === 'video') {
  const userId = videoProducerOwners.get(producerId);
  if (userId) {
    // Route to both screen share store (for ScreenShareViewer) and video store (for CallOverlay)
    setScreenShareStream(userId, stream);
    setRemoteVideo(userId, stream);
  }
  sendWs({ type: 'rtc:resumeConsumer', consumerId: consumer.id });
  return;
}
```

- [ ] **Step 5: Clean up video in leaveVoice()**

In the `leaveVoice()` function, add video cleanup after the screen share cleanup:

```typescript
// Clean up webcam video
if (videoProducer) {
  videoProducer.close();
  videoProducer = null;
}
if (videoStream) {
  videoStream.getTracks().forEach((t) => t.stop());
  videoStream = null;
}
clearAllVideo();
```

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/webrtc.ts
git commit -m "feat: add startVideo/stopVideo and route video consumers to video store"
```

---

### Task 4: Overhaul CallOverlay.svelte

**Files:**
- Modify: `client/src/lib/components/CallOverlay.svelte`

- [ ] **Step 1: Rewrite CallOverlay with video support**

Replace the entire file with the new implementation that handles:
- Incoming calls: "Accept with Video" / "Accept Audio Only" / "Decline" (for video calls)
- Outgoing calls: show whether it's a video or voice call
- Active calls: full-screen video with PiP local preview when video is active, compact bar when audio-only
- Camera toggle button in active call controls
- Mic toggle button in active call controls

Key additions to the script:
```typescript
import { startVideo, stopVideo } from '$lib/webrtc';
import { localVideoStream, remoteVideos, clearAllVideo } from '$lib/stores/video';
import { isMuted, toggleMute } from '$lib/stores/media';

let cameraOn = $state(false);
let localVideoEl: HTMLVideoElement;
let remoteVideoEl: HTMLVideoElement;

// Bind local video stream to video element
$effect(() => {
  if (localVideoEl && $localVideoStream) {
    localVideoEl.srcObject = $localVideoStream;
  }
});

// Bind remote video stream to video element
$effect(() => {
  if (remoteVideoEl && $activeCall?.peerId) {
    const stream = $remoteVideos.get($activeCall.peerId);
    if (stream) remoteVideoEl.srcObject = stream;
  }
});

const hasRemoteVideo = $derived(
  $activeCall?.peerId ? $remoteVideos.has($activeCall.peerId) : false
);

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
  // Start video after a short delay to let the voice channel connect
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
```

Template structure for active video call:
```svelte
{:else if $activeCall.status === 'active'}
  {#if hasRemoteVideo || cameraOn}
    <!-- Full video call view -->
    <div class="video-call-overlay">
      <div class="remote-video-container">
        {#if hasRemoteVideo}
          <video bind:this={remoteVideoEl} autoplay playsinline class="remote-video"></video>
        {:else}
          <!-- Remote peer avatar (no video yet) -->
          <div class="video-avatar-placeholder">...</div>
        {/if}
      </div>
      {#if $localVideoStream}
        <div class="local-pip">
          <video bind:this={localVideoEl} autoplay playsinline muted class="local-video"></video>
        </div>
      {/if}
      <div class="video-controls">
        <span class="video-call-name">{$activeCall.peerName}</span>
        <span class="video-call-time">{formatTime(elapsed)}</span>
        <div class="video-btns">
          <button class="control-btn" class:off={$isMuted} onclick={toggleMute}>
            <Icon name={$isMuted ? 'mic-off' : 'mic'} size={20} />
          </button>
          <button class="control-btn" class:off={!cameraOn} onclick={toggleCamera}>
            <Icon name={cameraOn ? 'video' : 'video-off'} size={20} />
          </button>
          <button class="control-btn end" onclick={() => handleEndCall($activeCall!.callId)}>
            <Icon name="phone-off" size={20} />
          </button>
        </div>
      </div>
    </div>
  {:else}
    <!-- Audio-only call bar (existing design + camera toggle) -->
    <div class="call-bar">...</div>
  {/if}
{/if}
```

CSS for video layout:
- `.video-call-overlay`: fixed position, centered, ~500px wide, rounded corners, glassmorphism
- `.remote-video-container`: 16:9 aspect ratio, rounded, overflow hidden
- `.remote-video`: object-fit cover, full container
- `.local-pip`: absolute bottom-right, ~160px wide, rounded, border, shadow
- `.video-controls`: glassmorphism bar at bottom of overlay, flex row with buttons

- [ ] **Step 2: Commit**

```bash
git add client/src/lib/components/CallOverlay.svelte
git commit -m "feat: overhaul CallOverlay with video call UI"
```

---

### Task 5: Add Video Call Buttons to Trigger UI

**Files:**
- Modify: `client/src/lib/components/UserProfileCard.svelte`
- Modify: `client/src/lib/components/ChatPane.svelte`

- [ ] **Step 1: Update UserProfileCard**

Find the existing call button (around line 164-172) and add a video call button next to it:

```svelte
<button
  class="call-btn"
  onclick={() => {
    initiateCall(user.id, user.display_name || user.username, user.avatar_url);
    onclose();
  }}
>
  <Icon name="volume" size={16} />
  Call
</button>
<button
  class="call-btn video"
  onclick={() => {
    initiateCall(user.id, user.display_name || user.username, user.avatar_url, true);
    onclose();
  }}
>
  <Icon name="video" size={16} />
  Video
</button>
```

Add CSS for `.call-btn.video` — same as `.call-btn` but with a different color accent (use `var(--accent)` instead of `var(--success)` to differentiate).

- [ ] **Step 2: Update ChatPane DM header**

Find the existing phone button (around line 233-243). Add a video call button next to it:

```svelte
<button
  class="header-icon-btn"
  title="Video call"
  aria-label="Video call"
  onclick={() =>
    initiateCall(
      dmOtherUser!.id,
      dmOtherUser!.display_name || dmOtherUser!.username,
      dmOtherUser!.avatar_url,
      true,
    )}
>
  <Icon name="video" size={20} />
</button>
```

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/components/UserProfileCard.svelte client/src/lib/components/ChatPane.svelte
git commit -m "feat: add video call buttons to UserProfileCard and ChatPane DM header"
```

---

### Task 6: Verify and Clean Up

- [ ] **Step 1: Run svelte-check**

```bash
npx svelte-check --workspace client
```

Fix any type errors in modified files.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address type errors in video call implementation"
```
