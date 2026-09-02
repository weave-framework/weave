/**
 * Run the migration service from this checkout — `pnpm migrate`.
 *
 * The published command will be `weave migrate`, which starts the same service out of the installed package.
 * This is the development door onto it: it builds the UI, starts the service pointed at that build, and prints
 * the URL. Nothing else — no browser is opened, because a printed URL works over SSH, in WSL and in a container,
 * and an auto-opened window does not.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = join(repo, 'packages', 'migrate', 'ui', 'dist');

// Build the UI first, so what you see is what the source says — not whatever `dist/` happened to hold.
const built = spawnSync(
  process.execPath,
  [join(repo, 'packages', 'cli', 'bin', 'weave.mjs'), 'build', '--config', join(repo, 'packages', 'migrate', 'ui', 'weave.config.ts')],
  { stdio: 'inherit' },
);
if (built.status !== 0) process.exit(built.status ?? 1);

const bundle = join(repo, 'node_modules', '.weave-migrate-serve.mjs');
await build({
  entryPoints: [join(repo, 'packages', 'migrate', 'src', 'server.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile: bundle,
});
const { serve } = await import(pathToFileURL(bundle).href);
rmSync(bundle, { force: true });

const port = Number(process.argv[2]) || 4280;
const server = await serve({ port, uiDir });
console.log(`\nweave migrate → ${server.url}\n`);
console.log('Open that URL. Ctrl-C to stop.');

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}
