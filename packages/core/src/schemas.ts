import { z } from 'zod';

// ============================================================
// Framework registry — single source of truth for templates
// ============================================================

export const FRAMEWORKS = [
  { id: 'laravel', name: 'Laravel', lang: 'PHP', icon: 'laravel', defaultPort: 8000, defaultBase: 'php:8.3-fpm-alpine' },
  { id: 'nextjs', name: 'Next.js', lang: 'Node', icon: 'nextjs', defaultPort: 3000, defaultBase: 'node:20-alpine' },
  { id: 'svelte', name: 'SvelteKit', lang: 'Node', icon: 'svelte', defaultPort: 5173, defaultBase: 'node:20-alpine' },
  { id: 'express', name: 'Express', lang: 'Node', icon: 'express', defaultPort: 3000, defaultBase: 'node:20-alpine' },
  { id: 'nestjs', name: 'NestJS', lang: 'Node', icon: 'nestjs', defaultPort: 3000, defaultBase: 'node:20-alpine' },
  { id: 'astro', name: 'Astro SSR', lang: 'Node', icon: 'astro', defaultPort: 4321, defaultBase: 'node:20-alpine' },
  { id: 'fastapi', name: 'FastAPI', lang: 'Python', icon: 'fastapi', defaultPort: 8000, defaultBase: 'python:3.12-slim' },
  { id: 'django', name: 'Django', lang: 'Python', icon: 'django', defaultPort: 8000, defaultBase: 'python:3.12-slim' },
  { id: 'gin', name: 'Gin (Go)', lang: 'Go', icon: 'go', defaultPort: 8080, defaultBase: 'golang:1.22-alpine' },
  { id: 'echo', name: 'Echo (Go)', lang: 'Go', icon: 'go', defaultPort: 8080, defaultBase: 'golang:1.22-alpine' },
  { id: 'axum', name: 'Axum', lang: 'Rust', icon: 'rust', defaultPort: 8080, defaultBase: 'rust:1.82-alpine' },
  { id: 'actix', name: 'Actix', lang: 'Rust', icon: 'rust', defaultPort: 8080, defaultBase: 'rust:1.82-alpine' },
] as const;

export type FrameworkId = (typeof FRAMEWORKS)[number]['id'];

export const GATEWAY_TYPES = [
  { id: 'kong', name: 'Kong', desc: 'Service gateway — plugins, auth, rate limit', defaultPort: 8000 },
  { id: 'envoy', name: 'Envoy', desc: 'L7 proxy — advanced routing, ext_authz', defaultPort: 10000 },
  { id: 'traefik', name: 'Traefik', desc: 'Auto-discovery with Docker labels', defaultPort: 80 },
  { id: 'nginx', name: 'NGINX', desc: 'Lightweight reverse proxy', defaultPort: 80 },
] as const;

export type GatewayType = (typeof GATEWAY_TYPES)[number]['id'];

export const REGISTRIES = ['ghcr', 'dockerhub', 'none'] as const;
export type Registry = (typeof REGISTRIES)[number];

export const BASE_IMAGES = {
  alpine: { desc: 'Small, musl-based', size: '~5MB' },
  slim: { desc: 'Debian-slim, glibc', size: '~80MB' },
  distroless: { desc: 'No shell, minimal attack surface', size: '~20MB' },
} as const;

export type BaseImage = keyof typeof BASE_IMAGES;

export const DATABASES = [
  { id: 'postgres', name: 'PostgreSQL', port: 5432, defaultVersion: '16' },
  { id: 'mysql', name: 'MySQL', port: 3306, defaultVersion: '8' },
  { id: 'mongodb', name: 'MongoDB', port: 27017, defaultVersion: '7' },
  { id: 'redis', name: 'Redis', port: 6379, defaultVersion: '7' },
] as const;

export type DatabaseId = (typeof DATABASES)[number]['id'];

// ============================================================
// Schemas
// ============================================================

