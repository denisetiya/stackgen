// Docker templates — Handlebars strings
// Per-framework Dockerfile + supporting templates

export const DOCKERFILE_TEMPLATES: Record<string, string> = {
  // ============================================================
  // Laravel (PHP) — composer + node + php-fpm + nginx
  // ============================================================
  laravel: `# syntax=docker/dockerfile:1.7
# ============================================================
# Stage 1: Composer dependencies
# ============================================================
FROM composer:2.7 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

# ============================================================
# Stage 2: Frontend assets
# ============================================================
FROM node:20-alpine AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ============================================================
# Stage 3: Autoloader + final vendor
# ============================================================
FROM composer:2.7 AS autoload
WORKDIR /app
COPY --from=vendor /app/vendor /app/vendor
COPY . .
RUN composer dump-autoload --optimize --no-dev

# ============================================================
# Stage 4: Runtime — PHP-FPM
# ============================================================
{{#if (eq baseImage "alpine")}}
FROM php:8.3-fpm-alpine AS runtime
{{else if (eq baseImage "slim")}}
FROM php:8.3-fpm-bookworm AS runtime
{{else}}
FROM gcr.io/distroless/php-debian12 AS runtime
{{/if}}

WORKDIR /var/www/html

RUN apt-get update && apt-get install -y --no-install-recommends \\
    libpng-dev libjpeg-dev libfreetype6-dev libzip-dev \\
    && docker-php-ext-install pdo pdo_mysql gd zip \\
    && rm -rf /var/lib/apt/lists/*

COPY --from=autoload /app /var/www/html
COPY --from=assets /app/public/build /var/www/html/public/build

RUN chown -R www-data:www-data /var/www/html \\
    && chmod -R 755 /var/www/html/storage /var/www/html/bootstrap/cache

ENV PORT={{port}}
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \\
    CMD php artisan octane:status || exit 1

CMD ["php", "artisan", "octane:start", "--server=swoole", "--host=0.0.0.0", "--port={{port}}"]
`,

  // ============================================================
  // Next.js — multi-stage with standalone output
  // ============================================================
  nextjs: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS deps
{{else}}
FROM node:20-bookworm-slim AS deps
{{/if}}
RUN apk add --no-cache libc6-compat || true
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS builder
{{else}}
FROM node:20-bookworm-slim AS builder
{{/if}}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS runner
{{else}}
FROM node:20-bookworm-slim AS runner
{{/if}}
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT={{port}}
RUN addgroup --system --gid 1001 nodejs \\
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}/api/health || exit 1

CMD ["node", "server.js"]
`,

  // ============================================================
  // SvelteKit — adapter-node
  // ============================================================
  svelte: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS deps
{{else}}
FROM node:20-bookworm-slim AS deps
{{/if}}
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS builder
{{else}}
FROM node:20-bookworm-slim AS builder
{{/if}}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS runner
{{else}}
FROM node:20-bookworm-slim AS runner
{{/if}}
WORKDIR /app
ENV NODE_ENV=production PORT={{port}}
RUN addgroup --system --gid 1001 svelte \\
 && adduser --system --uid 1001 svelte

COPY --from=builder --chown=svelte:svelte /app/build ./build
COPY --from=builder --chown=svelte:svelte /app/node_modules ./node_modules
COPY --from=builder --chown=svelte:svelte /app/package.json ./package.json

USER svelte
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}/ || exit 1

CMD ["node", "build/index.js"]
`,

  // ============================================================
  // Express / NestJS — same template, framework-agnostic Node
  // ============================================================
  express: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS deps
{{else}}
FROM node:20-bookworm-slim AS deps
{{/if}}
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS builder
{{else}}
FROM node:20-bookworm-slim AS builder
{{/if}}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build 2>/dev/null || true

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS runner
{{else}}
FROM node:20-bookworm-slim AS runner
{{/if}}
WORKDIR /app
ENV NODE_ENV=production PORT={{port}}
RUN addgroup --system --gid 1001 app \\
 && adduser --system --uid 1001 app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder --chown=app:app /app/dist ./dist 2>/dev/null || true
