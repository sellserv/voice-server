<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="SellServ Voice">
</p>

<h1 align="center">SellServ Voice</h1>

<p align="center">A multi-server voice and text chat platform — join the public instance or self-host your own.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0"></a>
  <a href="https://ko-fi.com/sellserv"><img src="https://img.shields.io/badge/Ko--fi-Support%20this%20project-FF5E5B?logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
</p>

Features real-time messaging, WebRTC voice/video calls, screen sharing, synchronized YouTube watching, a soundboard, custom emojis, a voice changer, polls, automod, and a role-based permission system — all running on a single server.

## Features

### Communication

- **Text Chat** — Real-time messaging via WebSocket, message editing/deletion, typing indicators, cursor-based pagination, message replies, emoji reactions, link previews with OG metadata, full-text search (FTS5), message pinning
- **Voice Chat** — WebRTC audio via mediasoup SFU, voice activity detection (VAD) with configurable sensitivity, push-to-talk (PTT) with custom keybind, speaking indicators, per-user volume control, mute/deafen
- **Video Calls** — 1-on-1 video calls with webcam support, accept with video or audio only, camera toggle during calls, local PiP preview
- **Screen Sharing** — Share your screen to a voice channel with a fullscreen viewer
- **Direct Messages** — Private 1-on-1 DM channels with voice and video call support
- **Calling** — Initiate, accept, reject, and end 1-on-1 calls with ring notifications, missed call tracking
- **Friends System** — Add friends, manage pending requests, and block users. See online status and mutual servers.
- **Polls** — Create polls in chat channels with real-time voting, multiple choice support, auto-expiry with winner announcements, manual close by creator

### Apps

- **Watch Together** — Synchronized YouTube watching in voice channels with host control, video queue, playback sync with RTT compensation, viewer tracking, and host transfer
- **Soundboard** — Upload short audio clips (max 7s) and play them in voice channels for all peers to hear
- **Voice Changer** — Real-time audio effects via Web Audio API with 6 presets: Deep, Chipmunk, Robot, Echo, Radio, Whisper

### Server Management

- **Multi-Server** — Users can create and join multiple servers, each with independent channels, roles, bots, and settings
- **Roles & Permissions** — 25 granular permissions with per-channel and per-group overrides (view, send, upload, react, emoji, manage messages, pin, connect voice, speak, screen share)
- **Channel Groups** — Organize channels into collapsible groups with group-level permission overrides. Precise reordering via drag-and-drop or **Context Menu "Move"** tool.
- **AFK Channels** — Automatically move inactive voice users to a designated AFK channel after a configurable timeout
- **Custom Emojis** — Upload and use custom emojis in chat and reactions (per-server, up to 50)
- **Bots** — Welcome bot with custom greeting and DM support, Automod bot with blocked word filtering (delete/warn/both) and admin immunity
- **Server Bans** — Ban/unban users with optional reasons and ban history
- **Admin Tools** — Invite codes (with expiry and max uses), server name/icon customization, app toggling, audit log
- **Instance Admin** — Global admin panel for managing all servers, users, and instance-wide settings
- **GIF Picker** — Search and send GIFs via Giphy API
- **Message Reporting** — Users can report problematic messages; Instance Admins can review and resolve reports via the global dashboard

### Security

- **MFA** — Email-based MFA (default) or TOTP via authenticator app with QR code setup
- **Password Policy** — 15-72 character passwords, 90-day expiry, bcrypt with 10 salt rounds
- **Account Lockout** — Locks after 5 failed login attempts, requires MFA to unlock
- **Email Verification** — Required before first login, 6-digit codes with 10-minute expiry
- **Session Management** — JWT with session tracking, CSRF double-submit tokens, password-change invalidation
- **Rate Limiting** — Auth endpoints (10/15min), WebSocket (15msg/s global + per-event limits), API routes (10r/s via nginx)
- **SSRF Protection** — DNS resolution before fetch with private/internal IP blocking (including cloud metadata 169.254.x.x)
- **Upload Security** — MIME + extension allowlist, path traversal prevention, daily per-user and total disk quotas
- **CAPTCHA** — Optional Cloudflare Turnstile integration on registration to prevent automated signups

