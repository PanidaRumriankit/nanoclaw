# NanoClaw Scheduler
# Cron and interval task execution.

FROM node:22-slim

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

RUN npm prune --omit=dev && rm -rf src/ node_modules/.cache

EXPOSE 4004

USER node

CMD ["node", "dist/index.js"]
