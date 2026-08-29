/**
 * A component may name its own types whatever it likes.
 *
 * The checker embeds a component's script verbatim into the module it synthesizes around it, and that
 * module declared the component's own type using the bare global name `Node`. So a component that
 * declared `interface Node` — a tree, a menu, a graph: the most natural name there is — silently
 * retyped its own default export, and every parent that rendered it got the memorable
 * `Type 'Node' is not assignable to type 'Node'`. Nine of the docs site's demos were in that state.
 *
 * The negative half matters as much: the component's OWN `Node` must still mean its own `Node`, or the
 * fix would have been to quietly ignore what the author wrote.
 *
 * Run: `node packages/check/test/shadowed-globals.smoke.mjs` (wired into `pnpm verify:check`).
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
const out = join(cacheDir, 'check-for-shadowed-globals-test.mjs');
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

console.log('\npackages/check/test/shadowed-globals.smoke.mjs');

/** A `Tree` component that declares its own `Node`, and a page that renders it. */
function checkTree(treeTs) {
  const dir = mkdtempSync(join(repo, 'tools', '.verify-check-shadowed-'));
  const write = (rel, text) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write('tree/tree.ts', treeTs);
  write('tree/tree.html', '<ul>@for (n of nodes; track n.label) { <li>{{ n.label }}</li> }</ul>\n');
  // Assigning it to the runtime's `Component` is what a registry, a router table or a lazy import does,
  // and it is where the shadowed name actually bites: rendering it from a template alone did not, which
  // is why the first version of this gate passed against the bug.
  write(
    'page/page.ts',
    'import Tree from "../tree/tree";\n' +
      'import type { Component } from "@weave-framework/runtime/dom";\n' +
      'export const registered: Component = Tree;\n' +
      'export function setup(): { items: { label: string }[] } {\n' +
      '  return { items: [{ label: "a" }] };\n' +
      '}\n'
  );
  write('page/page.html', '<div><Tree nodes={{ items }} /></div>\n');
  const diags = checkProject([dir]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  return diags;
}

const OWN_NODE =
  'interface Node {\n' +
  '  label: string;\n' +
  '}\n' +
  'export function setup(props?: { nodes?: Node[] }): { nodes: Node[] } {\n' +
  '  return { nodes: props?.nodes ?? [] };\n' +
  '}\n';

// 1. Rendering it must be clean. The component's `Node` is its own business.
{
  const diags = checkTree(OWN_NODE).filter((d) => d.category === 'error');
  ok(
    !diags.some((d) => /Two different types with this name exist/.test(d.message)),
    'a component that declares its own `Node` does not fight the DOM one'
  );
  ok(diags.length === 0, 'and the project is clean (got ' + JSON.stringify(diags.map((d) => d.message)) + ')');
}

// 2. And that `Node` still means what the author wrote: a node without a `label` is an error.
{
  const diags = checkTree(OWN_NODE.replace('label: string;', 'label: string;\n  weight: number;'));
  ok(
    diags.some((d) => d.category === 'error' && /weight/.test(d.message)),
    "the component's own `Node` is still enforced (got " + JSON.stringify(diags.map((d) => d.message)) + ')'
  );
}

if (failures) {
  console.error(`\n✖ ${failures} shadowed-global check(s) failed\n`);
  process.exit(1);
}
console.log('\n✔ a component may name its own types whatever it likes\n');
process.exit(0);
