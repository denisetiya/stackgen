import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    tailwind({ applyBaseStyles: true }),
  ],
  server: { host: '0.0.0.0', port: 4321 },
  redirects: {
    '/docker': '/stack',
    '/gateway': '/stack?step=3',
    '/cicd': '/stack?step=4',
  },
  vite: {
    ssr: {
      noExternal: ['@stackgen/core'],
    },
  },
});
