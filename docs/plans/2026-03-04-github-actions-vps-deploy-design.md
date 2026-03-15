# GitHub Actions VPS Deployment Setup

## Summary

Set up GitHub Actions to auto-deploy the VoIP server to a new VPS on push to `main`. Improves the existing workflow with npm caching, zero-downtime deploys, and concurrency control.

## Workflow Improvements

- **Concurrency control**: `concurrency.group: deploy` prevents overlapping deploys
- **Timeouts**: 10-minute workflow timeout + 8-minute SSH command timeout
- **npm ci caching**: Skips `npm ci` when `package-lock.json` hash hasn't changed (saves ~30s per deploy)
- **Zero-downtime**: Build completes before service restart; if build fails, service keeps running
- **Data protection**: `git clean` excludes `.env`, `uploads/`, and `data/` (SQLite DB)

## VPS Setup Steps

### 1. Generate Deploy SSH Key

On your local machine:

```bash
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/deploy_voip -N ""
```

### 2. Add Public Key to VPS

SSH into your VPS as the deploy user:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "CONTENTS_OF_deploy_voip.pub" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. Allow Passwordless Service Restart

On VPS as root:

```bash
echo "DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart voip-server" | sudo tee /etc/sudoers.d/voip-deploy
```

Replace `DEPLOY_USER` with the actual username.

### 4. Configure GitHub Secrets

In your GitHub repo: Settings > Secrets and variables > Actions > New repository secret

| Secret           | Value                                          |
| ---------------- | ---------------------------------------------- |
| `DEPLOY_HOST`    | Your VPS IP address                            |
| `DEPLOY_USER`    | SSH username on the VPS                        |
| `DEPLOY_SSH_KEY` | Contents of `~/.ssh/deploy_voip` (private key) |

### 5. Add .last-lock-hash to .gitignore

```bash
echo ".last-lock-hash" >> .gitignore
```

### 6. Test

Push to `main` and check the Actions tab in GitHub. The workflow should SSH in, pull, build, restart, and health-check.
