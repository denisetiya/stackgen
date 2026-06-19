import type { FrameworkId, DatabaseId } from '@stackgen/core/schemas';

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

interface DockerConfig {
  mode: 'single' | 'microservice';
  services: DockerService[];
  registry: { type: 'ghcr' | 'dockerhub' | 'none'; namespace?: string; imageName: string };
  compose: boolean;
  network: string;
  ci: boolean;
  ciProvider: 'github' | 'gitlab';
}

interface DockerWizard {
  step: number;
  steps: string[];
  frameworks: { id: FrameworkId; name: string; lang: string; defaultPort: number; defaultBase: string }[];
  databases: { id: DatabaseId; name: string; port: number; defaultVersion: string }[];
  config: DockerConfig;
  files: { path: string; content: string }[];
  active: number;
  loading: boolean;
  error: string;
  init(): void;
  loadFromURL(): void;
  saveToURL(): void;
  addService(): void;
  removeService(i: number): void;
  rebuild(): Promise<void>;
  next(): Promise<void>;
  prev(): void;
  downloadZip(): Promise<void>;
}

declare global {
  interface Window {
    dockerWizardData: {
      frameworks: DockerWizard['frameworks'];
      databases: DockerWizard['databases'];
    };
  }
}

export function dockerWizardFactory(): DockerWizard {
  return {
    step: 0,
    steps: ['Framework', 'Environment', 'Registry', 'Preview'],
    frameworks: window.dockerWizardData.frameworks,
    databases: window.dockerWizardData.databases,
    config: {
      mode: 'single',
      services: [],
      registry: { type: 'ghcr', namespace: '', imageName: 'app' },
      compose: true,
      network: 'app-net',
      ci: true,
      ciProvider: 'github',
    },
    files: [],
    active: 0,
    loading: false,
    error: '',

    init() {
      if (this.config.services.length === 0) this.addService();
      this.loadFromURL();
      this.rebuild();
      this.$watch('config', () => this.rebuild(), { deep: true });
    },

    loadFromURL() {
      const params = new URLSearchParams(window.location.search);
      const data = params.get('c');
      if (!data) return;
      try {
        const parsed = JSON.parse(atob(data));
        this.config = { ...this.config, ...parsed };
      } catch {}
    },

    saveToURL() {
      const data = btoa(JSON.stringify(this.config));
      const url = new URL(window.location.href);
      url.searchParams.set('c', data);
      window.history.replaceState({}, '', url);
    },

    addService() {
      const fw = this.frameworks[0];
      this.config.services.push({
        name: `service-${this.config.services.length + 1}`,
        framework: fw.id,
        port: fw.defaultPort,
        baseImage: 'alpine',
        env: [],
        healthcheckPath: '/health',
        replicas: 1,
        dependsOn: [],
      });
    },

    removeService(i: number) {
      this.config.services.splice(i, 1);
    },

    async rebuild() {
      this.saveToURL();
      if (this.step !== 3) return;
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/generate/docker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Generation failed');
        const data = await res.json();
        this.files = data.files;
        this.active = 0;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.loading = false;
    },

    async next() {
      if (this.step < this.steps.length - 1) {
        this.step++;
        if (this.step === 3) await this.rebuild();
      }
    },

    prev() {
      if (this.step > 0) this.step--;
    },

    async downloadZip() {
      this.loading = true;
      try {
        const res = await fetch('/api/generate/docker?format=zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stackgen-docker-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.loading = false;
    },
  };
}
