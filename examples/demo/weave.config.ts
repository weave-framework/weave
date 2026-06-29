import { defineConfig } from '@weave/cli';

/**
 * Weave Board demo — build/dev config (Angular-style: one file declares it all).
 * `weave dev` serves from memory (no `dist/`); `weave build` wipes + writes a
 * self-contained `dist/`. Component styles are authored in `.scss`.
 */
export default defineConfig({
  root: 'src/app/shell', // root component — Weave generates the bootstrap (mount + custom-element registration)
  // mount defaults to '#app'; index.html places that <div> wherever the author wants.
  index: 'src/index.html', // clean shell — Weave injects the entry script + (dev) live-reload
  publicDir: 'public', // static assets (favicons, manifest): served in dev, copied into dist
  outDir: 'dist',
  routesDir: 'src/pages', // file-based routing: a page file under here becomes a route (regenerated each build/dev)
  styleLang: 'scss', // components pair `<name>.scss`
  styles: ['src/styles/main.scss'], // global entry stylesheet (tokens + reset + layout)
  dev: { port: 8000 },
  build: { minify: true },
});
