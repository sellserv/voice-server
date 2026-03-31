#!/bin/bash
# Voice Server — Setup Script
# Run as root on a fresh Ubuntu 24.04 LTS (recommended) / Debian 12+
# Review and adapt before running!

set -euo pipefail

# Must be run as root
if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root"
    exit 1
fi

DOMAIN="your-domain.com"
APP_DIR="/opt/voip-server"

echo "=== Voice Server Setup ==="

# 1. System updates + swap + automatic security updates
apt update && apt upgrade -y
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
if ! swapon --show | grep -q /swapfile; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. Install Node.js 22 (download script first, then execute)
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
rm -f /tmp/nodesource_setup.sh
apt install -y nodejs

# 3. Install build tools (needed for mediasoup/bcrypt native modules)
apt install -y build-essential python3

# 4. Install nginx
apt install -y nginx

# 5. Firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 40000:40100/udp  # mediasoup RTP
ufw --force enable

# 6. SSH hardening
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd || true

# 7. Install fail2ban
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# 8. Create app user
useradd -r -m -d "$APP_DIR" -s /bin/false voip-server || true

# 9. Setup directories
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads"

# 10. Install pnpm and dependencies & build
npm install -g pnpm
cd "$APP_DIR"
pnpm install --frozen-lockfile
pnpm run build

# 11. Set ownership
chown -R voip-server:voip-server "$APP_DIR"

# 12. Create .env from example
if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    # Generate random JWT secret
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "0,/change-me-to-a-random-string/s/change-me-to-a-random-string/$JWT_SECRET/" "$APP_DIR/.env"
    # Generate random setup token for first admin registration
    SETUP_TOKEN=$(openssl rand -hex 32)
    sed -i "s/change-me-to-a-random-string/$SETUP_TOKEN/" "$APP_DIR/.env"
    # Bind to localhost only (nginx is the reverse proxy)
    sed -i "s/HOST=0.0.0.0/HOST=127.0.0.1/" "$APP_DIR/.env"
    # Set CORS origins
    sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN|" "$APP_DIR/.env"
else
    # .env already exists — regenerate secrets if still placeholders
    if grep -q "change-me-to-a-random-string" "$APP_DIR/.env"; then
        JWT_SECRET=$(openssl rand -hex 32)
        sed -i "0,/change-me-to-a-random-string/s/change-me-to-a-random-string/$JWT_SECRET/" "$APP_DIR/.env"
        SETUP_TOKEN=$(openssl rand -hex 32)
        sed -i "s/change-me-to-a-random-string/$SETUP_TOKEN/" "$APP_DIR/.env"
    fi
    sed -i "s/HOST=0.0.0.0/HOST=127.0.0.1/" "$APP_DIR/.env"
    sed -i "s|CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN|" "$APP_DIR/.env"
fi

# Read the setup token from .env so we can print it
SETUP_TOKEN=$(grep '^SETUP_TOKEN=' "$APP_DIR/.env" | cut -d'=' -f2)

echo ""
echo "=== IMPORTANT: Edit .env ==="
echo "nano $APP_DIR/.env"
echo "Set MEDIASOUP_ANNOUNCED_IP to your server's public IP"
echo ""

# 13. SSL directory
echo "=== SSL Setup ==="
echo "1. Go to Cloudflare Dashboard > SSL/TLS > Origin Server"
echo "2. Create a certificate for $DOMAIN"
echo "3. Save the certificate to /etc/ssl/voip-server/origin.pem"
echo "4. Save the private key to /etc/ssl/voip-server/origin-key.pem"
mkdir -p -m 700 /etc/ssl/voip-server

# 14. nginx config
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/voip-server
sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/sites-available/voip-server
ln -sf /etc/nginx/sites-available/voip-server /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx config — warn but don't fail if SSL certs aren't in place yet
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "nginx configured and reloaded."
else
    echo ""
    echo "WARNING: nginx config test failed (likely missing SSL certs)."
    echo "After placing your SSL certs, run: nginx -t && systemctl reload nginx"
fi

# 15. systemd service
cp "$APP_DIR/deploy/voip-server.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable voip-server

# Don't start the service yet — .env needs to be configured first
echo ""
echo "=== Setup Complete ==="
echo ""
echo "SETUP TOKEN: $SETUP_TOKEN"
echo "(Use this when registering the first admin account)"
echo ""
echo "Next steps:"
echo "  1. Edit .env:  nano $APP_DIR/.env"
echo "     - Set MEDIASOUP_ANNOUNCED_IP to your server's public IP"
echo "     - Set RESEND_API_KEY if you want email verification/MFA"
echo "  2. Place SSL certs in /etc/ssl/voip-server/"
echo "     - origin.pem (certificate)"
echo "     - origin-key.pem (private key)"
echo "  3. Reload nginx:  nginx -t && systemctl reload nginx"
echo "  4. Start the server:  systemctl start voip-server"
echo "  5. Check status:  systemctl status voip-server"
echo "  6. View logs:  journalctl -u voip-server -f"
