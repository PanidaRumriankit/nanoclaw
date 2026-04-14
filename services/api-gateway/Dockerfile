# NanoClaw API Gateway
# Lightweight HTTP router for inter-service communication.

FROM node:22-slim

WORKDIR /app

# Copy package files for caching
COPY package*.json ./

# Install system dependencies
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install ALL dependencies (including dev) for build
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Prune dev dependencies and remove source after build
RUN npm prune --omit=dev && rm -rf src/ node_modules/.cache

EXPOSE 4000

USER node

CMD ["node", "dist/index.js"]
