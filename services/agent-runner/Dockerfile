# NanoClaw Agent Runner
# Stateless container executor. Spawns agent containers on demand.

FROM node:22-slim

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && \
    curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | tar xz && \
    mv docker/docker /usr/local/bin/docker && \
    rm -rf docker && \
    rm -rf /var/lib/apt/lists/*

RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

RUN npm prune --omit=dev && rm -rf src/ node_modules/.cache

EXPOSE 4005

USER root

CMD ["node", "dist/index.js"]
