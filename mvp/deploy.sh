#!/bin/bash
# Deploy Red Herring API to Aliyun server.
# Usage: ./deploy.sh
#
# This script builds on the remote server so local Docker Desktop is not required.

set -e

SERVER_IP="121.89.90.68"
SERVER_USER="root"
REMOTE_DIR="/opt/red-herring"
ARCHIVE="red-herring-source.tar.gz"

echo "=== Packing source ==="
tar czf "$ARCHIVE" \
  --exclude='node_modules' \
  --exclude='server/node_modules' \
  --exclude='.git' \
  --exclude='.vercel' \
  --exclude='dist' \
  --exclude='dist-a' \
  --exclude='dist-b' \
  --exclude='.agent-memory' \
  --exclude='.superpowers' \
  --exclude='multi-agent-viz-research' \
  --exclude='*.png' \
  --exclude='*.jpg' \
  --exclude='*.jpeg' \
  --exclude="$ARCHIVE" \
  .

echo "=== Building server locally ==="
cd server
npx tsc || echo "tsc warnings ignored"
# Patch imports to add .js extensions (ESM requires explicit extensions)
for f in dist/lib/*.js dist/*.js 2>/dev/null; do
  [ -f "$f" ] && sed -i '' -E 's/from "(\.\/[a-zA-Z]+)"/from "\1.js"/g' "$f" 2>/dev/null
done
cd ..

echo "=== Deploying to $SERVER_IP ==="
ssh "$SERVER_USER@$SERVER_IP" "mkdir -p $REMOTE_DIR"
scp "$ARCHIVE" "$SERVER_USER@$SERVER_IP:/tmp/$ARCHIVE"
scp .env.local "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/.env.local"

ssh "$SERVER_USER@$SERVER_IP" << REMOTE
  set -e
  mkdir -p "$REMOTE_DIR"
  cd "$REMOTE_DIR"
  tar xzf "/tmp/$ARCHIVE"
  docker compose down
  docker compose up -d --build
  rm "/tmp/$ARCHIVE"
REMOTE

echo "=== Deployment complete ==="
echo "API: http://$SERVER_IP:3000"
rm "$ARCHIVE"
