#!/usr/bin/env bash
# Route bare-IP /api, /health, /r/ and orchestrate-stream to red-herring API;
# leave other IP paths for bb-roleplay.
# NGINX_CONF_OUT: dump the conf the script would write and exit (no /etc, no reload).
set -euo pipefail

ALIYUN_HOST="${ALIYUN_HOST:-}"
if [ -z "$ALIYUN_HOST" ]; then
  echo "Set ALIYUN_HOST"
  exit 1
fi

CONF=/etc/nginx/conf.d/red-herring-ip-api.conf

emit_conf() {
  cat <<NGINX
server {
    listen 80;
    server_name ${ALIYUN_HOST};

    client_max_body_size 20m;

    location /api/agent/orchestrate-stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location /r/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
}

if [ -n "${NGINX_CONF_OUT:-}" ]; then
  emit_conf >"$NGINX_CONF_OUT"
  echo "Wrote $NGINX_CONF_OUT"
  exit 0
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
