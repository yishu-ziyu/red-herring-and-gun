#!/usr/bin/env bash
set -euo pipefail

CONF=/etc/nginx/conf.d/red-herring.conf
BACKUP="${CONF}.bak-$(date +%Y%m%d-%H%M%S)"

if [ ! -d /opt/red-herring/dist ]; then
  echo "Missing frontend dist: /opt/red-herring/dist" >&2
  exit 1
fi

if [ ! -f /etc/letsencrypt/live/gun.yishuziyu.cn/fullchain.pem ]; then
  echo "Missing certificate: /etc/letsencrypt/live/gun.yishuziyu.cn/fullchain.pem" >&2
  exit 1
fi

cp "$CONF" "$BACKUP"
cat >"$CONF" <<'NGINX'
server {
    listen 443 ssl;
    server_name gun.yishuziyu.cn;

    ssl_certificate /etc/letsencrypt/live/gun.yishuziyu.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gun.yishuziyu.cn/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /opt/red-herring/dist;
    index index.html;
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
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name gun.yishuziyu.cn;
    return 301 https://$host$request_uri;
}
NGINX

nginx -t
systemctl reload nginx

echo "Updated $CONF"
echo "Backup: $BACKUP"
