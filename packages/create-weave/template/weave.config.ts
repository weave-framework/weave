import { defineConfig } from '@weave-framework/cli';

export default defineConfig({
  root: 'src/app/app',     // root component — Weave generates the bootstrap
  index: 'src/index.html', // HTML shell; Weave injects the script + styles
  publicDir: 'public',     // static assets copied into the build
  outDir: 'dist',          // production output
  dev: { port: 5173 },
});
