/**
 * `@weave-framework/ui/testing` must never reach a production bundle.
 *
 * The harness lives inside the library rather than in a package of its own, because it needs the
 * library's internals — the overlay container, the focus machinery — and a separate package would
 * force those into a public API that is frozen. The cost of that choice is that test-only code sits in
 * the same package as production code, and the whole argument rests on it tree-shaking away.
 *
 * "It tree-shakes" is exactly the kind of claim that is true until it is not: one side effect, one
 * eager import at module scope, and it is false without anything failing. So this builds an app that
 * imports a component the ordinary way, and reads the output.
 *
 * The negative case is what keeps it honest: an app that DOES import the harness must contain it, or
 * this is just asserting that a string never appears.
 *
 * Run: `node packages/ui/test/testing-subpath.smoke.mjs` (wired into `pnpm verify:ui-testing`).
 */
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('X ' + msg);
    failed++;
  } else console.log('+ ' + msg);
};

console.log('\npackages/ui/test/testing-subpath.smoke.mjs');

/** Bundle one entry the way a production build would, and return the output. */
const bundleOf = async (source) => {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-ui-testing-'));
  const entry = join(dir, 'entry.ts');
  writeFileSync(entry, source);
  const out = join(dir, 'out.js');
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    treeShaking: true,
    outfile: out,
    absWorkingDir: repo,
    loader: { '.html': 'text', '.scss': 'empty', '.css': 'empty' },
    external: ['sass'],
  });
  const text = readFileSync(out, 'utf8');
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return text;
};

// Measured, not guessed. Minification renames every parameter and drops every comment, so an
// assertion phrased against source text is satisfied by a bundle that DOES contain the harness — the
// first version of this file asserted exactly that, and stayed green when the entry imported it.
// What survives is a string LITERAL: the harness constructs a `keydown` event, and an icon has no
// keyboard. And the size: the harness reaches the compiler, so carrying it is not a rounding error.
const COMPONENT = ["import { setup } from '@weave-framework/ui/icon';", 'export const used = setup;', ''].join('\n');
const COMPONENT_PLUS_HARNESS = [
  "import { setup } from '@weave-framework/ui/icon';",
  "import { press } from '@weave-framework/ui/testing';",
  'export const used = [setup, press];',
  '',
].join('\n');

const app = await bundleOf(COMPONENT);
const withHarness = await bundleOf(COMPONENT_PLUS_HARNESS);

ok(!app.includes('keydown'), `a production bundle carries no part of the harness (${app.length} bytes)`);
ok(
  withHarness.includes('keydown'),
  `while one that imports it does (${withHarness.length} bytes) — so the check above means something`
);
ok(
  withHarness.length > app.length * 1.5,
  `and carrying it is not a rounding error: ${app.length} -> ${withHarness.length} bytes`
);

if (failed) {
  console.error('\nX ' + failed + ' ui-testing check(s) failed\n');
  process.exit(1);
}
console.log('\n+ the testing subpath exists, and never lands in a production bundle\n');
process.exit(0);
