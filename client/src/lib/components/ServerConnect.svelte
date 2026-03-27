<script lang="ts">
  import { serverUrl } from '$lib/stores/server';

  let showCustom = $state(false);
  let url = $state('');
  let error = $state('');
  let loading = $state(false);

  function joinOfficial() {
    serverUrl.set('https://chat.sellserv.net');
  }

  async function handleConnect() {
    error = '';
    const trimmed = url.trim().replace(/\/+$/, '');

    if (!trimmed) {
      error = 'Please enter a server URL';
      return;
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('invalid protocol');
      }
    } catch {
      error = 'Invalid URL. Use format: https://chat.example.com';
      return;
    }

    loading = true;
    try {
      const res = await fetch(`${trimmed}/api/auth/me`);
      if (!res.ok && res.status !== 401) {
        throw new Error(`Server returned ${res.status}`);
      }
      serverUrl.set(trimmed);
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="connect-container">
  <div class="connect-wrapper">
    <h1 class="brand">SellServ Voice</h1>
    <p class="tagline">Choose where to connect</p>

    <!-- Official Instance Card -->
    <button class="official-card" onclick={joinOfficial}>
      <div class="official-icon">
        <svg viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="bg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#5865F2"/><stop offset="100%" stop-color="#3B44B0"/></linearGradient></defs>
          <rect width="128" height="128" rx="16" fill="url(#bg)"/>
          <line x1="64" y1="18" x2="64" y2="30" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="64" cy="15" r="4" fill="#fff"/>
          <rect x="32" y="30" width="64" height="48" rx="12" fill="#fff"/>
          <circle cx="48" cy="52" r="7" fill="#5865F2"/><circle cx="80" cy="52" r="7" fill="#5865F2"/><circle cx="50" cy="50" r="2.5" fill="#fff"/><circle cx="82" cy="50" r="2.5" fill="#fff"/>
          <rect x="46" y="64" width="36" height="6" rx="3" fill="#5865F2"/>
          <rect x="40" y="82" width="48" height="28" rx="8" fill="#fff"/><rect x="20" y="86" width="16" height="8" rx="4" fill="#fff"/><rect x="92" y="86" width="16" height="8" rx="4" fill="#fff"/>
          <circle cx="56" cy="96" r="4" fill="#5865F2"/><circle cx="72" cy="96" r="4" fill="#5865F2"/>
        </svg>
      </div>
      <div class="official-text">
        <div class="official-name">Official Instance</div>
        <div class="official-url">chat.sellserv.net</div>
      </div>
      <svg class="official-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>

    <!-- Self-hosted option -->
    {#if !showCustom}
      <button class="self-host-btn" onclick={() => showCustom = true}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
          <line x1="6" y1="6" x2="6.01" y2="6"/>
          <line x1="6" y1="18" x2="6.01" y2="18"/>
        </svg>
        Connect to a self-hosted server
      </button>
    {:else}
      <div class="custom-section">
        <div class="custom-header">
          <span>Self-Hosted Server</span>
          <button class="back-btn" onclick={() => { showCustom = false; error = ''; }}>Cancel</button>
        </div>
        <form onsubmit={(e) => { e.preventDefault(); handleConnect(); }}>
          <input
            type="url"
            class="url-input"
            bind:value={url}
            placeholder="https://chat.example.com"
            required
          />
          {#if error}
            <p class="error">{error}</p>
          {/if}
          <button type="submit" class="connect-btn" disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    {/if}
  </div>
</div>

<style>
  .connect-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: var(--bg-darkest);
    padding: 24px;
  }

  .connect-wrapper {
    width: 100%;
    max-width: 420px;
  }

  .brand {
    text-align: center;
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 4px;
  }

  .tagline {
    text-align: center;
    color: var(--text-dim);
    font-size: 0.9rem;
    margin-bottom: 32px;
  }

  /* Official Instance Card */
  .official-card {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: var(--bg-dark);
    border: 1px solid var(--border-light);
    border-radius: 12px;
    cursor: pointer;
    transition: all 150ms var(--ease-out);
    text-align: left;
  }

  .official-card:hover {
    background: var(--bg-mid);
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .official-icon {
    width: 52px;
    height: 52px;
    border-radius: 12px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .official-icon svg {
    width: 100%;
    height: 100%;
  }

  .official-text {
    flex: 1;
  }

  .official-name {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text);
  }

  .official-url {
    font-size: 0.8rem;
    color: var(--text-dim);
    margin-top: 2px;
  }

  .official-arrow {
    color: var(--text-dim);
    flex-shrink: 0;
    transition: transform 150ms var(--ease-out);
  }

  .official-card:hover .official-arrow {
    color: var(--accent);
    transform: translateX(3px);
  }

  /* Self-hosted button */
  .self-host-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px;
    margin-top: 16px;
    background: none;
    border: 1px dashed var(--border-light);
    border-radius: 10px;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 150ms var(--ease-out);
  }

  .self-host-btn:hover {
    border-color: var(--text-dim);
    color: var(--text);
    background: rgba(255, 255, 255, 0.02);
  }

  /* Custom URL section */
  .custom-section {
    margin-top: 16px;
    background: var(--bg-dark);
    border: 1px solid var(--border-light);
    border-radius: 12px;
    padding: 20px;
  }

  .custom-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }

  .back-btn {
    font-size: 0.8rem;
    color: var(--text-dim);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .back-btn:hover {
    color: var(--text);
  }

  .url-input {
    width: 100%;
    padding: 10px 14px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: 8px;
    border: 1px solid var(--border-light);
    font-size: 0.9rem;
    transition: all 150ms var(--ease-out);
  }

  .url-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .url-input::placeholder {
    color: var(--text-dim);
  }

  .error {
    color: var(--danger);
    font-size: 0.8rem;
    margin-top: 8px;
  }

  .connect-btn {
    width: 100%;
    padding: 10px;
    margin-top: 12px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    font-size: 0.9rem;
    border-radius: 8px;
    transition: all 150ms var(--ease-out);
  }

  .connect-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .connect-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
