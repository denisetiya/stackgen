// CI/CD templates — GitHub Actions & GitLab CI

export const GITHUB_ACTIONS_TEMPLATES = {
  // ============================================================
  // Simple build + push (no deploy)
  // ============================================================
  simple: `name: CI — Build & Push

on:
  push:
    branches: [main]
    {{#if (eq trigger "push-tags")}}
    tags: ["v*"]
    {{/if}}
  {{#if (eq trigger "pr")}}
  pull_request:
    branches: [main]
  {{/if}}
  {{#if (eq trigger "manual")}}
  workflow_dispatch:
  {{/if}}

env:
  REGISTRY: {{#if (eq config.registry.type "ghcr")}}ghcr.io{{else if (eq config.registry.type "dockerhub")}}docker.io{{else}}{{/if}}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      {{#if (eq config.registry.type "ghcr")}}
      packages: write
      {{/if}}

    strategy:
      matrix:
        service: [{{#each config.services}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}]

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to {{config.registry.type}}
        {{#if (eq config.registry.type "ghcr")}}
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: {{gha 'github.actor'}}
          password: {{gha 'secrets.CR_PAT'}}
        {{else if (eq config.registry.type "dockerhub")}}
        uses: docker/login-action@v3
        with:
          username: {{gha 'secrets.DOCKERHUB_USERNAME'}}
          password: {{gha 'secrets.DOCKERHUB_TOKEN'}}
        {{/if}}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: {{gha 'env.REGISTRY'}}/{{config.registry.namespace}}/{{gha 'matrix.service'}}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=sha,format=short

      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: {{gha 'matrix.service'}}
          push: {{config.push}}
          tags: {{gha 'steps.meta.outputs.tags'}}
          labels: {{gha 'steps.meta.outputs.labels'}}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`,

  // ============================================================
  // Full pipeline — build, test, push, deploy via SSH
  // ============================================================
  full: `name: CI/CD — Build, Push, Deploy

on:
  push:
    branches: [main]
    {{#if (eq trigger "push-tags")}}
    tags: ["v*"]
    {{/if}}
  {{#if (eq trigger "manual")}}
  workflow_dispatch:
  {{/if}}

env:
  REGISTRY: {{#if (eq config.registry.type "ghcr")}}ghcr.io{{else if (eq config.registry.type "dockerhub")}}docker.io{{else}}{{/if}}

jobs:
  test:
    runs-on: ubuntu-latest
    {{#if config.test}}
    strategy:
      matrix:
        service: [{{#each config.services}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run tests
        working-directory: {{gha 'matrix.service'}}
        run: |
          if [ -f package.json ]; then npm ci && npm test; fi
          if [ -f pyproject.toml ]; then pip install -e . && pytest; fi
          if [ -f go.mod ]; then go test ./...; fi
          if [ -f Cargo.toml ]; then cargo test --release; fi
  {{else}}
  steps:
    - run: echo "Tests skipped"
  {{/if}}

  build:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      {{#if (eq config.registry.type "ghcr")}}
      packages: write
      {{/if}}
    strategy:
      matrix:
        service: [{{#each config.services}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Login
        {{#if (eq config.registry.type "ghcr")}}
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: {{gha 'github.actor'}}
          password: {{gha 'secrets.CR_PAT'}}
        {{else if (eq config.registry.type "dockerhub")}}
        uses: docker/login-action@v3
        with:
          username: {{gha 'secrets.DOCKERHUB_USERNAME'}}
          password: {{gha 'secrets.DOCKERHUB_TOKEN'}}
        {{/if}}
      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: {{gha 'matrix.service'}}
          push: {{config.push}}
          tags: |
            {{gha 'env.REGISTRY'}}/{{config.registry.namespace}}/{{gha 'matrix.service'}}:sha-{{gha 'github.sha'}}
            {{gha 'env.REGISTRY'}}/{{config.registry.namespace}}/{{gha 'matrix.service'}}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  {{#if config.deploy}}
  deploy:
    needs: build
    runs-on: ubuntu-latest
    {{#if (eq config.deployTarget.type "ssh")}}
    environment:
      name: production
      url: https://{{config.deployTarget.host}}
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: {{gha 'secrets.DEPLOY_HOST'}}
          username: {{gha 'secrets.DEPLOY_USER'}}
          key: {{gha 'secrets.DEPLOY_SSH_KEY'}}
          script: |
            cd /app && docker compose pull && docker compose up -d
    {{else}}
    steps:
      - name: Deploy skipped
        run: echo "No SSH deploy target"
    {{/if}}
  {{/if}}

  {{#if (eq config.notification "telegram")}}
  notify:
    needs: [build{{#if config.deploy}}, deploy{{/if}}]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Telegram notify
        run: |
          STATUS="{{gha 'needs.deploy.result'}}"
          curl -s "https://api.telegram.org/bot{{gha 'secrets.TG_BOT_TOKEN'}}/sendMessage" \\
            -d chat_id="{{gha 'secrets.TG_CHAT_ID'}}" \\
            -d text="Deploy {{gha 'github.repository'}}: \$STATUS"
  {{/if}}
`,

  // Standalone Docker build workflow (referenced by docker wizard)
  docker: `name: Docker Build

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    strategy:
      matrix:
        service: [{{#each services}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}}]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: {{#if (eq registry.type "ghcr")}}ghcr.io{{else}}docker.io{{/if}}
          username: {{gha 'github.actor'}}
          password: {{gha 'secrets.CR_PAT'}}

      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: {{gha 'matrix.service'}}
          push: true
          tags: |
            {{#if (eq registry.type "ghcr")}}ghcr.io{{else}}docker.io{{/if}}/{{registry.namespace}}/{{gha 'matrix.service'}}:latest
            {{#if (eq registry.type "ghcr")}}ghcr.io{{else}}docker.io{{/if}}/{{registry.namespace}}/{{gha 'matrix.service'}}:sha-{{gha 'github.sha'}}
`,
};

