<script lang="ts">
  import { page } from '$app/state';
  import '../app.css';

  let { data, children } = $props();

  const navItems = [
    { path: '/', label: 'Dashboard' },
    { path: '/users', label: 'Users' },
    { path: '/servers', label: 'Servers' },
    { path: '/reports', label: 'Reports' },
    { path: '/audit', label: 'Audit Log' },
  ];
</script>

<div class="admin-layout">
  <nav class="top-bar">
    <div class="top-left">
      <span class="brand">Admin Console</span>
    </div>
    <div class="top-right">
      <span class="user-name">{data.user.displayName || data.user.username}</span>
      <form method="POST" action="/auth/logout">
        <button type="submit" class="logout-btn">Logout</button>
      </form>
    </div>
  </nav>
  <div class="main">
    <aside class="sidebar">
      {#each navItems as item}
        <a
          href={item.path}
          class="nav-item"
          class:active={item.path === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(item.path)}
        >
          {item.label}
        </a>
      {/each}
    </aside>
    <main class="content">
      {@render children()}
    </main>
  </div>
</div>

<style>
  .admin-layout {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-darker);
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

  .top-left { display: flex; align-items: center; gap: 16px; }

  .brand {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .top-right { display: flex; align-items: center; gap: 16px; }

  .user-name { color: var(--text-muted); font-size: 0.85rem; }

  .logout-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .logout-btn:hover { color: var(--text); border-color: var(--text-muted); }

  .main { display: flex; flex: 1; overflow: hidden; }

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
    padding: 10px 14px;
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 0.9rem;
    font-weight: 500;
    transition: background 0.1s, color 0.1s;
  }

  .nav-item:hover { background: var(--bg-light); color: var(--text); }
  .nav-item.active { background: var(--bg-light); color: var(--text); }

  .content { flex: 1; padding: 32px; overflow-y: auto; }
</style>
