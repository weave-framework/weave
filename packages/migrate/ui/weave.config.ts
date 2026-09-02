import { defineConfig } from '@weave-framework/cli';

/**
 * The `weave migrate` UI — a Weave app, served by the local migration service.
 *
 * Built ahead of publishing and shipped as static files, the way the docs site is built with the same CLI. The
 * service hands these out from `dist/`; nothing here talks to anything but `http://127.0.0.1:<port>/api/*`.
 */
export default defineConfig({
  root: 'src/app/app',
  index: 'src/index.html',
  outDir: 'dist',
  styleLang: 'css',
  styles: ['src/styles/main.css'], // tokens + reset — scoped component styles cannot reach :root/body
  build: { minify: true },
  dev: { port: 4280 },
});
