#!/usr/bin/env bash
# Route bare-IP /api and /health to red-herring API; leave other IP paths for bb-roleplay.
set -euo pipefail

ALIYUN_HOST="${ALIYUN_HOST:-}"
if [ -z "$ALIYUN_HOST" ]; then
  echo "Set ALIYUN_HOST"
  exit 1
fi

CONF=/etc/nginx/conf.d/red-herring-ip-api.conf
BACKUP="${CONF}.bak-$(date +%Y%m%d-%H%M%S)"

if [ -f "$CONF" ]; then
  cp "$CONF" "$BACKUP"
fi

cat >"$CONF" <<NGINX
server {
    listen 80;
    server_name ${ALIYUN_HOST};

    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
NGINX

nginx -t
systemctl reload nginx
echo "Updated $CONF"
