<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { base } from '$app/paths';
  import { isAuthenticated, logout, isExpired } from '$lib/stores/auth';
  import '../app.css';

  $effect(() => {
    const onLoginPage = page.url.pathname.endsWith('/login');
    if (!$isAuthenticated || isExpired()) {
      if (!onLoginPage) {
        logout();
        goto(`${base}/login`);
      }
    }
  });

  function handleLogout() {
    logout();
    goto(`${base}/login`);
  }

  const navItems = [
    { path: `${base}/`, label: 'Dashboard' },
    { path: `${base}/users`, label: 'Users' },
    { path: `${base}/servers`, label: 'Servers' },
    { path: `${base}/reports`, label: 'Reports' },
    { path: `${base}/audit`, label: 'Audit Log' },
  ];

  const isLoginPage = $derived(page.url.pathname.endsWith('/login'));
</script>

{#if isLoginPage}
  <slot />
{:else if $isAuthenticated}
  <div class="admin-layout">
    <nav class="top-bar">
      <div class="brand">SellServ Admin</div>
      <button class="logout-btn" onclick={handleLogout}>Logout</button>
    </nav>
    <div class="main">
      <aside class="sidebar">
        {#each navItems as item}
          <a
            href={item.path}
            class="nav-item"
            class:active={page.url.pathname === item.path || (item.path !== `${base}/` && page.url.pathname.startsWith(item.path))}
          >
            {item.label}
          </a>
        {/each}
      </aside>
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
{/if}

<style>
  .admin-layout {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 56px;
    background: var(--bg-dark);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .brand {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .logout-btn {
    padding: 6px 16px;
    background: var(--bg-light);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .logout-btn:hover {
    color: var(--text);
    background: var(--bg-mid);
  }

  .main {
    display: flex;
    flex: 1;
  }

  .sidebar {
    width: 220px;
    background: var(--bg-dark);
    border-right: 1px solid var(--border);
    padding: 16px 8px;
    flex-shrink: 0;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 500;
    text-decoration: none;
    transition: background 0.1s, color 0.1s;
  }

  .nav-item:hover {
    background: var(--bg-light);
    color: var(--text);
    text-decoration: none;
  }

  .nav-item.active {
    background: var(--bg-light);
    color: var(--text);
  }

  .content {
    flex: 1;
    padding: 32px;
    overflow-y: auto;
    max-height: calc(100vh - 56px);
  }
</style>
