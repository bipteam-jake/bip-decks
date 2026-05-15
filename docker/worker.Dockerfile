# Multi-stage Dockerfile for the BullMQ worker process.
# Targets: `dev` (tsx watch) and `prod` (compiled JS).
# Per docs/bip-deck-platform-deployment.md §6.

# ---------------------------------------------------------------------------
# base — shared OS + Node + git
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=development

# ---------------------------------------------------------------------------
# deps — install workspace dependencies
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/ai-gateway/package.json ./packages/ai-gateway/
COPY packages/shared/package.json ./packages/shared/
RUN npm install

# ---------------------------------------------------------------------------
# dev — source bind-mounted by docker-compose
# ---------------------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
CMD ["npm", "run", "dev", "--workspace", "apps/worker"]

# ---------------------------------------------------------------------------
# build — compile worker TypeScript and generate Prisma client
# ---------------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate \
  && npm run build --workspace apps/worker

# ---------------------------------------------------------------------------
# prod — slim runtime image
# ---------------------------------------------------------------------------
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/worker ./apps/worker
COPY --from=build /app/packages ./packages
CMD ["node", "apps/worker/dist/index.js"]