COPY --from=builder --chown=app:app /app/src ./src 2>/dev/null || true

USER app
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}{{healthcheckPath}} || exit 1

CMD ["node", "dist/main.js"]
`,

  nestjs: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS deps
{{else}}
FROM node:20-bookworm-slim AS deps
{{/if}}
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS builder
{{else}}
FROM node:20-bookworm-slim AS builder
{{/if}}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS runner
{{else}}
FROM node:20-bookworm-slim AS runner
{{/if}}
WORKDIR /app
ENV NODE_ENV=production PORT={{port}}
RUN addgroup --system --gid 1001 app \\
 && adduser --system --uid 1001 app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder --chown=app:app /app/dist ./dist

USER app
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qOO- http://127.0.0.1:{{port}}{{healthcheckPath}} || exit 1

CMD ["node", "dist/main.js"]
`,

  // ============================================================
  // Astro SSR
  // ============================================================
  astro: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS deps
{{else}}
FROM node:20-bookworm-slim AS deps
{{/if}}
WORKDIR /app
COPY package.json pnpm-lock.yaml* .npmrc* ./
RUN corepack enable && pnpm i --frozen-lockfile

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS builder
{{else}}
FROM node:20-bookworm-slim AS builder
{{/if}}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm run build

{{#if (eq baseImage "alpine")}}
FROM node:20-alpine AS runner
{{else}}
FROM node:20-bookworm-slim AS runner
{{/if}}
WORKDIR /app
ENV HOST=0.0.0.0 PORT={{port}} NODE_ENV=production
RUN addgroup --system --gid 1001 astro \\
 && adduser --system --uid 1001 astro

COPY --from=builder --chown=astro:astro /app/dist ./dist
COPY --from=builder --chown=astro:astro /app/node_modules ./node_modules
COPY --from=builder --chown=astro:astro /app/package.json ./package.json

USER astro
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}/ || exit 1

CMD ["node", "./dist/server/entry.mjs"]
`,

  // ============================================================
  // FastAPI — uv + multi-stage
  // ============================================================
  fastapi: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM python:3.12-alpine AS deps
{{else}}
FROM python:3.12-slim AS deps
{{/if}}
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project --no-dev

{{#if (eq baseImage "alpine")}}
FROM python:3.12-alpine AS builder
{{else}}
FROM python:3.12-slim AS builder
{{/if}}
WORKDIR /app
COPY --from=deps /app/.venv /app/.venv
COPY . .
RUN uv sync --frozen --no-dev

{{#if (eq baseImage "alpine")}}
FROM python:3.12-alpine AS runner
{{else if (eq baseImage "slim")}}
FROM python:3.12-slim AS runner
{{else}}
FROM gcr.io/distroless/python3-debian12 AS runner
{{/if}}

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" PORT={{port}}

RUN groupadd --system --gid 1001 app \\
 && useradd --system --uid 1001 --gid app app

COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/app ./app

USER app
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:{{port}}{{healthcheckPath}}')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "{{port}}"]
`,

  // ============================================================
  // Django
  // ============================================================
  django: `# syntax=docker/dockerfile:1.7
{{#if (eq baseImage "alpine")}}
FROM python:3.12-alpine AS deps
{{else}}
FROM python:3.12-slim AS deps
{{/if}}
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock* requirements.txt* ./
RUN uv pip install --system --no-cache django gunicorn psycopg2-binary

{{#if (eq baseImage "alpine")}}
FROM python:3.12-alpine AS runner
{{else if (eq baseImage "slim")}}
FROM python:3.12-slim AS runner
{{else}}
FROM gcr.io/distroless/python3-debian12 AS runner
{{/if}}

WORKDIR /app
ENV PORT={{port}} DJANGO_SETTINGS_MODULE=app.settings.prod

RUN groupadd --system --gid 1001 app \\
 && useradd --system --uid 1001 --gid app app

COPY --chown=app:app . .

USER app
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:{{port}}{{healthcheckPath}}')" || exit 1

CMD ["gunicorn", "app.wsgi:application", "--bind", "0.0.0.0:{{port}}", "--workers", "4"]
`,

  // ============================================================
  // Go (Gin / Echo / Fiber — same multi-stage)
  // ============================================================
  gin: `# syntax=docker/dockerfile:1.7
FROM golang:1.22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache git
COPY go.mod go.sum* ./
RUN go mod download

FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/go.sum ./go.sum
COPY --from=deps /app/go.mod ./go.mod
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/app .

{{#if (eq baseImage "alpine")}}
FROM alpine:3.20 AS runner
{{else}}
FROM gcr.io/distroless/static-debian12 AS runner
{{/if}}

WORKDIR /app
COPY --from=builder /out/app /app/app

ENV PORT={{port}}
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}{{healthcheckPath}} || exit 1

ENTRYPOINT ["/app/app"]
`,

  echo: `# syntax=docker/dockerfile:1.7
FROM golang:1.22-alpine AS deps
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download

FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/go.sum ./go.sum
COPY --from=deps /app/go.mod ./go.mod
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/app .

{{#if (eq baseImage "alpine")}}
FROM alpine:3.20 AS runner
{{else}}
FROM gcr.io/distroless/static-debian12 AS runner
{{/if}}

WORKDIR /app
COPY --from=builder /out/app /app/app

ENV PORT={{port}}
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}{{healthcheckPath}} || exit 1

ENTRYPOINT ["/app/app"]
`,

  // ============================================================
  // Axum / Actix — Rust cargo-chef caching
  // ============================================================
  axum: `# syntax=docker/dockerfile:1.7
FROM lukemathwalker/cargo-chef:latest-rust-1.82 AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
RUN apk add --no-cache musl-dev
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --bin app --locked

{{#if (eq baseImage "alpine")}}
FROM alpine:3.20 AS runner
{{else}}
FROM gcr.io/distroless/static-debian12 AS runner
{{/if}}

WORKDIR /app
COPY --from=builder /app/target/release/app /app/app

ENV PORT={{port}}
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}{{healthcheckPath}} || exit 1

ENTRYPOINT ["/app/app"]
`,

  actix: `# syntax=docker/dockerfile:1.7
FROM lukemathwalker/cargo-chef:latest-rust-1.82 AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
RUN apk add --no-cache musl-dev
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --bin app --locked

{{#if (eq baseImage "alpine")}}
FROM alpine:3.20 AS runner
{{else}}
FROM gcr.io/distroless/static-debian12 AS runner
{{/if}}

WORKDIR /app
COPY --from=builder /app/target/release/app /app/app

ENV PORT={{port}}
EXPOSE {{port}}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \\
    CMD wget -qO- http://127.0.0.1:{{port}}{{healthcheckPath}} || exit 1

ENTRYPOINT ["/app/app"]
`,
};

