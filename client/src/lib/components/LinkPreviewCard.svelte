<script lang="ts">
  import { api } from '$lib/api';

  interface LinkPreviewData {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    site_name: string | null;
    author: string | null;
    favicon: string | null;
  }

  const MAX_CACHE_SIZE = 200;
  const previewCache = new Map<string, LinkPreviewData | null>();

  function cacheSet(key: string, value: LinkPreviewData | null) {
    if (previewCache.size >= MAX_CACHE_SIZE) {
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
  let isVideo = $state(false);
  let isShort = $state(false);
  let playing = $state(false);

  const VIDEO_DOMAINS = ['youtube.com', 'youtu.be', 'twitch.tv', 'vimeo.com'];
  const LARGE_IMAGE_DOMAINS = [...VIDEO_DOMAINS, 'twitter.com', 'x.com', 'reddit.com', 'imgur.com'];

  function getDomain(targetUrl: string): string {
    try {
      return new URL(targetUrl).hostname.replace('www.', '');
    } catch {
      return '';
    }
  }

  function matchesDomain(hostname: string, domains: string[]): boolean {
    return domains.some((d) => hostname === d || hostname.endsWith('.' + d));
  }

  function getEmbedUrl(targetUrl: string): string | null {
    try {
      const parsed = new URL(targetUrl);
      const host = parsed.hostname.replace('www.', '');

      // YouTube
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        // Shorts
        const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?]+)/);
        if (shortsMatch) {
          return `https://www.youtube.com/embed/${shortsMatch[1]}?autoplay=1&rel=0`;
        }

        const videoId = parsed.searchParams.get('v');
        const t = parsed.searchParams.get('t');
        if (videoId) {
          let embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
          if (t) embedUrl += `&start=${t.replace('s', '')}`;
          return embedUrl;
        }
      }
      if (host === 'youtu.be') {
        const videoId = parsed.pathname.slice(1).split('/')[0];
        const t = parsed.searchParams.get('t');
        if (videoId) {
          let embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
          if (t) embedUrl += `&start=${t.replace('s', '')}`;
          return embedUrl;
        }
      }

      // Twitch clips
      if (host === 'twitch.tv' || host === 'clips.twitch.tv') {
        const clipMatch = parsed.pathname.match(/\/clip\/([^/]+)/);
        if (clipMatch) {
          return `https://clips.twitch.tv/embed?clip=${clipMatch[1]}&parent=${window.location.hostname}&autoplay=true`;
        }
        // Twitch channels
        const channelMatch = parsed.pathname.match(/^\/([^/]+)$/);
        if (channelMatch && !['directory', 'downloads', 'p', 'jobs'].includes(channelMatch[1])) {
          return `https://player.twitch.tv/?channel=${channelMatch[1]}&parent=${window.location.hostname}&autoplay=true`;
        }
      }

      // Vimeo
      if (host === 'vimeo.com') {
        const vimeoId = parsed.pathname.slice(1).split('/')[0];
        if (vimeoId && /^\d+$/.test(vimeoId)) {
          return `https://player.vimeo.com/video/${vimeoId}?autoplay=1`;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  $effect(() => {
    const targetUrl = url;
    loading = true;
    showImage = true;
    showFavicon = true;
    playing = false;

    const hostname = getDomain(targetUrl);
    isVideo = matchesDomain(hostname, VIDEO_DOMAINS);
    try {
      isShort = /\/shorts\//.test(new URL(targetUrl).pathname);
    } catch {
      isShort = false;
    }

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

  let useLargeImage = $derived(
    preview?.image && showImage && matchesDomain(getDomain(url), LARGE_IMAGE_DOMAINS)
  );

  let embedUrl = $derived(getEmbedUrl(url));
  let canEmbed = $derived(isVideo && !!embedUrl);

  function handlePlayClick(e: MouseEvent) {
    if (canEmbed) {
      e.preventDefault();
      e.stopPropagation();
      playing = true;
    }
  }

  function handleCardClick(e: MouseEvent) {
    if (playing) {
      e.preventDefault();
    }
  }
</script>

{#if !loading && preview}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="link-preview-card" class:has-large-image={useLargeImage || playing} class:is-playing={playing} class:is-short={isShort} onclick={handleCardClick}>
    <div class="preview-content">
      <div class="preview-text">
        {#if preview.site_name}
          <div class="preview-site">
            {#if preview.favicon && showFavicon}
              <img
                src={preview.favicon}
                alt=""
                class="preview-favicon"
                onerror={() => { showFavicon = false; }}
              />
            {/if}
            <span class="preview-site-name">{preview.site_name}</span>
          </div>
        {/if}
        {#if preview.author}
          <div class="preview-author">{preview.author}</div>
        {/if}
        {#if preview.title}
          <a href={url} target="_blank" rel="noopener noreferrer" class="preview-title">{preview.title}</a>
        {/if}
        {#if preview.description && !useLargeImage && !playing}
          <div class="preview-description">{preview.description}</div>
        {/if}
      </div>
      {#if preview.image && showImage && !useLargeImage && !playing}
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={preview.image}
            alt=""
            class="preview-thumbnail"
            onerror={() => { showImage = false; }}
          />
        </a>
      {/if}
    </div>
    {#if playing && embedUrl}
      <div class="embed-wrapper">
        <iframe
          src={embedUrl}
          title={preview.title || 'Video'}
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>
    {:else if useLargeImage}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="preview-image-wrapper" onclick={canEmbed ? handlePlayClick : undefined}>
        <img
          src={preview.image}
          alt=""
          class="preview-image-large"
          onerror={() => { showImage = false; }}
        />
        {#if isVideo}
          <div class="play-button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .link-preview-card {
    display: block;
    margin-top: 8px;
    max-width: 520px;
    border-left: 4px solid var(--accent);
    border-radius: 0 8px 8px 0;
    background: var(--bg-mid);
    overflow: hidden;
    color: inherit;
    transition: background 150ms var(--ease-out);
    padding: 12px 16px;
  }

  .link-preview-card.has-large-image {
    padding-bottom: 0;
  }

  .link-preview-card:not(.is-playing):hover {
    background: var(--bg-light);
  }

  .preview-content {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .preview-text {
    flex: 1;
    min-width: 0;
  }

  .preview-thumbnail {
    width: 80px;
    height: 80px;
    border-radius: 6px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .preview-image-wrapper {
    position: relative;
    margin: 12px -16px 0;
    cursor: pointer;
  }

  .preview-image-large {
    width: 100%;
    max-height: 300px;
    object-fit: cover;
    display: block;
    border-radius: 0 0 4px 0;
  }

  .play-button {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms;
  }

  .preview-image-wrapper:hover .play-button {
    background: rgba(0, 0, 0, 0.8);
  }

  .embed-wrapper {
    position: relative;
    margin: 12px -16px 0;
    padding-top: 56.25%; /* 16:9 aspect ratio */
  }

  .embed-wrapper iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0 0 4px 0;
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
    color: var(--text-muted);
    font-weight: 600;
  }

  .preview-author {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 2px;
  }

  .preview-title {
    display: block;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--accent);
    line-height: 1.3;
    text-decoration: none;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preview-title:hover {
    text-decoration: underline;
  }

  .preview-description {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.4;
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* YouTube Shorts — vertical layout */
  .is-short {
    max-width: 320px;
  }

  .is-short .preview-image-large {
    max-height: 480px;
    aspect-ratio: 9 / 16;
    object-fit: cover;
  }

  .is-short .embed-wrapper {
    padding-top: 177.78%; /* 9:16 aspect ratio */
  }
</style>