### Client

- **Desktop App** — Native desktop app via Electron (macOS, Windows, Linux) with auto-updates via GitHub Releases
- **Microsoft Store** — APPX build target for Windows Store distribution
- **Cinematic Login** — Premium, interactive entry experience with mouse-parallax stellar background and technical system pulse indicator
- **Themes** — Midnight Blue (default), Dark, Light with glassmorphism UI
- **Noise Suppression** — RNNoise-based noise suppression via WebAssembly
- **Responsive** — Mobile-friendly with hamburger menus at 768px breakpoint
- **Notification Sounds** — Synthesized join/leave/message/ring sounds via Web Audio oscillators
- **Idle Detection** — Auto-sets status to idle after 5 minutes of inactivity
- **Presence** — Online, idle, do not disturb, and invisible statuses
- **Home Notifications** — Unread badge on Home button for DMs and server invitations
- **Profile Banners** — Customize your server profile with uploaded banners or GIFs

## Tech Stack

| Layer             | Technology                    |
| ----------------- | ----------------------------- |
| Runtime           | Node.js 22                    |
| HTTP Server       | Fastify 5                     |
| Frontend          | SvelteKit + Svelte 5          |
| Build Tool        | Vite 6                        |
| Database          | SQLite via better-sqlite3 + FTS5 |
| Voice/Video       | mediasoup 3.15 (WebRTC SFU)   |
| Auth              | bcrypt + JWT + otpauth (TOTP) |
| Email             | Resend API                    |
| Desktop           | Electron + electron-builder   |
| Noise Suppression | RNNoise (WebAssembly)         |
| Reverse Proxy     | nginx                         |

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Generate a secure JWT secret
sed -i "s/change-me-to-a-random-string/$(openssl rand -hex 32)/" .env

# Set your public IP for WebRTC (use 127.0.0.1 for local dev)
# Set CORS_ORIGINS to your frontend URL (e.g. http://localhost:5173 for dev)
nano .env

# Run dev mode (server + client with hot reload)
npm run dev
```

The first user to register becomes the instance admin automatically in dev mode.

### Production Quick Start

```bash
# Same as above, plus:

# Set MEDIASOUP_ANNOUNCED_IP to your server's public IP
# Set CORS_ORIGINS to https://your-domain.com
# Set RESEND_API_KEY and EMAIL_FROM for email (required in production)
# Set ADMIN_USERS to your username for instance admin access

# Build the client
npm run build

# Start production server
npm run start
```

See the [Deployment](#deployment-ubuntu-2404-lts-recommended--debian-12) section for full production setup with nginx, SSL, and systemd.

## Deployment (Ubuntu 24.04 LTS recommended / Debian 12+)

### What the Setup Script Does

The setup script (`deploy/setup.sh`) configures a fresh server with:

1. System updates + 1GB swap + automatic security updates (`unattended-upgrades`)
2. Node.js 22 via NodeSource
3. Build tools (`build-essential`, `python3`) for native module compilation
4. nginx as a reverse proxy
5. UFW firewall (SSH, HTTP, HTTPS, WebRTC UDP ports)
6. SSH hardening (password auth disabled, root login restricted to key-only)
7. fail2ban for brute-force protection
8. Dedicated `voip-server` system user
9. `.env` with auto-generated JWT secret and setup token, localhost binding, and production CORS
10. SSL certificate directory with restricted permissions (700)
11. nginx config with Cloudflare IP allowlist, security headers, TLS hardening, and rate limiting
12. systemd service with full sandboxing (syscall filters, capability restrictions, resource limits)

### Installation

```bash
# Clone to your server
git clone https://github.com/sellserv/voice-server.git /opt/voip-server
cd /opt/voip-server

# Review and run the setup script
# IMPORTANT: Edit DOMAIN at the top of the script first
sudo bash deploy/setup.sh

# Edit your config
nano .env
# Set MEDIASOUP_ANNOUNCED_IP to your server's public IP
# Set CORS_ORIGINS to https://your-domain.com

