/**
 * Bundle the tsserver plugin to a single CommonJS module. tsserver `require()`s the
 * plugin and calls the export as a factory, so the footer makes the default export
 * the module's exports.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

await build({
  entryPoints: [dir + 'src/index.ts'],
  outfile: dir + 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['typescript'],
  mainFields: ['module', 'main'],
  footer: { js: 'if (module.exports.default) module.exports = module.exports.default;' },
  logLevel: 'info',
});
