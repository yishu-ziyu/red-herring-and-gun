#!/usr/bin/env zsh
# deploy-to-aliyun.sh — 同步代码到阿里云并重启 Docker
#
# 流程：SSH → git pull → docker compose rebuild → 验证
#
# 前提：
#   - SSH key 已配置（能直接 ssh root@121.89.90.68）
#   - 阿里云上 /opt/red-herring/ 已有 git clone
#   - .env.local 在阿里云上（不在 git 里，不会被覆盖）
#
# 用法：./deploy-to-aliyun.sh

set -euo pipefail

ALIYUN_HOST="121.89.90.68"
ALIYUN_USER="root"
REPO_DIR="/opt/red-herring"

echo "🚀 开始部署 → ${ALIYUN_HOST}"
echo ""

# ─── Step 1: 拉取最新代码 ───────────────────────────────────

echo "📥 Step 1/3: 拉取最新代码..."
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new \
  "${ALIYUN_USER}@${ALIYUN_HOST}" << REMOTE_EOF
set -euo pipefail

cd ${REPO_DIR}

# 确认是 git 仓库
if [ ! -d .git ]; then
  echo "❌ ${REPO_DIR} 不是 git 仓库，需要先初始化"
  exit 1
fi

echo "   git fetch origin..."
git fetch origin

echo "   git reset --hard origin/main..."
git reset --hard origin/main

echo "   ✅ 代码已更新到最新"
echo "   📋 最新 commit: \$(git log --oneline -1)"
REMOTE_EOF

# ─── Step 2: Docker rebuild + restart ───────────────────────

echo ""
echo "🐳 Step 2/3: 重新构建 Docker 镜像..."

ssh -o ConnectTimeout=10 "${ALIYUN_USER}@${ALIYUN_HOST}" << REMOTE_EOF
set -euo pipefail

cd ${REPO_DIR}/mvp

echo "   docker compose build --no-cache..."
docker compose build --no-cache 2>&1 | tail -5

echo ""
echo "   docker compose up -d..."
docker compose up -d 2>&1

echo ""
echo "   ⏳ 等待服务启动..."
sleep 5

echo "   📋 容器状态:"
docker compose ps
REMOTE_EOF

# ─── Step 3: 验证 ───────────────────────────────────────────

echo ""
echo "🔍 Step 3/3: 验证部署..."

ssh -o ConnectTimeout=10 "${ALIYUN_USER}@${ALIYUN_HOST}" << REMOTE_EOF
set -euo pipefail

# 检查容器是否运行
if docker compose -f ${REPO_DIR}/mvp/docker-compose.yml ps | grep -q "Up"; then
  echo "   ✅ 容器运行中"
else
  echo "   ❌ 容器未运行，检查日志:"
  docker compose -f ${REPO_DIR}/mvp/docker-compose.yml logs --tail=20
  exit 1
fi

# 检查 API 是否响应（容器内）
RESPONSE=\$(docker exec red-herring-api wget -qO- http://127.0.0.1:3000/health 2>/dev/null | head -1 || echo "NO_RESPONSE")

if [ "\$RESPONSE" != "NO_RESPONSE" ]; then
  echo "   ✅ API 有响应"
else
  echo "   ⚠️ API 未返回内容（可能需要更多启动时间）"
fi
REMOTE_EOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 部署完成 → https://gun.yishuziyu.cn"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
