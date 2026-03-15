<script lang="ts">
  import { serverUrl } from '$lib/stores/server';

  let url = $state('');
  let error = $state('');
  let loading = $state(false);

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
  <div class="connect-card">
    <h1 class="brand">Voice Server</h1>
    <p class="tagline">Connect to your server</p>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleConnect();
      }}
    >
      <label class="field">
        <span>Server URL</span>
        <input type="url" bind:value={url} placeholder="https://chat.example.com" required />
      </label>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button type="submit" class="submit-btn" disabled={loading}>
        {loading ? 'Connecting...' : 'Connect'}
      </button>
    </form>
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

  .connect-card {
    background: var(--bg-dark);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-lg);
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: var(--shadow-lg), var(--shadow-glow);
  }

  .brand {
    text-align: center;
    font-size: 2rem;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 4px;
  }

  .tagline {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-bottom: 32px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .field span {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text-muted);
  }

  .field input {
    padding: 10px 14px;
    background: var(--bg-mid);
    color: var(--text);
    border-radius: var(--radius);
    border: 1px solid var(--border-light);
    transition: all 150ms var(--ease-out);
  }

  .field input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 12px var(--accent-glow);
    outline: none;
  }

  .field input::placeholder {
    color: var(--text-dim);
  }

  .error {
    color: var(--danger);
    font-size: 0.85rem;
    margin-bottom: 12px;
  }

  .submit-btn {
    width: 100%;
    padding: 12px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    font-size: 1rem;
    border-radius: var(--radius);
    box-shadow: 0 0 20px var(--accent-glow);
    transition: all 150ms var(--ease-out);
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 0 30px var(--accent-glow);
    transform: translateY(-1px);
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
