#!/usr/bin/env bash
# Route bare-IP /api and /health to red-herring API; leave other IP paths for bb-roleplay.
set -euo pipefail

CONF=/etc/nginx/conf.d/red-herring-ip-api.conf
BACKUP="${CONF}.bak-$(date +%Y%m%d-%H%M%S)"

if [ -f "$CONF" ]; then
  cp "$CONF" "$BACKUP"
fi

cat >"$CONF" <<'NGINX'
server {
    listen 80;
    server_name 121.89.90.68;

    client_max_body_size 20m;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
NGINX

nginx -t
systemctl reload nginx
echo "Updated $CONF"
