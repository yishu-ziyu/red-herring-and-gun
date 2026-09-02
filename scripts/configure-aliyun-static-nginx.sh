#!/usr/bin/env bash
# Write the live domain vhost for gun.yishuziyu.cn.
# NGINX_CONF_OUT: dump the conf the script would write and exit (no /etc, no reload).
set -euo pipefail

CONF=/etc/nginx/conf.d/red-herring.conf

emit_conf() {
  cat <<'NGINX'
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

    # SSE: must not buffer. Otherwise nginx dumps the whole stream at the end.
    location /api/agent/orchestrate-stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        gzip off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    # Permanent reports: Express, not the SPA try_files fallback.
    location /r/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
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
}

if [ -n "${NGINX_CONF_OUT:-}" ]; then
  emit_conf >"$NGINX_CONF_OUT"
  echo "Wrote $NGINX_CONF_OUT"
  exit 0
fi

if [ ! -d /opt/red-herring/dist ]; then
  echo "Missing frontend dist: /opt/red-herring/dist" >&2
  exit 1
fi

if [ ! -f /etc/letsencrypt/live/gun.yishuziyu.cn/fullchain.pem ]; then
  echo "Missing certificate: /etc/letsencrypt/live/gun.yishuziyu.cn/fullchain.pem" >&2
  exit 1
fi

BACKUP="${CONF}.bak-$(date +%Y%m%d-%H%M%S)"
if [ -f "$CONF" ]; then
  cp "$CONF" "$BACKUP"
fi
emit_conf >"$CONF"

nginx -t
systemctl reload nginx

echo "Updated $CONF"
echo "Backup: $BACKUP"
