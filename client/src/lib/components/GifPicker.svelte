<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api';
  import { toast } from '$lib/stores/toast';

  let { onSelect }: { onSelect: (gifUrl: string) => void } = $props();

  let query = $state('');
  let gifs: any[] = $state([]);
  let loading = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchInput: HTMLInputElement;

  onMount(() => {
    searchInput?.focus();
    fetchTrending();
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  async function fetchTrending() {
    loading = true;
    try {
      const data = await api.get<{ data: any[] }>('/api/giphy/search');
      gifs = data.data ?? [];
    } catch (err: any) {
      gifs = [];
      toast.error(err.message || 'Failed to load GIFs');
    } finally {
      loading = false;
    }
  }

  async function searchGifs(q: string) {
    if (!q.trim()) {
      fetchTrending();
      return;
    }
    loading = true;
    try {
      const data = await api.get<{ data: any[] }>(`/api/giphy/search?q=${encodeURIComponent(q)}`);
      gifs = data.data ?? [];
    } catch (err: any) {
      gifs = [];
      toast.error(err.message || 'Failed to search GIFs');
    } finally {
      loading = false;
    }
  }

  function handleInput() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => searchGifs(query), 400);
  }

  function selectGif(gif: any) {
    const url = gif.images?.fixed_height?.url || gif.images?.original?.url;
    if (url) onSelect(url);
  }
</script>

<div class="gif-popover">
  <input
    bind:this={searchInput}
    bind:value={query}
    oninput={handleInput}
    type="text"
    class="gif-search"
    placeholder="Search GIFs..."
  />
  <div class="gif-grid">
    {#if loading}
      <div class="gif-loading">Loading...</div>
    {:else if gifs.length === 0}
      <div class="gif-loading">No GIFs found</div>
    {:else}
      {#each gifs as gif (gif.id)}
        <button class="gif-item" onclick={() => selectGif(gif)}>
          <img
            src={gif.images?.downsized?.url || gif.images?.fixed_width?.url}
            alt={gif.title}
            loading="lazy"
          />
        </button>
      {/each}
    {/if}
  </div>
  <div class="giphy-attr">Powered by GIPHY</div>
</div>

<style>
  .gif-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 8px;
    z-index: 100;
    width: min(350px, calc(100vw - 24px));
    height: min(420px, 60vh);
    background: var(--glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--glass-border-bright);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--glass-shadow), var(--glass-glow);
  }

  .gif-search {
    padding: 12px 14px;
    background: var(--bg-mid);
    color: var(--text);
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
    flex-shrink: 0;
  }

  .gif-search::placeholder {
    color: var(--text-dim);
  }

  .gif-grid {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 6px;
  }

  .gif-item {
    background: var(--bg-mid);
    padding: 0;
    cursor: pointer;
    border-radius: 6px;
    overflow: hidden;
    height: 160px;
  }

  .gif-item:hover {
    opacity: 0.8;
    transform: scale(1.01);
  }

  .gif-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .gif-loading {
    text-align: center;
    padding: 24px;
    color: var(--text-dim);
  }

  .giphy-attr {
    padding: 4px 8px;
    font-size: 0.65rem;
    color: var(--text-dim);
    text-align: right;
    border-top: 1px solid var(--border);
  }
</style>
