import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebSocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resolve } from 'path';
import { mkdirSync, readFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { config } from './config.js';
import { initSchema } from './db/schema.js';
import authRoutes from './routes/auth.js';
import channelRoutes from './routes/channels.js';
import messageRoutes from './routes/messages.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/upload.js';
import giphyRoutes from './routes/giphy.js';
import mfaRoutes from './routes/mfa.js';
import emailRoutes from './routes/email.js';
import roleRoutes from './routes/roles.js';
import pollRoutes from './routes/polls.js';
import serverSettingsRoutes from './routes/server-settings.js';
import soundboardRoutes from './routes/soundboard.js';
import customEmojiRoutes from './routes/custom-emojis.js';
import channelGroupRoutes from './routes/channelGroups.js';
import botRoutes from './routes/bots.js';
import linkPreviewRoutes from './routes/linkPreview.js';
import auditRoutes from './routes/audit.js';
import serverRoutes from './routes/servers.js';
import friendRoutes from './routes/friends.js';
import billingRoutes from './routes/billing.js';
import pushRoutes from './routes/push.js';
import channelNotificationRoutes from './routes/channelNotifications.js';
import adminAuthRoutes from './routes/adminAuth.js';
import { adminIpAllowlist } from './routes/adminAuth.js';
import { cleanupOldAuditEntries } from './audit/log.js';
import { startPendingCleanup } from './push/index.js';
import { setupWebSocket } from './ws/index.js';
import { createWorkers, setWorkerDiedCallback } from './media/worker.js';
import { clearAllRooms } from './media/signaling.js';
import { broadcast, getOnlineUsers } from './ws/index.js';
import { initEmail } from './email/sender.js';
import { cleanupExpiredCodes } from './email/codes.js';
import { initPollExpiryManager } from './media/pollExpiryManager.js';
import db from './db/connection.js';

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const app = Fastify({ logger: true, trustProxy: true });

// Plugins
await app.register(fastifyCookie);
await app.register(fastifyCors, {
  origin: (origin, cb) => {
    // Always allow desktop app origins (Electron local server on 127.0.0.1)
    if (
      !origin ||
      (origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://localhost:'))
    ) {
      return cb(null, true);
    }
    // Allow configured origins
    if (config.corsOrigins.length > 0 && config.corsOrigins.includes(origin)) {
      return cb(null, true);
    }
    // Deny all other origins
    return cb(null, false);
  },
  credentials: true,
});
await app.register(fastifyRateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (request: any) => request.user?.userId || request.ip,
  allowList: (request: any) => {
    // Skip rate limiting for WebSocket upgrades and static assets
    if (request.url === '/ws') return true;
    if (!request.url.startsWith('/api/')) return true;
    return false;
  },
});
await app.register(fastifyWebSocket, {
  options: { maxPayload: 64 * 1024 }, // 64KB max WebSocket message size
});
await app.register(fastifyMultipart, {
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max (pro limit); per-user checks enforce free tier limit
});

// IP allowlist for admin routes
app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/admin/')) {
    await adminIpAllowlist(request, reply);
  }
});

// Security headers
app.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // CSP for non-HTML responses (HTML gets nonce-based CSP via serveHtmlWithNonce)
  const contentType = reply.getHeader('content-type');
  const isHtml = typeof contentType === 'string' && contentType.includes('text/html');
  if (!isHtml) {
    const ua = request.headers['user-agent'] || '';
    if (!ua.includes('Electron')) {
      reply.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' blob: data: https://*.giphy.com https://img.youtube.com",
          "media-src 'self' blob:",
          "connect-src 'self' wss: https://api.giphy.com https://challenges.cloudflare.com https://cloudflareinsights.com",
          'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com',
          "worker-src 'self' blob:",
        ].join('; '),
      );
    }
  }
  return payload;
});

// Ensure upload dir exists
mkdirSync(config.uploadDir, { recursive: true });