// ============================================================
// Shared templates
// ============================================================

export const DOCKERIGNORE_TEMPLATE = `node_modules
.git
.gitignore
.env
.env.local
*.md
!README.md
.vscode
.idea
dist
build
.next
.svelte-kit
target
__pycache__
*.pyc
.DS_Store
coverage
.nyc_output
.cache
`;

export const ENV_TEMPLATE = `# Generated by Stackgen
# Copy to .env and fill secrets. Never commit .env.

{{#each lines}}{{this}}
{{/each}}
`;

// ============================================================
// Docker Compose — microservice mode (multi-service)
// ============================================================

export const COMPOSE_TEMPLATES: Record<string, string> = {
  microservice: `# Generated by Stackgen — microservice stack
# Usage: docker compose up -d

networks:
  {{config.network}}:
    driver: bridge

volumes:
{{#each services}}
{{#if database}}
  {{name}}-db:
{{/if}}
{{/each}}

services:
{{#each services}}
  {{name}}:
    build:
      context: ./{{name}}
      dockerfile: Dockerfile
    image: {{#if (eq ../config.registry.type "ghcr")}}{{../config.registry.namespace}}/{{name}}:latest{{else if (eq ../config.registry.type "dockerhub")}}{{../config.registry.namespace}}/{{name}}:latest{{else}}{{name}}:latest{{/if}}
    container_name: {{name}}
    restart: unless-stopped
    networks:
      - {{../config.network}}
    ports:
      - "{{port}}:{{port}}"
    environment:
      NODE_ENV: production{{#if database}}
      DB_HOST: {{name}}-db
      DB_PORT: '{{database.port}}'
      DB_NAME: {{database.name}}
      DB_USER: {{database.user}}
      DB_PASS: \$\{{{envVarName}}}{{/if}}
{{#each env}}
      {{key}}: \$\{{{key}}}
{{/each}}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:{{port}}{{healthcheckPath}}"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
{{#if dependsOn}}
    depends_on:
{{#each dependsOn}}
      - {{this}}
{{/each}}
{{/if}}

{{#if database}}
  {{name}}-db:
    image: {{#if (eq database.type "postgres")}}postgres:{{database.version}}{{else if (eq database.type "mysql")}}mysql:{{database.version}}{{else if (eq database.type "mongodb")}}mongo:{{database.version}}{{else}}redis:{{database.version}}{{/if}}
    container_name: {{name}}-db
    restart: unless-stopped
    networks:
      - {{../config.network}}
    environment:
{{#if (eq database.type "postgres")}}
      POSTGRES_DB: {{database.name}}
      POSTGRES_USER: {{database.user}}
      POSTGRES_PASSWORD: \$\{{{envVarName}}}
{{else if (eq database.type "mysql")}}
      MYSQL_DATABASE: {{database.name}}
      MYSQL_USER: {{database.user}}
      MYSQL_PASSWORD: \$\{{{envVarName}}}
      MYSQL_ROOT_PASSWORD: \$\{{{rootEnvVarName}}}
{{else if (eq database.type "mongodb")}}
      MONGO_INITDB_DATABASE: {{database.name}}
      MONGO_INITDB_ROOT_USERNAME: {{database.user}}
      MONGO_INITDB_ROOT_PASSWORD: \$\{{{envVarName}}}
{{/if}}
    volumes:
      - {{name}}-db:/var/lib/{{#if (eq database.type "postgres")}}postgresql{{else if (eq database.type "mysql")}}mysql{{else if (eq database.type "mongodb")}}mongodb{{else}}redis{{/if}}/data
    healthcheck:
      test: ["CMD", "{{#if (eq database.type "postgres")}}pg_isready{{else if (eq database.type "mysql")}}mysqladmin{{else if (eq database.type "mongodb")}}mongosh{{else}}redis-cli{{/if}}", "-U", "{{database.user}}"]
      interval: 10s
      timeout: 5s
      retries: 5
{{/if}}

{{/each}}
`,
};