# Install, build, and start
npm ci --omit=dev
npm run build
sudo systemctl start voip-server
```

### Configuring the .env File

After running the setup script, your `.env` file is at `/opt/voip-server/.env`. The setup script auto-generates a JWT secret and sets production defaults. You still need to configure a few things:

```bash
nano /opt/voip-server/.env
```

**Required changes:**

```env
# Set to your server's public IP — required for WebRTC voice to work
MEDIASOUP_ANNOUNCED_IP=203.0.113.50

# Set to your domain
CORS_ORIGINS=https://your-domain.com
```

**Optional but recommended:**

```env
# Email (required for login — MFA codes are sent via email)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=noreply@your-domain.com

# GIF picker
GIPHY_API_KEY=your-giphy-api-key
```

After editing, restart the service:

```bash
sudo systemctl restart voip-server
```

### Admin Setup

Instance admins are configured via the `ADMIN_USERS` environment variable — a comma-separated list of usernames that have full platform control (manage all servers, users, and instance settings).

1. Register an account at your server URL
2. Verify your email
3. Add your username to `ADMIN_USERS` in `.env`:
   ```env
   ADMIN_USERS=yourusername
   ```
4. Restart the server — your account now has instance admin access
5. Create invite codes from the admin panel to let others join

### Email Setup (Resend)

Email is **required in production** for MFA login codes, email verification, password resets, and account lockout notifications. Without it, the server will refuse to start in production mode.

1. Create an account at [resend.com](https://resend.com)
2. Add and verify your domain under **Domains** (requires adding DNS records)
3. Create an API key under **API Keys**
4. Add to your `.env`:
   ```env
   RESEND_API_KEY=re_xxxxxxxxxxxx
   EMAIL_FROM=noreply@your-domain.com
   ```

The `EMAIL_FROM` address must use the domain you verified in Resend. For example, if you verified `example.com`, use `noreply@example.com`.

**Emails sent by the server:**
| Email | When | Code Expiry |
|-------|------|-------------|
| Email verification | On registration and email change | 10 minutes |
| MFA login code | On every login (if using email MFA) | 5 minutes |
| Password reset code | On forgot password request | 5 minutes |
| Account locked | After 5 failed login attempts | 10 minutes |

### Cloudflare Setup

1. Point your domain to your server's IP with **Proxy ON** (orange cloud)
2. Go to **SSL/TLS > Origin Server** and create an Origin Certificate for your domain
3. Save the certificate to `/etc/ssl/voip-server/origin.pem`
4. Save the private key to `/etc/ssl/voip-server/origin-key.pem`
5. Set SSL/TLS mode to **Full (strict)**

### Auto-Deploy from GitHub

Pushes to `main` automatically deploy to your server via GitHub Actions. The workflow:

- Pulls latest code
- Installs dependencies with `npm ci --omit=dev` (deterministic, lockfile-based)
- Builds the client
- Restarts the service
- Runs a health check to verify the deploy succeeded

**Setup:**

1. Create a deploy user on your server:

   ```bash
   sudo useradd -m -s /bin/bash deploy
   sudo usermod -aG voip-server deploy
   echo 'deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart voip-server' | sudo tee /etc/sudoers.d/voip-server-deploy
   ```

2. Generate an SSH key pair and copy the public key to your server:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/voip-server-deploy -N ""
   ssh-copy-id -i ~/.ssh/voip-server-deploy.pub deploy@your-server-ip
   ```

3. Add these **repository secrets** in GitHub (Settings > Secrets > Actions):

   | Secret           | Value                                                     |
   | ---------------- | --------------------------------------------------------- |
   | `DEPLOY_HOST`    | Your server's IP address                                  |
   | `DEPLOY_USER`    | `deploy`                                                  |
   | `DEPLOY_SSH_KEY` | Contents of the private key (`~/.ssh/voip-server-deploy`) |

4. Ensure the repo is cloned at `/opt/voip-server` and the deploy user has read access to it.

### Firewall Ports

| Port        | Protocol | Purpose                      |
| ----------- | -------- | ---------------------------- |
| 22          | TCP      | SSH                          |
| 80          | TCP      | HTTP (redirects to HTTPS)    |
| 443         | TCP      | HTTPS                        |
| 40000-40100 | UDP      | WebRTC media (mediasoup RTP) |