await app.register(fastifyStatic, {
  root: resolve(config.uploadDir),
  prefix: '/uploads/',
  decorateReply: false,
  setHeaders: (res, path) => {
    if (/\.(jpe?g|png|gif|webp)$/i.test(path)) {
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
});

// Serve built client in production
const clientDist = resolve(import.meta.dirname, '../../client/build');
await app.register(fastifyStatic, {
  root: clientDist,
  prefix: '/',
  decorateReply: true,
  wildcard: false,
  index: false, // Disable auto-serving index.html — we handle it with nonce injection
});

// Pre-load index.html for CSP nonce injection
const indexHtmlPath = resolve(clientDist, 'index.html');
const indexHtmlTemplate = existsSync(indexHtmlPath)
  ? readFileSync(indexHtmlPath, 'utf-8')
  : '';

function serveHtmlWithNonce(request: any, reply: any) {
  const nonce = randomBytes(16).toString('base64');
  const html = indexHtmlTemplate.replace(/<script>/g, `<script nonce="${nonce}">`);

  const ua = request.headers['user-agent'] || '';
  if (!ua.includes('Electron')) {
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://www.youtube.com https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' blob: data: https://*.giphy.com https://img.youtube.com",
        "media-src 'self' blob:",
        "connect-src 'self' wss: https://api.giphy.com https://challenges.cloudflare.com https://cloudflareinsights.com",
        'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com',
        "worker-src 'self' blob:",
      ].join('; '),
    );
  }

  reply.header('Content-Type', 'text/html; charset=utf-8');
  return reply.send(html);
}

// Warn if no instance admins configured
if (config.adminUsers.length === 0) {
  console.warn('⚠ ADMIN_USERS is empty — no instance admins configured. Set ADMIN_USERS in .env to grant platform-level admin access.');
}

// Initialize database
initSchema();

// Initialize email
initEmail();

// Initialize poll expiry manager
initPollExpiryManager();

// Initialize mediasoup workers (one per CPU core, configurable via MEDIASOUP_WORKERS)
await createWorkers();
setWorkerDiedCallback(() => {
  clearAllRooms();
  broadcast({ type: 'error', message: 'Voice server restarted. Please rejoin the voice channel.' });
});

// Health check
app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Public instance info (no auth required) — used by website widget
app.get('/api/public/instance/info', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');

  const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_bot = 0').get() as any).c;
  const totalServers = (db.prepare('SELECT COUNT(*) as c FROM servers').get() as any).c;
  const totalMessages = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as any).c;
  const onlineCount = getOnlineUsers().length;

  const settings = db.prepare('SELECT allow_registration FROM instance_settings WHERE id = 1').get() as any;
  const registrationOpen = settings ? !!settings.allow_registration : true;

  return {
    totalUsers,
    totalServers,
    totalMessages,
    onlineCount,
    registrationOpen,
  };
});

// Routes
await app.register(authRoutes);
await app.register(channelRoutes);
await app.register(messageRoutes);
await app.register(userRoutes);
await app.register(adminRoutes);
await app.register(uploadRoutes);
await app.register(giphyRoutes);
await app.register(mfaRoutes);
await app.register(emailRoutes);
await app.register(roleRoutes);
await app.register(pollRoutes);
await app.register(serverSettingsRoutes);
await app.register(soundboardRoutes);
await app.register(customEmojiRoutes);
await app.register(channelGroupRoutes);
await app.register(botRoutes);
await app.register(linkPreviewRoutes);
await app.register(auditRoutes);
await app.register(serverRoutes);
await app.register(friendRoutes);
await app.register(billingRoutes);
await app.register(pushRoutes);
await app.register(channelNotificationRoutes);
await app.register(adminAuthRoutes);

// WebSocket
setupWebSocket(app);

// SPA fallback — serve index.html for non-API routes (with CSP nonce injection)
app.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Not found' });
  }
  return serveHtmlWithNonce(request, reply);
});

// Cleanup expired email codes every hour
setInterval(cleanupExpiredCodes, 60 * 60 * 1000);

// Cleanup link preview cache older than 7 days
function cleanupLinkPreviews() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM link_previews WHERE fetched_at < ?').run(cutoff);
  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} expired link preview(s)`);
  }
}
cleanupLinkPreviews();
setInterval(cleanupLinkPreviews, 24 * 60 * 60 * 1000);

// Cleanup old audit log entries at startup and every 24 hours
cleanupOldAuditEntries();
setInterval(cleanupOldAuditEntries, 24 * 60 * 60 * 1000);

// Start
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Voice Server running on http://${config.host}:${config.port}`);
  startPendingCleanup();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
