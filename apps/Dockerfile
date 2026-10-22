# Red Herring and Gun — Server Deployment

FROM node:22-alpine AS builder

# server 放 /app/server，前后端共用的代码放 /app/shared（server/src 用 ../../shared 引用）
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
# shared 里的 typebox 要从 server 的依赖解析
RUN ln -s /app/server/node_modules /app/node_modules

COPY server/tsconfig.json ./
COPY server/src ./src
COPY shared /app/shared
RUN npm run build

FROM node:22-alpine

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev

# tsc 无 rootDir：产物为 dist/server/src/* + dist/shared/*
COPY --from=builder /app/server/dist ./dist

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/server/src/index.js"]