export const EnvVarSchema = z.object({
  key: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/, 'Must be UPPER_SNAKE_CASE'),
  value: z.string().default(''),
  secret: z.boolean().default(false),
});

export const DatabaseSchema = z.object({
  type: z.enum(['postgres', 'mysql', 'mongodb', 'redis']),
  version: z.string().default('16'),
  name: z.string().default('app'),
  user: z.string().default('app'),
  password: z.string().default('changeme'),
  port: z.number().int().default(5432),
});

export const ServiceSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9-]+$/, 'lowercase-with-dashes'),
  framework: z.enum([
    'laravel', 'nextjs', 'svelte', 'express', 'nestjs', 'astro',
    'fastapi', 'django', 'gin', 'echo', 'axum', 'actix',
  ]),
  port: z.number().int().min(1).max(65535),
  baseImage: z.enum(['alpine', 'slim', 'distroless']).default('alpine'),
  env: z.array(EnvVarSchema).default([]),
  database: DatabaseSchema.optional(),
  healthcheckPath: z.string().default('/health'),
  replicas: z.number().int().min(1).max(10).default(1),
  dependsOn: z.array(z.string()).default([]),
});

export const RegistryConfigSchema = z.object({
  type: z.enum(['ghcr', 'dockerhub', 'none']),
  namespace: z.string().optional(),
  imageName: z.string().default('app'),
});

export const DockerConfigSchema = z.object({
  mode: z.enum(['single', 'microservice']).default('single'),
  services: z.array(ServiceSchema).min(1),
  registry: RegistryConfigSchema,
  compose: z.boolean().default(true),
  network: z.string().default('app-net'),
  ci: z.boolean().default(true),
  ciProvider: z.enum(['github', 'gitlab']).default('github'),
});

export type Service = z.infer<typeof ServiceSchema>;
export type Database = z.infer<typeof DatabaseSchema>;
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
export type DockerConfig = z.infer<typeof DockerConfigSchema>;
export type EnvVar = z.infer<typeof EnvVarSchema>;

// ============================================================
// Gateway schemas
// ============================================================

export const GatewayServiceSchema = z.object({
  name: z.string().min(1),
  upstream: z.string(), // service:port
  path: z.string().default('/'),
  domain: z.string().optional(),
  auth: z.enum(['none', 'jwt', 'keycloak']).default('none'),
  rateLimit: z.number().int().min(0).default(0), // rps, 0 = off
  corsOrigins: z.array(z.string()).default([]),
});

export const GatewayConfigSchema = z.object({
  type: z.enum(['kong', 'envoy', 'traefik', 'nginx']),
  services: z.array(GatewayServiceSchema).min(1),
  tls: z.enum(['letsencrypt', 'selfsigned', 'none']).default('none'),
  email: z.string().email().optional(),
  dashboard: z.boolean().default(false),
});

export type GatewayService = z.infer<typeof GatewayServiceSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// ============================================================
// CI/CD schemas
// ============================================================

export const DeployTargetSchema = z.object({
  type: z.enum(['ssh', 'k8s', 'fly', 'none']),
  host: z.string().optional(),
  user: z.string().optional(),
  sshKey: z.string().optional(),
  namespace: z.string().optional(),
  cluster: z.string().optional(),
});

export const CicdConfigSchema = z.object({
  provider: z.enum(['github', 'gitlab']).default('github'),
  trigger: z.enum(['push-main', 'push-tags', 'manual', 'pr']).default('push-main'),
  build: z.boolean().default(true),
  test: z.boolean().default(true),
  push: z.boolean().default(true),
  deploy: z.boolean().default(false),
  deployTarget: DeployTargetSchema.optional(),
  registry: RegistryConfigSchema,
  notification: z.enum(['none', 'telegram', 'slack', 'discord']).default('none'),
  webhookUrl: z.string().optional(),
  services: z.array(z.string()).default([]), // service names to build
});

export type CicdConfig = z.infer<typeof CicdConfigSchema>;
