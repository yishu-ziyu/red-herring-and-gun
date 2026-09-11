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

    # 裸 http:// 会被备案拦截返回 403（实测），用 HSTS 让访问过一次的浏览器不再去试 HTTP。
    # 注意：location 一旦有自己的 add_header 就不再继承本行，所以下面四个 location 各写一遍。
    add_header Strict-Transport-Security "max-age=31536000" always;

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

    # 应用外壳与 Service Worker 必须每次回源校验。缺 Cache-Control 时浏览器按 Last-Modified
    # 做启发式缓存，会把旧 index.html 当新鲜内容复用 —— 部署新版后回访用户会一直停在旧壳
    # （2026-09-11 实测：线上 HTML 停在 Sep 2 的构建，引用的还是 #52 之前的包）。
    location = /index.html {
        add_header Cache-Control "no-cache";
        add_header Strict-Transport-Security "max-age=31536000" always;
    }

    location = /sw.js {
        add_header Cache-Control "no-cache";
        add_header Strict-Transport-Security "max-age=31536000" always;
    }

    location = /manifest.webmanifest {
        add_header Cache-Control "no-cache";
        add_header Strict-Transport-Security "max-age=31536000" always;
    }

    # 文件名带内容 hash，改名即换内容，可以长期缓存。
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Strict-Transport-Security "max-age=31536000" always;
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
