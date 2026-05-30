FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Copy all source files including shared lib code
COPY src ./src
COPY ../src/lib ./src/lib

EXPOSE 3000

CMD ["npx", "tsx", "src/index.ts"]
