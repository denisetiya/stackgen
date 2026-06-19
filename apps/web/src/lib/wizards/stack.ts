import type { FrameworkId, DatabaseId, GatewayType, Registry } from '@stackgen/core/schemas';

interface DockerService {
  name: string;
  framework: FrameworkId;
  port: number;
  baseImage: 'alpine' | 'slim' | 'distroless';
  env: { key: string; value: string; secret: boolean }[];
  database?: { type: DatabaseId; version: string; name: string; user: string; password: string; port: number };
  healthcheckPath: string;
  replicas: number;
  dependsOn: string[];
}

interface GatewayService {
  name: string;
  upstream: string;
  path: string;
  domain: string;
  auth: 'none' | 'jwt' | 'keycloak';
  rateLimit: number;
  corsOrigins: string[];
}

interface DeployTarget {
  type: 'ssh' | 'k8s' | 'fly' | 'none';
  host?: string;
  user?: string;
  sshKey?: string;
  namespace?: string;
  cluster?: string;
}

interface StackConfig {
  docker: {
    mode: 'single' | 'microservice';
    services: DockerService[];
    registry: { type: Registry; namespace?: string; imageName: string };
    compose: boolean;
    network: string;
  };
  gateway: {
    enabled: boolean;
    type: GatewayType;
    services: GatewayService[];
    tls: 'none' | 'selfsigned' | 'letsencrypt';
    email: string;
    dashboard: boolean;
  };
  cicd: {
    enabled: boolean;
    provider: 'github' | 'gitlab';
    trigger: 'push-main' | 'push-tags' | 'pr' | 'manual';
    test: boolean;
    build: boolean;
    push: boolean;
    deploy: boolean;
    deployTarget: DeployTarget;
    notification: 'none' | 'telegram' | 'slack' | 'discord';
    webhookUrl: string;
  };
}

interface FileEntry { path: string; content: string; }

interface StackWizard {
  step: number;
  steps: string[];
  frameworks: { id: FrameworkId; name: string; lang: string; defaultPort: number; defaultBase: string }[];
  databases: { id: DatabaseId; name: string; port: number; defaultVersion: string }[];
  gateways: { id: GatewayType; name: string; desc: string; defaultPort: number }[];
  config: StackConfig;
  files: FileEntry[];
  active: number;
  loading: boolean;
  error: string;
  generated: boolean;
  zipSize: number;

  init(): void;
  totalSteps(): number;
  canGoNext(): boolean;
  next(): Promise<void>;
  prev(): void;
  goto(s: number): Promise<void>;

  addService(): void;
  removeService(i: number): void;
  addGatewayService(): void;
  removeGatewayService(i: number): void;
  syncGatewayFromDocker(): void;

  toggleGateway(enabled: boolean): void;
  toggleCicd(enabled: boolean): void;

  rebuild(): Promise<void>;
  generate(): Promise<void>;
  downloadZip(): Promise<void>;
}

declare global {
  interface Window {
    stackWizardData: {
      frameworks: StackWizard['frameworks'];
      databases: StackWizard['databases'];
      gateways: StackWizard['gateways'];
    };
  }
}