export const GITLAB_CI_TEMPLATES = {
  full: `stages:
  - test
  - build
  - deploy

variables:
  DOCKER_REGISTRY: {{#if (eq config.registry.type "ghcr")}}ghcr.io{{else}}docker.io{{/if}}
  IMAGE_NAMESPACE: {{config.registry.namespace}}

services:
  - docker:dind

before_script:
  - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" $CI_REGISTRY

{{#if config.test}}
test:
  stage: test
  image: docker:24
  script:
    - docker compose -f docker-compose.yml config
{{/if}}

build:
  stage: build
  script:
    - docker compose -f docker-compose.yml build
    - docker compose -f docker-compose.yml push

{{#if config.deploy}}
deploy:
  stage: deploy
  script:
    - apt-get update && apt-get install -y openssh-client
    - scp docker-compose.yml \${DEPLOY_USER}@\${DEPLOY_HOST}:/app/
    - ssh \${DEPLOY_USER}@\${DEPLOY_HOST} "cd /app && docker compose pull && docker compose up -d"
  environment:
    name: production
  only:
    - main
{{/if}}
`,
};

export const CICD_README = `# Stackgen — CI/CD Pipeline

Generated {{generatedAt}}.

## Provider

**{{config.provider}}** — trigger: \`{{config.trigger}}\`

## Pipeline Steps

{{#if config.build}}- ✅ Build images{{/if}}
{{#if config.test}}- ✅ Run tests{{/if}}
{{#if config.push}}- ✅ Push to {{config.registry.type}}{{/if}}
{{#if config.deploy}}- ✅ Deploy via {{config.deployTarget.type}}{{/if}}
{{#if (ne config.notification "none")}}- ✅ Notify {{config.notification}}{{/if}}

## Files

| Path | Purpose |
|---|---|
| \`{{#if (eq config.provider "github")}}.github/workflows/deploy.yml{{else}}.gitlab-ci.yml{{/if}}\` | Pipeline definition |
{{#if (and config.deploy (eq config.deployTarget.type "ssh"))}}
| \`deploy.sh\` | Manual deploy script |
{{/if}}

## Step-by-Step Setup

### GitHub Actions

1. **Add secrets** to your repo (Settings → Secrets → Actions):
{{#if (eq config.registry.type "ghcr")}}
   - \`CR_PAT\` — GitHub PAT with \`write:packages\` scope
{{/if}}
{{#if (eq config.registry.type "dockerhub")}}
   - \`DOCKERHUB_USERNAME\`
   - \`DOCKERHUB_TOKEN\`
{{/if}}
{{#if (and config.deploy (eq config.deployTarget.type "ssh"))}}
   - \`DEPLOY_HOST\` — e.g. \`app.example.com\`
   - \`DEPLOY_USER\` — e.g. \`deploy\`
   - \`DEPLOY_SSH_KEY\` — private SSH key
{{/if}}
{{#if (eq config.notification "telegram")}}
   - \`TG_BOT_TOKEN\`
   - \`TG_CHAT_ID\`
{{/if}}

2. **Commit workflow file**:
\`\`\`bash
git add .github/workflows/
git commit -m "ci: add stackgen pipeline"
git push
\`\`\`

3. **Monitor**: Actions tab in GitHub

### GitLab CI

1. **Set CI/CD variables** (Settings → CI/CD → Variables):
{{#if (eq config.registry.type "ghcr")}}
   - \`CR_PAT\`, \`GITHUB_USERNAME\`
{{/if}}
{{#if (and config.deploy (eq config.deployTarget.type "ssh"))}}
   - \`DEPLOY_HOST\`, \`DEPLOY_USER\`, \`DEPLOY_SSH_KEY\`
{{/if}}

2. Push to trigger pipeline.

## SSH Deploy Setup

Generate SSH key:
\`\`\`bash
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/deploy_key
\`\`\`

Add public key to server:
\`\`\`bash
ssh-copy-id -i ~/.ssh/deploy_key.pub user@host
\`\`\`

Add private key to GitHub Secrets as \`DEPLOY_SSH_KEY\`.

---

Generated by [Stackgen](https://stackgen.denisetiya.site)
`;
