# Red Herring and Gun — Server Deployment
# Expects pre-compiled server/dist/ (run `npm run build` in mvp/server first)

FROM node:22-alpine

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/dist ./dist
COPY server/tsconfig.json ./

EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
