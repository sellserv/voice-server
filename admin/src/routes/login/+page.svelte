<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { setAuth } from '$lib/stores/auth';

  let username = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  const API_URL = import.meta.env.VITE_API_URL || '';

  async function handleLogin(e: Event) {
    e.preventDefault();
    error = '';
    loading = true;

    try {
      const res = await fetch(`${API_URL}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Login failed');
      }

      const { token, expiresAt } = await res.json();
      setAuth(token, expiresAt);
      goto(`${base}/`);
    } catch (e: any) {
      error = e.message || 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<div class="login-page">
  <div class="login-card">
    <h1>SellServ Admin</h1>
    <p class="subtitle">Instance Administration Console</p>

    <form onsubmit={handleLogin}>
      <label class="field">
        <span>Username</span>
        <input
          type="text"
          bind:value={username}
          placeholder="Admin username"
          required
          autocomplete="username"
        />
      </label>

      <label class="field">
        <span>Password</span>
        <input
          type="password"
          bind:value={password}
          placeholder="Admin password"
          required
          autocomplete="current-password"
        />
      </label>

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <button type="submit" class="submit-btn" disabled={loading || !username || !password}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  </div>
</div>

<style>
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-darker);
  }

  .login-card {
    background: var(--bg-dark);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 40px;
    width: 100%;
    max-width: 400px;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin-bottom: 28px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
  }

  .field span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .field input {
    padding: 10px 12px;
    background: var(--bg-mid);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.9rem;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
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
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
