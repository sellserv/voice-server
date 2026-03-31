<script lang="ts">
  import { serverUrl } from '$lib/stores/server';
  import { APP_NAME } from '$lib/constants';

  let customUrl = $state('');
  let error = $state('');
  let loading = $state(false);

  function connectOfficial() {
    serverUrl.set('https://chat.sellserv.net');
  }

  async function connectCustom() {
    let url = customUrl.trim();
    if (!url) {
      error = 'Please enter a server URL';
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    try {
      new URL(url);
    } catch {
      error = 'Invalid URL';
      return;
    }
    url = url.replace(/\/+$/, '');
    error = '';
    loading = true;
    try {
      const res = await fetch(`${url}/api/auth/me`);
      if (!res.ok && res.status !== 401) {
        throw new Error(`Server returned ${res.status}`);
      }
      serverUrl.set(url);
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') connectCustom();
  }
</script>

<div class="selector-container">
  <div class="selector-card">
    <div class="logo">
      <img src="/icon-512x512.png" alt={APP_NAME} class="logo-img" />
    </div>
    <h1 class="title">{APP_NAME}</h1>

    <button class="instance-option official" onclick={connectOfficial}>
      <div class="instance-icon official-icon">&#10022;</div>
      <div class="instance-info">
        <div class="instance-name">Official Instance</div>
        <div class="instance-url">chat.sellserv.net</div>
      </div>
      <span class="connect-arrow">CONNECT &rarr;</span>
    </button>

    <div class="divider">
      <span class="divider-line"></span>
      <span class="divider-text">or connect to</span>
      <span class="divider-line"></span>
    </div>

    <div class="custom-input-row">
      <input
        type="text"
        class="custom-url-input"
        placeholder="https://your-server.com"
        bind:value={customUrl}
        onkeydown={handleKeydown}
      />
      <button class="join-btn" onclick={connectCustom} disabled={loading}>
        {loading ? '...' : 'Join'}
      </button>
    </div>

    {#if error}
      <div class="error-text">{error}</div>
    {/if}
  </div>
</div>

<style>
  .selector-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-darkest, #08080f);
    padding: 1rem;
  }

  .selector-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.2rem;
    max-width: 400px;
    width: 100%;
  }

  .logo-img {
    width: 64px;
    height: 64px;
    border-radius: 16px;
  }

  .title {
    color: var(--text, #fff);
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0;
  }

  .instance-option {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    padding: 1rem 1.2rem;
    border-radius: 10px;
    cursor: pointer;
    border: 2px solid var(--accent, #7289da);
    background: var(--bg-mid, #1a1a2e);
    text-align: left;
    color: inherit;
    font: inherit;
  }

  .instance-option:hover {
    background: var(--bg-light, #222240);
  }

  .instance-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    flex-shrink: 0;
  }

  .official-icon {
    background: linear-gradient(135deg, #43b581, #3ca374);
    color: white;
  }

  .instance-info {
    flex: 1;
  }

  .instance-name {
    color: var(--text, #fff);
    font-weight: 600;
    font-size: 0.9rem;
  }

  .instance-url {
    color: var(--text-muted, #888);
    font-size: 0.75rem;
  }

  .connect-arrow {
    color: var(--accent, #7289da);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
  }

  .divider-line {
    flex: 1;
    height: 1px;
    background: var(--border, #333);
  }

  .divider-text {
    color: var(--text-muted, #666);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .custom-input-row {
    display: flex;
    gap: 0.5rem;
    width: 100%;
  }

  .custom-url-input {
    flex: 1;
    background: var(--bg-mid, #12121f);
    border: 1px solid var(--border, #333);
    border-radius: 8px;
    padding: 0.7rem 1rem;
    color: var(--text, #fff);
    font-size: 0.85rem;
    outline: none;
  }

  .custom-url-input:focus {
    border-color: var(--accent, #7289da);
  }

  .join-btn {
    background: var(--accent, #7289da);
    border: none;
    border-radius: 8px;
    padding: 0.7rem 1rem;
    color: white;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .join-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .join-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error-text {
    color: var(--danger, #e74c3c);
    font-size: 0.8rem;
  }
</style>
