interface DeployTarget {
  type: 'ssh' | 'k8s' | 'fly' | 'none';
  host?: string;
  user?: string;
  sshKey?: string;
  namespace?: string;
  cluster?: string;
}

interface CicdConfig {
  provider: 'github' | 'gitlab';
  trigger: 'push-main' | 'push-tags' | 'manual' | 'pr';
  build: boolean;
  test: boolean;
  push: boolean;
  deploy: boolean;
  deployTarget?: DeployTarget;
  registry: { type: 'ghcr' | 'dockerhub' | 'none'; namespace?: string; imageName: string };
  notification: 'none' | 'telegram' | 'slack' | 'discord';
  webhookUrl?: string;
  services: string[];
}

interface CicdWizard {
  step: number;
  steps: string[];
  config: CicdConfig;
  files: { path: string; content: string }[];
  active: number;
  loading: boolean;
  error: string;
  init(): void;
  rebuild(): Promise<void>;
  next(): Promise<void>;
  prev(): void;
  downloadZip(): Promise<void>;
}

export function cicdWizardFactory(): CicdWizard {
  return {
    step: 0,
    steps: ['Provider', 'Steps', 'Registry', 'Preview'],
    config: {
      provider: 'github',
      trigger: 'push-main',
      build: true,
      test: true,
      push: true,
      deploy: false,
      deployTarget: { type: 'ssh', host: '', user: '' },
      registry: { type: 'ghcr', namespace: '' },
      notification: 'none',
      services: [],
    },
    files: [],
    active: 0,
    loading: false,
    error: '',

    init() {
      this.$watch('config', () => {
        if (this.step === 3) this.rebuild();
      }, { deep: true });
    },

    async rebuild() {
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/generate/cicd', {
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
        const res = await fetch('/api/generate/cicd?format=zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.config),
        });
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stackgen-cicd-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.loading = false;
    },
  };
}
