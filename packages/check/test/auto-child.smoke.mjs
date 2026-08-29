/**
 * `weave check` must agree with `weave build` about child components.
 *
 * The build's loader resolves a PascalCase tag by convention — `<TodoItem>` finds
 * `./todo-item/todo-item.ts` and wires the import itself — so an app that never writes the import
 * compiles, runs, and renders. The checker did not: it reported `Cannot find name 'TodoItem'`. A tool
 * calling a working app broken is the fastest way to make someone stop running it.
 *
 * The other direction still has to hold: a tag that resolves to NOTHING is a real error, in both.
 *
 * Run: `node packages/check/test/auto-child.smoke.mjs` (wired into `pnpm verify:check`).
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
const out = join(cacheDir, 'check-for-auto-child-test.mjs');
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

console.log('\npackages/check/test/auto-child.smoke.mjs');

function project(files) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-child-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true });
  return diags;
}

const CHILD_TS = 'export function setup(props: { title: string }) {\n  const title = () => props.title;\n  return { title };\n}\n';
const CHILD_HTML = '<li>{{ title() }}</li>\n';

// 1. Dir-per-component (`../todo-item/todo-item`) — the layout the scaffold suggests.
{
  const diags = project({
    'app/app.ts': 'export function setup() {\n  return { name: "x" };\n}\n',
    'app/app.html': '<ul><TodoItem title={{ name }} /></ul>\n',
    'app/todo-item/todo-item.ts': CHILD_TS,
    'app/todo-item/todo-item.html': CHILD_HTML,
  });
  ok(diags.length === 0, `an auto-resolved child needs no import (got ${JSON.stringify(diags.map((d) => d.message))})`);
}

// 2. Flat sibling (`./todo-item`).
{
  const diags = project({
    'app/app.ts': 'export function setup() {\n  return { name: "x" };\n}\n',
    'app/app.html': '<ul><TodoItem title={{ name }} /></ul>\n',
    'app/todo-item.ts': CHILD_TS,
    'app/todo-item.html': CHILD_HTML,
  });
  ok(diags.length === 0, `a flat sibling resolves too (got ${JSON.stringify(diags.map((d) => d.message))})`);
}

// 3. The contract still applies — resolving the child is not the same as trusting it.
{
  const diags = project({
    'app/app.ts': 'export function setup() {\n  return { n: 1 };\n}\n',
    'app/app.html': '<ul><TodoItem title={{ n }} /></ul>\n',
    'app/todo-item/todo-item.ts': CHILD_TS,
    'app/todo-item/todo-item.html': CHILD_HTML,
  });
  ok(
    diags.some((d) => /not assignable/.test(d.message)),
    `a wrong prop type on an auto-resolved child is still an error (got ${JSON.stringify(diags.map((d) => d.message))})`
  );
}

// 4. A tag that resolves to nothing is still an error — the build fails on it too.
{
  const diags = project({
    'app/app.ts': 'export function setup() {\n  return { name: "x" };\n}\n',
    'app/app.html': '<ul><NoSuchThing title={{ name }} /></ul>\n',
  });
  ok(
    diags.some((d) => /Cannot find name 'NoSuchThing'/.test(d.message)),
    `an unresolvable tag is reported (got ${JSON.stringify(diags.map((d) => d.message))})`
  );
}

// 5. An explicit import still wins — the synthesized one must not collide with it.
{
  const diags = project({
    'app/app.ts': "import TodoItem from './todo-item/todo-item';\nvoid TodoItem;\nexport function setup() {\n  return { name: 'x' };\n}\n",
    'app/app.html': '<ul><TodoItem title={{ name }} /></ul>\n',
    'app/todo-item/todo-item.ts': CHILD_TS,
    'app/todo-item/todo-item.html': CHILD_HTML,
  });
  ok(diags.length === 0, `an explicit import is untouched (got ${JSON.stringify(diags.map((d) => d.message))})`);
}

console.log(failures ? `\n✖ ${failures} check failure(s)` : '\n✔ auto-child smoke passed');
process.exit(failures ? 1 : 0);
