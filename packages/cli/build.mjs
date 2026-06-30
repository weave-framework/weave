/**
 * Build the publishable CLI bundle: dist/cli.js (esbuild, ESM, Node). Inlines
 * @weave/compiler + @weave/check; esbuild/typescript/sass stay external (real
 * dependencies, resolved from the user's install). Type declarations are emitted
 * separately by `tsc -p tsconfig.build.json` (emitDeclarationOnly). Replaces the
 * old on-the-fly bundling the bin used to do at runtime.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, 'src/cli.ts')],
  outfile: join(here, 'dist/cli.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['esbuild', 'typescript', 'sass'],
});

console.log('cli build → packages/cli/dist/cli.js');