### systemd Service Hardening

The service runs with extensive sandboxing:

- `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`
- Kernel protection: `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`
- Device isolation: `PrivateDevices`, `DevicePolicy=closed`
- Capability restrictions: `CapabilityBoundingSet=` (empty — no capabilities)
- Syscall filtering: `SystemCallFilter=@system-service`, `SystemCallArchitectures=native`
- Namespace restrictions: `RestrictNamespaces`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK`
- Resource limits: 65535 open files, 512MB memory max, 256 tasks max
- Read-write access limited to `data/` and `uploads/` only

### nginx Security

- Cloudflare-only IP allowlist with `deny all`
- TLS 1.2/1.3 with modern ECDHE cipher suites and X25519/secp384r1 curves
- Session tickets disabled for forward secrecy
- Security headers: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy
- API rate limiting (10r/s with burst 20)
- Uploaded files served with `Content-Disposition: attachment`
- Server version hidden (`server_tokens off`)

## Project Structure

```
├── shared/              # Shared TypeScript types
├── server/src/
│   ├── auth/            # bcrypt, JWT, middleware, role permissions, sessions
│   ├── bots/            # Bot engine (welcome, automod)
│   ├── db/              # SQLite connection, schema (30+ tables + FTS5)
│   ├── email/           # Resend integration, templates, verification codes
│   ├── media/           # mediasoup worker, VoiceRoom, WebRTC signaling, poll expiry, AFK manager
│   ├── routes/          # REST API endpoints (20 route files)
│   └── ws/              # WebSocket server (connection, auth, rate limiting, presence, handlers)
├── client/src/
│   ├── lib/
│   │   ├── components/  # ~50 Svelte components
│   │   ├── stores/      # 18 Svelte stores (auth, channels, messages, media, video, call, etc.)
│   │   ├── api.ts       # HTTP client
│   │   ├── ws.ts        # WebSocket client with auto-reconnect and heartbeat
│   │   ├── webrtc.ts    # mediasoup-client integration (audio + video)
│   │   ├── voiceChanger.ts  # Web Audio pitch shifter worklet
│   │   └── sounds.ts    # Synthesized notification sounds
│   └── routes/          # SvelteKit pages
├── desktop/             # Electron desktop app (macOS, Windows, Linux)
│   ├── main.js          # Main process
│   ├── preload.js       # Preload script
│   └── package.json     # Electron-builder config (NSIS + APPX targets)
└── deploy/              # Deployment configs
    ├── setup.sh             # Server setup script
    ├── nginx.conf           # Reverse proxy config
    └── voip-server.service  # systemd unit
```

## Environment Variables

| Variable                    | Default               | Description                                                                                                                            |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | 3000                  | Server port                                                                                                                            |
| `HOST`                      | 127.0.0.1             | Bind address (localhost since nginx is the reverse proxy)                                                                              |
| `JWT_SECRET`                | —                     | **Required.** Generate with `openssl rand -hex 32`                                                                                     |
| `CORS_ORIGINS`              | —                     | Comma-separated allowed origins (e.g. `https://your-domain.com`)                                                                       |
| `MEDIASOUP_ANNOUNCED_IP`    | 127.0.0.1             | **Set to your server's public IP** for WebRTC                                                                                          |
| `MEDIASOUP_MIN_PORT`        | 40000                 | WebRTC UDP port range start                                                                                                            |
| `MEDIASOUP_MAX_PORT`        | 40100                 | WebRTC UDP port range end                                                                                                              |
| `DB_PATH`                   | ./data/voip-server.db | SQLite database path                                                                                                                   |
| `UPLOAD_DIR`                | ./uploads             | File upload directory                                                                                                                  |
| `MAX_FILE_SIZE`             | 20 MB                 | Per-file upload limit                                                                                                                  |
| `MAX_DAILY_UPLOAD_PER_USER` | 100 MB                | Daily per-user upload limit                                                                                                            |
| `MAX_TOTAL_DISK`            | 5 GB                  | Total upload storage limit                                                                                                             |
| `RESEND_API_KEY`            | —                     | Resend.com API key for emails (required in production)                                                                                 |
| `EMAIL_FROM`                | noreply@example.com   | From address for emails                                                                                                                |
| `GIPHY_API_KEY`             | —                     | Giphy API key (GIF picker disabled without it)                                                                                         |
| `TURNSTILE_SITE_KEY`        | —                     | Cloudflare Turnstile site key (CAPTCHA disabled without it)                                                                            |
| `TURNSTILE_SECRET_KEY`      | —                     | Cloudflare Turnstile secret key                                                                                                        |
| `ADMIN_USERS`               | —                     | Comma-separated usernames with instance-admin access                                                                                   |

