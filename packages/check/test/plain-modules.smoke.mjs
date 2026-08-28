/**
 * `weave check` must check the WHOLE project, not only the components.
 *
 * The checker built one program out of the component virtuals and then asked for diagnostics on those
 * files alone. Plain modules — services, stores, helpers, `routes.gen.ts`, everything that is not a
 * component — were pulled in as dependencies and never reported on. So a scaffolded app, whose only
 * quality script is `weave check`, would call `export const name: string = 123` clean, and a missing
 * module import in a non-component file passed silently too. Meanwhile `tsc --noEmit` on the same
 * project found both. A gate that green-lights an app plain `tsc` rejects is worse than no gate.
 *
 * Run: `node packages/check/test/plain-modules.smoke.mjs` (wired into `pnpm verify:check`).
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
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
const out = join(cacheDir, 'check-for-plain-modules-test.mjs');
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

console.log('\npackages/check/test/plain-modules.smoke.mjs');

/** Write a throwaway project from `{ relativePath: contents }` and check it. The fixture lives inside
 *  the repo, so the paths exercised are under the working directory the way a real app's are. */
function checkFiles(files) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-plain-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags;
}

// 1. A type error in a plain module nothing imports.
{
  const diags = checkFiles({
    'lib/util.ts': 'export const doubled = (n: number): number => n * 2;\nexport const wrong: string = 123;\n',
  });
  ok(
    diags.some((d) => d.code === 2322 && /lib[\\/]util\.ts$/.test(d.file)),
    `a type error in a plain module is reported (got ${JSON.stringify(diags.map((d) => `${d.file}:${d.code}`))})`
  );
}

// 2. A plain module a component imports — the shape a real app has.
{
  const diags = checkFiles({
    'app/app.ts': "import { total } from '../lib/cart';\nexport function setup() {\n  return { total };\n}\n",
    'app/app.html': '<p>{{ total() }}</p>\n',
    'lib/cart.ts': 'export const total = (): number => 1;\nexport const broken: number = "not a number";\n',
  });
  ok(
    diags.some((d) => d.code === 2322 && /lib[\\/]cart\.ts$/.test(d.file)),
    `a type error in an imported module is reported (got ${JSON.stringify(diags.map((d) => `${d.file}:${d.code}`))})`
  );
}

// 3. An import of a module that does not exist — how a missing generated file (`routes.gen.ts`) shows up.
{
  const diags = checkFiles({
    'app/router.ts': "import { routes } from './routes.gen';\nexport const all = routes;\n",
  });
  ok(
    diags.some((d) => d.code === 2307),
    `a missing module in a plain file is reported (got ${JSON.stringify(diags.map((d) => `${d.file}:${d.code}`))})`
  );
}

// 4. A clean project stays clean — plain modules must not invent errors of their own.
{
  const diags = checkFiles({
    'app/app.ts': "import { total } from '../lib/cart';\nexport function setup() {\n  return { total };\n}\n",
    'app/app.html': '<p>{{ total() }}</p>\n',
    'lib/cart.ts': 'export const total = (): number => 1;\n',
    'lib/types.ts': 'export interface Item {\n  id: string;\n}\n',
  });
  ok(diags.length === 0, `a clean project reports nothing (got ${JSON.stringify(diags.map((d) => `${d.file}: ${d.message}`))})`);
}

// 5. Line and column point at the real position in the real file, not at a virtual module.
{
  const diags = checkFiles({
    'lib/util.ts': '// a comment\nexport const wrong: string = 123;\n',
  });
  const d = diags.find((x) => x.code === 2322);
  ok(d?.line === 2, `the diagnostic keeps its line (got ${d?.line})`);
  ok(d?.col === 14, `the diagnostic keeps its column (got ${d?.col})`);
}

// 6. A plain module's path prints the way a component's does — relative to where the command runs.
{
  const diags = checkFiles({ 'lib/util.ts': 'export const wrong: string = 123;\n' });
  const d = diags.find((x) => x.code === 2322);
  ok(d !== undefined && !isAbsolute(d.file), `the reported path is relative, like a component's (got ${d?.file})`);
}

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ plain-module smoke passed');
process.exit(failures ? 1 : 0);
