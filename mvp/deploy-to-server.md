# 云服务器部署指南

## 前提
- 服务器：121.89.90.68（已安装 Docker）
- 域名：gun.yishuziyu.cn（已绑定 Vercel）

## 部署步骤

### 1. 上传代码到服务器

在本地执行：
```bash
# 打包项目（排除 node_modules）
tar czvf red-herring.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='server' \
  -C /Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp .

# 上传到服务器（需要密码）
scp red-herring.tar.gz root@121.89.90.68:/opt/
```

### 2. 在服务器上解压并启动

SSH 登录服务器后执行：

```bash
mkdir -p /opt/red-herring
cd /opt/red-herring
tar xzvf /opt/red-herring.tar.gz

# 创建环境变量文件
cat > .env.local << 'EOF'
# 360 AI Search
SEARCH360_API_KEY=你的360APIKey
SEARCH360_MODEL=360gpt-pro

# StepFun
STEPFUN_API_KEY=你的StepFunKey

# DeepSeek
DEEPSEEK_API_KEY=你的DeepSeekKey

# MiMo
MIMO_API_KEY=你的MiMoKey

# MiniMax
MINIMAX_API_KEY=你的MiniMaxKey

# Anthropic (Kimi Code)
ANTHROPIC_API_KEY=你的AnthropicKey
ANTHROPIC_BASE_URL=https://api.kimi.com/coding
EOF

# 安装依赖并构建
npm ci
npm run build

# 使用 PM2 启动（守护进程）
npm install -g pm2
pm2 start "npx vite preview --host 0.0.0.0 --port 3000" --name red-herring-api
pm2 save
pm2 startup

# 或者使用 Docker
docker build -t red-herring-api .
docker run -d -p 3000:3000 --env-file .env.local --name red-herring-api red-herring-api
```

### 3. 验证

```bash
# 测试 API
curl -X POST http://localhost:3000/api/search/360 \
  -H "Content-Type: application/json" \
  -d '{"query":"test"}'
```

### 4. Nginx 反向代理（可选）

如果用域名访问 API：

```nginx
server {
    listen 80;
    server_name api.yishuziyu.cn;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 架构

```
用户 → gun.yishuziyu.cn (Vercel 前端)
     → API 请求 → 121.89.90.68:3000 (云服务器 API)
     → LLM 调用 → StepFun / 360 / DeepSeek / MiMo
```