## Voice Configuration

| Setting              | Value                                                           |
| -------------------- | --------------------------------------------------------------- |
| Audio codec          | Opus, 48kHz, stereo, FEC enabled                                |
| Client bitrate       | 128kbps                                                         |
| Video codecs         | VP8, VP9 (profile 2)                                            |
| Transport protocol   | UDP preferred, TCP fallback                                     |
| Initial bitrate      | 600kbps                                                         |
| Speaking detection   | RMS energy analysis, -70dB to -20dB threshold range, 250ms hold |
| Audio level observer | 10 entries max, -60dB threshold, 50ms interval                  |
| Noise suppression    | RNNoise (WebAssembly)                                           |

## Database

SQLite with WAL mode, normal synchronous, and foreign keys enabled. Key tables:

| Table                          | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `users`                        | User accounts, auth, profiles, MFA, ban status         |
| `servers`                      | Server (guild) metadata, owner                         |
| `server_members`               | User-server membership                                 |
| `server_bans`                  | Server ban records with reasons                        |
| `server_invitations`           | Server join invitations                                |
| `channels`                     | Text, voice, and DM channels                           |
| `channel_groups`               | Channel grouping/categories                            |
| `messages`                     | Chat messages with replies, pins, file attachments     |
| `messages_fts`                 | FTS5 full-text search index (auto-synced via triggers) |
| `files`                        | Uploaded files                                         |
| `reactions`                    | Emoji reactions on messages                            |
| `roles`                        | Named roles with JSON permission blobs                 |
| `user_roles`                   | User-role assignments (many-to-many)                   |
| `channel_permission_overrides` | Per-channel permission overrides for roles/users       |
| `group_permission_overrides`   | Per-group permission overrides for roles/users         |
| `polls`                        | Chat polls with expiry and multi-choice                |
| `poll_options`                 | Poll answer options                                    |
| `poll_votes`                   | User votes on poll options                             |
| `invite_codes`                 | Registration invite codes                              |
| `email_codes`                  | Verification, MFA, and password reset codes            |
| `auth_sessions`                | Active JWT sessions                                    |
| `instance_settings`            | Instance-wide admin settings                           |
| `server_settings`              | Per-server name, icon, enabled apps                    |
| `soundboard_sounds`            | Soundboard audio clips                                 |
| `custom_emojis`                | Custom emoji images (per-server)                       |
| `bots`                         | Bot configuration (welcome, automod)                   |
| `audit_log`                    | Server action audit trail                              |
| `link_previews`                | Cached URL metadata (24h TTL, 7-day cleanup)           |
| `dm_participants`              | DM channel membership                                  |

## Background Jobs

| Job                  | Interval | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| Email code cleanup   | 1 hour   | Deletes expired verification/MFA/reset codes |
| Link preview cleanup | 24 hours | Deletes cached previews older than 7 days    |
| Poll expiry check    | 1 minute | Closes expired polls, announces winners      |

## Allowed Upload Types

Images: `jpg`, `jpeg`, `png`, `gif`, `webp`
Audio: `mp3`, `ogg`, `wav`, `webm`
Video: `mp4`, `webm`
Documents: `pdf`, `txt`, `csv`, `md`

## Resource Usage

Designed for a 1GB server serving 10-15 users:

| Component        | Memory          |
| ---------------- | --------------- |
| Node.js          | ~100 MB         |
| mediasoup worker | ~40 MB          |
| OS + nginx       | ~150 MB         |
| SQLite           | ~10 MB          |
| **Total**        | **~300-350 MB** |

Add 1GB swap as a safety net. The systemd service enforces a 512MB memory cap.

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE).
