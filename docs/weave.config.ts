import { defineConfig } from '@weave-framework/cli';

/**
 * Weave documentation site — built WITH Weave itself (dogfooding). A static SPA
 * deployed to GitHub Pages. `weave dev` serves from memory; `weave build` writes a
 * self-contained `dist/` for Pages (with an SPA fallback for deep links).
 */
export default defineConfig({
  root: 'src/app/shell', // root component — Weave generates the bootstrap (mount + custom elements)
  index: 'src/index.html',
  publicDir: 'public', // favicon + (later) the prebuilt search index, copied verbatim
  outDir: 'dist',
  routesDir: 'src/pages', // file-based routing: a page file under here becomes a route
  styleLang: 'scss',
  styles: ['src/styles/main.scss'], // tokens + reset + layout shell
  dev: { port: 8100 },
  build: { minify: true },
});
