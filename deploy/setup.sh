#!/bin/bash
# SellServ Voice — Production Setup Script
# Run as root on a fresh Ubuntu 24.04 LTS / Debian 12+
# Installs Docker, configures firewall for Cloudflare-only access.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root"
    exit 1
fi

APP_DIR="/opt/voip-server"

echo "=== SellServ Voice — Production Setup ==="

# 1. System updates + swap
apt update && apt upgrade -y
apt install -y curl git unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
if ! swapon --show | grep -q /swapfile; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 2. Install Docker
curl -fsSL https://get.docker.com | sh

# 3. SSH hardening
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh || systemctl restart sshd || true

# 4. Install fail2ban
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# 5. Firewall — allow only Cloudflare IPs on ports 80/443
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp

# Cloudflare IPv4 ranges
for ip in \
    173.245.48.0/20 \
    103.21.244.0/22 \
    103.22.200.0/22 \
    103.31.4.0/22 \
    141.101.64.0/18 \
    108.162.192.0/18 \
    190.93.240.0/20 \
    188.114.96.0/20 \
    197.234.240.0/22 \
    198.41.128.0/17 \
    162.158.0.0/15 \
    104.16.0.0/13 \
    104.24.0.0/14 \
    172.64.0.0/13 \
    131.0.72.0/22; do
    ufw allow from "$ip" to any port 80,443 proto tcp
done

# Cloudflare IPv6 ranges
for ip in \
    2400:cb00::/32 \
    2606:4700::/32 \
    2803:f800::/32 \
    2405:b500::/32 \
    2405:8100::/32 \
    2a06:98c0::/29 \
    2c0f:f248::/32; do
    ufw allow from "$ip" to any port 80,443 proto tcp
done

# LiveKit ports (WebRTC — open to all)
ufw allow 7881/tcp
ufw allow 50000:50100/udp

ufw --force enable

# 6. Setup directories
mkdir -p "$APP_DIR/deploy/production"
mkdir -p -m 700 /etc/ssl/voip-server

# 7. SSL instructions
echo ""
echo "=== SSL Setup ==="
echo "1. Go to Cloudflare Dashboard > SSL/TLS > Origin Server"
echo "2. Create a certificate (or use existing) for your domain"
echo "3. Save certificate to /etc/ssl/voip-server/origin.pem"
echo "4. Save private key to /etc/ssl/voip-server/origin-key.pem"

# 8. .env setup
if [ ! -f "$APP_DIR/deploy/production/.env" ]; then
    if [ -f "$APP_DIR/deploy/production/.env.example" ]; then
        cp "$APP_DIR/deploy/production/.env.example" "$APP_DIR/deploy/production/.env"
        # Generate random secrets
        sed -i "s/^JWT_SECRET=$/JWT_SECRET=$(openssl rand -hex 32)/" "$APP_DIR/deploy/production/.env"
        sed -i "s/^DB_PASSWORD=change-me$/DB_PASSWORD=$(openssl rand -hex 16)/" "$APP_DIR/deploy/production/.env"
        sed -i "s/^SESSION_SECRET=$/SESSION_SECRET=$(openssl rand -hex 32)/" "$APP_DIR/deploy/production/.env"
        sed -i "s/^OAUTH2_CLIENT_SECRET=$/OAUTH2_CLIENT_SECRET=$(openssl rand -hex 32)/" "$APP_DIR/deploy/production/.env"
    fi
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Clone the repo:  git clone https://github.com/sellserv/voice-server.git $APP_DIR"
echo "  2. Place SSL certs in /etc/ssl/voip-server/"
echo "     - origin.pem (certificate)"
echo "     - origin-key.pem (private key)"
echo "  3. Edit .env:  nano $APP_DIR/deploy/production/.env"
echo "     - Set DOMAIN, ADMIN_DOMAIN, LIVEKIT_DOMAIN"
echo "     - Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET"
echo "     - Set ADMIN_USERS"
echo "     - Configure email, storage, billing as needed"
echo "  4. Start:  cd $APP_DIR/deploy/production && docker compose up -d"
echo "  5. Check:  docker compose ps"
echo "  6. Logs:   docker compose logs -f app"
