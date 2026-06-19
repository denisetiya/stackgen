import type { GatewayType } from '@stackgen/core/schemas';

interface GatewayService {
  name: string;
  upstream: string;
  path: string;
  domain?: string;
  auth: 'none' | 'jwt' | 'keycloak';
  rateLimit: number;
  corsOrigins: string[];
}

interface GatewayConfig {
  type: GatewayType;
  services: GatewayService[];
  tls: 'letsencrypt' | 'selfsigned' | 'none';
  email?: string;
  dashboard: boolean;
}

interface GatewayWizard {
  step: number;
  steps: string[];
  gateways: { id: GatewayType; name: string; desc: string; defaultPort: number }[];
  config: GatewayConfig;
  files: { path: string; content: string }[];
  active: number;
  loading: boolean;
  error: string;
  init(): void;
  addService(): void;
  rebuild(): Promise<void>;
  next(): Promise<void>;
  prev(): void;
  downloadZip(): Promise<void>;
}

declare global {
  interface Window {
    gatewayWizardData: { gateways: GatewayWizard['gateways'] };
  }
}

export function gatewayWizardFactory(): GatewayWizard {
  return {
    step: 0,
    steps: ['Type', 'Services', 'TLS', 'Preview'],
    gateways: window.gatewayWizardData.gateways,
    config: {
      type: 'kong',
      services: [],
      tls: 'none',
      dashboard: false,
    },
    files: [],
    active: 0,
    loading: false,
    error: '',

    init() {
      if (this.config.services.length === 0) this.addService();
      this.$watch('config', () => {
        if (this.step === 3) this.rebuild();
      }, { deep: true });
    },

    addService() {
      this.config.services.push({
        name: `svc-${this.config.services.length + 1}`,
        upstream: `app:${3000 + this.config.services.length}`,
        path: '/',
        domain: '',
        auth: 'none',
        rateLimit: 0,
        corsOrigins: [],
      });
    },

    async rebuild() {
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/generate/gateway', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Failed');
        this.files = (await res.json()).files;
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
        const res = await fetch('/api/generate/gateway?format=zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stackgen-gateway-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.loading = false;
    },
  };
}
