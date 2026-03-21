import type { FastifyInstance } from 'fastify';
import { lookup } from 'dns/promises';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';
import { requireAuth } from '../auth/middleware.js';
import db from '../db/connection.js';

interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  favicon: string | null;
  fetched_at: string;
}

// Check if an IP address is private/internal
function isPrivateIp(ip: string): boolean {
  // IPv4
  const ipv4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 127 || // 127.x.x.x loopback
      a === 10 || // 10.x.x.x
      (a === 172 && b >= 16 && b <= 31) || // 172.16-31.x.x
      (a === 192 && b === 168) || // 192.168.x.x
      a === 0 || // 0.x.x.x
      (a === 169 && b === 254) || // 169.254.x.x link-local / cloud metadata
      (a >= 224 && a <= 239) || // 224.0.0.0/4 multicast
      a >= 240 // 240.0.0.0/4 reserved + 255.255.255.255 broadcast
    ) {
      return true;
    }
    return false;
  }

  // IPv6
  if (ip === '::1' || ip === '::') return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateIp(v4mapped[1]);

  // Normalize IPv6 and check private ranges
  const normalized = ip.toLowerCase();
  // fe80::/10 — link-local
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe80')) return true;
  // fc00::/7 — unique local (fc00:: and fd00::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  return false;
}

// Block private/internal IPs (SSRF protection)
function isPrivateHostname(hostname: string): boolean {
  hostname = hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]'
  ) {
    return true;
  }
  return isPrivateIp(hostname);
}

// Resolve hostname and return the validated IP, or null if private/blocked.
// The caller must use the returned IP to connect, preventing DNS rebinding.
async function resolveAndValidate(urlStr: string): Promise<{ ip: string; family: number } | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Quick check on hostname itself
  if (isPrivateHostname(hostname)) return null;

  // Resolve DNS and check the actual IP (with timeout to prevent slow DNS attacks)
  try {
    const result = await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), 3000),
      ),
    ]);
    if (isPrivateIp(result.address)) return null;
    return { ip: result.address, family: result.family };
  } catch {
    return null; // DNS resolution failed or timed out
  }
}

function isYouTubeUrl(urlStr: string): { isYT: boolean; videoId?: string } {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { isYT: false };
  }

  const host = parsed.hostname.replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const videoId = parsed.searchParams.get('v');
    if (videoId) return { isYT: true, videoId };
  }

  if (host === 'youtu.be') {
    const videoId = parsed.pathname.slice(1).split('/')[0];
    if (videoId) return { isYT: true, videoId };
  }

  return { isYT: false };
}

