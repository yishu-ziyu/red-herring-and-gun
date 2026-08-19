# Red Herring and Gun — Server Deployment

FROM node:22-alpine AS builder

# server 放 /app/server：server/src 通过 ../../src/lib/* 引用共享代码
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
# 服务端引用的前端共享 lib（checkQuota / accountIdentity / reasoningThoughts）
COPY src/lib /app/src/lib
RUN npm run build

FROM node:22-alpine

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# tsc 无 rootDir：产物为 dist/server/src/* + dist/src/lib/*
COPY --from=builder /app/server/dist ./dist

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/server/src/index.js"]
