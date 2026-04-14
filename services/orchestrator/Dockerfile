# NanoClaw Orchestrator
# Message processing, agent routing, container lifecycle management.

FROM node:22-slim

WORKDIR /app

# Copy package files for caching
COPY package*.json ./

# Install system dependencies (git for npm, docker CLI for container management)
RUN apt-get update && apt-get install -y git curl ca-certificates && \
    curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz | tar xz && \
    mv docker/docker /usr/local/bin/docker && \
    rm -rf docker && \
    rm -rf /var/lib/apt/lists/*

# Install ALL dependencies (including dev) for build
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Prune dev dependencies and remove source after build
RUN npm prune --omit=dev && rm -rf src/ node_modules/.cache

EXPOSE 4003

# Run as root so Docker socket access works.
# The agent containers themselves run as node user for security.
USER root

CMD ["node", "dist/index.js"]
