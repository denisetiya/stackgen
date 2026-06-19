import Handlebars from 'handlebars';
import type { DockerConfig, GatewayConfig, CicdConfig } from './schemas.js';

// Register helpers
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('ne', (a, b) => a !== b);
Handlebars.registerHelper('upper', (s: string) => s?.toUpperCase());
Handlebars.registerHelper('lower', (s: string) => s?.toLowerCase());
Handlebars.registerHelper('json', (obj: unknown) => JSON.stringify(obj, null, 2));
Handlebars.registerHelper('join', (arr: string[], sep: string) => arr?.join(sep) ?? '');
Handlebars.registerHelper('includes', (arr: string[], val: string) => arr?.includes(val) ?? false);
Handlebars.registerHelper('default', (val, def) => val ?? def);
Handlebars.registerHelper('replace', (str: string, from: string, to: string) => str?.replaceAll(from, to) ?? '');
Handlebars.registerHelper('gha', (...args: unknown[]) => {
  // Render literal GitHub Actions expression: ${{ expr }}
  // Usage: {{gha 'env.REGISTRY'}}
  return '${{ ' + args.slice(0, -1).join(' ') + ' }}';
});
Handlebars.registerHelper('and', (...args: unknown[]) => {
  // last arg is options object from handlebars
  const opts = args[args.length - 1] as Handlebars.HelperOptions;
  return args.slice(0, -1).every(Boolean);
});
Handlebars.registerHelper('or', (...args: unknown[]) => {
  const opts = args[args.length - 1] as Handlebars.HelperOptions;
  return args.slice(0, -1).some(Boolean);
});
Handlebars.registerHelper('indent', function (this: unknown, n: number, options: Handlebars.HelperOptions) {
  const text = options.fn(this) as string;
  const pad = ' '.repeat(n);
  return text.split('\n').map((l, i) => i === 0 ? l : pad + l).join('\n');
});

export type FileEntry = { path: string; content: string };

export interface GenerateOptions {
  config: DockerConfig | GatewayConfig | CicdConfig;
  kind: 'docker' | 'gateway' | 'cicd';
}

// ============================================================
// Template registry — embedded as strings for single-binary deploy
// ============================================================

import { DOCKERFILE_TEMPLATES, COMPOSE_TEMPLATES, DOCKERIGNORE_TEMPLATE, ENV_TEMPLATE, README_DOCKER_TEMPLATE } from './templates/docker/index.js';
import { KONG_TEMPLATES, ENVOY_TEMPLATES, NGINX_TEMPLATES, TRAEFIK_TEMPLATES, GATEWAY_README } from './templates/gateway/index.js';
import { GITHUB_ACTIONS_TEMPLATES, GITLAB_CI_TEMPLATES, CICD_README } from './templates/cicd/index.js';

function renderTemplate(template: string, ctx: Record<string, unknown>): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled(ctx);
}

// ============================================================
// Docker generator
// ============================================================

export function generateDocker(config: DockerConfig): FileEntry[] {
  const files: FileEntry[] = [];
  const envLines: string[] = [];
  const readmeCtx = {
    config,
    services: config.services,
    mode: config.mode,
    generatedAt: new Date().toISOString(),
  };

  for (const service of config.services) {
    const dockerfileTpl = DOCKERFILE_TEMPLATES[service.framework];
    if (!dockerfileTpl) continue;

    const ctx = {
      service,
      baseImage: service.baseImage,
      port: service.port,
      hasDb: !!service.database,
      dependsOn: service.dependsOn,
    };

    files.push({
      path: `${service.name}/Dockerfile`,
      content: renderTemplate(dockerfileTpl, ctx),
    });

    files.push({
      path: `${service.name}/.dockerignore`,
      content: DOCKERIGNORE_TEMPLATE,
    });

    if (service.database) {
      envLines.push(`# ${service.name} database`);
      envLines.push(`${service.name.toUpperCase().replace(/-/g, '_')}_DB_HOST=${service.name}-db`);
      envLines.push(`${service.name.toUpperCase().replace(/-/g, '_')}_DB_PORT=${service.database.port}`);
      envLines.push(`${service.name.toUpperCase().replace(/-/g, '_')}_DB_NAME=${service.database.name}`);
      envLines.push(`${service.name.toUpperCase().replace(/-/g, '_')}_DB_USER=${service.database.user}`);
      envLines.push(`${service.name.toUpperCase().replace(/-/g, '_')}_DB_PASS=\${${service.name.toUpperCase().replace(/-/g, '_')}_DB_PASS}`);
      envLines.push('');
    }

    for (const e of service.env) {
      envLines.push(`${e.key}=\${${e.key}${e.secret ? ':changeme' : ''}}`);
    }
  }

  // Compose
  if (config.compose) {
    const enrichedServices = config.services.map(s => {
      const envVarName = `${s.name.toUpperCase().replace(/-/g, '_')}_DB_PASS`;
      const rootEnvVarName = `${s.name.toUpperCase().replace(/-/g, '_')}_DB_ROOT_PASS`;
      return { ...s, envVarName, rootEnvVarName };
    });
    files.push({
      path: 'docker-compose.yml',
      content: renderTemplate(COMPOSE_TEMPLATES.microservice, { config, services: enrichedServices }),
    });
  }

  // Env file
  if (envLines.length > 0) {
    files.push({
      path: '.env.example',
      content: renderTemplate(ENV_TEMPLATE, { lines: envLines }),
    });
  }

  // CI workflow
  if (config.ci) {
    files.push({
      path: '.github/workflows/docker.yml',
      content: renderTemplate(GITHUB_ACTIONS_TEMPLATES.docker, { config, services: config.services }),
    });
  }

  // README
  files.push({
    path: 'README.md',
    content: renderTemplate(README_DOCKER_TEMPLATE, readmeCtx),
  });

  return files;
}

