#!/usr/bin/env bash
# 本机编译，推到服务器，重启后端。服务器只装 Node（/opt/red-herring/node），不在上面编译。
# 用法：RHG_HOST=root@<服务器> apps/deploy/deploy.sh
# 首次部署另需：建 rhg 用户、装 Node、放 /opt/red-herring/.env.local、装 red-herring.service 和 nginx-gun.conf。
set -euo pipefail
HOST="${RHG_HOST:?设置 RHG_HOST=root@<服务器>}"
cd "$(dirname "$0")/.."
# 阿里云偶尔丢握手：复用一条连接并重试。
SSH=(ssh -o ConnectTimeout=10 -o ConnectionAttempts=3 -o ServerAliveInterval=15 -o ControlMaster=auto -o ControlPath=/tmp/rhg-deploy-%C -o ControlPersist=120)

npm run build
(cd server && npm run build)

"${SSH[@]}" "$HOST" 'mkdir -p /opt/red-herring/web.new /opt/red-herring/server.new'
COPYFILE_DISABLE=1 tar --no-xattrs -C dist -czf - . | "${SSH[@]}" "$HOST" 'tar -C /opt/red-herring/web.new -xzf -'
COPYFILE_DISABLE=1 tar --no-xattrs -C server -czf - dist package.json package-lock.json | "${SSH[@]}" "$HOST" 'tar -C /opt/red-herring/server.new -xzf -'

"${SSH[@]}" "$HOST" 'set -e
cd /opt/red-herring/server.new
PATH=/opt/red-herring/node/bin:$PATH npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com
cd /opt/red-herring
rm -rf web.old server.old
[ -d web ] && mv web web.old
[ -d server ] && mv server server.old
mv web.new web
mv server.new server
systemctl restart red-herring
for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:3000/health 2>/dev/null && exit 0; sleep 1; done
echo "后端没起来，上一版在 web.old / server.old" >&2; journalctl -u red-herring -n 30 --no-pager >&2; exit 1'
