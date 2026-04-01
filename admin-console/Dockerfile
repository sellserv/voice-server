# Build stage
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files for caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY admin-console/package.json admin-console/

RUN pnpm install --frozen-lockfile --filter @voip-server/shared --filter @voip-server/admin-console

# Copy source
COPY shared/ shared/
COPY admin-console/ admin-console/

RUN pnpm --filter @voip-server/admin-console run build

# Production stage
FROM node:22-slim

WORKDIR /app

COPY --from=build /app/admin-console/build build/
COPY --from=build /app/admin-console/package.json ./

ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001

CMD ["node", "build/index.js"]
