#!/bin/bash
# Red Herring API 服务器一键部署脚本
# 在阿里云服务器上执行

set -e

APP_DIR="/opt/red-herring"
PORT=3000

echo "=== Red Herring API Server Setup ==="

# 1. 检查 Docker
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# 2. 创建应用目录
mkdir -p $APP_DIR
cd $APP_DIR

# 3. 检查代码是否已上传
if [ ! -f "package.json" ]; then
    echo "ERROR: Code not found in $APP_DIR"
    echo "Please upload the project files first:"
    echo "  scp -r * root@121.89.90.68:$APP_DIR/"
    exit 1
fi

# 4. 检查环境变量
if [ ! -f ".env.local" ]; then
    echo "WARNING: .env.local not found. Creating template..."
    cat > .env.local << 'EOF'
# 360 AI Search
SEARCH360_API_KEY=
SEARCH360_MODEL=360gpt-pro

# StepFun
STEPFUN_API_KEY=
STEPFUN_MODEL=step-3.7-flash

# DeepSeek
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-chat

# MiMo
MIMO_API_KEY=
MIMO_MODEL=mimo-v2.5-pro

# MiniMax
MINIMAX_API_KEY=
MINIMAX_MODEL=MiniMax-M2.7
EOF
    echo "Please edit .env.local and add your API keys, then rerun this script."
    exit 1
fi

# 5. 构建并启动
echo "=== Building Docker image ==="
docker build -t red-herring-api .

echo "=== Stopping old container ==="
docker stop red-herring-api 2>/dev/null || true
docker rm red-herring-api 2>/dev/null || true

echo "=== Starting new container ==="
docker run -d \
    --name red-herring-api \
    -p $PORT:$PORT \
    --env-file .env.local \
    --restart unless-stopped \
    red-herring-api

echo "=== Waiting for service ==="
sleep 5

# 6. 健康检查
if curl -sf http://localhost:$PORT/health > /dev/null; then
    echo "=== SUCCESS ==="
    echo "API Server running at http://121.89.90.68:$PORT"
    echo "Test: curl -X POST http://121.89.90.68:$PORT/api/search/360 -H 'Content-Type: application/json' -d '{\"query\":\"test\"}'"
else
    echo "=== WARNING ==="
    echo "Service may not be ready yet. Check logs: docker logs red-herring-api"
fi
