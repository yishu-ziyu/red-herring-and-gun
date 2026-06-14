# Build server TypeScript
FROM node:22-alpine AS builder

WORKDIR /app
COPY server/package*.json ./
RUN npm ci

COPY server/src ./src
RUN npx tsc

# Production: just run the Express server
FROM node:22-alpine

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
