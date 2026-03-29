<script lang="ts">
  import { serverSettings } from '$lib/stores/serverSettings';
  import { updateReady, installUpdate, openStoreUpdate, openDownloadsPage } from '$lib/updater';

  function handleUpdateClick() {
    if ($updateReady?.store) {
      openStoreUpdate();
    } else if ($updateReady?.download) {
      openDownloadsPage();
    } else {
      installUpdate();
    }
  }
  import { onMount } from 'svelte';

  let isMac = $state(false);
  let isWindows = $state(false);

  onMount(async () => {
    try {
      const api = (window as any).electronAPI;
      if (api) {
        const platform = await api.getPlatform();
        isMac = platform === 'darwin';
        isWindows = platform === 'win32';
      }
    } catch {}
  });

  function minimize() {
    (window as any).electronAPI?.minimize();
  }

  function toggleMaximize() {
    (window as any).electronAPI?.toggleMaximize();
  }

  function close() {
    (window as any).electronAPI?.close();
  }
</script>

<div class="titlebar" class:mac={isMac}>
  {#if isMac}
    <div class="titlebar-buttons mac-buttons">
      <button class="mac-btn close" onclick={close} title="Close">
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          ><line x1="0.5" y1="0.5" x2="5.5" y2="5.5" /><line
            x1="5.5"
            y1="0.5"
            x2="0.5"
            y2="5.5"
          /></svg
        >
      </button>
      <button class="mac-btn minimize" onclick={minimize} title="Minimize">
        <svg width="8" height="1" viewBox="0 0 8 1"
          ><rect width="8" height="1" fill="currentColor" /></svg
        >
      </button>
      <button class="mac-btn maximize" onclick={toggleMaximize} title="Maximize">
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          ><path d="M0.5 3.5 L0.5 0.5 L3.5 0.5" /><path d="M5.5 2.5 L5.5 5.5 L2.5 5.5" /></svg
        >
      </button>
    </div>
    <span class="titlebar-title">{$serverSettings.name}</span>
    <div class="mac-right">
      {#if $updateReady}
        <button class="update-btn" onclick={handleUpdateClick} title="Update v{$updateReady.version} available">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      {/if}
      <button class="refresh-btn" onclick={() => location.reload()} title="Refresh">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="23 4 23 10 17 10" /><path
            d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
          /></svg
        >
      </button>
    </div>
  {:else}
    <span class="titlebar-title">{$serverSettings.name}</span>
    <div class="titlebar-buttons">
      {#if $updateReady}
        <button class="titlebar-btn update-btn" onclick={handleUpdateClick} title="Update v{$updateReady.version} available">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      {/if}
      <button class="titlebar-btn" onclick={() => location.reload()} title="Refresh">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="23 4 23 10 17 10" /><path
            d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
          /></svg
        >
      </button>
      <button class="titlebar-btn" onclick={minimize} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1"
          ><rect width="10" height="1" fill="currentColor" /></svg
        >
      </button>
      <button class="titlebar-btn" onclick={toggleMaximize} title="Maximize">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" /></svg
        >
      </button>
      <button class="titlebar-btn close" onclick={close} title="Close">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          ><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg
        >
      </button>
    </div>
  {/if}
</div>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding-left: 12px;
    background: var(--bg-darkest);
    border-bottom: 1px solid var(--border);
    user-select: none;
    flex-shrink: 0;
    z-index: 10000;
    -webkit-app-region: drag;
  }

  .titlebar-btn,
  .mac-btn,
  .refresh-btn,
  .update-btn {
    -webkit-app-region: no-drag;
  }

  .titlebar.mac {
    justify-content: space-between;
    padding-left: 8px;
    padding-right: 8px;
  }

  .titlebar-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.02em;
    pointer-events: none;
  }

  .mac .titlebar-title {
    text-align: center;
  }

  /* Windows/Linux buttons */
  .titlebar-buttons {
    display: flex;
    height: 100%;
  }

  .titlebar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 100%;
    background: transparent;
    color: var(--text-muted);
    border: none;
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .titlebar-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .titlebar-btn.close:hover {
    background: var(--danger);
    color: white;
  }

  /* macOS traffic light buttons */
  .mac-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding-left: 4px;
  }

  .mac-right {
    display: flex;
    align-items: center;
    width: 54px;
    justify-content: flex-end;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    border-radius: var(--radius-sm);
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .refresh-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .mac-btn {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    color: transparent;
    transition: all 120ms ease;
  }

  .mac-btn.close {
    background: #ff5f57;
  }

  .mac-btn.minimize {
    background: #febc2e;
  }

  .mac-btn.maximize {
    background: #28c840;
  }

  .mac-buttons:hover .mac-btn {
    color: rgba(0, 0, 0, 0.5);
  }

  .mac-btn:active {
    filter: brightness(0.8);
  }

  .update-btn {
    color: #22c55e;
  }

  .update-btn:hover {
    color: #4ade80;
    background: rgba(34, 197, 94, 0.15);
  }

  .titlebar-btn.update-btn:hover {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }
</style>
