FROM node:22-alpine

WORKDIR /app

# Install native dependencies for puppeteer/better-sqlite3
RUN apk add --no-cache python3 make g++ chromium

# Environment variables for puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev || npm install

COPY . .

EXPOSE 10000

CMD ["node", "--import", "tsx", "server/index.ts"]
