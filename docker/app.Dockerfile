# Multi-stage Dockerfile for the Next.js app.
# Targets: `dev` (hot reload, bind-mounted source) and `prod` (built artifact).
# Per docs/bip-deck-platform-deployment.md §6.

# ---------------------------------------------------------------------------
# base — shared OS + Node + git (simple-git shells out to the git CLI)
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=development

# ---------------------------------------------------------------------------
# deps — install workspace dependencies (cached layer)
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
# dev — bind-mount the repo at /app; source comes from the host
# ---------------------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
# Source is bind-mounted by docker-compose; nothing else to copy.
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "apps/web"]

# ---------------------------------------------------------------------------
# build — generate Prisma client and build the Next.js app
# ---------------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate \
  && npm run build --workspace apps/web

# ---------------------------------------------------------------------------
# prod — slim runtime image
# ---------------------------------------------------------------------------
FROM base AS prod
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "apps/web"]
