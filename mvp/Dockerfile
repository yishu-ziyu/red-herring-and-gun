# Red Herring and Gun — Fullstack Deployment
# Serves static frontend + API handlers via Vite preview

FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/vite.config.ts ./
COPY --from=builder /app/src ./src

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
