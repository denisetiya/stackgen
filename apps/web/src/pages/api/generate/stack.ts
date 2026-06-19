import type { APIRoute } from 'astro';
import {
  generateDocker,
  generateGateway,
  generateCicd,
  bundleZip,
  DockerConfigSchema,
  GatewayConfigSchema,
  CicdConfigSchema,
  type FileEntry,
} from '@stackgen/core';

export const prerender = false;

interface StackRequest {
  docker: unknown;
  gateway: { enabled: boolean; type: string; services: any[]; tls: string; email?: string; dashboard: boolean };
  cicd: { enabled: boolean; provider: string; trigger: string; test: boolean; build: boolean; push: boolean; deploy: boolean; deployTarget: any; notification: string; webhookUrl?: string };
}

function buildGatewayFromDocker(stack: StackRequest): unknown {
  // Map docker services to gateway services if not explicitly configured
  const dockerServices = (stack.docker as any).services ?? [];
  const providedServices = stack.gateway.services ?? [];

  const services = dockerServices.map((svc: any, i: number) => {
    const existing = providedServices.find((s: any) => s.name === svc.name);
    return existing ?? {
      name: svc.name,
      upstream: `${svc.name}:${svc.port}`,
      path: '/',
      domain: '',
      auth: 'none',
      rateLimit: 0,
      corsOrigins: [],
    };
  });

  return {
    type: stack.gateway.type,
    services,
    tls: stack.gateway.tls,
    email: stack.gateway.email || undefined,
    dashboard: stack.gateway.dashboard,
  };
}

function buildCicdFromDocker(stack: StackRequest): unknown {
  // CI/CD services mirror docker service names
  const dockerServices = (stack.docker as any).services ?? [];
  const dockerReg = (stack.docker as any).registry ?? { type: 'none' };

  return {
    provider: stack.cicd.provider,
    trigger: stack.cicd.trigger,
    build: stack.cicd.build,
    test: stack.cicd.test,
    push: stack.cicd.push,
    deploy: stack.cicd.deploy,
    deployTarget: stack.cicd.deploy ? stack.cicd.deployTarget : undefined,
    registry: { ...dockerReg, imageName: dockerReg.imageName ?? 'app' },
    notification: stack.cicd.notification,
    webhookUrl: stack.cicd.webhookUrl || undefined,
    services: dockerServices.map((s: any) => s.name),
  };
}

function buildReadme(stack: StackRequest, sections: string[], fileCount: number): FileEntry {
  const docker = stack.docker as any;
  const services = docker.services ?? [];
  const svcList = services.map((s: any) => `- **${s.name}** (${s.framework}, :${s.port})`).join('\n');

  const gatewaySection = stack.gateway.enabled
    ? `## API Gateway (${stack.gateway.type})

Routes:
${(stack.gateway.services ?? []).map((s: any) => `- \`${s.path}\` → \`${s.upstream}\``).join('\n')}

TLS: \`${stack.gateway.tls}\`${stack.gateway.tls === 'letsencrypt' ? ` (email: ${stack.gateway.email})` : ''}
${stack.gateway.dashboard ? 'Admin dashboard: enabled\n' : ''}`
    : '';

  const cicdSection = stack.cicd.enabled
    ? `## CI/CD (${stack.cicd.provider})

Pipeline triggers on: \`${stack.cicd.trigger}\`
${stack.cicd.test ? '- Run tests\n' : ''}${stack.cicd.build ? '- Build Docker images\n' : ''}${stack.cicd.push ? `- Push to ${docker.registry.type}\n` : ''}${stack.cicd.deploy ? `- Deploy to ${stack.cicd.deployTarget.type}\n` : ''}
${stack.cicd.notification !== 'none' ? `Notifications: ${stack.cicd.notification}\n` : ''}`
    : '';

  const included = sections.length > 0 ? sections.join(' · ') : 'docker only';

  return {
    path: 'README.md',
    content: `# Stackgen Stack — ${included}

Generated: {{generatedAt}}
Total files: ${fileCount}

## Docker Services (${docker.mode})

${svcList || '_No services configured_'}

Registry: \`${docker.registry.type}\`${docker.registry.namespace ? ` (${docker.registry.namespace})` : ''}
Network: \`${docker.network}\`

${gatewaySection}
${cicdSection}
## Getting started

\`\`\`bash
# 1. Build and run
docker compose up -d

# 2. (If gateway enabled) start gateway
cd gateway && docker compose up -d

# 3. (If CI/CD enabled) commit to repo, pipeline auto-triggers
git init && git add . && git commit -m "init"
\`\`\`
`,
  };
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const body: StackRequest = await request.json();

    // Validate docker (required)
    const dockerConfig = DockerConfigSchema.parse(body.docker);
    const dockerFiles = generateDocker(dockerConfig);

    const allFiles: FileEntry[] = [];
    const sections: string[] = ['docker'];
    const rootFiles: FileEntry[] = [];

    // Docker files → docker/
    for (const f of dockerFiles) {
      // Top-level files stay at root
      if (f.path === 'docker-compose.yml' || f.path === '.env.example' || f.path === 'README.md' || f.path === '.gitignore') {
        rootFiles.push(f);
      } else if (f.path === '.github/workflows/docker.yml' || f.path === '.gitlab-ci.yml') {
        // Suppress docker's built-in CI; we generate our own if enabled
        continue;
      } else {
        allFiles.push({ ...f, path: `docker/${f.path}` });
      }
    }

    // Gateway (optional)
    if (body.gateway?.enabled) {
      const gatewayConfig = GatewayConfigSchema.parse(buildGatewayFromDocker(body));
      const gatewayFiles = generateGateway(gatewayConfig);
      for (const f of gatewayFiles) {
        if (f.path === 'README.md') {
          rootFiles.push({ ...f, path: 'gateway.README.md' });
        } else if (f.path === '.env.example') {
          allFiles.push({ ...f, path: 'gateway/.env.example' });
        } else {
          allFiles.push({ ...f, path: `gateway/${f.path}` });
        }
      }
      sections.push('gateway');
    }

    // CI/CD (optional)
    if (body.cicd?.enabled) {
      const cicdConfig = CicdConfigSchema.parse(buildCicdFromDocker(body));
      const cicdFiles = generateCicd(cicdConfig);
      for (const f of cicdFiles) {
        allFiles.push(f);
      }
      sections.push('cicd');
    }

    // Top-level README
    const readme = buildReadme(body, sections, allFiles.length + rootFiles.length + 1);
    const finalReadme: FileEntry = {
      ...readme,
      content: readme.content.replace('{{generatedAt}}', new Date().toISOString()),
    };

    const finalFiles = [...allFiles, ...rootFiles.filter(f => f.path !== 'README.md'), finalReadme];

    const format = url.searchParams.get('format');
    if (format === 'zip') {
      const buf = await bundleZip(finalFiles);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="stackgen-stack.zip"`,
        },
      });
    }

    // Preview mode (JSON listing only)
    return new Response(JSON.stringify({ files: finalFiles, zipSize: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Generation failed' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};