// ============================================================
// Gateway generator
// ============================================================

export function generateGateway(config: GatewayConfig): FileEntry[] {
  const files: FileEntry[] = [];
  const tplMap = {
    kong: KONG_TEMPLATES,
    envoy: ENVOY_TEMPLATES,
    nginx: NGINX_TEMPLATES,
    traefik: TRAEFIK_TEMPLATES,
  } as const;

  const tpl = tplMap[config.type];
  const defaultPort = config.type === 'kong' ? 8000 : config.type === 'envoy' ? 10000 : 80;
  const ctx = {
    config,
    services: config.services,
    type: config.type,
    port: defaultPort,
    generatedAt: new Date().toISOString(),
  };

  // Config file
  if (config.type === 'kong') {
    files.push({ path: 'gateway/kong.yml', content: renderTemplate(tpl.config, ctx) });
  } else if (config.type === 'envoy') {
    files.push({ path: 'gateway/envoy.yaml', content: renderTemplate(tpl.config, ctx) });
  } else if (config.type === 'nginx') {
    files.push({ path: 'gateway/nginx.conf', content: renderTemplate(tpl.config, ctx) });
  } else if (config.type === 'traefik') {
    files.push({ path: 'gateway/dynamic.yml', content: renderTemplate(tpl.config, ctx) });
  }

  // Compose
  files.push({ path: 'docker-compose.yml', content: renderTemplate(tpl.compose, ctx) });
  files.push({ path: '.env.example', content: renderTemplate(tpl.env, ctx) });
  files.push({ path: 'README.md', content: renderTemplate(GATEWAY_README, ctx) });

  return files;
}

// ============================================================
// CI/CD generator
// ============================================================

export function generateCicd(config: CicdConfig): FileEntry[] {
  const files: FileEntry[] = [];
  const ctx = { config };

  const cicdCtx = { config, generatedAt: new Date().toISOString() };

  if (config.provider === 'github') {
    const tpl = config.deploy
      ? GITHUB_ACTIONS_TEMPLATES.full
      : GITHUB_ACTIONS_TEMPLATES.simple;

    const path = config.deploy ? '.github/workflows/deploy.yml' : '.github/workflows/ci.yml';
    files.push({ path, content: renderTemplate(tpl, cicdCtx) });
  } else {
    files.push({ path: '.gitlab-ci.yml', content: renderTemplate(GITLAB_CI_TEMPLATES.full, cicdCtx) });
  }

  if (config.deploy && config.deployTarget?.type === 'ssh') {
    files.push({
      path: 'deploy.sh',
      content: `#!/usr/bin/env bash\nset -euo pipefail\nssh -t \${DEPLOY_USER}@\${DEPLOY_HOST} "cd /app && docker compose pull && docker compose up -d"\n`,
    });
  }

  files.push({ path: 'README.md', content: renderTemplate(CICD_README, cicdCtx) });

  return files;
}

export { renderTemplate, Handlebars };
