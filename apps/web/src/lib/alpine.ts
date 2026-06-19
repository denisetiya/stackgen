import Alpine from 'alpinejs';

type WizardFactory = () => Record<string, unknown>;

/**
 * Initialize Alpine.js + register wizard components.
 * Call once per page. Pass wizard factories as `Alpine.data()` registrations
 * to survive Vite tree-shaking (string-attribute `x-data="name()"` is not a
 * static import, so bare function declarations get tree-shaken away).
 */
export function startAlpine(wizards: Record<string, WizardFactory> = {}) {
  if (typeof window === 'undefined') return; // SSR guard
  (window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
  for (const [name, factory] of Object.entries(wizards)) {
    Alpine.data(name, factory);
  }
  Alpine.start();
}
