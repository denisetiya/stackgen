# stackgen

> Production scaffolding generator — Docker compose, API gateways, and CI/CD pipelines as ZIP. Self-hosted.

🌐 **Live:** [stackgen.denisetiya.site](https://stackgen.denisetiya.site)

## What it does

Generate production-ready infrastructure configs through a wizard UI. Outputs a ZIP with:

- **Docker generator** — Multi-service compose, framework-specific Dockerfiles (Laravel, Next.js, Svelte, Express, NestJS, Astro, FastAPI, Django, Go, Axum, Actix), healthchecks, registries (GHCR/Docker Hub), optional database services.
- **Gateway generator** — Kong / Envoy / NGINX / Traefik configs with auth, rate limits, CORS, TLS, and routing rules.
- **CI/CD generator** — GitHub Actions / GitLab CI workflows with build, push, deploy stages and notifications.

Each generator emits a complete project tree: Dockerfiles, compose, env templates, README, and deployment instructions.

## Why

Most scaffolders give you "Hello World" with TODOs. Stackgen emits config you'd actually ship to production — healthchecks, proper signal handling, non-root users, multi-stage builds, secrets management, TLS termination.

## Architecture

```
stackgen/
├── apps/
│   └── web/              # Astro SSR + Alpine.js UI
│       ├── src/
│       │   ├── pages/    # /docker /gateway /cicd wizards
│       │   ├── lib/
│       │   │   ├── alpine.ts        # Alpine.js init
│       │   │   └── wizards/         # Wizard state factories
│       │   ├── layouts/
│       │   └── styles/global.css    # Ambient light design system
│       └── astro.config.mjs
├── packages/
│   └── core/             # Generation engine
│       ├── src/
│       │   ├── schemas.ts           # Zod input schemas
│       │   ├── generator.ts         # Template loader + ZIP builder
│       │   ├── templates/           # Handlebars templates
│       │   └── presets/             # Framework/gateway/CI presets
│       └── package.json
├── Dockerfile            # Multi-stage build (pnpm --ignore-scripts)
└── docker-compose.yml
```

### Tech stack

- **Frontend**: Astro 4 (SSR), Tailwind CSS, Alpine.js 3, Handlebars templates
- **Backend**: Node 22 (Astro server adapter standalone), JSZip
- **Validation**: Zod (input schemas)
- **Runtime**: Alpine.js on client, Astro SSR for HTML rendering
- **Container**: Multi-stage Docker, Alpine runtime, pnpm with `--ignore-scripts`

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/denisetiya/stackgen.git
cd stackgen
docker compose up -d
# → http://localhost:4321
```

### Local dev

```bash
# Requirements: Node 22+, pnpm 11+
pnpm install
pnpm build         # builds core then web
pnpm dev           # starts Astro dev server on :4321
```

## API endpoints

All wizards POST their config to generate a ZIP:

```bash
# Docker
curl -X POST http://localhost:4321/api/generate/docker \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "microservice",
    "services": [
      {"name": "api", "framework": "laravel", "port": 8000},
      {"name": "worker", "framework": "nestjs", "port": 3000}
    ],
    "registry": {"type": "ghcr", "namespace": "youruser", "imageName": "myapp"}
  }' \
  --output stack.zip

# Gateway
curl -X POST http://localhost:4321/api/generate/gateway \
  -H "Content-Type: application/json" \
  -d '{"type": "kong", "services": [...]}' --output gateway.zip

# CI/CD
curl -X POST http://localhost:4321/api/generate/cicd \
  -H "Content-Type: application/json" \
  -d '{"provider": "github", "steps": [...]}' --output cicd.zip
```

## Configuration

The web app reads no environment variables at runtime — it's a stateless generator. The Docker image exposes port 4321.

To run behind a reverse proxy (nginx, Caddy, Cloudflare Tunnel):

```nginx
location / {
  proxy_pass http://stackgen-web:4321;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  client_max_body_size 10m;  # ZIP downloads
}
```

## Development notes

- **Bug fix history**: Vite tree-shakes Alpine.js wizard factories defined in `<script>` blocks (they're referenced via string attributes like `x-data="dockerWizard"`). Solution: extract factories to `src/lib/wizards/*.ts` and register via `Alpine.data('name', factory)` — explicit side-effect call survives bundling.
- **`x-cloak` requires CSS**: Alpine.js hides bound elements only if `[x-cloak] { display: none !important; }` is defined globally.
- **Multi-stage Docker**: pnpm install with `--ignore-scripts` skips native binding (esbuild, sharp) — must be rebuilt manually after install in the build stage.

## License

MIT
