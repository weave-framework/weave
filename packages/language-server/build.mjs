/**
 * Bundle the language server to a single `dist/server.js` the editors can spawn.
 * `typescript` stays external — the server loads the editor's TypeScript via its
 * tsdk path, never its own copy.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

// CommonJS output: many Volar/vscode-languageservice deps are CJS and do relative
// `require('./parser/…')` lazily; bundling to CJS lets esbuild inline them all (an
// ESM bundle leaves those requires dangling against the output dir). `.cjs` keeps it
// unambiguous under the package's "type": "module".
await build({
  entryPoints: [dir + 'src/server.ts'],
  outfile: dir + 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['typescript'],
  // Prefer the ESM build of deps (e.g. vscode-css-languageservice ships a UMD `main`
  // whose lazy `require('./parser/…')` esbuild can't follow, but a static-import
  // `module` build it bundles cleanly).
  mainFields: ['module', 'main'],
  logLevel: 'info',
});
