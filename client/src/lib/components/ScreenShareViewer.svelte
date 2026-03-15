<script lang="ts">
  let {
    username,
    stream,
    onclose,
  }: {
    username: string;
    stream: MediaStream | undefined;
    onclose: () => void;
  } = $props();

  let videoEl: HTMLVideoElement;
  let dragging = $state(false);
  let pos = $state({ x: 100, y: 100 });
  let size = $state({ w: 640, h: 360 });
  let dragOffset = { x: 0, y: 0 };

  $effect(() => {
    if (videoEl && stream) {
      videoEl.srcObject = stream;
    }
  });

  function onMouseDown(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    dragging = true;
    dragOffset = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    pos = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
  }

  function onMouseUp() {
    dragging = false;
  }
</script>

<svelte:window onmousemove={onMouseMove} onmouseup={onMouseUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="viewer" style="left: {pos.x}px; top: {pos.y}px; width: {size.w}px; height: {size.h}px;">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="title-bar" onmousedown={onMouseDown}>
    <span class="title">{username}'s screen</span>
    <button class="close-btn" onclick={onclose}>&times;</button>
  </div>
  <div class="video-container">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={videoEl} autoplay playsinline class="video"></video>
  </div>
</div>

<style>
  .viewer {
    position: fixed;
    z-index: 300;
    background: var(--bg-darkest);
    border: 1px solid var(--border-light);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 320px;
    min-height: 200px;
    resize: both;
  }

  .title-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-dark);
    border-bottom: 1px solid var(--border);
    cursor: move;
    user-select: none;
    flex-shrink: 0;
  }

  .title {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-muted);
    border-radius: 4px;
    font-size: 16px;
    transition: all 150ms var(--ease-out);
  }

  .close-btn:hover {
    background: var(--danger);
    color: white;
  }

  .video-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    overflow: hidden;
  }

  .video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
