# Gemini CLI Mandates

## Branching & Deploys
- **Always ask for explicit confirmation** before committing, pushing, or tagging any changes.
- **Default Branch:** All commits and pushes must happen on the `staging` branch. Do not push to `main` unless explicitly requested.
- **Staging:** Deploys to `staging.sellserv.net` automatically on push.
- **Production (Main):** Deploys ONLY when a GitHub Release is published.
- **Merging:** To merge staging to production, use squash: `git checkout main && git merge --squash staging && git commit && git push origin main`.

## Release Procedure
- Before creating a new release or tag, always check the latest: `gh release list --limit 1` and `git tag --sort=-v:refname | head -1`.
- Tag pushes (`v*`) trigger desktop build workflows which create a draft release. Publishing this draft triggers the production web deploy.

## Commit Rules
- **No Co-Authors:** Never add `Co-Authored-By` lines to commits.
- **Explicit Confirmation:** Always obtain user approval before any git write operation.

## Technical Integrity & Quality
- **Async Safety:** Rigorously catch rejected promises and guard against unhandled rejections.
- **Data Validation:** Always validate data and guard against `undefined`/`null` before usage.
- **Architecture Compliance:** 
  - Server-scoped routes must use `/api/servers/:serverId/` prefix.
  - Global routes (Auth, DMs, User Profile, Uploads) must NOT be server-scoped.
  - DM channels have `server_id = NULL`.

