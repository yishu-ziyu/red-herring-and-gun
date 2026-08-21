#!/bin/bash
# Deploy Red Herring API to Aliyun server.
# Usage: ./deploy.sh
#
# This script builds on the remote server so local Docker Desktop is not required.

set -e

ALIYUN_HOST="${ALIYUN_HOST:-}"
ALIYUN_USER="${ALIYUN_USER:-}"
if [ -z "$ALIYUN_HOST" ] || [ -z "$ALIYUN_USER" ]; then
  echo "Set ALIYUN_HOST and ALIYUN_USER"
  exit 1
fi
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

echo "=== Deploying to $ALIYUN_HOST ==="
ssh "$ALIYUN_USER@$ALIYUN_HOST" "mkdir -p $REMOTE_DIR"
scp "$ARCHIVE" "$ALIYUN_USER@$ALIYUN_HOST:/tmp/$ARCHIVE"
scp .env.local "$ALIYUN_USER@$ALIYUN_HOST:$REMOTE_DIR/.env.local"

ssh "$ALIYUN_USER@$ALIYUN_HOST" << REMOTE
  set -e
  mkdir -p "$REMOTE_DIR"
  cd "$REMOTE_DIR"
  tar xzf "/tmp/$ARCHIVE"
  docker compose down
  docker compose up -d --build
  rm "/tmp/$ARCHIVE"
REMOTE

echo "=== Deployment complete ==="
echo "API: http://$ALIYUN_HOST/api (nginx :80 -> 127.0.0.1:3000)"
rm "$ARCHIVE"
