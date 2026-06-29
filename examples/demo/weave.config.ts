import { defineConfig } from '@weave/cli';

/**
 * Weave Board demo — build/dev config (Angular-style: one file declares it all).
 * `weave dev` serves from memory (no `dist/`); `weave build` wipes + writes a
 * self-contained `dist/`. Component styles are authored in `.scss`.
 */
export default defineConfig({
  entry: 'src/main.ts',
  index: 'src/index.html', // clean shell — Weave injects the entry script + (dev) live-reload
  publicDir: 'public', // static assets (favicons, manifest): served in dev, copied into dist
  outDir: 'dist',
  styleLang: 'scss', // components pair `<name>.scss`
  styles: ['src/styles/main.scss'], // global entry stylesheet (tokens + reset + layout)
  dev: { port: 8000 },
  build: { minify: true },
});
