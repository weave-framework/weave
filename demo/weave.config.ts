import { defineConfig } from '@weave-framework/cli';

/**
 * Weave Analytics — a flagship demo built with nothing but Weave, to show two things:
 *  1) fine-grained reactivity under a live, high-frequency data feed (only the exact
 *     cell that changes repaints), and
 *  2) that the UI library re-skins entirely through design tokens — this app looks
 *     nothing like the Weave docs, yet uses the same components (see src/styles/main.scss).
 *
 * Self-contained: all data is simulated client-side (no API), so it deploys as a static
 * SPA (Cloudflare Pages).
 */
export default defineConfig({
  root: 'src/app/dashboard',
  index: 'src/index.html',
  publicDir: 'public',
  outDir: 'dist',
  styleLang: 'scss',
  styles: ['src/styles/main.scss'],
  dev: { port: 8300 },
  build: { minify: true },
});
