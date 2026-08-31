/**
 * `weave check` must read the project's own `.d.ts` files.
 *
 * Import an npm package that ships no types and TypeScript says TS7016, then tells you the fix:
 * "add a new declaration (.d.ts) file containing `declare module '…'`". Do exactly that and `tsc
 * --noEmit` goes green — while `weave check` kept reporting the same error, and kept printing the same
 * advice, for a file the author had already written. The checker was telling someone to do a thing it
 * then ignored.
 *
 * The cause is one clause in `collect()`: `path.endsWith('.ts') && !path.endsWith('.d.ts')`. Skipping a
 * `.d.ts` as a COMPONENT is right — it has no template and no setup. Dropping it from the program
 * entirely is not: an ambient `declare module` only takes effect when its file is a root of the
 * program, which is precisely what `tsconfig`'s `include` does for `tsc` and what this skipped.
 *
 * It matters beyond untyped packages: `declare global`, module augmentation, and the `.d.ts` shims an
 * app writes for its own assets all work the same way, and none of them reached the checker.
 *
 * Reproduced in isolation before it was reported — a five-file fixture in this repository, no
 * consuming app, with `tsc` exiting 0 on the same tree that `weave check` failed.
 *
 * Run: `node packages/check/test/ambient-dts.smoke.mjs` (wired into `pnpm verify:check`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

const cacheDir = join(repo, 'node_modules', '.weave');
mkdirSync(cacheDir, { recursive: true });
const out = join(cacheDir, 'check-for-ambient-dts-test.mjs');
await esbuild({
  entryPoints: [join(repo, 'packages', 'check', 'src', 'index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  external: ['typescript'],
  outfile: out,
});
const { checkProject } = await import(pathToFileURL(out).href);

console.log('\npackages/check/test/ambient-dts.smoke.mjs');

/** Write a throwaway project inside the repo and check it, exactly as plain-modules.smoke does. */
function checkFiles(files) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-dts-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags;
}

const codes = (diags) => JSON.stringify(diags.map((d) => `${d.file}:${d.code}`));

// 1. WITHOUT the shim: the error must still be reported. If this one stops firing, case 2 below proves
//    nothing — it would be green because nothing is checked at all.
{
  const diags = checkFiles({
    'app/a.ts': "import { thing } from 'nope-no-types-here';\nexport function setup() {\n  const run = (): void => thing();\n}\n",
    'app/a.html': '<button type="button" on:click={{ run }}>go</button>\n',
  });
  ok(
    diags.some((d) => d.code === 2307 || d.code === 7016),
    `an untyped/unresolvable import IS reported without a shim (got ${codes(diags)})`
  );
}

// 2. WITH the shim: an ambient `declare module` in the project silences it, the way tsc does.
{
  const diags = checkFiles({
    'app/a.ts': "import { thing } from 'nope-no-types-here';\nexport function setup() {\n  const run = (): void => thing();\n}\n",
    'app/a.html': '<button type="button" on:click={{ run }}>go</button>\n',
    'types/shim.d.ts': "declare module 'nope-no-types-here' {\n  export function thing(): void;\n}\n",
  });
  ok(
    !diags.some((d) => d.code === 2307 || d.code === 7016),
    `a project .d.ts resolves the module (got ${codes(diags)})`
  );
}

// 3. `declare global` from a project .d.ts reaches component code too — same mechanism, and the shape
//    an app uses for a global injected by its host page.
{
  const diags = checkFiles({
    'app/b.ts': 'export function setup() {\n  const version = (): string => __APP_VERSION__;\n}\n',
    'app/b.html': '<p>{{ version() }}</p>\n',
    'types/globals.d.ts': 'declare const __APP_VERSION__: string;\n',
  });
  ok(
    !diags.some((d) => d.code === 2304),
    `a global declared in a project .d.ts is visible (got ${codes(diags)})`
  );
}

// 4. A `.d.ts` must not be mistaken for a component: no template, no setup, and no complaint about it.
{
  const diags = checkFiles({
    'types/only.d.ts': "declare module 'x' {\n  export const y: number;\n}\n",
  });
  ok(diags.length === 0, `a lone .d.ts produces no diagnostics of its own (got ${codes(diags)})`);
}

rmSync(out, { force: true });

console.log('\n----------------------------------------');
if (failures) {
  console.error(`ambient-dts smoke FAILED (${failures})\n`);
  process.exit(1);
}
console.log('ambient-dts smoke passed\n');
