# Open Registration + Safeguards Design

**Goal:** Allow account creation without invite codes, protected by Cloudflare Turnstile CAPTCHA and a 1-hour new-user cooldown on DMs and uploads.

## 1. Open Registration

- Remove the invite code requirement from registration for non-admin users
- If an invite code IS provided, still join the associated server (existing behavior preserved)
- Users who register without an invite code can join servers later via `POST /api/servers/join`
- First-user admin flow (setup token) unchanged

## 2. Cloudflare Turnstile CAPTCHA

- New env vars: `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`
- Server verifies Turnstile token on registration via `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Client loads Turnstile script and renders widget in registration form
- Graceful: if keys not configured, CAPTCHA is skipped (dev/self-hosting flexibility)
- Server passes site key to client via enhanced `GET /api/auth/setup-status` response

## 3. New User Cooldown (1 hour)

- Uses existing `created_at` column — no DB schema changes
- Blocks DM creation (`dm:open` WebSocket event) for accounts < 1 hour old
- Blocks file uploads (`POST /api/upload`) for accounts < 1 hour old
- Admin role bypasses cooldown
- Clear error messages with time remaining
