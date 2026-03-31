# Build stage — install deps and build client
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

RUN pnpm install --frozen-lockfile

# Copy source
COPY shared/ shared/
COPY server/ server/
COPY client/ client/

# Build the SvelteKit client
RUN pnpm run build

# Production stage — slim image with only what's needed
FROM node:22-slim

# mediasoup needs python3 and build tools for native compilation
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod --filter @voip-server/shared --filter @voip-server/server

# Copy shared types
COPY shared/ shared/

# Copy server source
COPY server/ server/

# Copy built client from build stage
COPY --from=build /app/client/build client/build

# Create data and upload directories
RUN mkdir -p data uploads

# Default environment
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=./data/voip-server.db
ENV UPLOAD_DIR=./uploads

EXPOSE 3000
# Expose mediasoup RTC port range
EXPOSE 40000-40100/udp

VOLUME ["/app/data", "/app/uploads"]

CMD ["node", "--import", "tsx", "server/src/index.ts"]
