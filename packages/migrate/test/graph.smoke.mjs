/**
 * Node smoke for `@weave-framework/migrate` graph keys — the folder each node is grouped by.
 *
 * The graph draws 227 cards for one real application, and no arrangement of that many makes a picture worth
 * reading. Grouping is the answer, and the folder a file lives in is the axis: measured, it covers 170 of the
 * 227 nodes and its first level separates the application from the shared component and service libraries.
 * (Angular's lazy boundaries were measured first and reach only 57 of the 227, so they group nothing.)
 *
 * Two things make or break that key, and each is guarded here:
 *   root     — the key is relative to the deepest folder holding EVERY file read, not to the analysed unit.
 *              An application reaches into sibling workspace libraries, so half its files sit outside it;
 *              measured against the unit, 110 of 227 nodes fell into one bucket named after the drive letter.
 *   carriers — `src`, `app`, `lib(s)`, `apps`, `projects` are repeated by every workspace and say nothing
 *              about what a file is. Left in, the first level of every group is the word "src".
 *
 * Run: `node packages/migrate/test/graph.smoke.mjs` (wired as `pnpm verify:migrate-graph`).
 */
import { build as esbuild } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const app = join(here, 'fixtures', 'alias-modules', 'app');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✔' : '  ✖'} ${msg}`);
  if (!cond) failures++;
};

console.log('\nverify:migrate-graph — every node carries the folder it is grouped by\n');

const bundles = {};
for (const name of ['analyze', 'graph']) {
  const out = join(here, `.graph.${name}.mjs`);
  await esbuild({
    entryPoints: [join(repo, 'packages', 'migrate', 'src', `${name}.ts`)],
    bundle: true, format: 'esm', platform: 'node', outfile: out, packages: 'external',
  });
  bundles[name] = await import(pathToFileURL(out).href);
}

const facts = bundles.analyze.assembleFactsOpening(app, ['*']);
const graph = bundles.graph.buildGraph(facts);
const at = (label) => graph.nodes.find((n) => n.label === label);

const one = at('OneService');
const two = at('TwoService');
const shell = at('ShellComponent');
const three = at('ThreeService');
ok(one && two && shell && three, `the fixture yields all four nodes (${[one, two, shell, three].filter(Boolean).length}/4)`);

// Every node with a source file gets a key; a node without one (a route, an npm class) gets none.
const sourced = graph.nodes.filter((n) => ['component', 'service', 'ngmodule'].includes(n.kind));
ok(sourced.every((n) => n.folder !== undefined), `every sourced node has a folder key (${sourced.filter((n) => n.folder !== undefined).length}/${sourced.length})`);

// The root is the deepest folder holding EVERY file, so the two module barrels differ by their own name only.
ok(one?.folder === 'modules/one', `the first module keys on its own folder (got "${one?.folder}")`);
ok(two?.folder === 'modules/two', `the second keys on its own, not merged with the first (got "${two?.folder}")`);

// The library OUTSIDE the analysed unit is the case that proves the root is common rather than unit-relative:
// `shared/three` sits beside the application, so a unit-relative key cannot express it without the full path.
ok(three?.folder === 'shared/three', `a library outside the unit keys on its own folder (got "${three?.folder}")`);
ok(!(three?.folder ?? '').includes(':'), 'no key falls back to an absolute path with a drive letter');

// `app` is a carrier: ShellComponent lives in src/app/shell and must key on "shell".
ok(shell?.folder === 'shell', `carrier segments are dropped from the key (got "${shell?.folder}")`);
ok(!sourced.some((n) => (n.folder ?? '').split('/').some((p) => ['src', 'app', 'lib', 'libs', 'apps'].includes(p))),
   'no key contains a carrier segment anywhere');

// The keys must actually separate: one group per module, not everything in one bucket.
const groups = new Set(sourced.map((n) => (n.folder || '(root)').split('/')[0]));
ok(groups.size >= 2, `the keys separate the nodes into groups (${groups.size}: ${[...groups].join(', ')})`);

// The file each node came from travels with it, so the UI can show where a card lives.
ok(one?.file?.endsWith('one.service.ts'), `each node carries its own file (got "${one?.file}")`);

for (const name of ['analyze', 'graph']) rmSync(join(here, `.graph.${name}.mjs`), { force: true });
console.log(`\n${failures ? `${failures} failing` : 'all green'}\n`);
process.exit(failures ? 1 : 0);
