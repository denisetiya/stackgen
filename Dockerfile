# syntax=docker/dockerfile:1.7
# ============================================================
# Stage 1 — install deps & build
# ============================================================
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

# Copy workspace root manifests + npmrc
COPY package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml* ./

# Copy source code
COPY packages/core ./packages/core
COPY apps/web ./apps/web

# Install deps (ignore scripts to avoid approval prompt, then rebuild what we need)
RUN pnpm install --ignore-scripts --frozen-lockfile || pnpm install --ignore-scripts
RUN pnpm rebuild esbuild sharp

# Build core (tsc) + web (astro)
RUN pnpm build

# ============================================================
# Stage 2 — runtime
# ============================================================
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

# Copy only package.json files + lockfile for prod install
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/.npmrc ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/apps/web/package.json ./apps/web/

# Install production-only deps
RUN pnpm install --prod --ignore-scripts --frozen-lockfile || pnpm install --prod --ignore-scripts

# Copy built server + client from builder
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 4321

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4321/ || exit 1

WORKDIR /app/apps/web

CMD ["node", "./dist/server/entry.mjs"]