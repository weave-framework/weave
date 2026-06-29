import { defineConfig } from '@weave/cli';

/**
 * Weave Board demo — build/dev config (Angular-style: one file declares it all).
 * `weave dev` serves from memory (no `dist/`); `weave build` wipes + writes a
 * self-contained `dist/`. Component styles are authored in `.scss`.
 */
export default defineConfig({
  entry: 'src/main.ts',
  index: 'index.html',
  outDir: 'dist',
  styleLang: 'scss', // components pair `<name>.scss`
  styles: ['src/styles/main.scss'], // global entry stylesheet (tokens + reset + layout)
  dev: { port: 8000 },
  build: { minify: true },
});
