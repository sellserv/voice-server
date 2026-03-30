<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { currentUser } from '$lib/stores/auth';
  import { officialInstance } from '$lib/stores/features';

  $effect(() => {
    if ($currentUser && !$currentUser.is_instance_admin) {
      goto('/');
    }
  });

  $effect(() => {
    if ($officialInstance) {
      goto('/');
    }
  });

  const navItems = [
    { path: '/admin', label: 'Dashboard' },
    { path: '/admin/users', label: 'Users' },
    { path: '/admin/servers', label: 'Servers' },
    { path: '/admin/reports', label: 'Reports' },
    { path: '/admin/audit', label: 'Audit Log' },
  ];
</script>

{#if $currentUser?.is_instance_admin}
  <div class="admin-layout">
    <nav class="top-bar">
      <div class="top-left">
        <span class="brand">SellServ Admin</span>
      </div>
      <div class="top-right">
        <a href="/" class="back-link">Back to Chat</a>
        <span class="user-name">{$currentUser.display_name || $currentUser.username}</span>
      </div>
    </nav>
    <div class="main">
      <aside class="sidebar">
        {#each navItems as item}
          <a
            href={item.path}
            class="nav-item"
            class:active={item.path === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(item.path)}
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
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-darker);
    z-index: 9999;
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

  .top-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .brand {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .top-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .back-link {
    color: var(--text-muted);
    font-size: 0.85rem;
    text-decoration: none;
  }

  .back-link:hover {
    color: var(--text);
  }

  .user-name {
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .main {
    display: flex;
    flex: 1;
    overflow: hidden;
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
  }

  .nav-item.active {
    background: var(--bg-light);
    color: var(--text);
  }

  .content {
    flex: 1;
    padding: 32px;
    overflow-y: auto;
  }
</style>
