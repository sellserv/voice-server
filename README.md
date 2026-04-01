<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="SellServ Voice">
</p>

<h1 align="center">SellServ Voice</h1>

<p align="center">A multi-server voice and text chat platform — join the public instance or self-host your own.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0"></a>
  <a href="https://ko-fi.com/sellserv"><img src="https://img.shields.io/badge/Ko--fi-Support%20this%20project-FF5E5B?logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
</p>

> [!CAUTION]
> Hey there! This is a solo developer side project currently in alpha. Development happens in my free time, so expect rough edges, breaking changes, and periods of inactivity. Thanks for checking it out! If you run into bugs, please open an issue or reach out at support@sellserv.net.

## Features

### Communication

- **Text Chat** — Real-time messaging, editing/deletion, typing indicators, replies, emoji reactions, link previews, full-text search, message pinning
- **Voice Chat** — WebRTC audio via mediasoup or LiveKit SFU, voice activity detection (VAD), push-to-talk (PTT), speaking indicators, per-user volume control
- **Video Calls** — 1-on-1 video calls with webcam support, accept with video or audio only, camera toggle
- **Screen Sharing** — Share your screen to a voice channel with a fullscreen viewer
- **Direct Messages** — Private 1-on-1 DM channels with voice and video call support
- **Friends System** — Add friends, manage requests, block users, see online status
- **Polls** — Create polls with real-time voting, multiple choice, auto-expiry, winner announcements

### Apps

- **Watch Together** — Synchronized YouTube watching in voice channels with host control and video queue
- **Soundboard** — Upload short audio clips and play them in voice channels
- **Voice Changer** — Real-time audio effects with 6 presets: Deep, Chipmunk, Robot, Echo, Radio, Whisper (works on both mediasoup and LiveKit backends)

### Server Management

- **Multi-Server** — Create and join multiple servers, each with independent channels, roles, and settings
- **Roles & Permissions** — 25 granular permissions with per-channel and per-group overrides
- **Channel Groups** — Organize channels into collapsible groups with group-level permissions
- **AFK Channels** — Auto-move inactive voice users after a configurable timeout
- **Custom Emojis** — Upload and use custom emojis per server
- **Bots** — Welcome bot with custom greetings, Automod with blocked word filtering
- **Server Bans** — Ban/unban users with reasons and ban history
- **Instance Admin** — Global admin panel for managing all servers, users, and instance settings
- **GIF Picker** — Search and send GIFs via Giphy API
- **Message Reporting** — Users can report messages; admins can review and resolve

### Security

- **MFA** — Email-based (default) or TOTP via authenticator app
- **Password Policy** — 15-72 characters, 90-day expiry, bcrypt hashing
- **Account Lockout** — Locks after 5 failed attempts, MFA required to unlock
- **Email Verification** — Required before first login
- **Session Management** — JWT with session tracking, CSRF tokens, password-change invalidation
- **Rate Limiting** — Auth endpoints, WebSocket, and API routes
- **SSRF Protection** — DNS validation with private IP blocking
- **Upload Security** — MIME + extension allowlist, path traversal prevention, disk quotas
- **CAPTCHA** — Optional Cloudflare Turnstile on registration

### Client

- **Desktop App** — Electron (macOS, Windows, Linux) with auto-updates
- **Microsoft Store** — Available as an APPX package
- **Mobile App** — Android via Capacitor with push notifications
- **Themes** — Default, Midnight, Dark, Light
- **Noise Suppression** — RNNoise via WebAssembly (works on both mediasoup and LiveKit backends)
- **Game Activity** — Detects and displays currently playing games
- **Inline Video** — Play YouTube, Twitch, and Vimeo links directly in chat

## Tech Stack

SellServ Voice runs in two modes from the same codebase — a simple self-hosted setup or a scaled production deployment.

### Self-Hosted

Single container, zero external dependencies. Everything just works.

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| HTTP Server | Fastify 5 |
| Frontend | SvelteKit + Svelte 5 |
| Database | SQLite via better-sqlite3 + FTS5 |
| Voice/Video | mediasoup 3.15 (WebRTC SFU) |
| File Storage | Local disk |
| Reverse Proxy | Caddy (automatic Let's Encrypt TLS) |
| Auth | bcrypt + JWT + otpauth (TOTP) |
| Desktop | Electron + electron-builder |
| Mobile | Capacitor (Android) |

### Production

Multi-container deployment for scaling to thousands of users. Same Docker image, activated via environment variables.

| Layer | Technology |
|---|---|
| Database | PostgreSQL 17 with connection pooling |
| Cache / Pub/Sub | Valkey (Redis-compatible) |
| Voice/Video | LiveKit (WebRTC SFU) with E2EE |
| File Storage | S3-compatible (Cloudflare R2) with CDN |
| Reverse Proxy | Caddy (Cloudflare origin certs) |

> Both modes use the same adapter layer. Self-hosters get the simple stack by default. Production features activate when their env vars are set (e.g., `DB_TYPE=postgres`, `REDIS_URL`, `VOICE_TYPE=livekit`, `STORAGE_TYPE=s3`).

## Self-Hosting

### Quick Start

```bash
git clone https://github.com/sellserv/voice-server.git
cd voice-server/deploy/self-hosted
cp .env.example .env
# Edit .env — set JWT_SECRET and DOMAIN
docker compose up -d
```

This starts 2 containers (Caddy + app) with automatic HTTPS via Let's Encrypt.

### Production Deployment

```bash
cd deploy/production
cp .env.example .env
# Edit .env — configure PostgreSQL, Valkey, LiveKit, S3/R2 credentials
docker compose up -d
```

This starts 6 containers: Caddy, app, admin-console, PostgreSQL, Valkey, and LiveKit.

### Development

```bash
pnpm install
pnpm run dev        # starts server + client concurrently
pnpm run dev:server # server only (tsx watch)
pnpm run dev:client # client only (Vite on :5173)
pnpm test           # run all tests (Vitest)
```

For full guides, visit the **[Documentation](https://info.sellserv.net/docs.html)**.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
