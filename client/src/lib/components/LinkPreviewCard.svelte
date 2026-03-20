<script lang="ts">
  import { api } from '$lib/api';

  interface LinkPreviewData {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    site_name: string | null;
    favicon: string | null;
  }

  // Module-level cache shared across all instances (bounded to prevent memory leaks)
  const MAX_CACHE_SIZE = 200;
  const previewCache = new Map<string, LinkPreviewData | null>();

  function cacheSet(key: string, value: LinkPreviewData | null) {
    if (previewCache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry
      const firstKey = previewCache.keys().next().value;
      if (firstKey !== undefined) previewCache.delete(firstKey);
    }
    previewCache.set(key, value);
  }

  let { url }: { url: string } = $props();

  let preview = $state<LinkPreviewData | null>(null);
  let loading = $state(true);
  let showImage = $state(true);
  let showFavicon = $state(true);

  $effect(() => {
    const targetUrl = url;
    loading = true;
    showImage = true;
    showFavicon = true;

    if (previewCache.has(targetUrl)) {
      preview = previewCache.get(targetUrl) || null;
      loading = false;
      return;
    }

    api
      .get<LinkPreviewData>(`/api/link-preview?url=${encodeURIComponent(targetUrl)}`)
      .then((data) => {
        if (data.title) {
          cacheSet(targetUrl, data);
          preview = data;
        } else {
          cacheSet(targetUrl, null);
          preview = null;
        }
      })
      .catch(() => {
        cacheSet(targetUrl, null);
        preview = null;
      })
      .finally(() => {
        loading = false;
      });
  });
</script>

{#if !loading && preview}
  <a href={url} target="_blank" rel="noopener noreferrer" class="link-preview-card">
    {#if preview.image && showImage}
      <img
        src={preview.image}
        alt=""
        class="preview-image"
        onerror={() => {
          showImage = false;
        }}
      />
    {/if}
    <div class="preview-body">
      {#if preview.site_name || preview.favicon}
        <div class="preview-site">
          {#if preview.favicon && showFavicon}
            <img
              src={preview.favicon}
              alt=""
              class="preview-favicon"
              onerror={() => {
                showFavicon = false;
              }}
            />
          {/if}
          {#if preview.site_name}
            <span class="preview-site-name">{preview.site_name}</span>
          {/if}
        </div>
      {/if}
      {#if preview.title}
        <div class="preview-title">{preview.title}</div>
      {/if}
      {#if preview.description}
        <div class="preview-description">{preview.description}</div>
      {/if}
    </div>
  </a>
{/if}

<style>
  .link-preview-card {
    display: block;
    margin-top: 8px;
    max-width: min(420px, 100%);
    border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius) var(--radius) 0;
    background: var(--bg-mid);
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: background 150ms var(--ease-out);
  }

  .link-preview-card:hover {
    background: var(--bg-light);
    text-decoration: none;
  }

  .preview-image {
    width: 100%;
    max-height: 200px;
    object-fit: cover;
    display: block;
  }

  .preview-body {
    padding: 10px 12px;
  }

  .preview-site {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .preview-favicon {
    width: 16px;
    height: 16px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .preview-site-name {
    font-size: 0.75rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-weight: 600;
  }

  .preview-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--accent);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preview-description {
    font-size: 0.8rem;
    color: var(--text-muted);
    line-height: 1.4;
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