function extractMetaContent(html: string, property: string): string | null {
  // Try og: property
  const ogRegex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const ogMatch = html.match(ogRegex);
  if (ogMatch) return ogMatch[1];

  // Try reversed attribute order (content before property)
  const revRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i',
  );
  const revMatch = html.match(revRegex);
  if (revMatch) return revMatch[1];

  return null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function extractFavicon(html: string, origin: string): string {
  // Look for <link rel="icon" href="..."> or rel="shortcut icon"
  const match = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  if (match) {
    const href = match[1];
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return origin + href;
    return origin + '/' + href;
  }
  // Also check reversed attribute order
  const revMatch = html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i,
  );
  if (revMatch) {
    const href = revMatch[1];
    if (href.startsWith('http')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return origin + href;
    return origin + '/' + href;
  }
  return origin + '/favicon.ico';
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const linkPreviewRateLimit = {
  config: {
    rateLimit: {
      max: 20,
      timeWindow: '1 minute',
      keyGenerator: (request: any) => request.user?.userId || request.ip,
    },
  },
};

export default async function linkPreviewRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { url?: string } }>(
    '/api/link-preview',
    { preHandler: requireAuth, ...linkPreviewRateLimit },
    async (request, reply) => {
      const { url } = request.query;
      if (!url) {
        return reply.code(400).send({ error: 'Missing url parameter' });
      }
      if (url.length > 2048) {
        return reply.code(400).send({ error: 'URL too long' });
      }

      // Validate URL format
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return reply.code(400).send({ error: 'Invalid URL' });
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return reply.code(400).send({ error: 'Only http/https URLs are supported' });
      }

      // SSRF protection — resolve DNS and validate against private IP ranges
      // Returns the resolved IP so we can pin the connection to it (prevents DNS rebinding)
      const resolved = await resolveAndValidate(url);
      if (!resolved) {
        return reply.code(403).send({ error: 'Private/internal URLs are not allowed' });
      }

      // Check cache
      const cached = db.prepare('SELECT * FROM link_previews WHERE url = ?').get(url) as
        | LinkPreview
        | undefined;

      if (cached) {
        const fetchedAt = new Date(cached.fetched_at + 'Z').getTime();
        if (Date.now() - fetchedAt < CACHE_TTL_MS) {
          return {
            url: cached.url,
            title: cached.title,
            description: cached.description,
            image: cached.image,
            site_name: cached.site_name,
            favicon: cached.favicon,
          };
        }
        // Expired — delete and re-fetch
        db.prepare('DELETE FROM link_previews WHERE url = ?').run(url);
      }

      try {
        const { isYT, videoId } = isYouTubeUrl(url);

        let title: string | null = null;
        let description: string | null = null;
        let image: string | null = null;
        let siteName: string | null = null;
        let favicon: string | null = null;

        if (isYT && videoId) {
          // Use YouTube oEmbed API
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const res = await fetch(oembedUrl, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              title?: string;
              author_name?: string;
              thumbnail_url?: string;
            };
            title = data.title || null;
            siteName = data.author_name || 'YouTube';
            image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
            favicon = 'https://www.youtube.com/favicon.ico';
          }
        } else {
          // Generic URL — fetch HTML (limit to ~50KB)
          // Pin DNS to the already-validated IP to prevent DNS rebinding (TOCTOU)
          const pinnedAgent = new UndiciAgent({
            connect: {
              lookup: (_hostname: string, _options: unknown, cb: Function) => {
                cb(null, [{ address: resolved.ip, family: resolved.family }]);
              },
            },
          });

          const res = await undiciFetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            dispatcher: pinnedAgent,
          });

          if (!res.ok) {
            return reply.code(502).send({ error: 'Failed to fetch URL' });
          }

          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            return reply.code(400).send({ error: 'URL does not return HTML' });
          }

          // Read only first ~50KB
          const reader = res.body?.getReader();
          if (!reader) {
            return reply.code(502).send({ error: 'Failed to read response' });
          }

          let html = '';
          const decoder = new TextDecoder();
          const MAX_BYTES = 50 * 1024;
          let totalBytes = 0;

          while (totalBytes < MAX_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.length;
            html += decoder.decode(value, { stream: true });
          }
          reader.cancel().catch(() => {});
          pinnedAgent.close();

          title = extractMetaContent(html, 'og:title') || extractTitle(html);
          description = extractMetaContent(html, 'og:description');
          image = extractMetaContent(html, 'og:image');
          siteName = extractMetaContent(html, 'og:site_name');
          favicon = extractFavicon(html, parsed.origin);

          // Make relative image URLs absolute
          if (image && !image.startsWith('http')) {
            if (image.startsWith('//')) {
              image = 'https:' + image;
            } else if (image.startsWith('/')) {
              image = parsed.origin + image;
            }
          }
        }

        // Only cache if we got at least a title
        if (title) {
          db.prepare(
            `INSERT OR REPLACE INTO link_previews (url, title, description, image, site_name, favicon)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(url, title, description, image, siteName, favicon);
        }

        return {
          url,
          title,
          description,
          image,
          site_name: siteName,
          favicon,
        };
      } catch (err: any) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') {
          return reply.code(504).send({ error: 'URL fetch timed out' });
        }
        return reply.code(502).send({ error: 'Failed to fetch URL metadata' });
      }
    },
  );
}