export function stackWizardFactory(): StackWizard {
  return {
    step: 0,
    steps: ['Stack', 'Environment', 'Registry', 'Gateway', 'CI/CD', 'Preview'],
    frameworks: window.stackWizardData.frameworks,
    databases: window.stackWizardData.databases,
    gateways: window.stackWizardData.gateways,
    config: {
      docker: {
        mode: 'single',
        services: [],
        registry: { type: 'ghcr', namespace: '', imageName: 'app' },
        compose: true,
        network: 'app-net',
      },
      gateway: {
        enabled: false,
        type: 'kong',
        services: [],
        tls: 'none',
        email: '',
        dashboard: false,
      },
      cicd: {
        enabled: true,
        provider: 'github',
        trigger: 'push-main',
        test: true,
        build: true,
        push: true,
        deploy: false,
        deployTarget: { type: 'ssh', host: '', user: '' },
        notification: 'none',
        webhookUrl: '',
      },
    },
    files: [],
    active: 0,
    loading: false,
    error: '',
    generated: false,
    zipSize: 0,

    init() {
      if (this.config.docker.services.length === 0) this.addService();

      // Default toggles based on context
      if (this.config.docker.mode === 'microservice') {
        this.config.gateway.enabled = true;
      }
      this.config.cicd.enabled = this.config.docker.registry.type !== 'none';

      this.$watch('config', () => {
        // Auto-toggle gateway based on mode
        if (this.config.docker.mode === 'microservice' && !this.config.gateway.enabled) {
          this.config.gateway.enabled = true;
        }
        if (this.config.docker.mode === 'single' && this.config.gateway.enabled) {
          this.config.gateway.enabled = false;
        }
        // Auto-toggle cicd based on registry
        this.config.cicd.enabled = this.config.docker.registry.type !== 'none';

        // Auto-sync gateway services from docker services
        if (this.config.gateway.enabled) this.syncGatewayFromDocker();

        if (this.step === this.totalSteps() - 1 && this.generated) this.rebuild();
      }, { deep: true });
    },

    totalSteps() {
      return this.steps.length;
    },

    canGoNext() {
      // Block next if on Gateway step and gateway is enabled but no services
      if (this.step === 3 && this.config.gateway.enabled && this.config.gateway.services.length === 0) {
        return false;
      }
      return true;
    },

    async next() {
      if (!this.canGoNext()) return;
      if (this.step < this.totalSteps() - 1) {
        this.step++;
        if (this.step === this.totalSteps() - 1) await this.generate();
      }
    },

    prev() {
      if (this.step > 0) this.step--;
    },

    async goto(s: number) {
      if (s >= 0 && s < this.totalSteps()) {
        this.step = s;
        if (s === this.totalSteps() - 1) await this.generate();
      }
    },

    addService() {
      const fw = this.frameworks[0];
      this.config.docker.services.push({
        name: `service-${this.config.docker.services.length + 1}`,
        framework: fw.id,
        port: fw.defaultPort,
        baseImage: 'alpine',
        env: [],
        healthcheckPath: '/health',
        replicas: 1,
        dependsOn: [],
      });
      if (this.config.gateway.enabled) this.syncGatewayFromDocker();
    },

    removeService(i: number) {
      this.config.docker.services.splice(i, 1);
      if (this.config.gateway.enabled) this.syncGatewayFromDocker();
    },

    addGatewayService() {
      this.config.gateway.services.push({
        name: `svc-${this.config.gateway.services.length + 1}`,
        upstream: `app:${3000 + this.config.gateway.services.length}`,
        path: '/',
        domain: '',
        auth: 'none',
        rateLimit: 0,
        corsOrigins: [],
      });
    },

    removeGatewayService(i: number) {
      this.config.gateway.services.splice(i, 1);
    },

    syncGatewayFromDocker() {
      // Sync gateway services to match docker services (preserve custom config)
      const docker = this.config.docker.services;
      const existing = new Map(this.config.gateway.services.map(s => [s.name, s]));
      this.config.gateway.services = docker.map((svc, i) => {
        const prev = existing.get(svc.name);
        return prev ?? {
          name: svc.name,
          upstream: `${svc.name}:${svc.port}`,
          path: '/',
          domain: '',
          auth: 'none',
          rateLimit: 0,
          corsOrigins: [],
        };
      });
      if (this.config.gateway.services.length === 0 && docker.length > 0) {
        // ensure at least one gateway service exists for first docker service
        this.config.gateway.services.push({
          name: docker[0].name,
          upstream: `${docker[0].name}:${docker[0].port}`,
          path: '/',
          domain: '',
          auth: 'none',
          rateLimit: 0,
          corsOrigins: [],
        });
      }
    },

    toggleGateway(enabled: boolean) {
      this.config.gateway.enabled = enabled;
      if (enabled && this.config.gateway.services.length === 0) {
        this.syncGatewayFromDocker();
      }
    },

    toggleCicd(enabled: boolean) {
      this.config.cicd.enabled = enabled;
    },

    async rebuild() {
      // Re-generate after config changes on preview step
      if (this.generated) await this.generate();
    },

    async generate() {
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/generate/stack?format=zip&preview=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Generation failed' }));
          throw new Error(err.error || 'Generation failed');
        }
        const data = await res.json();
        this.files = data.files;
        this.zipSize = data.zipSize ?? 0;
        this.active = 0;
        this.generated = true;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.loading = false;
    },

    async downloadZip() {
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/generate/stack?format=zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Download failed' }));
          throw new Error(err.error || 'Download failed');
        }
        const blob = await res.blob();
        const size = blob.size;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stackgen-stack-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        this.zipSize = size;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.loading = false;
    },
  };
}