// ============================================================
// README — step-by-step implementation guide
// ============================================================

export const README_DOCKER_TEMPLATE = `# Stackgen — Docker Stack

Generated {{generatedAt}}. Stack mode: **{{mode}}**.

## Architecture

This bundle contains a **{{mode}}** Docker stack with **{{services.length}} service(s)**:

{{#each services}}
- **{{name}}** — {{framework}} on port {{port}}{{#if database}} + {{database.type}} DB{{/if}}
{{/each}}

{{#if (eq mode "microservice")}}
## Microservice Network Layout

\`\`\`
                ┌─────────────────────────────┐
                │   External Traffic          │
                └──────────────┬──────────────┘
                               │
                  ┌────────────▼────────────┐
                  │   Your Apps             │
                  │   (exposed on host)     │
                  └────────────┬────────────┘
                               │
                  ┌────────────▼────────────┐
                  │   {{network}}           │
                  │   (bridge network)      │
                  └─────────────────────────┘
{{/if}}

## Prerequisites

- Docker 24+ with Compose v2
- (Optional) Registry account — GHCR or Docker Hub

## Files Generated

| Path | Purpose |
|---|---|
{{#each services}}
| \`{{name}}/Dockerfile\` | Multi-stage build for {{framework}} |
| \`{{name}}/.dockerignore\` | Excludes from build context |
{{/each}}
| \`docker-compose.yml\` | Orchestrates all services + DBs |
| \`.env.example\` | Environment variables template |
{{#if ci}}
| \`.github/workflows/docker.yml\` | CI: build + push to {{registry.type}} |
{{/if}}

## Step-by-Step Implementation

### Step 1 — Copy files to your project root

\`\`\`bash
# From this bundle's root
cp -r ./* /path/to/your/repo/

# Or extract the ZIP at your repo root
unzip stackgen-docker.zip -d /path/to/your/repo/
\`\`\`

### Step 2 — Add app source code

Each service directory ({{#each services}}\`{{name}}/\`{{#unless @last}}, {{/unless}}{{/each}}) must contain your application source.

\`\`\`bash
# Example: Laravel
cp -r /your/laravel/* {{services.0.name}}/

# Example: Express
cp -r /your/express/* {{services.0.name}}/
\`\`\`

Ensure your app:
- Listens on \`0.0.0.0\` (not \`localhost\`)
- Reads port from \`PORT\` env var
- Has the env vars from \`.env.example\`

### Step 3 — Configure environment

\`\`\`bash
cp .env.example .env
# Edit .env — fill in real secrets
\`\`\`

Generate strong passwords:
\`\`\`bash
openssl rand -base64 32
\`\`\`

### Step 4 — Build & run locally

\`\`\`bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f {{services.0.name}}
\`\`\`

Verify health:
\`\`\`bash
curl http://localhost:{{services.0.port}}{{services.0.healthcheckPath}}
\`\`\`

### Step 5 — Setup registry (optional)

#### GHCR
1. Create PAT at https://github.com/settings/tokens with \`write:packages\` scope
2. Add to GitHub repo: Settings → Secrets → \`CR_PAT\` = your PAT

#### Docker Hub
1. Create account at https://hub.docker.com
2. Add to GitHub repo: \`DOCKERHUB_USERNAME\`, \`DOCKERHUB_TOKEN\`

### Step 6 — Enable CI/CD

Push the workflow file:
\`\`\`bash
git add .github/workflows/docker.yml
git commit -m "ci: add stackgen workflow"
git push
\`\`\`

The workflow will:
- Build all {{services.length}} service(s)
- Push to {{registry.type}}
- Tag with git SHA + \`latest\`

### Step 7 — Deploy to server

SSH to your server, install Docker, then:
\`\`\`bash
git clone https://github.com/you/repo.git /app
cd /app
cp .env.example .env && nano .env
docker compose pull
docker compose up -d
\`\`\`

For automated deploys via SSH, configure the \`deploy\` step in CI/CD wizard.

## Production Checklist

- [ ] All secrets in \`.env\` are strong & unique
- [ ] \`.env\` is in \`.gitignore\` (it is)
- [ ] HTTPS terminator in front (gateway, Caddy, Traefik, or cloud LB)
- [ ] Database backups configured
- [ ] Log rotation setup
- [ ] Resource limits added to compose (memory/CPU)

## Customization

Edit any file directly — they're standard Docker configs. Common tweaks:
- Add volumes for persistent data
- Add \`deploy.resources\` for production limits
- Add reverse proxy labels (Traefik, NGINX Proxy Manager)

---

Generated by [Stackgen](https://stackgen.denisetiya.site)
`;
