#!/bin/bash
# Deploy Red Herring API to Aliyun server
# Usage: ./deploy.sh

set -e

SERVER_IP="121.89.90.68"
SERVER_USER="root"
REMOTE_DIR="/opt/red-herring"

echo "=== Building Docker image ==="
docker build -t red-herring-api:latest .
docker save red-herring-api:latest | gzip > red-herring-api.tar.gz

echo "=== Deploying to $SERVER_IP ==="
scp red-herring-api.tar.gz $SERVER_USER@$SERVER_IP:/tmp/
scp docker-compose.yml .env.local $SERVER_USER@$SERVER_IP:$REMOTE_DIR/

ssh $SERVER_USER@$SERVER_IP << 'REMOTE'
  cd /opt/red-herring
  docker load < /tmp/red-herring-api.tar.gz
  docker compose down
  docker compose up -d
  rm /tmp/red-herring-api.tar.gz
REMOTE

echo "=== Deployment complete ==="
echo "API: http://$SERVER_IP:3000"
rm red-herring-api.tar.gz
